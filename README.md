# @yiong/railguard

English | [简体中文](./README.zh-CN.md)

Guardrail pipeline for LLM apps and agents: **data-access guards** (RBAC / row filtering / masking / human approval) and **LLM I/O guards** (prompt injection / citation faithfulness / link allowlists) in one in-process lifecycle-hook pipeline. TypeScript, zero runtime dependencies, Node + edge.

> Design philosophy (OWASP GenAI 2026): "build the system around it, so that when the model
> is fooled — and it will be — nothing important breaks."

## Shape

```
onInput → onPromptBuild → beforeToolCall → afterToolCall → onModelResponse → onOutput
                └──────────────── audit event stream (side channel) ───────────────┘
```

- **A rule is a pure function plus metadata** — no network, no env, no clock, no randomness. The same rule runs in the browser and on the server.
- **Per-rule tri-state**: `enforce / observe / off` — ship a new rule in observe mode first, reconcile the audit stream, then switch it to enforce.
- **Graded actions**: pass / modified (rewrite) / blocked / escalated (human-in-the-loop; the escalation payload must be the raw low-level operation, never a model-written summary).
- **`status` is orthogonal to `verdict`**: a rule crashing is not the same as content violating. Per-rule `failMode: open | closed`.
- **Order is load-bearing**: rules run in registration order; the pipeline never reorders them.

## Quick start

```ts
import { createGuard, lens } from '@yiong/railguard'
import { faithfulness, injection, inputHygiene, linkPolicy, maxLength } from '@yiong/railguard/rules'
import { consoleSink } from '@yiong/railguard/audit'

const guard = createGuard({
  audit: consoleSink(),
  hooks: {
    onInput: [inputHygiene(), maxLength(200), injection({ mode: 'block' })],
    onOutput: [
      faithfulness({ resolve: (c) => corpus.slice(c), quoteOf: (c) => c.quote }),
      lens(linkPolicy({ allow: ['https://github.com/you/'] }), (p) => p.answer, (p, v) => ({ ...p, answer: v })),
    ],
  },
})

const ctx = guard.context()
const input = await guard.run('onInput', userQuestion, ctx)
if (!input.ok) return refuse(input.blocked?.reason)
// ... model call and tool loop ...
const output = await guard.run('onOutput', answerPayload, ctx)
```

## Built-in rules (M1)

| Rule | Hook | Tier | What it does |
|---|---|---|---|
| `injection({mode})` | onInput / any | probabilistic | Injection pattern table (data file + version stamp); three modes: block / defang (sanitize without deleting) / flag |
| `inputHygiene()` | onInput | deterministic | Strips invisible Unicode (tag block, zero-width); blocks raw control characters |
| `maxLength(n)` | onInput | deterministic | Input length cap |
| `faithfulness(opts)` | onOutput | deterministic | Verbatim citation verification; unverifiable citations are dropped; if none survive, the answer is force-downgraded to a refusal (`failMode: closed`) |
| `linkPolicy({allow})` | onOutput | deterministic | URL allowlist (allowlist semantics — blocklists are bypassable); strips invisible tag characters |
| `outputCaps(opts)` | onOutput | deterministic | Caps answer length and citation count |
| `spotlight({mode})` | afterToolCall / any | probabilistic | Spotlighting for untrusted content (per-request marker derived from requestId); delimit / datamark |
| `lethalTrifecta(opts)` | beforeToolCall | deterministic | Escalates to human when private-data + untrusted-content + external-comms all present; evidence = raw call |
| `numericTrace({provider})` | onOutput | deterministic | Every data-like number must trace to a trust-leveled fact (authoritative/derived/userStated); tolerance derived from written precision |
| `pii({kinds, strategy})` | onOutput | deterministic | CN phone / ID / email / bank card; mask / redact / block |
| `admitPromptBoundText` | helper | deterministic | Admission gate for text entering the prompt domain (memory/plans): sanitize then reject on injection hit |

The probabilistic tier (injection heuristics) **does not constitute a security boundary on its own** — the real boundary is output-side verification and the deterministic rules. This is a documented commitment, not a disclaimer.

Streaming: `createStreamGuard(guard, ctx)` batches chunks at sentence boundaries and runs the same onOutput rules incrementally — mid-stream block cuts the stream.

## Data-access guards (`/data`)

Ported from mcp-foundry's guard pipeline (fail-closed, enumeration-oracle-safe, replay-proof):

| API | Hook | What it does |
|---|---|---|
| `rbacToolGate({config})` | beforeToolCall | Role → tool allowlist; unknown role / missing principal blocked (fail-closed) |
| `allowedTools(config, principal, names)` | helper | Narrow the tool list before it is ever shown |
| `rowFilter({config})` | afterToolCall | Row-level filtering via `$self` refs; "not found" and "not yours" return identical denials |
| `fieldMask({config})` | afterToolCall | Recursive field redaction per role |
| `approvalGate({config, store})` | beforeToolCall | Graded human approval: idempotent ticketing, retry-consumes-ticket, one ticket one call, WAL-backed stores |
| `MemoryApprovalStore` / `JsonlApprovalStore` (`/node`) | — | Event-sourced approval stores; crash-tail tolerant replay |
| `SignedJsonlAuditSink` (`/node`) + `verifyAuditChain` (`/audit`) | — | Tamper-evident audit: Ed25519-signed hash chain, offline verification, crash-tail truncation, cross-restart continuation |

## Evals & adapters (M4, `/eval` and `/adapters/*`)

| API | What it does |
|---|---|
| `evaluate(guard, cases)` | ASR + utility dual-metric report (interception rate alone drifts toward blocking everything); byRule/byTag attribution |
| `ioCases()` / `dataCases()` + `referenceIoGuard()` / `referenceDataGuard()` | Versioned dataset + reference guards — evaluate out of the box; CI pins the exact numbers |
| `scoreCurve(guard, cases)` | Threshold curve for the probabilistic layer (observe-mode: hypothetical catch rate vs. false-flag rate) |
| `recordingGuard` / `diffReplay` | Record real traffic → replay under a new config → list of changed verdicts; the observe → enforce reconciliation step as code |
| `coverageMatrix(rules, cases)` | Rule `threats` metadata × the official OWASP 2026 catalogs (LLM Top 10 + Agentic/ASI Top 10); uncovered threats listed honestly |
| `railguardMiddleware(guard)` + `guardTools(tools, guard)` | Vercel AI SDK v7 middleware + tool wrapping (`@yiong/railguard/adapters/vercel-ai`, zero-dep structural types) |
| `railguardProcessor(guard)` | Mastra v1 Processor (`@yiong/railguard/adapters/mastra`); rules-layer, zero model calls — stack it before Mastra's LLM-based detectors |

Honesty note baked into the dataset: it includes an off-table novel-phrasing attack the heuristic layer is *expected* to miss — a non-zero ASR is a documented fact, not a defect.

## Roadmap

- M2 rules half ✅ (0.2.0); M3 data-access half + Ed25519 signed audit chain ✅ (0.4.0)
- M4 ✅ (0.5.0): eval framework (ASR + utility dual metrics, threshold curves, record-replay reconciliation), OWASP 2026 coverage matrix, Vercel AI SDK / Mastra adapters, docs site
- Next: land the ai-edge migration (guide in `docs/migrations/ai-edge.md`), grow the attack corpus, NER-tier PII adapter

## Engineering commitments

Zero `dependencies` (asserted in CI); ESM-only; unbundled, unminified build artifacts (every published file diffs back to source); `src/` ships with the package; versioned rule tables — judgment changes never land in a patch release.

MIT
