/** 键序归一化 JSON:同参不同键序得到同一序列化(审批幂等匹配的地基) */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** SHA-256 hex(WebCrypto,Node/edge/浏览器通用) */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 调用参数指纹(取 16 hex):审批幂等匹配、审计脱敏记录共用 */
export async function hashArgs(args: Record<string, unknown>): Promise<string> {
  return (await sha256Hex(canonicalJson(args))).slice(0, 16)
}
