/** 消毒冻结块:defang 标记带内容哈希 token,防「攻击者预埋假标记伪装已清洗」。 */

/** FNV-1a(非加密哈希;防伪造力来自与 per-request id 拼合,攻击者无法预知) */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const MARK_OPEN = '⟦defang:'

/** 预埋的假冻结标记先行失效(插入不可见断点以外的显式破坏符) */
export function breakForgedMarks(text: string): string {
  return text.split(MARK_OPEN).join('⟦defang×')
}

export function freezeWrap(requestId: string, content: string, note: string): string {
  const token = fnv1a(requestId + content)
  return `${MARK_OPEN}${token} ${note}⟧${content}⟦/defang:${token}⟧`
}
