import type { Rule, RuleOutcome } from '../core/types'

export interface LinkPolicyOptions {
  /** 允许保留的 URL 前缀(allowlist 语义——blocklist 可被同域中转绕过) */
  allow: readonly string[]
  /** 替换文案,默认 [链接已移除] */
  replacement?: string
  hook?: Rule['hook']
}

const URL_RE = /https?:\/\/[^\s)\]}>'"]+/g
// 输出侧同样要剥 Unicode Tag 隐形字符(隐藏外传通道)
const TAG_BLOCK = /[\u{E0000}-\u{E007F}]/gu

/**
 * 链接白名单(作用于字符串;结构化载荷用 lens 提升)。
 * 模型会连域名一起编——只有白名单前缀的 URL 保留,其余替换。
 */
export function linkPolicy(options: LinkPolicyOptions): Rule<string> {
  const replacement = options.replacement ?? '[链接已移除]'
  return {
    id: 'link-policy',
    hook: options.hook ?? 'onOutput',
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM10:2026'], asi: ['ASI02:2026'] },
    check(input: string): RuleOutcome<string> {
      let removed = 0
      const cleaned = input.replace(TAG_BLOCK, '').replace(URL_RE, (url) => {
        if (options.allow.some((prefix) => url.startsWith(prefix))) return url
        removed++
        return replacement
      })
      if (cleaned === input) return { verdict: 'pass', status: 'ok' }
      return {
        verdict: 'modified', status: 'ok', transformed: cleaned,
        reason: removed > 0 ? `移除 ${removed} 个白名单外链接` : '剥除隐形字符',
      }
    },
  }
}
