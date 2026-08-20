# Mastra Adapter

`@yiong/railguard/adapters/mastra`, aligned with the `Processor` interface of @mastra/core v1.
Zero-dependency: `Processor` is a pure structural type; the adapter hand-writes a minimal mirror of the source and plugs straight into an Agent.

```ts
import { Agent } from '@mastra/core/agent'
import { railguardProcessor } from '@yiong/railguard/adapters/mastra'

const rg = railguardProcessor(guard)
const agent = new Agent({
  // ...
  inputProcessors: [rg],
  outputProcessors: [rg],
})
```

## Hook mapping

| Mastra hook point | railguard hook | Behavior |
|---|---|---|
| `processInput` | `onInput` | The last user message is checked; modified rewrites it; blocked calls `abort()` to trigger the tripwire |
| `processOutputStream` | `onOutput` (streaming) | text-delta [batched by sentence](./streaming): half-sentences are swallowed and buffered, full sentences released (text may be rewritten); on block, `abort()` cuts the stream |
| `processOutputResult` | `onOutput` | Flushes the streaming buffer (`abort()` on violation), then runs the **full final assistant message** through onOutput and rewrites it — the persisted text is guarded on both streaming and non-streaming paths |
| `processToolResult` | `afterToolCall` | Tool results run through the data-access rules; blocked means `abort()` |

Tripwire semantics: `abort(reason, { metadata: { ruleId } })` — non-streaming reads the reason
from `result.tripwire`, streaming receives a `tripwire` chunk. `metadata.ruleId` is for attribution.

## Positioning: rules layer first, LLM detectors after

Mastra's built-in `PIIDetector` / `PromptInjectionDetector` / `ModerationProcessor`
run a model call per detection (a `model` must be configured). railguardProcessor is the **rules layer**:
zero model calls, deterministic, [evaluable](./eval) offline. The two are not either/or — put the rules layer
in front: deterministic hits get blocked outright, saving most of the LLM detection calls;
only the genuinely ambiguous cases go to the model layer.

```ts
inputProcessors: [railguardProcessor(guard), new PromptInjectionDetector({ model })]
```

## Boundaries (documented commitments)

- `processToolResult` only **checks and blocks**; it never rewrites tool results — rewriting requires Mastra's
  `MessageList` API, which the zero-dependency layer stays out of. If you need row-level filtering / masking
  rewrites, wrap `tool.execute` directly with the rules from `@yiong/railguard/data` (same approach as
  [the Vercel adapter's guardTools](./adapter-vercel-ai#tool-wrapping-beforetoolcall-aftertoolcall));
- The streaming path's residual buffer (a stream that ends mid-sentence) can only be blocked, never re-emitted —
  a Mastra processor cannot inject text at the end of a stream. A buffer that ends on a sentence boundary
  is checked and released immediately, so normally punctuated output is unaffected; the live stream may miss
  a trailing half-sentence, but `processOutputResult` re-runs the full final message through onOutput,
  so the persisted text never goes unguarded;
- ctx lives in Mastra's per-request `state`; all four hook points share it automatically within one request
  (so taint flows from input through tools to output).
