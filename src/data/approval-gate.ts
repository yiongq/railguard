/** 审批闸门规则(beforeToolCall):幂等开单 → 挂起升级 → 批复后重试消票放行。
 *  语义自 mcp-foundry Guard 迁入:一票一次防重放;涉审但未接存储 = fail-closed。 */
import { hashArgs } from '../core/hash'
import type { Rule, RuleOutcome } from '../core/types'
import type { ApprovalStore } from './approvals'
import { roleForSystem, roleHasApprovalRule, roleOf, roleRequiresApproval, type RbacConfig } from './rbac'
import type { ToolCallPayload } from './guards'

export interface ApprovalGateOptions {
  config: RbacConfig
  store: ApprovalStore
  system?: string
  /** 参数之外的分级信号(如「本月已退款几笔」),并入审批条件求值上下文 */
  signals?: (call: ToolCallPayload) => Promise<Record<string, number>>
  /** 审批单有效期,默认 24h(足够审批人晚点看到,又不攒过期僵尸单) */
  ttlMs?: number
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * 流程:角色对该工具配置了审批 → 取信号求值是否触发 → 找已有单
 * (无 → 开单并 escalated;pending → escalated;approved → 消费放行;
 * denied → 消费后拦截)。恢复语义是「重试消票」:同人同参重试命中已批单即放行,
 * 天然适配无状态 HTTP。escalated 的 evidence 是原始调用 + 单号。
 */
export function approvalGate(options: ApprovalGateOptions): Rule<ToolCallPayload> {
  const system = options.system ?? 'default'
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS
  return {
    id: 'approval-gate',
    hook: 'beforeToolCall',
    tier: 'deterministic',
    cost: 'ms',
    failMode: 'closed',
    version: '1.0.0',
    threats: { llm: ['LLM03:2026'], asi: ['ASI02:2026'] },
    async check(input: ToolCallPayload, ctx): Promise<RuleOutcome<ToolCallPayload>> {
      const principal = ctx.principal
      const role = roleOf(options.config, principal, system)
      if (!principal || !role) return { verdict: 'pass', status: 'ok' } // 角色闸门的职责,不重复拦
      if (!roleHasApprovalRule(role, input.name)) return { verdict: 'pass', status: 'ok' }

      const signals = options.signals ? await options.signals(input) : {}
      if (!roleRequiresApproval(role, input.name, { ...input.args, ...signals })) {
        return { verdict: 'pass', status: 'ok' }
      }

      const argsHash = await hashArgs(input.args)
      const ticket = await options.store.find(system, principal.id, input.name, argsHash)

      if (!ticket) {
        const created = await options.store.create({
          system, tool: input.name, args: input.args, argsHash,
          userId: principal.id,
          role: roleForSystem(principal, system) ?? '',
          expiresAt: new Date(Date.now() + ttl).toISOString(),
        })
        return {
          verdict: 'escalated', status: 'ok',
          reason: `需要人工审批(单号 ${created.id})`,
          evidence: { approvalId: created.id, tool: input.name, args: input.args },
        }
      }
      if (ticket.status === 'pending') {
        return {
          verdict: 'escalated', status: 'ok',
          reason: `审批处理中(单号 ${ticket.id})`,
          evidence: { approvalId: ticket.id, tool: input.name, args: input.args },
        }
      }
      // 已决单:无论批复结果先消费——一张单只作用于一次调用,防重放。
      // consume 抛错(并发败者/落盘失败)由 failMode: closed 收口,绝不放行执行。
      await options.store.consume(ticket.id)
      if (ticket.status === 'denied') {
        return { verdict: 'blocked', status: 'ok', reason: `approval_denied:${ticket.id}` }
      }
      return { verdict: 'pass', status: 'ok', reason: `approval_consumed:${ticket.id}` }
    },
  }
}
