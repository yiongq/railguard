/**
 * Mastra 适配器(@mastra/core v1 的 Processor 接口)。
 * 零依赖纪律:不 import '@mastra/core'——Processor 是纯结构类型,
 * 以下按 v1.60 源码手写最小镜像(2026-08 核实)。钩子用方法语法声明:
 * strictFunctionTypes 下方法参数保持双变,收窄的结构化参数仍可赋值。
 *
 * 定位:Mastra 内置的 PIIDetector / PromptInjectionDetector 每次检测要走一遍
 * LLM;railguardProcessor 是规则层——零模型调用、确定性、可离线评测,
 * 两者叠加使用(规则层在前,省掉大多数 LLM 检测调用)。
 */
import { createStreamGuard, type StreamGuard } from '../core/stream'
import type { Guard, GuardContext } from '../core/types'

/** Mastra 消息的最小结构面(format: 2,文本在 content.parts[type=text].text) */
export interface MastraMessageLike {
  id: string
  role: string
  content: {
    format: 2
    parts: { type: string; text?: string; [key: string]: unknown }[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Mastra 流 chunk 的最小结构面(text-delta 的文本在 payload.text) */
export interface MastraChunkLike {
  type: string
  payload?: unknown
  [key: string]: unknown
}

type MastraAbort = (reason?: string, options?: { retry?: boolean; metadata?: unknown }) => never

export interface MastraAdapterOptions {
  /** 处理器 id(同一 Agent 挂多份 railguard 时需要区分) */
  id?: string
  /** 每次请求的上下文来源;缺省用 Mastra 的 per-request state 存放,请求内自动共享 */
  context?: () => GuardContext
}

/**
 * state 键按处理器实例区分:Mastra 的 state 桶按处理器 id 归属,
 * 两个同 id(都留默认 'railguard')的实例会共享同一个桶——固定键名会让
 * 第二个实例复用第一个的 ctx/攒批器,静默绕过自己的守卫。实例序号消除碰撞。
 */
let instanceSeq = 0

function textOfMessage(message: MastraMessageLike): string {
  return message.content.parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('')
}

function replaceMessageText(message: MastraMessageLike, text: string): MastraMessageLike {
  let placed = false
  const parts = message.content.parts.map((p) => {
    if (p.type !== 'text') return p
    if (placed) return { ...p, text: '' }
    placed = true
    return { ...p, text }
  })
  return { ...message, content: { ...message.content, parts } }
}

/** railguard 的 Mastra Processor。挂法:new Agent({ inputProcessors: [p], outputProcessors: [p] }) */
export interface RailguardProcessor {
  readonly id: string
  readonly name: string
  processInput(args: {
    messages: MastraMessageLike[]
    abort: MastraAbort
    state: Record<string, unknown>
  }): Promise<MastraMessageLike[]>
  processOutputStream(args: {
    part: MastraChunkLike
    state: Record<string, unknown>
    abort: MastraAbort
  }): Promise<MastraChunkLike | null | undefined>
  processOutputResult(args: {
    messages: MastraMessageLike[]
    abort: MastraAbort
    state: Record<string, unknown>
  }): Promise<MastraMessageLike[]>
  processToolResult(args: {
    toolName: string
    toolCallId: string
    args: unknown
    result: unknown
    state: Record<string, unknown>
    abort: MastraAbort
  }): Promise<void>
}

/**
 * 语义映射:processInput→onInput(blocked 即 abort 触发 tripwire,modified 改写
 * 消息文本);processOutputStream→onOutput 按句攒批(中途拦截 abort 切流);
 * processOutputResult→onOutput 全文兜底(非流式路径);processToolResult→
 * beforeToolCall 时点已过,只做 afterToolCall 检查,blocked 即 abort——
 * 结果改写需要 Mastra 的 MessageList API,零依赖层不做,宿主要改写请用内置
 * 规则直接包 tool.execute。
 */
export function railguardProcessor(guard: Guard, options: MastraAdapterOptions = {}): RailguardProcessor {
  const nextContext = options.context ?? ((): GuardContext => guard.context())
  const instanceKey = `__railguard:${options.id ?? 'railguard'}:${instanceSeq++}`
  const CTX_KEY = `${instanceKey}:ctx`
  const STREAM_KEY = `${instanceKey}:stream`
  // Mastra 的 state 是跨钩子共享的每请求对象——正好放 ctx
  const ctxOf = (state: Record<string, unknown>): GuardContext => {
    const existing = state[CTX_KEY]
    if (existing) return existing as GuardContext
    const ctx = nextContext()
    state[CTX_KEY] = ctx
    return ctx
  }

  return {
    id: options.id ?? 'railguard',
    name: 'Railguard',

    async processInput({ messages, abort, state }) {
      const ctx = ctxOf(state)
      const idx = messages.map((m) => m.role).lastIndexOf('user')
      const message = idx >= 0 ? messages[idx] : undefined
      if (!message) return messages
      const text = textOfMessage(message)
      if (!text) return messages
      const r = await guard.run<string>('onInput', text, ctx)
      if (!r.ok) {
        abort(r.blocked?.reason ?? r.escalation?.reason ?? 'railguard 拦截', {
          metadata: { ruleId: r.blocked?.ruleId ?? r.escalation?.ruleId },
        })
      }
      if (r.verdict !== 'modified' || r.output === text) return messages
      const next = [...messages]
      next[idx] = replaceMessageText(message, r.output)
      return next
    },

    async processOutputStream({ part, state, abort }) {
      if (part.type !== 'text-delta') return part
      const payload = part.payload as { text?: unknown } | undefined
      if (typeof payload?.text !== 'string') return part
      const ctx = ctxOf(state)
      const existing = state[STREAM_KEY]
      const stream: StreamGuard = existing
        ? (existing as StreamGuard)
        : createStreamGuard(guard, ctx)
      state[STREAM_KEY] = stream
      const out = await stream.push(payload.text)
      if (out.blocked) {
        abort(out.blocked.reason ?? `railguard 拦截: ${out.blocked.ruleId}`, {
          metadata: { ruleId: out.blocked.ruleId },
        })
      }
      if (!out.emit) return null // 本批攒着,吞掉此 chunk
      return { ...part, payload: { ...payload, text: out.emit } }
    },

    async processOutputResult({ messages, abort, state }) {
      const ctx = ctxOf(state)
      // 流式路径:先冲洗残余缓冲(违规即 abort;这里拿不到 chunk 出口,
      // 冲出的合规尾巴无法补进已结束的流),再对最终消息做一次全文过闸——
      // 无论 Mastra 用原始输出还是处理后 chunk 组装最终消息,落库的文本都被守住
      const stream = state[STREAM_KEY]
      if (stream) {
        const out = await (stream as StreamGuard).flush()
        if (out.blocked) {
          abort(out.blocked.reason ?? `railguard 拦截: ${out.blocked.ruleId}`, {
            metadata: { ruleId: out.blocked.ruleId },
          })
        }
      }
      const idx = messages.map((m) => m.role).lastIndexOf('assistant')
      const message = idx >= 0 ? messages[idx] : undefined
      if (!message) return messages
      const text = textOfMessage(message)
      if (!text) return messages
      const r = await guard.run<string>('onOutput', text, ctx)
      if (!r.ok) {
        abort(r.blocked?.reason ?? 'railguard 拦截', {
          metadata: { ruleId: r.blocked?.ruleId ?? r.escalation?.ruleId },
        })
      }
      if (r.verdict !== 'modified' || r.output === text) return messages
      const next = [...messages]
      next[idx] = replaceMessageText(message, r.output)
      return next
    },

    async processToolResult({ toolName, result, state, abort }) {
      const ctx = ctxOf(state)
      const r = await guard.run('afterToolCall', { name: toolName, data: result }, ctx)
      if (!r.ok) {
        abort(r.blocked?.reason ?? `railguard 拦截工具结果: ${toolName}`, {
          metadata: { ruleId: r.blocked?.ruleId ?? r.escalation?.ruleId },
        })
      }
    },
  }
}
