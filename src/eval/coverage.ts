/**
 * 覆盖矩阵:从规则的 threats 元数据 × 评测用例的 threats 标注,
 * 生成「威胁 → 哪些规则防、哪些用例验证过」的对照表。
 * 未覆盖的威胁明列出来——覆盖矩阵的价值一半在空格上,静默截断即谎报。
 */
import type { Rule, RuleTier, HookPoint, Threats } from '../core/types'
import { THREAT_CATALOG, normalizeThreatId, type ThreatEntry } from './threat-catalog'
import type { EvalCase } from './types'

export interface CoveringRule {
  id: string
  tier: RuleTier
  hook: HookPoint
}

export interface CoverageRow {
  threat: ThreatEntry
  rules: readonly CoveringRule[]
  /** 声称覆盖该威胁且判定为 caught 之外也算——verifiedBy 只回答「有没有攻击用例打过这里」 */
  verifiedBy: readonly string[]
}

export interface CoverageMatrix {
  rows: readonly CoverageRow[]
  /** 名录里无任何规则声称覆盖的威胁 */
  uncovered: readonly ThreatEntry[]
  /** 规则引用了但名录里没有的 ID(拼写错误或名录过期的信号) */
  unknownIds: readonly string[]
}

function threatIds(threats: Threats | undefined): string[] {
  if (!threats) return []
  return [...(threats.llm ?? []), ...(threats.asi ?? []), ...(threats.t ?? [])]
}

export function coverageMatrix(
  rules: readonly Rule[],
  cases: readonly EvalCase[] = [],
  catalog: readonly ThreatEntry[] = THREAT_CATALOG,
): CoverageMatrix {
  const known = new Set(catalog.map((t) => normalizeThreatId(t.id)))
  const unknownIds = new Set<string>()

  const ruleIndex = new Map<string, CoveringRule[]>()
  for (const rule of rules) {
    for (const raw of threatIds(rule.threats)) {
      const key = normalizeThreatId(raw)
      if (!known.has(key)) {
        unknownIds.add(raw)
        continue
      }
      const list = ruleIndex.get(key) ?? []
      if (!list.some((r) => r.id === rule.id)) {
        list.push({ id: rule.id, tier: rule.tier, hook: rule.hook })
      }
      ruleIndex.set(key, list)
    }
  }

  const caseIndex = new Map<string, string[]>()
  for (const evalCase of cases) {
    if (evalCase.kind !== 'attack') continue
    for (const raw of threatIds(evalCase.threats)) {
      const key = normalizeThreatId(raw)
      // 用例侧的名录外 ID 同样要报警——写错的 ID 静默消失,矩阵就在谎报「未验证」
      if (!known.has(key)) {
        unknownIds.add(raw)
        continue
      }
      const list = caseIndex.get(key) ?? []
      if (!list.includes(evalCase.id)) list.push(evalCase.id)
      caseIndex.set(key, list)
    }
  }

  const rows: CoverageRow[] = catalog.map((threat) => ({
    threat,
    rules: ruleIndex.get(normalizeThreatId(threat.id)) ?? [],
    verifiedBy: caseIndex.get(normalizeThreatId(threat.id)) ?? [],
  }))

  return {
    rows,
    uncovered: rows.filter((r) => r.rules.length === 0).map((r) => r.threat),
    unknownIds: [...unknownIds],
  }
}

const LIST_TITLES: Record<string, { en: string; zh: string }> = {
  llm: { en: 'OWASP Top 10 for LLM Applications 2026', zh: 'OWASP LLM 应用 Top 10(2026)' },
  asi: { en: 'OWASP Top 10 for Agentic Applications 2026', zh: 'OWASP Agentic 应用 Top 10(2026)' },
  t: { en: 'Agentic AI – Threats and Mitigations v1.1', zh: 'Agentic AI 威胁与缓解 v1.1' },
}

/** 渲染成 Markdown(文档站的覆盖矩阵页由脚本从这里生成,不手抄) */
export function renderCoverageMarkdown(matrix: CoverageMatrix, lang: 'zh' | 'en' = 'zh'): string {
  const zh = lang === 'zh'
  const lines: string[] = []
  const lists = [...new Set(matrix.rows.map((r) => r.threat.list))]

  for (const list of lists) {
    const rows = matrix.rows.filter((r) => r.threat.list === list)
    if (rows.length === 0) continue
    lines.push(`## ${LIST_TITLES[list]?.[zh ? 'zh' : 'en'] ?? list}`, '')
    lines.push(
      zh
        ? '| 威胁 | 名称 | 防护规则 | 攻击用例验证 |'
        : '| Threat | Title | Covering rules | Verified by attack cases |',
      '|---|---|---|---|',
    )
    for (const row of rows) {
      const rules =
        row.rules.length === 0
          ? zh ? '**——未覆盖**' : '**— not covered**'
          : row.rules
              .map((r) => `\`${r.id}\`${r.tier === 'probabilistic' ? (zh ? ' *(概率层)*' : ' *(probabilistic)*') : ''}`)
              .join('<br>')
      const verified = row.verifiedBy.length === 0 ? '—' : row.verifiedBy.map((id) => `\`${id}\``).join('<br>')
      lines.push(`| ${row.threat.id} | ${zh ? row.threat.titleZh : row.threat.title} | ${rules} | ${verified} |`)
    }
    lines.push('')
  }

  if (matrix.uncovered.length > 0) {
    lines.push(
      zh
        ? `> 未覆盖:${matrix.uncovered.map((t) => t.id).join('、')}。空格是事实,不是遗漏——按需自写规则或等后续里程碑。`
        : `> Not covered: ${matrix.uncovered.map((t) => t.id).join(', ')}. The gaps are facts, not omissions.`,
      '',
    )
  }
  if (matrix.unknownIds.length > 0) {
    lines.push(
      zh
        ? `> ⚠ 规则引用了名录外的 ID:${matrix.unknownIds.join('、')}(拼写错误或名录需更新)。`
        : `> ⚠ Rules reference IDs missing from the catalog: ${matrix.unknownIds.join(', ')}.`,
      '',
    )
  }
  return lines.join('\n')
}
