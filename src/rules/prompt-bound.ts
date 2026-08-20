import type { GuardContext } from '../core/types'
import { inputHygiene } from './hygiene'
import { injection } from './injection'

export interface AdmitResult {
  ok: boolean
  /** 通过时的净化文本(剥隐形字符后) */
  cleaned: string
  reason?: string
}

/**
 * prompt-bound 文本准入:凡是将进入 system prompt 的持久文本(记忆、计划、
 * 用户偏好),写入前必须过这道闸——防投毒内容诱导模型「把 payload 存成记忆」
 * 形成持续污染(OWASP ASI06)。净化后仍命中注入模式的一律拒存。
 */
export async function admitPromptBoundText(text: string, ctx: GuardContext): Promise<AdmitResult> {
  const hygiene = await inputHygiene().check(text, ctx)
  if (hygiene.verdict === 'blocked') {
    return { ok: false, cleaned: text, reason: hygiene.reason ?? '含异常字符' }
  }
  const cleaned = hygiene.verdict === 'modified' && hygiene.transformed !== undefined ? hygiene.transformed : text
  const inj = await injection({ mode: 'block' }).check(cleaned, ctx)
  if (inj.verdict === 'blocked') {
    return { ok: false, cleaned, reason: inj.reason ?? '命中注入模式,拒绝写入 prompt 域' }
  }
  return { ok: true, cleaned }
}
