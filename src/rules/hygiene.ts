import type { Rule, RuleOutcome } from '../core/types'

/** 输入长度上限(字符数) */
export function maxLength(limit: number, hook: Rule['hook'] = 'onInput'): Rule<string> {
  return {
    id: 'max-length',
    hook,
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM06:2026'] },
    check(input: string): RuleOutcome<string> {
      return input.length > limit
        ? { verdict: 'blocked', status: 'ok', reason: `输入 ${input.length} 字符,上限 ${limit}` }
        : { verdict: 'pass', status: 'ok' }
    },
  }
}

// Unicode Tag 字符块(U+E0000-E007F,隐形注入载体)与零宽字符
const TAG_BLOCK = /[\u{E0000}-\u{E007F}]/gu
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g
// C0 控制字符(保留 \t \n \r)
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

/**
 * 输入卫生:剥隐形 Unicode(打标后照常处理),裸控制字符直接拦。
 * 隐形字符是「藏起来的注入指令」的常用载体,剥掉即失效,不必拒绝整条输入。
 */
export function inputHygiene(hook: Rule['hook'] = 'onInput'): Rule<string> {
  return {
    id: 'input-hygiene',
    hook,
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM01:2026'] },
    check(input: string): RuleOutcome<string> {
      if (CONTROL.test(input)) {
        return { verdict: 'blocked', status: 'ok', reason: '输入含控制字符' }
      }
      const stripped = input.replace(TAG_BLOCK, '').replace(ZERO_WIDTH, '')
      if (stripped !== input) {
        return {
          verdict: 'modified', status: 'ok', transformed: stripped,
          reason: `剥除 ${input.length - stripped.length} 个隐形字符`,
        }
      }
      return { verdict: 'pass', status: 'ok' }
    },
  }
}
