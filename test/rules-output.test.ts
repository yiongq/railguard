import { describe, expect, it } from 'vitest'
import { createGuard } from '../src/index'
import { faithfulness, linkPolicy, outputCaps, type GroundedAnswer } from '../src/rules/index'

const ctx = () => createGuard({ hooks: {} }).context()

interface Cite { ref: string; quote: string }
const CORPUS: Record<string, string> = {
  a: '判卷器校准一致率 96.5%,200 题人工对照。',
  b: 'FP8 峰值吞吐 +20%,5,810 tok/s。',
}
const rule = faithfulness<Cite>({
  resolve: (c) => CORPUS[c.ref] ?? null,
  quoteOf: (c) => c.quote,
})
const answer = (citations: Cite[], refused = false): GroundedAnswer<Cite> => ({
  answer: refused ? '' : '有据的回答',
  refused,
  citations,
})

describe('faithfulness', () => {
  it('逐字存在(空白差异容忍)→ 放行', async () => {
    const out = await rule.check(answer([{ ref: 'a', quote: '校准一致率 96.5%,200 题' }]), ctx())
    expect(out.verdict).toBe('pass')
  })
  it('引用与原文不符 → 丢弃该条', async () => {
    const out = await rule.check(
      answer([
        { ref: 'a', quote: '校准一致率 96.5%' },
        { ref: 'b', quote: '吞吐 +50%' }, // 编造的数字
      ]),
      ctx(),
    )
    expect(out.verdict).toBe('modified')
    expect((out.transformed as GroundedAnswer<Cite>).citations).toHaveLength(1)
  })
  it('全部核验失败 → 强制降级为拒答', async () => {
    const out = await rule.check(answer([{ ref: 'a', quote: '不存在的话' }]), ctx())
    const t = out.transformed as GroundedAnswer<Cite>
    expect(t.refused).toBe(true)
    expect(t.citations).toHaveLength(0)
  })
  it('引用出处不存在 → 同样丢弃', async () => {
    const out = await rule.check(answer([{ ref: 'ghost', quote: '任何话' }]), ctx())
    expect((out.transformed as GroundedAnswer<Cite>).refused).toBe(true)
  })
  it('拒答回答不许夹带引用', async () => {
    const out = await rule.check(answer([{ ref: 'a', quote: '校准一致率' }], true), ctx())
    expect((out.transformed as GroundedAnswer<Cite>).citations).toHaveLength(0)
  })
})

describe('linkPolicy', () => {
  const rule = linkPolicy({ allow: ['https://github.com/yiongq/'] })
  it('白名单内保留,名单外移除', async () => {
    const out = await rule.check(
      '见 https://github.com/yiongq/medforge 和 https://evil.example.com/x',
      ctx(),
    )
    expect(out.verdict).toBe('modified')
    expect(out.transformed).toContain('github.com/yiongq/medforge')
    expect(out.transformed).not.toContain('evil.example.com')
    expect(out.transformed).toContain('[链接已移除]')
  })
  it('无链接不动', async () => {
    expect((await rule.check('纯文本回答', ctx())).verdict).toBe('pass')
  })
  it('输出侧也剥 Tag 隐形字符', async () => {
    const out = await rule.check('文本\u{E0041}泄露', ctx())
    expect(out.verdict).toBe('modified')
    expect(out.transformed).toBe('文本泄露')
  })
})

describe('outputCaps', () => {
  it('回答与引用条数封顶', async () => {
    const rule = outputCaps<Cite>({ maxAnswerChars: 5, maxCitations: 1 })
    const out = await rule.check(
      { answer: '123456789', refused: false, citations: [{ ref: 'a', quote: 'x' }, { ref: 'b', quote: 'y' }] },
      ctx(),
    )
    const t = out.transformed as GroundedAnswer<Cite>
    expect(t.answer).toBe('12345')
    expect(t.citations).toHaveLength(1)
  })
})
