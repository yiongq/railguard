import type { Rule, RuleOutcome } from '../core/types'

/**
 * 事实分信任级(wecom price-guard 的教训沉淀):
 * authoritative=工具/系统产出;derived=规则推导;userStated=用户自述——
 * 承诺语境下用户自述不作数,防「客户喊 6800 你答应就过护栏」。
 */
export type FactTrust = 'authoritative' | 'derived' | 'userStated'

export interface Fact {
  value: number
  trust: FactTrust
  /** 来源说明,进审计 */
  source?: string
}

export interface FactProvider {
  facts(): readonly Fact[]
}

export interface NumericTraceOptions {
  provider: FactProvider
  /**
   * 数字抽取器(locale 插件位)。默认抽取阿拉伯数字(含千分位/小数),
   * 中文金额单位(万/元)这类宿主语言相关的解析由宿主注入。
   */
  extract?: (text: string) => readonly ExtractedNumber[]
  /** 相对容差(默认按书写精度推导:整数 ±0.5,小数按末位精度) */
  tolerance?: (n: number) => number
  /** 命中不到白名单事实的数字如何处置:redact=抹去(默认),block=整条拦截 */
  onUngrounded?: 'redact' | 'block'
  /** 是否处于「承诺语境」(报价/确认场景),是则 userStated 事实不作数 */
  committing?: boolean
  hook?: Rule['hook']
}

export interface ExtractedNumber {
  value: number
  raw: string
}

const DEFAULT_EXTRACT = (text: string): ExtractedNumber[] =>
  [...text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d{2,}/g)].map((m) => ({
    value: Number(m[0].replace(/,/g, '')),
    raw: m[0],
  }))

/** 书写精度容差:「5.8」±0.05,「120」±0.5——固定百分比在密集数值域上等于放行一切 */
const DEFAULT_TOLERANCE = (n: number): number => {
  const s = String(n)
  const dot = s.indexOf('.')
  if (dot < 0) return 0.5
  return 0.5 * 10 ** -(s.length - dot - 1)
}

/**
 * 无据数字溯源:输出里的每个数据型数字必须能在事实白名单里找到出处,
 * 找不到的按 onUngrounded 处置。年份(1900-2100)与孤立小整数不算数据型。
 */
export function numericTrace(options: NumericTraceOptions): Rule<string> {
  const extract = options.extract ?? DEFAULT_EXTRACT
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const action = options.onUngrounded ?? 'redact'
  return {
    id: 'numeric-trace',
    hook: options.hook ?? 'onOutput',
    tier: 'deterministic',
    cost: 'zero',
    version: '1.0.0',
    threats: { llm: ['LLM07:2026'] },
    check(input: string): RuleOutcome<string> {
      const facts = options.provider
        .facts()
        .filter((f) => (options.committing ? f.trust !== 'userStated' : true))
      const grounded = (v: number) => facts.some((f) => Math.abs(f.value - v) <= tolerance(v))
      const isDataLike = (n: ExtractedNumber) => !(n.value >= 1900 && n.value <= 2100 && Number.isInteger(n.value) && n.raw.length === 4)

      const offenders = extract(input).filter((n) => isDataLike(n) && !grounded(n.value))
      if (offenders.length === 0) return { verdict: 'pass', status: 'ok' }
      const reason = `无据数字: ${offenders.map((o) => o.raw).join(', ')}`
      if (action === 'block') {
        return { verdict: 'blocked', status: 'ok', reason, evidence: offenders }
      }
      let out = input
      for (const o of offenders) out = out.split(o.raw).join('[数字无出处已移除]')
      return { verdict: 'modified', status: 'ok', transformed: out, reason, evidence: offenders }
    },
  }
}
