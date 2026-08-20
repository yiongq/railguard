import type { Rule, RuleOutcome } from './types'

/**
 * lens:把作用于内层值(通常是 string)的规则,提升到结构化载荷上。
 * 例:linkPolicy 作用于字符串,宿主的输出是 { answer, citations };
 * lens(linkPolicy(...), p => p.answer, (p, v) => ({ ...p, answer: v }))
 * 让同一条规则免改造复用——业务载荷形状各异,规则不该为此分叉。
 */
export function lens<Outer, Inner>(
  rule: Rule<Inner>,
  get: (outer: Outer) => Inner,
  set: (outer: Outer, inner: Inner) => Outer,
): Rule<Outer> {
  return {
    ...rule,
    id: rule.id,
    async check(input: Outer, ctx): Promise<RuleOutcome<Outer>> {
      const inner = await rule.check(get(input), ctx)
      const outcome: RuleOutcome<Outer> = { verdict: inner.verdict, status: inner.status }
      if (inner.verdict === 'modified' && inner.transformed !== undefined) {
        outcome.transformed = set(input, inner.transformed)
      }
      if (inner.reason !== undefined) outcome.reason = inner.reason
      if (inner.score !== undefined) outcome.score = inner.score
      if (inner.evidence !== undefined) outcome.evidence = inner.evidence
      return outcome
    },
  }
}
