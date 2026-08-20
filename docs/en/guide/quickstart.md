# Quickstart

## Install

```sh
npm i @yiong/railguard
```

Zero runtime dependencies, ESM-only, works on both Node ≥ 20.19 and edge runtimes (Cloudflare Workers / Vercel Edge).
The build is neither bundled nor minified — `src/` ships in the package, so every published file can be diffed back to its source.

## One pipeline

```
onInput → onPromptBuild → beforeToolCall → afterToolCall → onModelResponse → onOutput
                    └──────────── audit event stream (side channel) ────────────┘
```

Rules mount per hook, and **array order is execution order** — the pipeline never auto-reorders anything; order is load-bearing
(dependencies like "create the approval ticket before verifying links" are real).

```ts
import { createGuard, lens } from '@yiong/railguard'
import { faithfulness, injection, inputHygiene, linkPolicy, maxLength } from '@yiong/railguard/rules'
import { consoleSink } from '@yiong/railguard/audit'

const guard = createGuard({
  audit: consoleSink(),
  hooks: {
    onInput: [inputHygiene(), maxLength(2000), injection({ mode: 'block' })],
    onOutput: [
      faithfulness({ resolve: (c) => corpus[c.source] ?? null, quoteOf: (c) => c.quote }),
      lens(linkPolicy({ allow: ['https://docs.example.com/'] }), (p) => p.answer, (p, v) => ({ ...p, answer: v })),
    ],
  },
})
```

## Wiring it up

```ts
const ctx = guard.context()                       // one context per request

const input = await guard.run('onInput', userQuestion, ctx)
if (!input.ok) return refuse(input.blocked?.reason) // both blocked and escalated set ok=false

// … model call and tool loop (run beforeToolCall / afterToolCall around each tool) …

const output = await guard.run('onOutput', answerPayload, ctx)
if (!output.ok) return refuse(output.blocked?.reason)
reply(output.output)                              // may have been modified by rules (redaction / link stripping / degraded refusal)
```

Three points:

- **`run` is enforce, `check` is a dress rehearsal**: `guard.check()` runs every rule once in observe mode and
  never mutates the input — the foundation for unit tests and evals.
- **`!ok` comes in two flavors**: `blocked` (blocked — return `blocked.reason` to the user) and
  `escalation` (escalated to a human — `escalation.payload` is the raw underlying operation, and that is what the approver must see).
- **`output.output` is what you actually send**: rules may modify it (PII masking, removal of non-allowlisted links,
  degraded refusal on failed citation verification) — never send the original value you're holding.

## Handling escalation (escalated)

```ts
const call = await guard.run('beforeToolCall', { name, args }, ctx)
if (call.verdict === 'escalated') {
  // escalation.payload carries the approval ticket id and the raw call; push it to the approver — after approval, retrying with identical args consumes the ticket and passes
  return askForApproval(call.escalation)
}
```

Approval recovery semantics are "retry-consumes-ticket": a retry by the same person with identical args that matches an approved ticket passes; one ticket, one use prevents replay,
and this fits stateless HTTP naturally. See [data-access half](./data-access).

## Next steps

- [Core concepts](./concepts): tri-state staged rollout, verdict×status orthogonality, failMode, lens
- [Built-in rules](./rules): each rule's options and semantics
- [Eval framework](./eval): measure ASR and utility before shipping
