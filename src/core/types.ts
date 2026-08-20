/**
 * railguard 核心类型。公共 API 一律手写显式类型(isolatedDeclarations 纪律):
 * 接口即契约,不导出深度泛型推断结果。
 */

/** 流水线的六个生命周期挂载点 */
export type HookPoint =
  | 'onInput'
  | 'onPromptBuild'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onModelResponse'
  | 'onOutput'

/** 内容信道:同一条规则可按信道给不同阈值(记忆读写也是注入面) */
export type Channel = 'user' | 'assistant' | 'tool' | 'memory' | 'system'

/** per-rule 三态:执法 / 只观察不拦(灰度上线) / 关闭 */
export type RuleMode = 'enforce' | 'observe' | 'off'

/**
 * 确定性规则(白名单/RBAC/配额/忠实性核验)可默认 enforce;
 * 概率性规则(启发式/分类器)单独 enforce 不构成安全边界,文档如此承诺。
 */
export type RuleTier = 'deterministic' | 'probabilistic'

/** 成本提示(报告与文档用;流水线执行顺序始终按注册顺序,顺序是承重的) */
export type RuleCost = 'zero' | 'ms' | 'llm'

export type Verdict = 'pass' | 'modified' | 'blocked' | 'escalated'

/** 规则自身的执行状态,与 verdict 正交:「规则挂了」不等于「内容违规」 */
export type RuleStatus = 'ok' | 'error' | 'skipped'

/** 威胁映射(ID 必须带年份,如 'LLM01:2026'——条目会换位) */
export interface Threats {
  llm?: readonly string[]
  asi?: readonly string[]
  t?: readonly string[]
}

export interface RuleOutcome<T = unknown> {
  verdict: Verdict
  status: RuleStatus
  /** verdict 为 modified 时的改写结果 */
  transformed?: T
  reason?: string
  /** 0-1 风险分,概率性规则给出,评测框架用它算阈值曲线 */
  score?: number
  /**
   * 证据,进审计与 trace。escalated 时必须是原始底层操作
   * (确切请求/命令/参数),禁止只放模型生成的摘要——防审批操纵。
   */
  evidence?: unknown
}

export interface Rule<T = unknown> {
  id: string
  hook: HookPoint
  tier: RuleTier
  cost: RuleCost
  /** 缺省 enforce;概率性规则建议宿主先 observe */
  mode?: RuleMode
  /** 规则自身抛错时:open=放行(默认),closed=按拦截处理(末道闸类规则用) */
  failMode?: 'open' | 'closed'
  channels?: readonly Channel[]
  threats?: Threats
  /** 规则表版本戳:改判定逻辑必 bump,拦截率指标才有可复现分母 */
  version: string
  /** 纯函数红线:不碰网络/env/时钟/随机;需要外部数据走 ctx 注入 */
  check(input: T, ctx: GuardContext): RuleOutcome<T> | Promise<RuleOutcome<T>>
}

export interface Identity {
  id: string
  role?: string
  attrs?: Record<string, string | number>
}

export interface ToolCallRecord {
  tool: string
  at: number
  argsSummary?: string
}

/** 轻量污点跟踪(lethal trifecta 三要素),随钩子传播 */
export interface Taint {
  untrustedSources: string[]
  touchedPrivateData: boolean
  externalCommsRequested: boolean
}

export interface AuditEvent {
  at: string
  requestId: string
  label?: string
  hookPoint: HookPoint
  ruleId: string
  ruleVersion: string
  mode: RuleMode
  verdict: Verdict
  status: RuleStatus
  score?: number
  reason?: string
  /** true = 这次是代码救的(enforce 生效);观察态命中不算 rescued */
  rescued?: boolean
}

export type AuditSink = (event: AuditEvent) => void | Promise<void>

/** 每请求上下文。双主体:principal=被代理用户,agent=机器身份 */
export interface GuardContext {
  requestId: string
  label?: string
  principal?: Identity
  agent?: Identity
  channel?: Channel
  trace: ToolCallRecord[]
  taint: Taint
  kv: Map<string, unknown>
}

export interface BlockedInfo {
  ruleId: string
  reason?: string
}

export interface EscalationInfo {
  ruleId: string
  reason?: string
  /** 原始底层操作,给审批人看的必须是它 */
  payload?: unknown
}

export interface HookRunResult<T> {
  /** false 仅当 enforce 态被 blocked/escalated */
  ok: boolean
  verdict: Verdict
  /** 流经全部规则后的内容(可能被改写);blocked 时为拦截前的最后内容 */
  output: T
  blocked?: BlockedInfo
  escalation?: EscalationInfo
  events: AuditEvent[]
}

export interface GuardConfig {
  /** 配置形状版本,便于将来迁移 */
  version?: number
  label?: string
  audit?: AuditSink
  /** 未显式给 mode 的规则的缺省态(默认 enforce) */
  defaultMode?: RuleMode
  /** 规则按钩子挂载;数组顺序即执行顺序,顺序是承重的,不做自动重排 */
  hooks: Partial<Record<HookPoint, readonly Rule[]>>
}

export interface Guard {
  /** 执行某个钩子:enforce 规则真实生效 */
  run<T>(hook: HookPoint, input: T, ctx: GuardContext): Promise<HookRunResult<T>>
  /** 只评估不执法:全部规则按 observe 跑,单测与评测的地基 */
  check<T>(hook: HookPoint, input: T, ctx: GuardContext): Promise<HookRunResult<T>>
  /** 创建一份每请求上下文 */
  context(init?: Partial<GuardContext>): GuardContext
  /** 列出全部已挂规则(生成覆盖矩阵用) */
  rules(): readonly Rule[]
}
