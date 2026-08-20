/** 数据访问守卫规则:工具白名单 / 行级过滤 / 字段脱敏(生产守卫管线的沉淀)。 */
import type { Identity, Rule, RuleOutcome } from '../core/types'
import { resolveSelfRef, roleOf, type RbacConfig, type RowRule } from './rbac'

export interface ToolCallPayload { name: string; args: Record<string, unknown> }
export interface ToolResultPayload { name: string; data: unknown }

export interface DataGuardOptions {
  config: RbacConfig
  /** 目标系统标识(多系统网关用;单系统宿主用默认值即可) */
  system?: string
}

const SYSTEM_DEFAULT = 'default'

/** tools/list 阶段收窄:不该用的工具连列表都不出现 */
export function allowedTools(config: RbacConfig, principal: Identity | undefined, toolNames: readonly string[], system: string = SYSTEM_DEFAULT): string[] {
  const role = roleOf(config, principal, system)
  if (!role) return []
  if (role.tools === '*') return [...toolNames]
  const allow = new Set(role.tools)
  return toolNames.filter((t) => allow.has(t))
}

/** 工具白名单闸门:角色不存在/工具不在白名单 → 拦截 */
export function rbacToolGate(options: DataGuardOptions): Rule<ToolCallPayload> {
  const system = options.system ?? SYSTEM_DEFAULT
  return {
    id: 'rbac-tool-gate',
    hook: 'beforeToolCall',
    tier: 'deterministic',
    cost: 'zero',
    failMode: 'closed',
    version: '1.0.0',
    threats: { llm: ['LLM03:2026'], asi: ['ASI02:2026', 'ASI03:2026'] },
    check(input: ToolCallPayload, ctx): RuleOutcome<ToolCallPayload> {
      const role = roleOf(options.config, ctx.principal, system)
      if (!role) return { verdict: 'blocked', status: 'ok', reason: `unknown_role:${ctx.principal?.role ?? '(无身份)'}` }
      if (role.tools !== '*' && !role.tools.includes(input.name)) {
        return { verdict: 'blocked', status: 'ok', reason: `tool_not_allowed:${input.name}` }
      }
      return { verdict: 'pass', status: 'ok' }
    },
  }
}

type RowOutcome = { denied: false; data: unknown } | { denied: true; rule: string }

/**
 * 行级过滤:数组逐行筛,单对象不匹配即整体拒绝。
 * 规则字段缺失或 $self 解析失败按不匹配处理——宁可错拒,不可错放。
 */
export function applyRowRules(data: unknown, rules: readonly RowRule[], principal: Identity): RowOutcome {
  if (rules.length === 0) return { denied: false, data }
  const matches = (row: unknown): boolean => {
    if (typeof row !== 'object' || row === null) return false
    return rules.every((rule) => {
      const expected = resolveSelfRef(rule.equals, principal)
      if (expected === undefined) return false
      const actual = (row as Record<string, unknown>)[rule.field]
      // 宽松相等:源系统的 id 常见 number/string 混用
      return actual !== undefined && String(actual) === String(expected)
    })
  }
  if (Array.isArray(data)) {
    const kept = data.filter(matches)
    // 一行未滤时返回原引用:verdict 语义要诚实,没改内容就不许报 modified
    return { denied: false, data: kept.length === data.length ? data : kept }
  }
  if (matches(data)) return { denied: false, data }
  return { denied: true, rule: rules.map((r) => `${r.field}==${r.equals}`).join(' && ') }
}

/**
 * 行级过滤规则(afterToolCall):按 ctx.principal 的角色行规则过滤工具结果。
 * 注意:「目标不存在」与「越权」必须返回同一种拒绝——差异会成为存在性枚举预言机。
 */
export function rowFilter(options: DataGuardOptions): Rule<ToolResultPayload> {
  const system = options.system ?? SYSTEM_DEFAULT
  return {
    id: 'row-filter',
    hook: 'afterToolCall',
    tier: 'deterministic',
    cost: 'zero',
    failMode: 'closed',
    version: '1.1.0', // 1.1.0:未滤除任何行时改报 pass(原先数组一律报 modified)
    threats: { llm: ['LLM02:2026'] },
    check(input: ToolResultPayload, ctx): RuleOutcome<ToolResultPayload> {
      const role = roleOf(options.config, ctx.principal, system)
      const rules = role?.rows ?? []
      if (rules.length === 0 || !ctx.principal) return { verdict: 'pass', status: 'ok' }
      const outcome = applyRowRules(input.data, rules, ctx.principal)
      if (outcome.denied) {
        return { verdict: 'blocked', status: 'ok', reason: `row_denied:${outcome.rule}` }
      }
      return outcome.data === input.data
        ? { verdict: 'pass', status: 'ok' }
        : { verdict: 'modified', status: 'ok', transformed: { ...input, data: outcome.data } }
    },
  }
}

/** 字段脱敏:按字段名递归抹除(含嵌套对象与数组)。数据里不含目标字段时返回原引用 */
export function maskFields(data: unknown, fields: readonly string[]): unknown {
  if (fields.length === 0) return data
  const blocked = new Set(fields)
  let removed = false
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.some(([key]) => blocked.has(key))) removed = true
      return Object.fromEntries(
        entries.filter(([key]) => !blocked.has(key)).map(([key, v]) => [key, walk(v)]),
      )
    }
    return value
  }
  const masked = walk(data)
  return removed ? masked : data
}

/** 字段脱敏规则(afterToolCall):按角色 mask 列表抹除结果字段 */
export function fieldMask(options: DataGuardOptions): Rule<ToolResultPayload> {
  const system = options.system ?? SYSTEM_DEFAULT
  return {
    id: 'field-mask',
    hook: 'afterToolCall',
    tier: 'deterministic',
    cost: 'zero',
    failMode: 'closed',
    version: '1.1.0', // 1.1.0:数据里不含目标字段时改报 pass(原先配置了 mask 就一律报 modified)
    threats: { llm: ['LLM02:2026'] },
    check(input: ToolResultPayload, ctx): RuleOutcome<ToolResultPayload> {
      const role = roleOf(options.config, ctx.principal, system)
      const fields = role?.mask ?? []
      if (fields.length === 0) return { verdict: 'pass', status: 'ok' }
      const data = maskFields(input.data, fields)
      if (data === input.data) return { verdict: 'pass', status: 'ok' }
      return {
        verdict: 'modified', status: 'ok',
        transformed: { ...input, data },
        reason: `脱敏字段: ${fields.join(', ')}`,
      }
    },
  }
}
