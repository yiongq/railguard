import type { Rule, RuleOutcome } from '../core/types'

export type PiiKind = 'phoneCN' | 'idCardCN' | 'email' | 'bankCard'
export type PiiStrategy = 'mask' | 'redact' | 'block'

export interface PiiOptions {
  /** 检测哪些类别(默认全部) */
  kinds?: readonly PiiKind[]
  /** mask=保留首尾打码(默认),redact=整体替换,block=拦截 */
  strategy?: PiiStrategy
  hook?: Rule['hook']
}

const PATTERNS: Record<PiiKind, RegExp> = {
  phoneCN: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  idCardCN: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])\d{3}[\dXx](?!\d)/g,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  bankCard: /(?<!\d)\d{16,19}(?!\d)/g,
}

const mask = (s: string): string =>
  s.length <= 6 ? s[0] + '***' : s.slice(0, 3) + '****' + s.slice(-3)

/** PII 检测与脱敏(确定性正则层;更高召回的 NER 检测规划走可选适配器——路线图项,不进零依赖核心) */
export function pii(options: PiiOptions = {}): Rule<string> {
  const kinds = options.kinds ?? (Object.keys(PATTERNS) as PiiKind[])
  const strategy = options.strategy ?? 'mask'
  return {
    id: `pii.${strategy}`,
    hook: options.hook ?? 'onOutput',
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM02:2026'] },
    check(input: string): RuleOutcome<string> {
      let found = 0
      let out = input
      for (const kind of kinds) {
        out = out.replace(PATTERNS[kind], (m) => {
          found++
          return strategy === 'redact' ? `[${kind} 已脱敏]` : mask(m)
        })
      }
      if (found === 0) return { verdict: 'pass', status: 'ok' }
      if (strategy === 'block') {
        return { verdict: 'blocked', status: 'ok', reason: `输出包含 ${found} 处 PII` }
      }
      return { verdict: 'modified', status: 'ok', transformed: out, reason: `脱敏 ${found} 处 PII` }
    },
  }
}
