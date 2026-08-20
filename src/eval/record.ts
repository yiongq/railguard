/**
 * 录制与重放:observe → 对账 → enforce 的对账工序落成代码。
 * 录制真实流量(录 run() 的入参与结论),换一份规则配置重放,
 * diff 出 verdict 变化——新规则上线前先回答「它会改判哪些历史请求」。
 */
import type {
  Channel, Guard, GuardContext, HookPoint, Identity, Taint, ToolCallRecord, Verdict,
} from '../core/types'

export interface RecordedRun {
  seq: number
  requestId: string
  label?: string
  hook: HookPoint
  channel?: Channel
  /** 载荷原文。要持久化就必须 JSON 可序列化——录制层不校验,序列化时才炸 */
  payload: unknown
  /** run 时刻的污点快照,重放用它种上下文 */
  taint: Taint
  principal?: Identity
  /** 机器身份也入录——按 agent 放行的规则重放时不能失忆 */
  agent?: Identity
  /** 工具调用轨迹快照 */
  trace?: ToolCallRecord[]
  verdict: Verdict
  ok: boolean
  ruleId?: string
}

function snapshotTaint(taint: Taint): Taint {
  return {
    untrustedSources: [...taint.untrustedSources],
    touchedPrivateData: taint.touchedPrivateData,
    externalCommsRequested: taint.externalCommsRequested,
  }
}

/**
 * 录制守卫:包一层 guard,每次 run() 把 (hook, payload, ctx 快照, 结论) 追加进 store。
 * check/context/rules 透传。快照覆盖 taint/principal/agent/trace/channel/label;
 * kv 与外部存储不入录——依赖它们的规则(如 approval-gate)重放结果可能与录制不同,
 * 这是文档承诺的边界。
 */
export function recordingGuard(guard: Guard, store: RecordedRun[]): Guard {
  return {
    async run<T>(hook: HookPoint, input: T, ctx: GuardContext) {
      const taint = snapshotTaint(ctx.taint)
      const r = await guard.run(hook, input, ctx)
      const rec: RecordedRun = {
        seq: store.length,
        requestId: ctx.requestId,
        hook,
        payload: input,
        taint,
        verdict: r.verdict,
        ok: r.ok,
      }
      if (ctx.label !== undefined) rec.label = ctx.label
      if (ctx.channel !== undefined) rec.channel = ctx.channel
      if (ctx.principal !== undefined) rec.principal = ctx.principal
      if (ctx.agent !== undefined) rec.agent = ctx.agent
      if (ctx.trace.length > 0) rec.trace = ctx.trace.map((t) => ({ ...t }))
      const ruleId =
        r.blocked?.ruleId ??
        r.escalation?.ruleId ??
        r.events.filter((e) => e.mode === 'enforce' && e.verdict === 'modified').at(-1)?.ruleId
      if (ruleId !== undefined) rec.ruleId = ruleId
      store.push(rec)
      return r
    },
    check: (hook, input, ctx) => guard.check(hook, input, ctx),
    context: (init) => guard.context(init),
    rules: () => guard.rules(),
  }
}

export interface ReplayDiff {
  seq: number
  hook: HookPoint
  before: Verdict
  after: Verdict
  ruleBefore?: string
  ruleAfter?: string
}

export interface ReplayReport {
  total: number
  /** verdict 发生变化的样本(对账要看的就是这份清单) */
  changed: readonly ReplayDiff[]
}

/**
 * 重放对账:每条录制样本以快照种一份新 ctx,过给定 guard,报告改判清单。
 * 样本彼此独立(录制时的跨请求状态以 taint 快照为准),顺序不承重。
 */
export async function diffReplay(guard: Guard, runs: readonly RecordedRun[]): Promise<ReplayReport> {
  const changed: ReplayDiff[] = []
  for (const run of runs) {
    const init: Partial<GuardContext> = { taint: snapshotTaint(run.taint) }
    if (run.principal !== undefined) init.principal = run.principal
    if (run.agent !== undefined) init.agent = run.agent
    if (run.trace !== undefined) init.trace = run.trace.map((t) => ({ ...t }))
    if (run.channel !== undefined) init.channel = run.channel
    if (run.label !== undefined) init.label = run.label
    const ctx = guard.context(init)
    const r = await guard.run(run.hook, run.payload, ctx)
    if (r.verdict === run.verdict) continue
    const diff: ReplayDiff = { seq: run.seq, hook: run.hook, before: run.verdict, after: r.verdict }
    if (run.ruleId !== undefined) diff.ruleBefore = run.ruleId
    const ruleAfter =
      r.blocked?.ruleId ??
      r.escalation?.ruleId ??
      r.events.filter((e) => e.mode === 'enforce' && e.verdict === 'modified').at(-1)?.ruleId
    if (ruleAfter !== undefined) diff.ruleAfter = ruleAfter
    changed.push(diff)
  }
  return { total: runs.length, changed }
}

const ENVELOPE_VERSION = 1

/** 序列化录制样本(带版本封套)。payload 含不可 JSON 化的值会在这里炸——录制层刻意不早炸 */
export function serializeRuns(runs: readonly RecordedRun[]): string {
  return JSON.stringify({ v: ENVELOPE_VERSION, runs })
}

export function parseRuns(text: string): RecordedRun[] {
  const parsed = JSON.parse(text) as { v?: number; runs?: RecordedRun[] }
  if (parsed.v !== ENVELOPE_VERSION || !Array.isArray(parsed.runs)) {
    throw new Error('无法识别的录制文件格式')
  }
  return parsed.runs
}
