/**
 * 防篡改审计:审计事件升级为「Ed25519 签名的哈希链」(自 mcp-foundry 迁入,
 * node:crypto → WebCrypto,Node/edge/浏览器通用)。
 *
 * 每条记录带 seq(单调)、prevHash(前条 hash)、hash(本条规范化内容 SHA-256)、
 * sig(对 hash 的 Ed25519 签名)。两层保护:
 *  - 哈希链:改任一历史记录 → 断掉后续 prevHash 链 → 复算即暴露
 *  - 签名:能写文件的攻击者也无法重算合法签名(私钥不在服务器)
 * 校验只需公钥,可离线进行。私钥属签发方,绝不落服务器——
 * 服务器能生产可验证的事实,却无法伪造历史。
 */
import { canonicalJson, sha256Hex } from '../core/hash'
import type { AuditEvent } from '../core/types'

export const GENESIS: string = '0'.repeat(64)

export interface SignedAuditEvent extends AuditEvent {
  seq: number
  prevHash: string
  /** sha256hex(canonicalJson({...event, seq, prevHash})) */
  hash: string
  /** 对 hash 字节的 Ed25519 签名,base64 */
  sig: string
}

const ED25519 = { name: 'Ed25519' } as const

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** hash 覆盖业务字段 + seq + prevHash——任一改动都会让复算结果不同 */
export async function computeChainHash(event: AuditEvent, seq: number, prevHash: string): Promise<string> {
  return sha256Hex(canonicalJson({ ...event, seq, prevHash }))
}

export interface AuditKeypair { privateKey: CryptoKey; publicKey: CryptoKey }

/** 生成 Ed25519 密钥对。私钥交签发方保管,公钥随日志分发给校验方 */
export async function generateAuditKeypair(): Promise<AuditKeypair> {
  const pair = (await globalThis.crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair
  return { privateKey: pair.privateKey, publicKey: pair.publicKey }
}

export async function exportKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return globalThis.crypto.subtle.exportKey('jwk', key)
}
export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('jwk', jwk, ED25519, true, ['sign'])
}
export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('jwk', jwk, ED25519, true, ['verify'])
}

export interface ChainHead { seq: number; prevHash: string }

/**
 * 签名链写入器(存储无关):串行队列保证 seq/prevHash 无竞态;
 * 写前算签,append 回调成功后才推进链头——落盘失败链头不前进,内存与盘不分叉。
 */
export class AuditChainSigner {
  private tail: Promise<void> = Promise.resolve()
  private seq: number
  private prevHash: string

  constructor(
    private readonly privateKey: CryptoKey,
    private readonly append: (record: SignedAuditEvent) => Promise<void>,
    resume?: ChainHead,
  ) {
    this.seq = resume?.seq ?? 0
    this.prevHash = resume?.prevHash ?? GENESIS
  }

  head(): ChainHead {
    return { seq: this.seq, prevHash: this.prevHash }
  }

  async log(event: AuditEvent): Promise<void> {
    const run = this.tail.then(() => this.appendOne(event))
    // 队列不因单条失败永久卡死:吞掉 rejection 让下一条继续(用未推进的链头);
    // 本次调用仍拿到原始 rejection,错误不被吞。
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private async appendOne(event: AuditEvent): Promise<void> {
    const seq = this.seq + 1
    const prevHash = this.prevHash
    const hash = await computeChainHash(event, seq, prevHash)
    const sigBytes = await globalThis.crypto.subtle.sign(ED25519, this.privateKey, hexToBytes(hash))
    const record: SignedAuditEvent = { ...event, seq, prevHash, hash, sig: bytesToBase64(new Uint8Array(sigBytes)) }
    await this.append(record) // 可能抛——抛出时链头不前进
    this.seq = seq
    this.prevHash = hash
  }
}

export interface VerifyResult {
  ok: boolean
  count: number
  /** 第一处断裂:序号+原因(ok=true 时不存在) */
  brokenAt?: { seq: number; reason: string }
}

/**
 * 离线校验:逐条查 seq 连续、prevHash 链接、hash 复算一致、签名有效。
 * 任一处失败即停并报因——把「日志没被动过」变成可复现的密码学事实。
 */
export async function verifyAuditChain(
  records: readonly SignedAuditEvent[],
  publicKey: CryptoKey,
): Promise<VerifyResult> {
  let prevHash = GENESIS
  let expectedSeq = 1
  for (const record of records) {
    const broken = (reason: string): VerifyResult => ({
      ok: false, count: records.length, brokenAt: { seq: record.seq, reason },
    })
    if (record.seq !== expectedSeq) return broken(`seq 不连续(期望 ${expectedSeq},实际 ${record.seq})`)
    if (record.prevHash !== prevHash) return broken('prevHash 断链(记录被删除、重排或插入)')
    const { seq, prevHash: recPrev, hash, sig, ...event } = record
    if ((await computeChainHash(event as AuditEvent, seq, recPrev)) !== hash) {
      return broken('hash 不匹配(记录字段被篡改)')
    }
    let sigOk = false
    try {
      sigOk = await globalThis.crypto.subtle.verify(ED25519, publicKey, base64ToBytes(sig), hexToBytes(hash))
    } catch {
      sigOk = false
    }
    if (!sigOk) return broken('签名无效(伪造,或公钥与签发私钥不符)')
    prevHash = hash
    expectedSeq += 1
  }
  return { ok: true, count: records.length }
}

/** 解析 JSONL 审计文本为签名记录数组(跳过空行) */
export function parseSignedAuditLog(text: string): SignedAuditEvent[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as SignedAuditEvent)
}
