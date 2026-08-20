import { mkdtempSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonlApprovalStore } from '../src/node/index'

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'railguard-')), 'approvals.jsonl')

describe('JsonlApprovalStore(事件溯源)', () => {
  it('状态迁移落盘,新实例回放重建', async () => {
    const file = tmpFile()
    const a = new JsonlApprovalStore(file)
    const rec = await a.create({
      system: 'default', tool: 'refund', args: { amount: 5000 }, argsHash: 'h1',
      userId: 'u1', role: 'employee', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    await a.decide(rec.id, 'approved', 'boss')
    await a.consume(rec.id)

    const b = new JsonlApprovalStore(file) // 冷启动回放
    const replayed = await b.get(rec.id)
    expect(replayed?.status).toBe('approved')
    expect(replayed?.approverId).toBe('boss')
    expect(replayed?.consumedAt).toBeDefined()
    await expect(b.consume(rec.id)).rejects.toThrow('已被消费') // 回放后不变量仍成立
  })

  it('末行半截写入被容忍(崩溃残留),不炸启动', async () => {
    const file = tmpFile()
    const a = new JsonlApprovalStore(file)
    await a.create({
      system: 'default', tool: 't', args: {}, argsHash: 'h',
      userId: 'u', role: 'r', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    appendFileSync(file, '{"type":"decided","id":"半截')
    const b = new JsonlApprovalStore(file)
    expect(await b.listPending()).toHaveLength(1)
  })
})
