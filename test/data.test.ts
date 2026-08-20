import { describe, expect, it } from 'vitest'
import { canonicalJson, hashArgs } from '../src/core/hash'
import { createGuard, type GuardContext } from '../src/index'
import {
  allowedTools, applyRowRules, approvalGate, evalApprovalCondition, fieldMask,
  MemoryApprovalStore, maskFields, rbacToolGate, resolveSelfRef, rowFilter, validateRbacConfig,
  type RbacConfig,
} from '../src/data/index'

const CONFIG: RbacConfig = {
  roles: {
    employee: {
      tools: ['read_profile', 'refund'],
      rows: [{ field: 'employee_id', equals: '$self.id' }],
      mask: ['salary', 'phone'],
      approval: [{ tool: 'refund', when: { field: 'amount', gt: 1000 } }],
    },
    admin: { tools: '*' },
  },
}

const ctxWith = (id: string, role: string): GuardContext => {
  const c = createGuard({ hooks: {} }).context()
  c.principal = { id, role }
  return c
}

describe('rbac 基础', () => {
  it('审批条件:gt/anyOf/字段缺失 fail-safe', () => {
    expect(evalApprovalCondition({ field: 'amount', gt: 1000 }, { amount: 1500 })).toBe(true)
    expect(evalApprovalCondition({ field: 'amount', gt: 1000 }, { amount: 800 })).toBe(false)
    expect(evalApprovalCondition({ anyOf: [{ field: 'a', gt: 1 }, { field: 'b', lte: 0 }] }, { a: 0, b: 0 })).toBe(true)
    // 金额字段被漏传/塞成非数不应免审
    expect(evalApprovalCondition({ field: 'amount', gt: 1000 }, {})).toBe(true)
    expect(evalApprovalCondition({ field: 'amount', gt: 1000 }, { amount: 'abc' })).toBe(true)
  })
  it('$self 引用解析,未知引用返回 undefined', () => {
    const p = { id: 'u1', role: 'employee', attrs: { dept: 'hr' } }
    expect(resolveSelfRef('$self.id', p)).toBe('u1')
    expect(resolveSelfRef('$self.attrs.dept', p)).toBe('hr')
    expect(resolveSelfRef('literal', p)).toBe('literal')
    expect(resolveSelfRef('$self.unknown', p)).toBeUndefined()
  })
  it('validateRbacConfig 拒绝坏形状', () => {
    expect(() => validateRbacConfig({ roles: { x: { tools: 123 } } })).toThrow()
    expect(validateRbacConfig(CONFIG)).toBe(CONFIG)
  })
  it('canonicalJson 键序归一,hashArgs 同参同哈希', async () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
    expect(await hashArgs({ x: 1, y: 2 })).toBe(await hashArgs({ y: 2, x: 1 }))
  })
})

describe('rbacToolGate / allowedTools', () => {
  const gate = rbacToolGate({ config: CONFIG })
  it('白名单内放行,外则拦,未知角色拦,无身份拦', async () => {
    expect((await gate.check({ name: 'read_profile', args: {} }, ctxWith('u1', 'employee'))).verdict).toBe('pass')
    expect((await gate.check({ name: 'delete_all', args: {} }, ctxWith('u1', 'employee'))).verdict).toBe('blocked')
    expect((await gate.check({ name: 'read_profile', args: {} }, ctxWith('u1', 'ghost'))).verdict).toBe('blocked')
    const noPrincipal = createGuard({ hooks: {} }).context()
    expect((await gate.check({ name: 'read_profile', args: {} }, noPrincipal)).verdict).toBe('blocked')
  })
  it("'*' 全放行;tools/list 收窄", async () => {
    expect((await gate.check({ name: 'anything', args: {} }, ctxWith('a', 'admin'))).verdict).toBe('pass')
    expect(allowedTools(CONFIG, { id: 'u1', role: 'employee' }, ['read_profile', 'refund', 'delete_all'])).toEqual(['read_profile', 'refund'])
    expect(allowedTools(CONFIG, { id: 'a', role: 'admin' }, ['x', 'y'])).toEqual(['x', 'y'])
    expect(allowedTools(CONFIG, undefined, ['x'])).toEqual([])
  })
})

describe('rowFilter / fieldMask', () => {
  it('数组逐行筛(modified),匹配对象放行,不匹配对象整体拒', async () => {
    const rule = rowFilter({ config: CONFIG })
    const rows = [
      { employee_id: 'u1', name: 'A' },
      { employee_id: 'u2', name: 'B' },
    ]
    const filtered = await rule.check({ name: 'list', data: rows }, ctxWith('u1', 'employee'))
    expect(filtered.verdict).toBe('modified')
    expect((filtered.transformed as { data: unknown[] }).data).toHaveLength(1)

    const own = await rule.check({ name: 'get', data: { employee_id: 'u1' } }, ctxWith('u1', 'employee'))
    expect(own.verdict).toBe('pass')

    const other = await rule.check({ name: 'get', data: { employee_id: 'u2' } }, ctxWith('u1', 'employee'))
    expect(other.verdict).toBe('blocked')
    expect(other.reason).toContain('row_denied')
  })
  it('「不存在」与「越权」的拒绝形状一致(防存在性枚举预言机)', async () => {
    const rule = rowFilter({ config: CONFIG })
    const missing = await rule.check({ name: 'get', data: {} }, ctxWith('u1', 'employee'))
    const denied = await rule.check({ name: 'get', data: { employee_id: 'u2' } }, ctxWith('u1', 'employee'))
    expect(missing.verdict).toBe('blocked')
    expect(missing.reason).toBe(denied.reason)
  })
  it('字段脱敏递归抹除(含嵌套)', async () => {
    const rule = fieldMask({ config: CONFIG })
    const out = await rule.check(
      { name: 'get', data: { name: 'A', salary: 100, nested: { phone: 'x', keep: 1 } } },
      ctxWith('u1', 'employee'),
    )
    const data = (out.transformed as { data: Record<string, unknown> }).data
    expect(data).toEqual({ name: 'A', nested: { keep: 1 } })
    expect(maskFields({ a: 1 }, [])).toEqual({ a: 1 })
  })
  it('applyRowRules:$self 解析失败按拒绝处理', () => {
    const out = applyRowRules({ owner: 'u1' }, [{ field: 'owner', equals: '$self.attrs.missing' }], { id: 'u1', role: 'x' })
    expect(out.denied).toBe(true)
  })
})

describe('approvalGate 生命周期', () => {
  const call = { name: 'refund', args: { order: 'o1', amount: 5000 } }
  const small = { name: 'refund', args: { order: 'o2', amount: 200 } }

  it('低于阈值放行;高于阈值幂等开单并升级', async () => {
    const store = new MemoryApprovalStore()
    const gate = approvalGate({ config: CONFIG, store })
    const c = ctxWith('u1', 'employee')

    expect((await gate.check(small, c)).verdict).toBe('pass')

    const first = await gate.check(call, c)
    expect(first.verdict).toBe('escalated')
    const evidence = first.evidence as { approvalId: string; tool: string; args: Record<string, unknown> }
    expect(evidence.tool).toBe('refund')
    expect(evidence.args).toEqual(call.args)

    // 同参重试:命中同一张 pending 单,不重复开单
    const second = await gate.check(call, c)
    expect(second.verdict).toBe('escalated')
    expect((second.evidence as { approvalId: string }).approvalId).toBe(evidence.approvalId)
    expect(await store.listPending()).toHaveLength(1)
  })

  it('批准后重试消票放行,一票一次;再来一次重新开单', async () => {
    const store = new MemoryApprovalStore()
    const gate = approvalGate({ config: CONFIG, store })
    const c = ctxWith('u1', 'employee')
    const first = await gate.check(call, c)
    const id = (first.evidence as { approvalId: string }).approvalId
    await store.decide(id, 'approved', 'boss')

    const approved = await gate.check(call, c)
    expect(approved.verdict).toBe('pass')
    expect(approved.reason).toContain('approval_consumed')

    // 票已消费:同参再来必须重新走审批,防「一次审批终身有效」
    const again = await gate.check(call, c)
    expect(again.verdict).toBe('escalated')
    expect((again.evidence as { approvalId: string }).approvalId).not.toBe(id)
  })

  it('拒绝后消费并拦截', async () => {
    const store = new MemoryApprovalStore()
    const gate = approvalGate({ config: CONFIG, store })
    const c = ctxWith('u1', 'employee')
    const first = await gate.check(call, c)
    const id = (first.evidence as { approvalId: string }).approvalId
    await store.decide(id, 'denied', 'boss')
    const denied = await gate.check(call, c)
    expect(denied.verdict).toBe('blocked')
    expect(denied.reason).toContain('approval_denied')
  })

  it('参数键序不同命中同一张单;分级信号并入求值', async () => {
    const store = new MemoryApprovalStore()
    const gate = approvalGate({
      config: {
        roles: { employee: { tools: ['refund'], approval: [{ tool: 'refund', when: { field: 'monthCount', gte: 2 } }] } },
      },
      store,
      signals: async () => ({ monthCount: 3 }),
    })
    const c = ctxWith('u1', 'employee')
    const a = await gate.check({ name: 'refund', args: { x: 1, y: 2 } }, c)
    expect(a.verdict).toBe('escalated') // 信号触发分级审批
    const b = await gate.check({ name: 'refund', args: { y: 2, x: 1 } }, c)
    expect((b.evidence as { approvalId: string }).approvalId).toBe((a.evidence as { approvalId: string }).approvalId)
  })

  it('store 层不变量:重复批复/重复消费抛错', async () => {
    const store = new MemoryApprovalStore()
    const rec = await store.create({
      system: 'default', tool: 't', args: {}, argsHash: 'h', userId: 'u', role: 'r',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    await store.decide(rec.id, 'approved', 'boss')
    await expect(store.decide(rec.id, 'denied', 'boss')).rejects.toThrow('不能重复批复')
    await store.consume(rec.id)
    await expect(store.consume(rec.id)).rejects.toThrow('已被消费')
  })

  it('过期单被忽略,重新开单', async () => {
    const store = new MemoryApprovalStore()
    await store.create({
      system: 'default', tool: 'refund', args: call.args, argsHash: await hashArgs(call.args),
      userId: 'u1', role: 'employee', expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const gate = approvalGate({ config: CONFIG, store })
    const out = await gate.check(call, ctxWith('u1', 'employee'))
    expect(out.verdict).toBe('escalated') // 新单,而非命中过期旧单
    expect(await store.listPending()).toHaveLength(1)
  })
})
