# Vercel AI SDK Adapter

`@yiong/railguard/adapters/vercel-ai`, aligned with ai@7 (the LanguageModelV4 middleware shape).
**Zero-dependency discipline**: no runtime or peer dependency on `ai` — the middleware object is a
hand-written structural mirror of the public d.ts; `wrapLanguageModel` consumes it structurally,
so the mirror is assignable as-is.

## Model middleware: onInput / onOutput

```ts
import { wrapLanguageModel } from 'ai'
import { railguardMiddleware } from '@yiong/railguard/adapters/vercel-ai'

const model = wrapLanguageModel({
  model: yourModel,
  middleware: railguardMiddleware(guard, { blockedText: '(内容未通过输出护栏)' }),
})
```

| SDK hook point | railguard hook | Behavior |
|---|---|---|
| `transformParams` | `onInput` | The last user message is inspected; modified rewrites and continues; blocked throws `RailguardBlockedError` |
| `wrapGenerate` | `onOutput` | The full output is inspected; modified replaces the text; blocked is swapped for `blockedText` |
| `wrapStream` | `onOutput` (streaming) | [Sentence-level batching](./streaming); a mid-stream block cuts the stream and emits `blockedText`, subsequent deltas are dropped |

A blocked input **throws** rather than silently rewriting — catch it at the call site and turn it into a refusal response:

```ts
try {
  const { text } = await generateText({ model, prompt, tools })
} catch (err) {
  if (err instanceof RailguardBlockedError) return refuse(err.message) // err.ruleId gives attribution
  throw err
}
```

## Tool wrapping: beforeToolCall / afterToolCall

The AI SDK's tool execution does not pass through model middleware — the tool-side hook point is wrapping `execute`:

```ts
import { guardTools, RailguardEscalationError } from '@yiong/railguard/adapters/vercel-ai'

const ctx = guard.context({ principal })
const tools = guardTools(rawTools, guard, { context: () => ctx })
```

- `beforeToolCall` inspects `{ name, args }`: blocked throws `RailguardBlockedError`
  (the SDK records it as a tool-error and returns it to the model); escalated throws `RailguardEscalationError`,
  whose `payload` is the original call plus the approval ticket id — catch it and route it through your approval flow;
- `afterToolCall` inspects `{ name, data }`: the rewritten result of row-level filtering / masking becomes the tool's return value.

## The critical wiring: shared context

The lethal trifecta requires taint to accumulate across steps (read an untrusted web page → then try to send outbound).
Have the middleware and the tool wrapper **share the same `context` factory** — one ctx per request:

```ts
const ctx = guard.context()
const middleware = railguardMiddleware(guard, { context: () => ctx })
const tools = guardTools(rawTools, guard, { context: () => ctx })
```

Within a single call, `transformParams` and `wrapGenerate/wrapStream` already share the ctx
automatically by params object identity — no extra wiring needed.

## Type compatibility notes

The adapter's structural types are checked against ai@7.0 / @ai-sdk/provider@4.0. If the host's SDK version
has a stricter type surface and the assignment errors, behavior is unaffected — just assert through:
`middleware: railguardMiddleware(guard) as unknown as LanguageModelMiddleware`.
