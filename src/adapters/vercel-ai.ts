/**
 * Vercel AI SDK 适配器(v7,LanguageModelV4 中间件形状)。
 * 零依赖纪律:不 import 'ai' 或 '@ai-sdk/provider'——以下结构化类型
 * 按 ai@7 / @ai-sdk/provider@4 的公开 d.ts 手写镜像(2026-08 核实),
 * `wrapLanguageModel` 只做结构消费,不做 instanceof 检查,镜像即可赋值。
 *
 * 分工:模型中间件管 onInput/onOutput(含流式),工具拦截管 before/afterToolCall
 * (AI SDK 的工具执行不经过模型中间件,guardTools 包 execute 才是正确挂点)。
 */
import { createStreamGuard, type StreamGuard } from '../core/stream'
import type { Guard, GuardContext } from '../core/types'

/** ai@7 的 prompt 消息(镜像最小面;index 签名兜住未镜像字段) */
export interface AiSdkTextPart {
  type: 'text'
  text: string
  [key: string]: unknown
}

export interface AiSdkMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | readonly (AiSdkTextPart | { type: string; [key: string]: unknown })[]
  [key: string]: unknown
}

export interface AiSdkParams {
  prompt: readonly AiSdkMessage[]
  [key: string]: unknown
}

export interface AiSdkGenerateResult {
  content: readonly (AiSdkTextPart | { type: string; [key: string]: unknown })[]
  [key: string]: unknown
}

export interface AiSdkStreamPart {
  type: string
  id?: string
  /** text-delta 的增量字段(v4 spec 叫 delta,不是 textDelta) */
  delta?: string
  [key: string]: unknown
}

export interface AiSdkStreamResult {
  stream: ReadableStream<AiSdkStreamPart>
  [key: string]: unknown
}

/** 结构化镜像:可直接传给 ai@7 的 wrapLanguageModel({ middleware }) */
export interface RailguardMiddleware {
  specificationVersion: 'v4'
  transformParams: (options: { type: 'generate' | 'stream'; params: AiSdkParams; model: unknown }) => Promise<AiSdkParams>
  wrapGenerate: (options: {
    doGenerate: () => PromiseLike<AiSdkGenerateResult>
    params: AiSdkParams
    model: unknown
  }) => Promise<AiSdkGenerateResult>
  wrapStream: (options: {
    doStream: () => PromiseLike<AiSdkStreamResult>
    params: AiSdkParams
    model: unknown
  }) => Promise<AiSdkStreamResult>
}

/** 输入被拦时抛出;宿主在调用侧接住转成拒绝响应 */
export class RailguardBlockedError extends Error {
  readonly ruleId: string
  constructor(ruleId: string, reason: string | undefined) {
    super(reason ?? `railguard 拦截: ${ruleId}`)
    this.name = 'RailguardBlockedError'
    this.ruleId = ruleId
  }
}

export interface VercelAdapterOptions {
  /** 每次模型调用的上下文来源(缺省每次新建;需要跨调用累积污点就传自己的) */
  context?: () => GuardContext
  /** 输出被拦时替换的文案(流式与非流式一致) */
  blockedText?: string
}

const DEFAULT_BLOCKED_TEXT = '(内容未通过输出护栏,已替换)'

function textOfMessage(message: AiSdkMessage): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((p): p is AiSdkTextPart => p.type === 'text' && typeof (p as AiSdkTextPart).text === 'string')
    .map((p) => p.text)
    .join('')
}

function replaceMessageText(message: AiSdkMessage, text: string): AiSdkMessage {
  if (typeof message.content === 'string') return { ...message, content: text }
  let placed = false
  const content = message.content.map((p) => {
    if (p.type !== 'text') return p
    if (placed) return { ...p, text: '' }
    placed = true
    return { ...p, text }
  })
  return { ...message, content }
}

/**
 * 模型中间件:最后一条 user 消息过 onInput(blocked 抛 RailguardBlockedError,
 * modified 改写后继续);generate 输出整体过 onOutput;stream 输出按句攒批过同一套
 * onOutput 规则,中途拦截即切流并补发替换文案。
 * 用法:wrapLanguageModel({ model, middleware: railguardMiddleware(guard) })
 */
export function railguardMiddleware(guard: Guard, options: VercelAdapterOptions = {}): RailguardMiddleware {
  const nextContext = options.context ?? ((): GuardContext => guard.context())
  const blockedText = options.blockedText ?? DEFAULT_BLOCKED_TEXT
  // 同一次调用里 transformParams → wrapGenerate/wrapStream 共享 ctx(输入侧污点
  // 才能流到输出侧)。中间件钩子间没有官方的每调用状态,按 params 对象身份关联;
  // 后续中间件再换 params 对象时兜底新建。
  const contextByParams = new WeakMap<object, GuardContext>()
  const contextFor = (params: object): GuardContext => contextByParams.get(params) ?? nextContext()

  return {
    specificationVersion: 'v4',

    async transformParams({ params }) {
      const ctx = nextContext()
      contextByParams.set(params, ctx)
      const idx = params.prompt.map((m) => m.role).lastIndexOf('user')
      if (idx < 0) return params
      const message = params.prompt[idx]
      if (!message) return params
      const text = textOfMessage(message)
      if (!text) return params
      const r = await guard.run<string>('onInput', text, ctx)
      if (!r.ok) {
        const info = r.blocked ?? { ruleId: r.escalation?.ruleId ?? 'railguard' }
        throw new RailguardBlockedError(info.ruleId, info.reason)
      }
      if (r.verdict !== 'modified' || r.output === text) return params
      const prompt = [...params.prompt]
      prompt[idx] = replaceMessageText(message, r.output)
      const transformed = { ...params, prompt }
      contextByParams.set(transformed, ctx)
      return transformed
    },

    async wrapGenerate({ doGenerate, params }) {
      const ctx = contextFor(params)
      const result = await doGenerate()
      const text = result.content
        .filter((p): p is AiSdkTextPart => p.type === 'text' && typeof (p as AiSdkTextPart).text === 'string')
        .map((p) => p.text)
        .join('')
      if (!text) return result
      const r = await guard.run<string>('onOutput', text, ctx)
      const finalText = r.ok ? r.output : blockedText
      if (r.ok && r.verdict !== 'modified') return result
      let placed = false
      const content = result.content.map((p) => {
        if (p.type !== 'text') return p
        if (placed) return { ...p, text: '' }
        placed = true
        return { ...p, text: finalText }
      })
      return { ...result, content }
    },

    async wrapStream({ doStream, params }) {
      const ctx = contextFor(params)
      // 每个 text part id 一份攒批器:并发/交错的多段文本互不串段,
      // 冲洗出的文本永远挂在自己的 id 上
      const guards = new Map<string, StreamGuard>()
      const guardFor = (id: string): StreamGuard => {
        const existing = guards.get(id)
        if (existing) return existing
        const created = createStreamGuard(guard, ctx)
        guards.set(id, created)
        return created
      }
      const result = await doStream()
      let dead = false

      const transform = new TransformStream<AiSdkStreamPart, AiSdkStreamPart>({
        async transform(part, controller) {
          const id = typeof part.id === 'string' ? part.id : 'railguard-text'
          if (part.type === 'text-delta' && typeof part.delta === 'string') {
            if (dead) return
            const out = await guardFor(id).push(part.delta)
            if (out.emit) controller.enqueue({ ...part, delta: out.emit })
            if (out.blocked) {
              dead = true
              controller.enqueue({ type: 'text-delta', id, delta: blockedText })
            }
            return
          }
          if (part.type === 'text-end' && !dead && guards.has(id)) {
            const out = await guardFor(id).flush()
            if (out.emit) controller.enqueue({ type: 'text-delta', id, delta: out.emit })
            if (out.blocked) {
              dead = true
              controller.enqueue({ type: 'text-delta', id, delta: blockedText })
            }
          }
          controller.enqueue(part)
        },
        async flush(controller) {
          if (dead) return
          for (const [id, sg] of guards) {
            const out = await sg.flush()
            if (out.emit) controller.enqueue({ type: 'text-delta', id, delta: out.emit })
            if (out.blocked) {
              controller.enqueue({ type: 'text-delta', id, delta: blockedText })
              return
            }
          }
        },
      })

      return { ...result, stream: result.stream.pipeThrough(transform) }
    },
  }
}

/** AI SDK 工具的最小结构面:只关心 execute */
export interface AiSdkToolLike {
  execute?: (input: unknown, options?: unknown) => unknown
  [key: string]: unknown
}

export interface GuardToolsOptions {
  /** 所有被包工具共享的上下文来源(共享才有跨调用污点累积;缺省每次新建) */
  context?: () => GuardContext
}

/** 工具调用升级人工时抛出;宿主接住后走自己的审批流,payload 是原始调用 */
export class RailguardEscalationError extends Error {
  readonly ruleId: string
  readonly payload: unknown
  constructor(ruleId: string, reason: string | undefined, payload: unknown) {
    super(reason ?? `railguard 升级人工: ${ruleId}`)
    this.name = 'RailguardEscalationError'
    this.ruleId = ruleId
    this.payload = payload
  }
}

/**
 * 包一组 AI SDK 工具:execute 前过 beforeToolCall({name, args}),结果过
 * afterToolCall({name, data})。blocked 抛 RailguardBlockedError(SDK 记为
 * tool-error 回给模型),escalated 抛 RailguardEscalationError(宿主接住走审批)。
 * 与 railguardMiddleware 共用一个 options.context 才能凑齐致命三要素的跨步污点。
 */
export function guardTools<T extends Record<string, AiSdkToolLike>>(
  tools: T,
  guard: Guard,
  options: GuardToolsOptions = {},
): T {
  const sharedContext = options.context
  const wrapped = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = tool.execute
      if (typeof execute !== 'function') return [name, tool]
      const guarded = async (input: unknown, execOptions?: unknown): Promise<unknown> => {
        const ctx = sharedContext ? sharedContext() : guard.context()
        const wrapped = typeof input === 'object' && input !== null
        const args = (wrapped ? input : { value: input }) as Record<string, unknown>
        const before = await guard.run('beforeToolCall', { name, args }, ctx)
        if (!before.ok) {
          if (before.escalation) {
            // payload 兜底为原始调用:规则忘给 evidence 也不能让审批人拿到 undefined
            throw new RailguardEscalationError(
              before.escalation.ruleId,
              before.escalation.reason,
              before.escalation.payload ?? { name, args },
            )
          }
          throw new RailguardBlockedError(before.blocked?.ruleId ?? 'railguard', before.blocked?.reason)
        }
        // modified 的改写结果要真实生效:执行的是规则改写后的参数
        const guardedArgs = (before.output as { args: Record<string, unknown> }).args
        const finalInput = wrapped ? guardedArgs : guardedArgs.value
        const data = await execute.call(tool, finalInput, execOptions)
        const after = await guard.run('afterToolCall', { name, data }, ctx)
        if (!after.ok) {
          throw new RailguardBlockedError(after.blocked?.ruleId ?? 'railguard', after.blocked?.reason)
        }
        return (after.output as { data: unknown }).data
      }
      return [name, { ...tool, execute: guarded }]
    }),
  ) as T
  return wrapped
}
