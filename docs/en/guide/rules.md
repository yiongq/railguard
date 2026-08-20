# Built-in Rules

All from `@yiong/railguard/rules`. The threat IDs listed map to the [OWASP coverage matrix](../coverage).

| Rule | Hook (default) | Layer | Threats |
|---|---|---|---|
| [`injection`](#injection) | onInput / any | probabilistic | LLM01 · ASI01 |
| [`inputHygiene`](#inputhygiene) | onInput | deterministic | LLM01 |
| [`maxLength`](#maxlength) | onInput | deterministic | LLM06 |
| [`faithfulness`](#faithfulness) | onOutput | deterministic | LLM07 · LLM09 |
| [`outputCaps`](#outputcaps) | onOutput | deterministic | LLM06 |
| [`linkPolicy`](#linkpolicy) | onOutput | deterministic | LLM10 · ASI02 |
| [`numericTrace`](#numerictrace) | onOutput | deterministic | LLM07 |
| [`pii`](#pii) | onOutput | deterministic | LLM02 |
| [`spotlight`](#spotlight) | afterToolCall | probabilistic | LLM01 · ASI06 |
| [`lethalTrifecta`](#lethaltrifecta) | beforeToolCall | deterministic | LLM01 · LLM02 · ASI02 |
| [`admitPromptBoundText`](#admitpromptboundtext) | helper | deterministic | ASI06 |

## injection

Injection detection, rule-table-driven (the data file carries a version stamp `INJECTION_TABLE_VERSION`; any language can load the same table).

```ts
injection({ mode: 'block' })                          // user input: block on hit
injection({ mode: 'defang', hook: 'afterToolCall' })  // retrieval / tool content: defang, don't delete
injection({ mode: 'flag' })                           // flag only (score + reason), hand off downstream
```

- **Table discipline**: a zero-false-positive hard line — role-marker rows are line-start-anchored
  ("OS: Linux" does not fire), override/persona rows match hijack phrases rather than bare words
  ("act as a tour guide and introduce the sights" does not fire). Change one row, bump the version.
- **defang freeze-block**: the mark token is derived from `fnv1a(requestId + content)` — an attacker cannot predict it;
  pre-planted forged marks are broken first by `breakForgedMarks` — faking "already defanged" is not viable.
- Host-specific patterns go in via `extraPatterns`; do not fork the table.
- Probabilistic layer: enforcing it alone does not constitute a security boundary — see [Core Concepts](./concepts#the-probabilistic-layer-is-not-a-security-boundary).

## inputHygiene

Invisible-Unicode stripping and control-character blocking. The Unicode Tag block (U+E0000–E007F) and zero-width characters are
the usual carriers of "hidden injected instructions" — stripping them defuses the attack, no need to reject the whole input; bare control characters are blocked outright.

## maxLength

Input length cap (in characters). `maxLength(2000)`, or `maxLength(500, 'onOutput')` to attach it to another hook.

## faithfulness

Verbatim citation verification — the last gate on the output side, `failMode: 'closed'` (nothing passes even when the verifier itself is down).

```ts
faithfulness<C>({
  resolve: (c) => corpus[c.source] ?? null, // source text the citation claims to come from; return null if not found
  quoteOf: (c) => c.quote,                  // the verbatim quoted text
})
```

Semantics: every citation's quote must exist verbatim in the text `resolve` returns (compared after whitespace folding);
what fails verification is dropped; when a non-refusal answer is stripped down to zero citations, it is **force-downgraded to a refusal**; a refusal may not carry citations.

## outputCaps

Caps on answer length and citation count — guards against runaway output and citation flooding.

## linkPolicy

URL allowlist — **allowlist semantics**; a blocklist can be bypassed by a same-domain relay. Models fabricate domains along with everything else:
only URLs with an allowlisted prefix survive, the rest are replaced with `[链接已移除]`; it also strips invisible Tag characters from the output
(a hidden exfiltration channel). For structured payloads, lift with [lens](./concepts#lens-structured-payloads-reuse-string-rules).

## numericTrace

Ungrounded-number tracing: every data-like number in the output must find its source in a **trust-tiered fact allowlist**.

```ts
numericTrace({
  provider: { facts: () => [{ value: 58, trust: 'authoritative' }] },
  committing: true,        // committing context: userStated facts don't count ("the customer said 6800, so just agree" is not allowed)
  onUngrounded: 'redact',  // or 'block'
})
```

- Trust tiers: `authoritative` (produced by tools/system) > `derived` (rule-derived) > `userStated` (the user's own claim);
- Tolerance is derived from written precision: "5.8" ±0.05, "120" ±0.5 — a fixed percentage in a dense numeric domain amounts to waving everything through;
- Years and isolated small integers do not count as data-like; parsing of Chinese amount units (万/元) is injected via the host's `extract`.

## pii

Mainland-China phone numbers / national ID numbers / emails / bank cards, with three policies: `mask` (keep head and tail, mask the rest) / `redact` / `block`.
Deterministic regex layer; higher-recall NER detection goes through an optional adapter and stays out of the zero-dependency core.

## spotlight

Spotlighting (Microsoft 2024): mark untrusted content so the model treats it as data, not instructions.
The marker is derived from `ctx.requestId` — different on every request, so an attacker who has read the system prompt cannot forge it in advance.
`delimit` (delimiter wrapping, the default) / `datamark` (per-token marking — stronger, at a readability cost).
A probabilistic-layer mitigation; must be stacked with output-side verification.

## lethalTrifecta

The lethal trifecta (Willison's lethal trifecta / Meta's Rule of Two, codified):
**has touched private data + has ingested untrusted content + is now about to communicate externally** — when all three hold, escalate to a human for approval.

```ts
lethalTrifecta({
  isExternalComm: (name) => ['send_email', 'http_post'].includes(name),
  touchesPrivateData: (name) => name === 'read_crm',
})
```

A deterministic rule: it does not guess whether content is an injection, only checks whether the three elements are all present. The `escalated` evidence
is the raw call (tool name + arguments). Taint is marked by the host via helpers such as `markUntrustedSource`.

## admitPromptBoundText

Admission control for prompt-bound text: any persistent text headed into the system prompt (memories, plans, user preferences)
must pass this gate before being written — prevents poisoned content from luring the model into "saving the payload as a memory" and creating persistent contamination (ASI06).
Anything that still matches injection patterns after sanitization is refused storage.
