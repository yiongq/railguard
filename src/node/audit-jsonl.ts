/** 审计的文件落盘(Node 专属):普通 JSONL sink 与签名哈希链 sink。 */
import { appendFile, mkdir, readFile, truncate } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  AuditChainSigner, parseSignedAuditLog,
  type ChainHead, type SignedAuditEvent,
} from '../audit/chain'
import type { AuditEvent, AuditSink } from '../core/types'

/** 普通 JSONL 审计 sink(不带防篡改;要防篡改用 SignedJsonlAuditSink) */
export function jsonlAuditSink(filePath: string): AuditSink {
  let dirReady: Promise<void> | null = null
  return async (event: AuditEvent): Promise<void> => {
    dirReady ??= mkdir(dirname(filePath), { recursive: true }).then(() => undefined)
    await dirReady
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  }
}

/**
 * 启动时读日志尾部续链,容忍崩溃/断电留下的残缺尾行:
 * 找出最后一条完整记录,**按字节物理截断**其后的残字节——否则下次 append 会把
 * 新记录拼到残行上,把「一次断电」放大成校验器永远读不懂的坏行。
 * 完整性由离线校验负责;这里只保证进程带着可信前缀继续。
 */
async function loadChainHead(filePath: string): Promise<ChainHead> {
  await mkdir(dirname(filePath), { recursive: true })
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { seq: 0, prevHash: '0'.repeat(64) }
    throw err
  }
  const segments = text.split('\n')
  const totalBytes = Buffer.byteLength(text, 'utf8')
  let validBytes = 0
  let last: SignedAuditEvent | null = null
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string
    const isLast = i === segments.length - 1
    const segBytes = Buffer.byteLength(seg, 'utf8') + (isLast ? 0 : 1)
    if (seg.trim() === '') {
      validBytes += segBytes
      continue
    }
    try {
      last = JSON.parse(seg) as SignedAuditEvent
    } catch {
      break // 残缺尾行:其后字节一律丢弃
    }
    validBytes += segBytes
  }
  if (validBytes < totalBytes) await truncate(filePath, validBytes)
  return last ? { seq: last.seq, prevHash: last.hash } : { seq: 0, prevHash: '0'.repeat(64) }
}

export class SignedJsonlAuditSink {
  private constructor(private readonly signer: AuditChainSigner) {}

  /** 从文件尾部续链创建(跨重启链不断) */
  static async create(filePath: string, privateKey: CryptoKey): Promise<SignedJsonlAuditSink> {
    const head = await loadChainHead(filePath)
    const signer = new AuditChainSigner(
      privateKey,
      async (record) => { await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8') },
      head,
    )
    return new SignedJsonlAuditSink(signer)
  }

  /** 作为 createGuard({ audit }) 的 sink 使用 */
  sink: AuditSink = (event: AuditEvent) => this.signer.log(event)

  head(): ChainHead {
    return this.signer.head()
  }
}

/** 读取并解析签名审计文件(供离线校验) */
export async function readSignedAuditLog(filePath: string): Promise<SignedAuditEvent[]> {
  return parseSignedAuditLog(await readFile(filePath, 'utf8'))
}
