/**
 * 评测框架类型(M4)。回答两个问题——「攻击拦得住吗」(ASR)与
 * 「正常流量伤不伤」(utility)。单指标必然漂移:只考核拦截率,
 * 护栏会被调成拦一切;两个指标一起看才是工程事实。
 */
import type { Channel, HookPoint, Identity, Taint, Threats, Verdict } from '../core/types'

/** 用例性质:attack=期望被拦截的攻击场景;benign=期望不受伤的正常流量 */
export type CaseKind = 'attack' | 'benign'

/** 用例的一步:在某个钩子上投放一份载荷。多步共享同一 ctx,污点得以跨步累积 */
export interface EvalStep {
  hook: HookPoint
  payload: unknown
  channel?: Channel
}

/** 上下文种子:重现「已经读过不可信邮件」这类前置状态 */
export interface CaseContextSeed {
  principal?: Identity
  agent?: Identity
  channel?: Channel
  taint?: Taint
}

export interface EvalCase {
  id: string
  kind: CaseKind
  /** 场景标签(injection / pii / exfil …),报告分组用 */
  tags?: readonly string[]
  /** 声称覆盖的威胁 ID——覆盖矩阵「已验证」列的数据来源 */
  threats?: Threats
  steps: readonly EvalStep[]
  context?: CaseContextSeed
  /**
   * 仅攻击用例:哪些规则的 modified 算「成功消解」。缺省任何规则的改写都算;
   * 当钩子上挂着 spotlight 这类对一切内容打标的规则时必须收窄——
   * 否则攻击永远显示被拦,ASR 虚假归零。blocked/escalated 一律算拦住,不受此限。
   */
  neutralizedBy?: readonly string[]
  note?: string
}

/** 单步执行记录 */
export interface StepResult {
  hook: HookPoint
  verdict: Verdict
  /** 短路规则(blocked/escalated 时) */
  ruleId?: string
  /** 本步中 enforce 态实际改写过内容的规则(按执行顺序,去重) */
  modifiedBy?: readonly string[]
}

export type CaseOutcome =
  | 'caught' // 攻击被拦住(blocked/escalated,或被认可的规则消解)
  | 'leaked' // 攻击穿透全部规则——计入 ASR 分子
  | 'clean' // 良性流量原样通过——utility 的分子
  | 'degraded' // 良性流量被改写:可用性受损但未被拒(打标/脱敏也落在这档,报告单列)
  | 'harmed' // 良性流量被拦截/升级——误伤

export interface CaseResult {
  id: string
  kind: CaseKind
  outcome: CaseOutcome
  steps: readonly StepResult[]
  /** 拦截发生在第几步(caught/harmed 且短路时) */
  stoppedAt?: number
  /** 起作用的规则 id */
  byRule?: string
  tags?: readonly string[]
}

export interface RuleTally {
  /** enforce 生效拦下/消解攻击的次数 */
  caught: number
  /** 误伤良性用例的次数(blocked/escalated) */
  falsePositives: number
  /** 改写良性内容的次数 */
  benignModified: number
}

export interface TagTally {
  attacks: number
  leaked: number
  benign: number
  harmed: number
}

export interface EvalReport {
  /** 数据集版本戳——指标要有可复现的分母 */
  datasetVersion?: string
  attacks: number
  benign: number
  /** 攻击成功率 leaked / attacks,越低越好 */
  asr: number
  /** 可用性 clean / benign,越高越好(degraded 不计入分子) */
  utility: number
  /** 良性被改写的比例,单列给宿主自行裁量容忍度 */
  benignDegraded: number
  byRule: Record<string, RuleTally>
  byTag: Record<string, TagTally>
  cases: readonly CaseResult[]
}
