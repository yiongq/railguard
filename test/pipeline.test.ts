import { describe, expect, it } from 'vitest'
import { createGuard, lens, type Rule, type RuleOutcome } from '../src/index'
import { memorySink } from '../src/audit/index'

function stub(id: string, outcome: RuleOutcome<string>, opts: Partial<Rule<string>> = {}): Rule<string> {
  return {
    id, hook: 'onInput', tier: 'deterministic', cost: 'zero', version: '0',
    check: () => outcome,
    ...opts,
  }
}

const upper = stub('upper', { verdict: 'modified', status: 'ok', transformed: 'HI' })
const pass = stub('pass', { verdict: 'pass', status: 'ok' })
const block = stub('block', { verdict: 'blocked', status: 'ok', reason: 'no' })

describe('流水线语义', () => {
  it('注册顺序执行:后面的规则看到前面的改写结果', async () => {
    const seen: string[] = []
    const spy = stub('spy', { verdict: 'pass', status: 'ok' })
    spy.check = (input: string) => { seen.push(input); return { verdict: 'pass', status: 'ok' } }
    const g = createGuard({ hooks: { onInput: [upper, spy] } })
    const r = await g.run('onInput', 'hi', g.context())
    expect(seen).toEqual(['HI'])
    expect(r.output).toBe('HI')
    expect(r.verdict).toBe('modified')
  })

  it('enforce blocked 短路:后续规则不执行', async () => {
    let ran = false
    const after = stub('after', { verdict: 'pass', status: 'ok' })
    after.check = () => { ran = true; return { verdict: 'pass', status: 'ok' } }
    const g = createGuard({ hooks: { onInput: [block, after] } })
    const r = await g.run('onInput', 'x', g.context())
    expect(r.ok).toBe(false)
    expect(r.blocked?.ruleId).toBe('block')
    expect(ran).toBe(false)
  })

  it('observe:记录审计但不改写不拦截', async () => {
    const { sink, events } = memorySink()
    const g = createGuard({
      audit: sink,
      hooks: { onInput: [stub('ob', { verdict: 'blocked', status: 'ok', reason: 'would block' }, { mode: 'observe' })] },
    })
    const r = await g.run('onInput', 'x', g.context())
    expect(r.ok).toBe(true)
    expect(r.output).toBe('x')
    expect(events).toHaveLength(1)
    expect(events[0]!.verdict).toBe('blocked')
    expect(events[0]!.mode).toBe('observe')
    expect(events[0]!.rescued).toBe(false)
  })

  it('off:跳过且无审计事件', async () => {
    const { sink, events } = memorySink()
    const g = createGuard({ audit: sink, hooks: { onInput: [stub('off', { verdict: 'blocked', status: 'ok' }, { mode: 'off' })] } })
    const r = await g.run('onInput', 'x', g.context())
    expect(r.ok).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('check() 等价全规则 observe,永不改变输入', async () => {
    const g = createGuard({ hooks: { onInput: [upper, block] } })
    const r = await g.check('onInput', 'hi', g.context())
    expect(r.ok).toBe(true)
    expect(r.output).toBe('hi')
    expect(r.events.map((e) => e.verdict)).toEqual(['modified', 'blocked'])
  })

  it('escalated 携带原始 payload', async () => {
    const esc = stub('esc', { verdict: 'escalated', status: 'ok', reason: '需人工', evidence: { raw: 'POST /refund' } })
    const g = createGuard({ hooks: { onInput: [esc] } })
    const r = await g.run('onInput', 'x', g.context())
    expect(r.verdict).toBe('escalated')
    expect(r.escalation?.payload).toEqual({ raw: 'POST /refund' })
  })

  it('failMode:open 放行、closed 拦截,status 都是 error', async () => {
    const boomOpen = stub('boom-open', { verdict: 'pass', status: 'ok' })
    boomOpen.check = () => { throw new Error('x') }
    const boomClosed = stub('boom-closed', { verdict: 'pass', status: 'ok' }, { failMode: 'closed' })
    boomClosed.check = () => { throw new Error('x') }

    const g1 = createGuard({ hooks: { onInput: [boomOpen, pass] } })
    const r1 = await g1.run('onInput', 'x', g1.context())
    expect(r1.ok).toBe(true)
    expect(r1.events[0]!.status).toBe('error')

    const g2 = createGuard({ hooks: { onInput: [boomClosed] } })
    const r2 = await g2.run('onInput', 'x', g2.context())
    expect(r2.ok).toBe(false)
    expect(r2.events[0]!.status).toBe('error')
  })

  it('挂错门在 createGuard 时报错', () => {
    expect(() => createGuard({ hooks: { onOutput: [pass] } })).toThrow(/挂在 onOutput/)
  })

  it('lens 把字符串规则提升到结构化载荷', async () => {
    const strip = stub('strip', { verdict: 'modified', status: 'ok', transformed: 'clean' })
    const lifted = lens(strip, (p: { answer: string; n: number }) => p.answer, (p, v) => ({ ...p, answer: v }))
    const g = createGuard({ hooks: { onInput: [lifted] } })
    const r = await g.run('onInput', { answer: 'dirty', n: 42 }, g.context())
    expect(r.output).toEqual({ answer: 'clean', n: 42 })
  })
})
