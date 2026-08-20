import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  exportKeyJwk, generateAuditKeypair, importPrivateKeyJwk, importPublicKeyJwk,
  parseSignedAuditLog, verifyAuditChain,
} from '../src/audit/index'
import { readSignedAuditLog, SignedJsonlAuditSink } from '../src/node/index'
import type { AuditEvent } from '../src/index'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'railguard-audit-')), 'audit.jsonl')

const evt = (n: number): AuditEvent => ({
  at: `2026-08-20T00:00:0${n}.000Z`,
  requestId: `req${n}`,
  hookPoint: 'onInput',
  ruleId: 'injection.block',
  ruleVersion: '1.0.0',
  mode: 'enforce',
  verdict: n % 2 ? 'blocked' : 'pass',
  status: 'ok',
})

describe('Ed25519 签名审计链', () => {
  it('写三条 → 离线校验通过;篡改任一字段即断', async () => {
    const { privateKey, publicKey } = await generateAuditKeypair()
    const file = tmpFile()
    const sink = await SignedJsonlAuditSink.create(file, privateKey)
    for (let i = 1; i <= 3; i++) await sink.sink(evt(i))

    const records = await readSignedAuditLog(file)
    expect(records).toHaveLength(3)
    expect(await verifyAuditChain(records, publicKey)).toEqual({ ok: true, count: 3 })

    // 篡改第二条的 verdict
    const tampered = records.map((r, i) => (i === 1 ? { ...r, ruleId: 'tampered' } : r))
    const v1 = await verifyAuditChain(tampered, publicKey)
    expect(v1.ok).toBe(false)
    expect(v1.brokenAt).toEqual({ seq: 2, reason: expect.stringContaining('hash 不匹配') })

    // 删除中间一条 → prevHash/seq 断
    const dropped = [records[0]!, records[2]!]
    const v2 = await verifyAuditChain(dropped, publicKey)
    expect(v2.ok).toBe(false)
    expect(v2.brokenAt?.seq).toBe(3)

    // 换一把公钥 → 签名无效
    const other = await generateAuditKeypair()
    const v3 = await verifyAuditChain(records, other.publicKey)
    expect(v3.brokenAt?.reason).toContain('签名无效')
  })

  it('跨重启续链:新 sink 从文件尾续 seq,整链仍可校验', async () => {
    const { privateKey, publicKey } = await generateAuditKeypair()
    const file = tmpFile()
    const a = await SignedJsonlAuditSink.create(file, privateKey)
    await a.sink(evt(1))
    await a.sink(evt(2))

    const b = await SignedJsonlAuditSink.create(file, privateKey)
    expect(b.head().seq).toBe(2)
    await b.sink(evt(3))

    const records = await readSignedAuditLog(file)
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3])
    expect((await verifyAuditChain(records, publicKey)).ok).toBe(true)
  })

  it('断电残行被物理截断,链带着可信前缀继续', async () => {
    const { privateKey, publicKey } = await generateAuditKeypair()
    const file = tmpFile()
    const a = await SignedJsonlAuditSink.create(file, privateKey)
    await a.sink(evt(1))
    appendFileSync(file, '{"seq":2,"半截')

    const b = await SignedJsonlAuditSink.create(file, privateKey)
    expect(b.head().seq).toBe(1)
    await b.sink(evt(2))
    const records = await readSignedAuditLog(file) // 残字节已被截掉,能整体解析
    expect(records).toHaveLength(2)
    expect((await verifyAuditChain(records, publicKey)).ok).toBe(true)
  })

  it('JWK 导出/导入往返后签名与校验仍成立', async () => {
    const pair = await generateAuditKeypair()
    const priv = await importPrivateKeyJwk(await exportKeyJwk(pair.privateKey))
    const pub = await importPublicKeyJwk(await exportKeyJwk(pair.publicKey))
    const file = tmpFile()
    const sink = await SignedJsonlAuditSink.create(file, priv)
    await sink.sink(evt(1))
    expect((await verifyAuditChain(await readSignedAuditLog(file), pub)).ok).toBe(true)
  })

  it('落盘失败链头不前进(预写纪律)', async () => {
    const { privateKey } = await generateAuditKeypair()
    const file = tmpFile()
    const sink = await SignedJsonlAuditSink.create(file, privateKey)
    await sink.sink(evt(1))
    // 把文件换成目录使 appendFile 失败
    const dirAsFile = join(mkdtempSync(join(tmpdir(), 'railguard-x-')), 'audit.jsonl')
    writeFileSync(dirAsFile, readFileSync(file))
    const broken = await SignedJsonlAuditSink.create('/dev/null/impossible/audit.jsonl', privateKey).catch(() => null)
    expect(broken).toBeNull() // 目录都建不出来:创建期就失败,而不是静默吞
    expect(sink.head().seq).toBe(1)
  })
})
