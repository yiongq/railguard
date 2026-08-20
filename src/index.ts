export { createGuard } from './core/pipeline'
export { lens } from './core/lens'
export { createStreamGuard, type StreamEmit, type StreamGuard, type StreamGuardOptions } from './core/stream'
export type {
  AuditEvent, AuditSink, BlockedInfo, Channel, EscalationInfo, Guard, GuardConfig,
  GuardContext, HookPoint, HookRunResult, Identity, Rule, RuleCost, RuleMode,
  RuleOutcome, RuleStatus, RuleTier, Taint, Threats, ToolCallRecord, Verdict,
} from './core/types'
