/**
 * OpenTelemetry 适配器:把审计事件变成标准格式的判定事件,贴进宿主的请求时间线。
 *
 * 零依赖纪律:不 import '@opentelemetry/api'——以下按 api@1.9(消费面自 1.0 起
 * 零破坏,2026-08 核实)手写最小结构镜像,宿主把自己的 tracer/span/logger 递进来,
 * 我们只按形状调用,零版本耦合(Vercel AI SDK v7 同款做法)。
 *
 * 字段纪律(2026-08 核实的语义约定现状):
 * - 判定事件对齐已合并的 gen_ai.evaluation.result(Development 状态)——
 *   name/score.value/score.label/explanation;
 * - 其余细节走 railguard.* 自有命名空间,不自造 gen_ai.* 字段
 *   (护栏专属提案 #427 未合并且命名空间仍在漂移,合并后 minor 跟进);
 * - reason 默认不采集:它可能引用户内容片段,内容默认不进 trace 是官方要求。
 */
import type { AuditEvent, AuditSink, Guard, GuardContext, HookPoint } from '../core/types'

/** OTel 属性值(镜像 api 的 AttributeValue 常用子集) */
export type OtelAttributeValue = string | number | boolean

/** Span 的最小结构面:只镜像我们要调的方法(方法语法,保持双变兼容) */
export interface OtelSpanLike {
  addEvent(name: string, attributes?: Record<string, OtelAttributeValue>): unknown
  setAttribute(key: string, value: OtelAttributeValue): unknown
  setStatus(status: { code: number; message?: string }): unknown
  end(): void
}

/** Tracer 的最小结构面:startActiveSpan 让钩子 span 成为活跃 span,判定事件自动归位 */
export interface OtelTracerLike {
  startActiveSpan<T>(
    name: string,
    options: { kind?: number; attributes?: Record<string, OtelAttributeValue> },
    fn: (span: OtelSpanLike) => T,
  ): T
}

/** Logs API Logger 的最小结构面(api-logs 仍是 0.x 实验版,故做成 opt-in) */
export interface OtelLoggerLike {
  emit(record: {
    eventName?: string
    timestamp?: Date
    severityNumber?: number
    attributes?: Record<string, OtelAttributeValue>
  }): void
}

/** gen_ai.evaluation.result——已合并的「检查结果」事件名(Development) */
export const EVALUATION_EVENT_NAME = 'gen_ai.evaluation.result' as const

// api-logs SeverityNumber 的谱系值(spec 冻结):INFO=9,WARN=13
const SEVERITY_INFO = 9
const SEVERITY_WARN = 13
// SpanKind.INTERNAL / SpanStatusCode.ERROR(spec 冻结的枚举值,硬编码免依赖)
const SPAN_KIND_INTERNAL = 0
const SPAN_STATUS_ERROR = 2

export interface OtelAuditSinkOptions {
  /** 取当前活跃 span(如 () => trace.getActiveSpan());判定事件贴在它上面 */
  getActiveSpan?: () => OtelSpanLike | undefined
  /**
   * 传入 api-logs 形状的 Logger 则改发标准 log 事件(取代 span event,属性完全一致)。
   * Logs API 在 JS 侧尚为实验版,多数宿主未接——这就是它是 opt-in 的原因。
   */
  logger?: OtelLoggerLike
  /**
   * 是否把拦截原因写进 trace(gen_ai.evaluation.explanation)。
   * 默认 false:reason 可能引用户内容片段(如「无据数字: 9999」),
   * trace 通常发往第三方后端,内容默认不出门。
   */
  captureReason?: boolean
}

function eventAttributes(event: AuditEvent, captureReason: boolean): Record<string, OtelAttributeValue> {
  const attrs: Record<string, OtelAttributeValue> = {
    'gen_ai.evaluation.name': event.ruleId,
    'gen_ai.evaluation.score.label': event.verdict,
    'railguard.hook': event.hookPoint,
    'railguard.rule.version': event.ruleVersion,
    'railguard.mode': event.mode,
    'railguard.status': event.status,
    'railguard.request.id': event.requestId,
  }
  if (event.score !== undefined) attrs['gen_ai.evaluation.score.value'] = event.score
  if (event.rescued !== undefined) attrs['railguard.rescued'] = event.rescued
  if (event.label !== undefined) attrs['railguard.label'] = event.label
  if (captureReason && event.reason !== undefined) attrs['gen_ai.evaluation.explanation'] = event.reason
  return attrs
}

/**
 * 审计 sink:每条规则判定 → 一个 gen_ai.evaluation.result 事件,
 * 贴在宿主的活跃 span 上(或经 logger 发标准 log 事件)。
 * 观测不许反噬主流程:内部任何异常都吞掉;没接任何目标时是纯 no-op。
 */
export function otelAuditSink(options: OtelAuditSinkOptions = {}): AuditSink {
  const captureReason = options.captureReason ?? false
  return (event: AuditEvent): void => {
    try {
      const attrs = eventAttributes(event, captureReason)
      if (options.logger) {
        options.logger.emit({
          eventName: EVALUATION_EVENT_NAME,
          timestamp: new Date(event.at),
          severityNumber:
            event.verdict === 'blocked' || event.verdict === 'escalated' ? SEVERITY_WARN : SEVERITY_INFO,
          attributes: attrs,
        })
        return
      }
      options.getActiveSpan?.()?.addEvent(EVALUATION_EVENT_NAME, attrs)
    } catch {
      // 遥测挂了不能连累护栏——静默吞掉
    }
  }
}

export interface TraceGuardOptions {
  tracer: OtelTracerLike
}

/**
 * 可选包装:每次 guard.run() 画成一个独立时间段(span 名 `railguard.{hook}`,
 * 6 个固定值,低基数;规则身份全在属性里)。钩子 span 经 startActiveSpan 成为
 * 活跃 span——otelAuditSink 的判定事件自动贴进来。
 * 拦截/升级是护栏正常工作,不设 ERROR;只有 run 自身抛异常才标错。
 * check()(observe 彩排)不画 span,原样透传。
 */
export function traceGuard(guard: Guard, options: TraceGuardOptions): Guard {
  return {
    run: <T>(hook: HookPoint, input: T, ctx: GuardContext) =>
      options.tracer.startActiveSpan(
        `railguard.${hook}`,
        { kind: SPAN_KIND_INTERNAL, attributes: { 'railguard.hook': hook, 'railguard.request.id': ctx.requestId } },
        async (span) => {
          try {
            const result = await guard.run(hook, input, ctx)
            span.setAttribute('railguard.verdict', result.verdict)
            const stoppedBy = result.blocked?.ruleId ?? result.escalation?.ruleId
            if (stoppedBy !== undefined) span.setAttribute('railguard.stopped_by', stoppedBy)
            return result
          } catch (err) {
            span.setStatus({ code: SPAN_STATUS_ERROR, message: err instanceof Error ? err.message : String(err) })
            throw err
          } finally {
            span.end()
          }
        },
      ),
    check: (hook, input, ctx) => guard.check(hook, input, ctx),
    context: (init) => guard.context(init),
    rules: () => guard.rules(),
  }
}
