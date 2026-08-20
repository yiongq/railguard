/** RBAC 配置模型(零依赖形态:解绑 zod/yaml——宿主传对象,
 *  validateRbacConfig 做零依赖结构校验;YAML 解析留给宿主)。 */
import type { Identity } from '../core/types'

/**
 * 行级规则:结果集中每行的 field 必须等于 equals 解出的值。
 * equals 支持 "$self.id" / "$self.attrs.<key>" 引用提问人,或字面量。
 * 刻意不做表达式 DSL——可求值字符串是注入面,结构化对象不是。
 */
export interface RowRule {
  field: string
  equals: string | number
}

/**
 * 分级审批条件:对「调用参数 + 宿主信号」求值成 true 即需人工审批。
 * 数值缺失/非数值一律判 true——fail-safe,宁可多要一次审批,不可静默放行。
 */
export type ApprovalCondition =
  | { field: string; gt: number }
  | { field: string; gte: number }
  | { field: string; lt: number }
  | { field: string; lte: number }
  | { anyOf: ApprovalCondition[] }
  | { allOf: ApprovalCondition[] }

/** 审批条目:字符串=该工具一律涉审;{tool, when}=分级,when 成立才涉审 */
export type ApprovalEntry = string | { tool: string; when: ApprovalCondition }

export interface RoleRule {
  tools: '*' | string[]
  rows?: RowRule[]
  mask?: string[]
  approval?: ApprovalEntry[]
  /** 该角色是否有权批复本域审批单 */
  approver?: boolean
}

export interface RbacConfig {
  roles: Record<string, RoleRule>
}

/** 零依赖结构校验:形状不对直接抛——配置错误要在启动期炸,不能到请求期才发现 */
export function validateRbacConfig(config: unknown): RbacConfig {
  if (typeof config !== 'object' || config === null) throw new Error('RbacConfig 必须是对象')
  const roles = (config as { roles?: unknown }).roles
  if (typeof roles !== 'object' || roles === null) throw new Error('RbacConfig.roles 必须是对象')
  for (const [name, rule] of Object.entries(roles as Record<string, unknown>)) {
    if (typeof rule !== 'object' || rule === null) throw new Error(`角色 ${name} 必须是对象`)
    const r = rule as Record<string, unknown>
    const toolsOk = r.tools === '*' || (Array.isArray(r.tools) && r.tools.every((t) => typeof t === 'string' && t.length > 0))
    if (!toolsOk) throw new Error(`角色 ${name}.tools 必须是 '*' 或字符串数组`)
    for (const row of (r.rows as unknown[]) ?? []) {
      const rr = row as Record<string, unknown>
      if (typeof rr.field !== 'string' || (typeof rr.equals !== 'string' && typeof rr.equals !== 'number')) {
        throw new Error(`角色 ${name}.rows 条目不合法`)
      }
    }
  }
  return config as RbacConfig
}

/** 多帽子:一个人在不同系统里可有不同角色;rolesBySystem 覆盖,缺省回落 role */
export function roleForSystem(principal: Identity, system: string): string | undefined {
  const bySystem = (principal.attrs?.[`role:${system}`] as string | undefined)
  return bySystem ?? principal.role
}

export function roleOf(config: RbacConfig, principal: Identity | undefined, system: string): RoleRule | undefined {
  if (!principal) return undefined
  const name = roleForSystem(principal, system)
  return name === undefined ? undefined : config.roles[name]
}

/** 求值审批条件。数值缺失/非数值 → true(fail-safe) */
export function evalApprovalCondition(cond: ApprovalCondition, ctx: Record<string, unknown>): boolean {
  if ('anyOf' in cond) return cond.anyOf.some((c) => evalApprovalCondition(c, ctx))
  if ('allOf' in cond) return cond.allOf.every((c) => evalApprovalCondition(c, ctx))
  const raw = ctx[cond.field]
  const actual = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(actual)) return true
  if ('gt' in cond) return actual > cond.gt
  if ('gte' in cond) return actual >= cond.gte
  if ('lt' in cond) return actual < cond.lt
  return actual <= cond.lte
}

export function roleRequiresApproval(role: RoleRule, tool: string, ctx: Record<string, unknown>): boolean {
  for (const entry of role.approval ?? []) {
    if (typeof entry === 'string') {
      if (entry === tool) return true
    } else if (entry.tool === tool && evalApprovalCondition(entry.when, ctx)) {
      return true
    }
  }
  return false
}

export function roleHasApprovalRule(role: RoleRule, tool: string): boolean {
  return (role.approval ?? []).some((e) => (typeof e === 'string' ? e === tool : e.tool === tool))
}

/** 解析 $self 引用;失败返回 undefined(守卫侧按拒绝处理,不静默放行) */
export function resolveSelfRef(value: string | number, principal: Identity): string | number | undefined {
  if (typeof value === 'number') return value
  if (!value.startsWith('$self.')) return value
  if (value === '$self.id') return principal.id
  const attrKey = value.startsWith('$self.attrs.') ? value.slice('$self.attrs.'.length) : null
  if (attrKey) return principal.attrs?.[attrKey]
  return undefined
}
