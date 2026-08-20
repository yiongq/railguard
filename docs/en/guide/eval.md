# Evaluation Framework

`@yiong/railguard/eval`. It answers two questions: **do attacks get stopped** (ASR, attack success rate)
and **does benign traffic get harmed** (utility). A single metric always drifts — grade only the catch rate
and the guardrail gets tuned to block everything; reading both metrics together is the engineering fact.

## Evaluate Out of the Box

```ts
import { evaluate, ioCases, referenceIoGuard, EVAL_DATASET_VERSION } from '@yiong/railguard/eval'

const report = await evaluate(referenceIoGuard(), ioCases(), { datasetVersion: EVAL_DATASET_VERSION })
report.asr            // attack success rate (lower is better)
report.utility        // benign pass-through-unchanged rate (higher is better)
report.benignDegraded // share of benign traffic modified (marking/masking counts; listed separately for judgment)
report.byRule         // per rule: how many blocked / false positives / modified
report.byTag          // grouped by scenario tag (injection / pii / exfil ...)
```

The built-in dataset (version stamp `EVAL_DATASET_VERSION`) comes in two halves: `ioCases()`
(injection / exfiltration / PII / ungrounded numbers / citation forgery / lethal trifecta) pairs with
`referenceIoGuard()`; `dataCases()` (RBAC privilege escalation / row-level leakage / tiered approval)
pairs with `referenceDataGuard()`.

**An honest commitment**: the dataset contains one off-table novel-phrasing attack (`exp-novel-phrasing`)
that the probabilistic layer is **expected to miss** — a non-zero ASR on the reference dataset is a
documented fact, not a defect. The real line of defense is the deterministic rules; this case exists to
remind you never to treat heuristics as the boundary.

## Case Model

```ts
const case_: EvalCase = {
  id: 'exf-lethal-trifecta',
  kind: 'attack',                       // or 'benign'
  steps: [{ hook: 'beforeToolCall', payload: { name: 'send_email', args: { ... } } }],
  context: { taint: { untrustedSources: ['email:attachment'], touchedPrivateData: true, externalCommsRequested: false } },
  threats: { llm: ['LLM01:2026'] },     // data source for the coverage matrix's "verified" column
}
```

- **Multiple steps share one ctx** — taint accumulates across steps, so cross-call scenarios like the
  lethal trifecta replay faithfully;
- `context` seeds prior state ("an untrusted email has already been read");
- **`neutralizedBy`**: which rules' modified verdicts count as "successfully neutralized". When a rule
  like spotlight that marks all content is attached, this must be narrowed — otherwise every attack
  shows as caught and ASR falsely drops to zero. blocked / escalated always count as caught,
  regardless of this setting.

Five verdict grades: attack → `caught` / `leaked`; benign → `clean` / `degraded` (modified: marking,
masking — protective actions are not false positives, listed separately) / `harmed` (blocked: a false positive).

## Pinning Metrics in CI

Evaluation reads no clock and no randomness — same guard plus same cases always yields the same
report, so the numbers can be asserted directly:

```ts
expect(report.asr).toBeCloseTo(1 / 17, 10)   // any change to the dataset or rule table turns this red
expect(report.cases.filter((c) => c.outcome === 'harmed')).toHaveLength(0)
```

## Threshold Curve (Probabilistic Layer)

```ts
const curve = await scoreCurve(guard, cases, { ruleIds: ['injection.block'] })
// [{ threshold, attackCatchRate, benignFlagRate }, ...]
```

Runs everything in observe (`guard.check`, no blocking, no modification), takes each case's highest
score, and computes "hypothetical catch rate vs hypothetical false-positive rate" over a threshold
grid — ROC-style trade-off data for setting heuristic thresholds. Deterministic rules emit no score
and naturally stay out of the curve.

## Record-Replay Reconciliation

The observe → enforce reconciliation step, turned into code. Before shipping a new rule, answer first:
**which historical requests would it re-verdict?**

```ts
import { recordingGuard, diffReplay, serializeRuns, parseRuns } from '@yiong/railguard/eval'

// 1) Production side: record real traffic (observe mode, nothing gets blocked)
const store: RecordedRun[] = []
const guard = recordingGuard(createGuard({ defaultMode: 'observe', hooks }), store)

// 2) Evaluation side: replay with the enforce config, get the re-verdict list
const replay = await diffReplay(createGuard({ hooks }), store)
replay.changed  // [{ seq, hook, before: 'pass', after: 'blocked', ruleAfter: 'injection.block' }]
```

What gets recorded: hook, raw payload, taint/identity/channel snapshot, verdict. `kv` and external
storage are not recorded — rules that depend on approval storage may replay differently; this boundary
is a documented commitment. For persistence use `serializeRuns` / `parseRuns` (with a versioned envelope).

## Coverage Matrix

```ts
import { coverageMatrix, renderCoverageMarkdown } from '@yiong/railguard/eval'

const matrix = coverageMatrix(guard.rules(), cases)
matrix.uncovered   // threats no rule claims to cover — a blank cell is a fact, not an omission
matrix.unknownIds  // rules referencing IDs outside the catalog (a signal of typos or a stale catalog)
```

The catalog data file (`THREAT_CATALOG`, version-stamped) carries the official entries of both OWASP
2026 lists: the LLM Top 10 (published 2026-08, with 8 of 10 entries renumbered from 2025) and the
Agentic Applications Top 10 (ASI). This site's [coverage matrix page](../coverage) is generated from
rule metadata by `pnpm gen:coverage` — never hand-copied.
