# Streaming Guardrails

Gateway-style solutions generally skip guardrails entirely for streaming output — railguard makes it a first-class citizen:
**exactly the same rules and tri-state as the non-streaming `run()`**, with no separate downgrade for streaming.

```ts
import { createStreamGuard } from '@yiong/railguard'

const stream = createStreamGuard(guard, ctx)          // hook defaults to onOutput

for await (const chunk of modelStream) {
  const out = await stream.push(chunk)
  if (out.emit) send(out.emit)                        // text that passed the guard (possibly modified)
  if (out.blocked) return cutStream(out.blocked)      // mid-stream block cuts the stream immediately
}
const rest = await stream.flush()                     // flush the remaining buffer at end of stream
if (rest.emit) send(rest.emit)
if (rest.blocked) return cutStream(rest.blocked)
```

## Semantics

- **Sentence-level batching**: chunks accumulate into complete sentences at sentence
  boundaries; each batch runs through the onOutput rules before release. The default
  boundary covers Chinese/English sentence punctuation, newlines, and "ASCII period +
  whitespace" — English declarative prose splits normally while decimals like `3.5` are
  never cut in half. Rules see complete sentences, not fragments — `linkPolicy` cannot be
  fooled by a URL split in half.
- **A buffer ending exactly on a boundary** counts as a complete segment and is checked
  immediately, without waiting for the next chunk — scenarios that depend on the host's
  flush (e.g. Mastra cannot emit extra text at the end of a stream) will not swallow sentences.
- **Custom boundaries**: both zero-width (lookaround) and consuming regexes (e.g. `/\n/`)
  work; a consuming separator stays attached to the preceding segment and is never eaten
  from the stream. `m`/`y` flags are stripped for safety; do not use capture groups.
- **Forced check on overflow**: `maxBuffer` (default 480 characters) prevents a long
  punctuation-free stream from choking the buffer.
- **Blocked means the stream is dead**: once blocked, every subsequent `push` returns
  empty — there is no "blocked halfway, then kept going."

## Options

```ts
createStreamGuard(guard, ctx, {
  boundary: /(?<=[。!?;\n!?;])|(?<=\.)(?=\s)/,  // batching boundary (default)
  maxBuffer: 480,
  hook: 'onOutput',
})
```

The two adapters ([Vercel AI SDK](./adapter-vercel-ai)'s `wrapStream` and
[Mastra](./adapter-mastra)'s `processOutputStream`) use exactly this machinery internally —
no need to wire it up yourself.

## An Honest Statement of the Cost

Sentence-level batching means delivery latency grows by roughly one sentence's generation
time; blocking happens at sentence boundaries, and the sentences already delivered cannot
be recalled. This is the inherent geometry of streaming guardrails, not an implementation
defect — genuinely sensitive scenarios (commitment contexts, outbound sends) should use
non-streaming + full-text verification.
