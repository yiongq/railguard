import type { Rule, RuleOutcome } from '../core/types'

/** 带引用的回答载荷。C 是宿主自己的引用类型,规则通过访问器读取 */
export interface GroundedAnswer<C = unknown> {
  answer: string
  refused: boolean
  refusal_reason?: string
  citations: C[]
}

export interface FaithfulnessOptions<C> {
  /** 返回该引用声称出处的原文片段;找不到返回 null */
  resolve: (citation: C) => string | null
  /** 从引用里取出被引的逐字文本 */
  quoteOf: (citation: C) => string
  /** 全部引用核验失败时给出的拒答理由 */
  refusalReason?: string
}

const norm = (s: string): string => s.replace(/\s+/g, '')

/**
 * 引用忠实性核验:每条引用的 quote 必须逐字存在于 resolve 出的原文里,
 * 核不上就丢弃;非拒答回答丢到一条不剩时,强制降级为拒答。
 * 这是输出侧的最后一道闸,failMode=closed:规则自己挂了也不放行。
 */
export function faithfulness<C>(options: FaithfulnessOptions<C>): Rule<GroundedAnswer<C>> {
  return {
    id: 'citation-faithfulness',
    hook: 'onOutput',
    tier: 'deterministic',
    cost: 'ms',
    failMode: 'closed',
    version: '1.0.0',
    threats: { llm: ['LLM07:2026', 'LLM09:2026'] },
    check(input: GroundedAnswer<C>): RuleOutcome<GroundedAnswer<C>> {
      if (input.refused) {
        return input.citations.length === 0
          ? { verdict: 'pass', status: 'ok' }
          : { verdict: 'modified', status: 'ok', transformed: { ...input, citations: [] } }
      }
      const dropped: string[] = []
      const valid = input.citations.filter((c) => {
        const source = options.resolve(c)
        const quote = options.quoteOf(c)
        const ok = source !== null && quote !== '' && norm(source).includes(norm(quote))
        if (!ok) dropped.push(quote.slice(0, 40))
        return ok
      })
      if (valid.length === 0) {
        return {
          verdict: 'modified', status: 'ok',
          transformed: {
            answer: '', refused: true, citations: [],
            refusal_reason: options.refusalReason ?? '材料未通过引用核验,按无据处理。',
          },
          reason: `全部引用核验失败(${input.citations.length} 条),降级为拒答`,
        }
      }
      if (valid.length < input.citations.length) {
        return {
          verdict: 'modified', status: 'ok',
          transformed: { ...input, citations: valid },
          reason: `丢弃 ${dropped.length} 条核验失败的引用`,
        }
      }
      return { verdict: 'pass', status: 'ok' }
    },
  }
}

export interface OutputCapsOptions<C> {
  maxAnswerChars: number
  maxCitations: number
  /** 可选:对每条引用做裁剪(如 quote 截断) */
  capCitation?: (citation: C) => C
}

/** 输出限幅:回答长度与引用条数封顶,防超长输出与引用洪泛 */
export function outputCaps<C>(options: OutputCapsOptions<C>): Rule<GroundedAnswer<C>> {
  return {
    id: 'output-caps',
    hook: 'onOutput',
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM06:2026'] },
    check(input: GroundedAnswer<C>): RuleOutcome<GroundedAnswer<C>> {
      const citations = input.citations.slice(0, options.maxCitations)
      const capped: GroundedAnswer<C> = {
        ...input,
        answer: input.answer.slice(0, options.maxAnswerChars),
        citations: options.capCitation ? citations.map(options.capCitation) : citations,
      }
      const changed =
        capped.answer !== input.answer || capped.citations.length !== input.citations.length || options.capCitation !== undefined
      return changed
        ? { verdict: 'modified', status: 'ok', transformed: capped }
        : { verdict: 'pass', status: 'ok' }
    },
  }
}
