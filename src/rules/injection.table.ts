/**
 * 注入检测规则表 · 版本 1.0.0
 *
 * 纪律(改一条都要 bump INJECTION_TABLE_VERSION,并补双侧测试):
 * - 零误报硬线:role-marker 必须行首锚定(「操作系统:Linux」不许命中);
 *   override/persona 类匹配"劫持短语"而非裸词(「扮演导游介绍景点」不许命中)。
 * - 表是数据不是代码:pattern 用 {source, flags} 存,任何语言可加载同一张表。
 */

export interface InjectionPattern {
  id: string
  category: 'role-marker' | 'instruction-override' | 'role-injection'
  source: string
  flags: string
  /** 良性反例备注:为什么这样写不误报 */
  note?: string
}

export const INJECTION_TABLE_VERSION = '1.0.0' as const

export const INJECTION_TABLE: readonly InjectionPattern[] = [
  {
    id: 'role-marker-en',
    category: 'role-marker',
    source: '^\\s*(system|assistant)\\s*[::]',
    flags: 'im',
    note: '行首锚定;"the system: works" 在行中不命中',
  },
  {
    id: 'role-marker-zh',
    category: 'role-marker',
    source: '^\\s*(系统提示词?|系统指令|系统角色)\\s*[::]',
    flags: 'm',
    note: '行首锚定;「操作系统:Linux」不命中(词不同)',
  },
  {
    id: 'override-zh',
    category: 'instruction-override',
    source: '(忽略|无视|忘记|抛开)(前面|以上|之前|所有|全部).{0,8}(指令|规则|提示|设定)',
    flags: '',
  },
  {
    id: 'override-en',
    category: 'instruction-override',
    source: '(ignore|disregard|forget)\\s+(all\\s+|the\\s+|your\\s+)?(previous|above|prior|earlier)\\s+(instructions?|rules?|prompts?)',
    flags: 'i',
  },
  {
    id: 'prompt-exfil-zh',
    category: 'instruction-override',
    source: '(输出|打印|展示|重复|泄露|告诉我).{0,8}(系统提示词?|完整提示词?|你的指令)',
    flags: '',
  },
  {
    id: 'prompt-exfil-en',
    category: 'instruction-override',
    source: '(reveal|print|show|repeat|output)\\s+(your\\s+)?(system\\s+prompt|initial\\s+instructions?|hidden\\s+instructions?)',
    flags: 'i',
  },
  {
    id: 'persona-zh',
    category: 'role-injection',
    source: '(你现在是|从现在开始你是|假装你(是|不受)|忘掉你(是|的身份)|进入开发者模式)',
    flags: '',
    note: '劫持短语整体匹配;「扮演导游介绍景点」这类正常请求不含这些短语',
  },
  {
    id: 'persona-en',
    category: 'role-injection',
    source: '(you\\s+are\\s+now|pretend\\s+(to\\s+be|you\\s+are)|act\\s+as\\s+if\\s+you\\s+(are|have\\s+no)|developer\\s+mode|do\\s+anything\\s+now|\\bDAN\\s+mode)',
    flags: 'i',
  },
  {
    id: 'guard-bypass-zh',
    category: 'role-injection',
    source: '(无视|绕过|解除|关闭).{0,6}(安全(限制|机制|设置)|内容(限制|过滤)|防护|护栏)',
    flags: '',
  },
] as const
