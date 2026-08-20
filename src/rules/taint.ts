import type { GuardContext, Rule, RuleOutcome } from '../core/types'

/** 污点标记辅助:宿主在相应事件发生时调用,标记随 ctx 传播 */
export function markUntrustedSource(ctx: GuardContext, source: string): void {
  if (!ctx.taint.untrustedSources.includes(source)) ctx.taint.untrustedSources.push(source)
}
export function markPrivateDataTouched(ctx: GuardContext): void {
  ctx.taint.touchedPrivateData = true
}
export function markExternalComms(ctx: GuardContext): void {
  ctx.taint.externalCommsRequested = true
}

export interface LethalTrifectaOptions {
  /** 判定某次工具调用是否属于「对外通信」(如 fetch/send_email/webhook) */
  isExternalComm: (toolName: string, args: Record<string, unknown>) => boolean
  /** 判定某次工具调用是否触达私有数据 */
  touchesPrivateData?: (toolName: string, args: Record<string, unknown>) => boolean
}

interface ToolCallPayload { name: string; args: Record<string, unknown> }

/**
 * 致命三要素守卫(Willison lethal trifecta / Meta Rule of Two 的代码化):
 * 「接触过私有数据 + 摄入过不可信内容 + 现在要对外通信」三者齐备时,
 * 该调用自动升级人工审批——这是 2026 年对间接注入的最高共识,确定性规则。
 * escalated 的 evidence 是原始调用(工具名+参数),给审批人看的必须是它。
 */
export function lethalTrifecta(options: LethalTrifectaOptions): Rule<ToolCallPayload> {
  return {
    id: 'lethal-trifecta',
    hook: 'beforeToolCall',
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM01:2026', 'LLM02:2026'], asi: ['ASI02:2026'] },
    check(input: ToolCallPayload, ctx): RuleOutcome<ToolCallPayload> {
      if (options.touchesPrivateData?.(input.name, input.args)) ctx.taint.touchedPrivateData = true
      const external = options.isExternalComm(input.name, input.args)
      if (!external) return { verdict: 'pass', status: 'ok' }
      ctx.taint.externalCommsRequested = true
      const trifecta =
        ctx.taint.touchedPrivateData && ctx.taint.untrustedSources.length > 0
      if (!trifecta) return { verdict: 'pass', status: 'ok' }
      return {
        verdict: 'escalated', status: 'ok',
        reason: `致命三要素齐备:已触达私有数据 + 摄入过不可信内容(${ctx.taint.untrustedSources.join(', ')})+ 请求对外通信`,
        evidence: { tool: input.name, args: input.args },
      }
    },
  }
}
