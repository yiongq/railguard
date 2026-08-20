# OpenTelemetry Adapter

`@yiong/railguard/otel`. Turns every guardrail verdict into a standards-shaped event
attached to your existing request timeline — "this injection was blocked at onInput"
and "this citation failed verification and was dropped" show up in your trace panel
instead of being scattered across function logs.

```
/api/ask (host HTTP span)
 ├─ chat gpt-4o                       120ms
 ├─ railguard.onInput                   2ms   ← traceGuard (optional)
 │    • gen_ai.evaluation.result  name=injection.block  label=blocked  score=0.75
 └─ railguard.onOutput                  3ms
      • gen_ai.evaluation.result  name=citation-faithfulness  label=modified
```

## Wiring (two parts, use what you need)

```ts
import { trace } from '@opentelemetry/api'
import { otelAuditSink, traceGuard } from '@yiong/railguard/otel'

// ① Verdict events on the active span — most hosts only need this line
const guard = createGuard({
  audit: otelAuditSink({ getActiveSpan: () => trace.getActiveSpan() }),
  hooks: { /* ... */ },
})

// ② Optional: one span per hook (when you want guardrail latency itself visible)
const traced = traceGuard(guard, { tracer: trace.getTracer('railguard') })
```

**Zero-dependency discipline**: this package does not depend on `@opentelemetry/api` —
the host hands in tracer/span/logger as structural shapes (the api 1.x consumer surface
has had zero breaking changes since 1.0; calling by shape means zero version coupling —
the same pattern Vercel AI SDK v7 uses). With no target wired, the sink is a pure no-op.

## Attribute mapping

Verdict events align with the merged `gen_ai.evaluation.result` convention
(Development status); details live under the `railguard.*` namespace — no invented
`gen_ai.*` attributes:

| Audit event | OTel attribute |
|---|---|
| `ruleId` | `gen_ai.evaluation.name` |
| `verdict` (pass/modified/blocked/escalated) | `gen_ai.evaluation.score.label` |
| `score` (probabilistic rules only) | `gen_ai.evaluation.score.value` |
| `reason` (**off by default**, see below) | `gen_ai.evaluation.explanation` |
| hook / rule version / mode / status / rescued / requestId / label | `railguard.hook` `railguard.rule.version` `railguard.mode` `railguard.status` `railguard.rescued` `railguard.request.id` `railguard.label` |

`traceGuard` hook spans: fixed names `railguard.{hook}` (6 values, low cardinality —
rule identity stays in attributes, never in span names), closing with
`railguard.verdict` and `railguard.stopped_by`.

## Three deliberate semantics

- **`reason` stays out of traces by default**: it may quote user-content fragments
  (e.g. "ungrounded number: 9999"), and traces usually ship to third-party backends.
  Enable explicitly with `captureReason: true` — content-off-by-default is OTel's own
  GenAI guidance, not this package's quirk;
- **Blocking is not an ERROR**: blocked/escalated means the guardrail did its job;
  span status stays unset. Only an exception thrown by `run()` itself sets ERROR.
  A crashed rule (`status: 'error'`) shows in event attributes, orthogonal to the
  verdict — consistent with the pipeline's semantics;
- **Telemetry never bites back**: any exception inside the sink is swallowed;
  a dead exporter cannot affect verdicts.

## Log events (optional)

The spec defines evaluation results as log events, but the JS Logs API is still 0.x
experimental and most hosts have no LoggerProvider wired. Pass a `logger`
(`{ emit }` shape) to switch to standard log events — attributes identical to the
span-event form, zero migration cost; blocked/escalated log at WARN, the rest INFO.

## Tracking the standard

The guardrail-specific conventions (`run_guardrail` operation, `gen_ai.guardrail.*`
attributes) are still at the proposal stage with an unsettled namespace. This adapter
aligns with the **merged** evaluation convention; when the proposal lands, attribute
names follow in a minor release.
