import type { Guard } from '../core/types'
import type { EvalCase } from './types'
import { runCaseObserved } from './observe'

export interface CurvePoint {
  threshold: number
  /** maxScore ≥ threshold 的攻击占比(假想拦截率) */
  attackCatchRate: number
  /** maxScore ≥ threshold 的良性占比(假想误伤率) */
  benignFlagRate: number
}

export interface ScoreCurveOptions {
  /** 阈值网格,默认 0.05 步进 */
  thresholds?: readonly number[]
  /** 只统计这些规则的 score(缺省统计所有给分规则) */
  ruleIds?: readonly string[]
}

// 整数算完再除:浮点连乘会让 0.7 变 0.7000000000000001,恰好等于阈值的 score
// 在标称 0.7 那一行被漏计——ROC 数据恰恰在宿主最爱选的整值上失真
const DEFAULT_THRESHOLDS: readonly number[] = Array.from({ length: 19 }, (_, i) => Math.round((i + 1) * 5) / 100)

/**
 * 概率层阈值曲线:全规则 observe 跑一遍(guard.check,不拦截不改写),
 * 取每条用例的最高 score,再按阈值网格算「假想拦截率 vs 假想误伤率」——
 * 给概率性规则(启发式/分类器)定阈值用的 ROC 式取舍数据。
 * 确定性规则不给 score,天然不进曲线;它们的效果看 evaluate() 的双指标。
 */
export async function scoreCurve(
  guard: Guard,
  cases: readonly EvalCase[],
  options: ScoreCurveOptions = {},
): Promise<CurvePoint[]> {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS
  const attackScores: number[] = []
  const benignScores: number[] = []

  for (const evalCase of cases) {
    const events = await runCaseObserved(guard, evalCase)
    const scores = events
      .filter((e) => e.score !== undefined)
      .filter((e) => options.ruleIds === undefined || options.ruleIds.includes(e.ruleId))
      .map((e) => e.score ?? 0)
    const max = scores.length === 0 ? 0 : Math.max(...scores)
    ;(evalCase.kind === 'attack' ? attackScores : benignScores).push(max)
  }

  const rate = (scores: readonly number[], t: number): number =>
    scores.length === 0 ? 0 : scores.filter((s) => s >= t).length / scores.length

  return thresholds.map((threshold) => ({
    threshold,
    attackCatchRate: rate(attackScores, threshold),
    benignFlagRate: rate(benignScores, threshold),
  }))
}
