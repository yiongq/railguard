/**
 * OWASP GenAI 威胁名录(覆盖矩阵的行)。数据文件纪律同注入表:
 * 改条目必 bump 版本;ID 规范带年份(官方 ASI 清单不带年份后缀,
 * 匹配时按冒号前缀归一,两种写法都认)。
 *
 * 来源(2026-08 核实):
 * - OWASP Top 10 for LLM Applications 2026(2026-08-04 发布)
 *   https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/
 * - OWASP Top 10 for Agentic Applications 2026(ASI,2025-12-09 发布)
 *   https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
 * - Agentic AI – Threats and Mitigations v1.1(T1–T17,2025-12)
 *   https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/
 */

export type ThreatList = 'llm' | 'asi' | 't'

export interface ThreatEntry {
  /** 规范 ID(带年份的官方/惯用写法) */
  id: string
  list: ThreatList
  title: string
  titleZh: string
}

export const THREAT_CATALOG_VERSION = '2026.08.0' as const

export const THREAT_CATALOG: readonly ThreatEntry[] = [
  // —— OWASP Top 10 for LLM Applications 2026(注意:2025→2026 有 8/10 条改号)——
  { id: 'LLM01:2026', list: 'llm', title: 'Prompt Injection', titleZh: '提示词注入' },
  { id: 'LLM02:2026', list: 'llm', title: 'Sensitive Information Disclosure', titleZh: '敏感信息泄露' },
  { id: 'LLM03:2026', list: 'llm', title: 'Excessive Agency', titleZh: '过度代理' },
  { id: 'LLM04:2026', list: 'llm', title: 'Supply Chain', titleZh: '供应链' },
  { id: 'LLM05:2026', list: 'llm', title: 'Data and Model Poisoning', titleZh: '数据与模型投毒' },
  { id: 'LLM06:2026', list: 'llm', title: 'Unbounded Consumption', titleZh: '无界消耗' },
  { id: 'LLM07:2026', list: 'llm', title: 'Misinformation', titleZh: '虚假信息' },
  { id: 'LLM08:2026', list: 'llm', title: 'Hidden Context Exposure', titleZh: '隐藏上下文暴露' },
  { id: 'LLM09:2026', list: 'llm', title: 'Vector and Embedding Weaknesses', titleZh: '向量与嵌入弱点' },
  { id: 'LLM10:2026', list: 'llm', title: 'Improper Output Handling', titleZh: '输出处理不当' },
  // —— OWASP Top 10 for Agentic Applications 2026(ASI)——
  { id: 'ASI01:2026', list: 'asi', title: 'Agent Goal Hijack', titleZh: '代理目标劫持' },
  { id: 'ASI02:2026', list: 'asi', title: 'Tool Misuse and Exploitation', titleZh: '工具滥用与利用' },
  { id: 'ASI03:2026', list: 'asi', title: 'Identity and Privilege Abuse', titleZh: '身份与权限滥用' },
  { id: 'ASI04:2026', list: 'asi', title: 'Agentic Supply Chain Vulnerabilities', titleZh: '代理供应链漏洞' },
  { id: 'ASI05:2026', list: 'asi', title: 'Unexpected Code Execution (RCE)', titleZh: '意外代码执行' },
  { id: 'ASI06:2026', list: 'asi', title: 'Memory & Context Poisoning', titleZh: '记忆与上下文投毒' },
  { id: 'ASI07:2026', list: 'asi', title: 'Insecure Inter-Agent Communication', titleZh: '不安全的代理间通信' },
  { id: 'ASI08:2026', list: 'asi', title: 'Cascading Failures', titleZh: '级联故障' },
  { id: 'ASI09:2026', list: 'asi', title: 'Human-Agent Trust Exploitation', titleZh: '人-代理信任利用' },
  { id: 'ASI10:2026', list: 'asi', title: 'Rogue Agents', titleZh: '失控代理' },
] as const

/** 归一化威胁 ID:去掉年份后缀、统一大写——'llm01:2025' 与 'LLM01:2026' 同键 */
export function normalizeThreatId(id: string): string {
  const colon = id.indexOf(':')
  return (colon < 0 ? id : id.slice(0, colon)).toUpperCase()
}
