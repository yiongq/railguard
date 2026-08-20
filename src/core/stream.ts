import type { BlockedInfo, Guard, GuardContext, HookPoint } from './types'

export interface StreamGuardOptions {
  /** 攒批边界(默认中英句读与换行) */
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

/**
 * 流式输出护栏:chunk 按句边界攒批,每批过一遍 hook 规则再放行——
 * 网关型方案对流式直接跳过输出护栏,这里把它做成一等公民。
 * 语义:与非流式 run() 完全同一套规则与三态;blocked 即中途切流。
 */
export function createStreamGuard(
  guard: Guard,
  ctx: GuardContext,
  options: StreamGuardOptions = {},
): StreamGuard {
  const boundary = options.boundary ?? /(?<=[。!?;\n!?;])/
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
      const parts = buffer.split(boundary)
      // 最后一段可能是半句,留在缓冲;缓冲超限则强制全量送检
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
