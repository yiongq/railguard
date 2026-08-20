import type { Rule, RuleOutcome } from '../core/types'
import { INJECTION_TABLE, INJECTION_TABLE_VERSION, type InjectionPattern } from './injection.table'

export interface InjectionOptions {
  /**
   * block:命中即拦(用户输入用)
   * defang:命中处打标失效但保留内容(检索/工具内容用——文档只能消毒不能拒收)
   * flag:只标记(score+reason),交给下游层
   */
  mode: 'block' | 'defang' | 'flag'
  /** 追加宿主自有模式(与内置表同格式) */
  extraPatterns?: readonly InjectionPattern[]
  hook?: Rule['hook']
}

interface Hit { id: string; category: string; matched: string }

function scan(text: string, patterns: readonly InjectionPattern[]): Hit[] {
  const hits: Hit[] = []
  for (const p of patterns) {
    const m = text.match(new RegExp(p.source, p.flags))
    if (m) hits.push({ id: p.id, category: p.category, matched: m[0].slice(0, 60) })
  }
  return hits
}

function defangText(text: string, patterns: readonly InjectionPattern[]): string {
  let out = text
  for (const p of patterns) {
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g'
    out = out.replace(new RegExp(p.source, flags), (m) => `⟦已失效的疑似注入: ${m}⟧`)
  }
  return out
}

/**
 * 注入检测(启发式规则表)。tier=probabilistic:这是概率层,
 * 单独 enforce 不构成安全边界——真正的边界在输出侧核验与确定性规则。
 */
export function injection(options: InjectionOptions): Rule<string> {
  const patterns: readonly InjectionPattern[] = [
    ...INJECTION_TABLE,
    ...(options.extraPatterns ?? []),
  ]
  return {
    id: `injection.${options.mode}`,
    hook: options.hook ?? 'onInput',
    tier: 'probabilistic',
    cost: 'zero',
    version: INJECTION_TABLE_VERSION,
    threats: { llm: ['LLM01:2026'], asi: ['ASI01:2026'] },
    check(input: string): RuleOutcome<string> {
      const hits = scan(input, patterns)
      if (hits.length === 0) return { verdict: 'pass', status: 'ok' }
      const reason = `命中注入模式: ${hits.map((h) => h.id).join(', ')}`
      const score = Math.min(1, 0.5 + hits.length * 0.25)
      if (options.mode === 'block') {
        return { verdict: 'blocked', status: 'ok', reason, score, evidence: hits }
      }
      if (options.mode === 'defang') {
        return { verdict: 'modified', status: 'ok', transformed: defangText(input, patterns), reason, score, evidence: hits }
      }
      return { verdict: 'pass', status: 'ok', reason, score, evidence: hits }
    },
  }
}
