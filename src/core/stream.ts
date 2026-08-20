import type { BlockedInfo, Guard, GuardContext, HookPoint } from './types'

export interface StreamGuardOptions {
  /**
   * 攒批边界。默认:中英句读与换行,外加「ASCII 句点 + 空白」
   * (裸 `.` 不作边界——"3.5" 这类小数不许被拦腰切开)。
   * 零宽(lookaround)与消耗型(如 /\n/)边界都支持:消耗型的分隔符
   * 保留在前一段里,不会从流里被吃掉;不要使用捕获组。
   */
  boundary?: RegExp
  /** 单批最大字符数,超过即使无边界也强制送检(防无标点长流憋死) */
  maxBuffer?: number
  hook?: HookPoint
}

export interface StreamEmit {
  /** 通过守卫后可下发的文本(可能被规则改写) */
  emit: string
  /** 命中拦截:调用方应终止下发并按拦截处理;后续 push 一律返回空 */
  blocked?: BlockedInfo
}

export interface StreamGuard {
  push(chunk: string): Promise<StreamEmit>
  /** 流结束:冲洗残余缓冲 */
  flush(): Promise<StreamEmit>
}

const DEFAULT_BOUNDARY = /(?<=[。!?;\n!?;])|(?<=\.)(?=\s)/

/**
 * 按边界切分,分隔符保留在段内(split 会把消耗型边界吃掉,这里不会)。
 * 返回段列表;最后一段是未完结的尾巴(可能为空串——恰好切在边界上)。
 */
function segment(buffer: string, boundary: RegExp): string[] {
  // 只保留对匹配语义安全的 flag:g 必加(matchAll 要求);
  // m 会让模式里的 $ 命中每个行尾、y 会破坏扫描,都剥掉
  const safeFlags = 'g' + boundary.flags.replace(/[gmy]/g, '')
  const re = new RegExp(boundary.source, safeFlags)
  const parts: string[] = []
  let last = 0
  for (const m of buffer.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length
    if (end <= last) continue // 同位置的零宽重复匹配,跳过防死循环
    parts.push(buffer.slice(last, end))
    last = end
  }
  parts.push(buffer.slice(last))
  return parts
}

/**
 * 流式输出护栏:chunk 按句边界攒批,每批过一遍 hook 规则再放行——
 * 网关型方案对流式直接跳过输出护栏,这里把它做成一等公民。
 * 语义:与非流式 run() 完全同一套规则与三态;blocked 即中途切流。
 * 缓冲恰好以边界收尾即视为完整段立刻送检,不等下一个 chunk。
 */
export function createStreamGuard(
  guard: Guard,
  ctx: GuardContext,
  options: StreamGuardOptions = {},
): StreamGuard {
  const boundary = options.boundary ?? DEFAULT_BOUNDARY
  const maxBuffer = options.maxBuffer ?? 480
  const hook = options.hook ?? 'onOutput'
  let buffer = ''
  let dead: BlockedInfo | undefined

  async function guardSegments(segments: string[]): Promise<StreamEmit> {
    let out = ''
    for (const seg of segments) {
      if (!seg) continue
      const r = await guard.run<string>(hook, seg, ctx)
      if (!r.ok) {
        dead = r.blocked ?? { ruleId: r.escalation?.ruleId ?? 'stream' }
        return { emit: out, blocked: dead }
      }
      out += r.output
    }
    return { emit: out }
  }

  return {
    async push(chunk: string): Promise<StreamEmit> {
      if (dead) return { emit: '', blocked: dead }
      buffer += chunk
      const parts = segment(buffer, boundary)
      // 最后一段是未完结尾巴,留在缓冲(为空即恰好切在边界上);缓冲超限则全量送检
      let ready: string[]
      if (buffer.length >= maxBuffer) {
        ready = parts
        buffer = ''
      } else {
        buffer = parts.pop() ?? ''
        ready = parts
      }
      return guardSegments(ready)
    },
    async flush(): Promise<StreamEmit> {
      if (dead) return { emit: '', blocked: dead }
      const rest = buffer
      buffer = ''
      return rest ? guardSegments([rest]) : { emit: '' }
    },
  }
}
