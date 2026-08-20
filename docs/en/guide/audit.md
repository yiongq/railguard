# Signed Audit Chain

`@yiong/railguard/audit` + `@yiong/railguard/node`. A guardrail without an audit stream has no metrics;
without tamper resistance it has no trustworthy metrics.

## Audit events

Every rule execution produces one `AuditEvent`: timestamp, requestId, hook, rule id and **version**,
tri-state mode, verdict, status, score, `rescued` (true = this was a real enforce block;
an observe-mode hit does not count as rescued — the two are different things in the metrics).

A sink is just a function:

```ts
import { consoleSink, memorySink } from '@yiong/railguard/audit'

createGuard({ audit: consoleSink(), hooks: { ... } })  // one JSON line per event; works in both Node and edge
```

## Ed25519-signed hash chain

`SignedJsonlAuditSink` (Node) writes events as JSONL, each line carrying
`hash = H(prevHash ‖ event)` and an Ed25519 signature — tamper with any line and the chain breaks at that line:

```ts
import { SignedJsonlAuditSink, readSignedAuditLog } from '@yiong/railguard/node'
import { generateAuditKeypair, verifyAuditChain } from '@yiong/railguard/audit'

const keys = await generateAuditKeypair()
const signed = await SignedJsonlAuditSink.create('audit.jsonl', keys.privateKey) // continues the chain from the file tail
const guard = createGuard({ audit: signed.sink, hooks: { /* ... */ } })
```

Verification is **offline** — anyone with the public key can verify; no access to the writer is needed.
It checks, record by record, that seq is contiguous, prevHash links, the recomputed hash matches, and the
signature is valid — turning "the log was never touched" into a reproducible cryptographic fact:

```ts
const records = await readSignedAuditLog('audit.jsonl')   // or parseSignedAuditLog(text)
const result = await verifyAuditChain(records, keys.publicKey)
// { ok, count, brokenAt?: { seq, reason } } — the first break, pinpointed to seq and reason
```

Keys travel as JWK: `exportKeyJwk` / `importPrivateKeyJwk` / `importPublicKeyJwk`.

## Engineering semantics

- **WebCrypto implementation**: signing and verification work in edge runtimes too (`/audit` has no node: imports;
  only JSONL file writing lives in `/node`);
- **Torn-write truncation**: a half-written line left by a crash is truncated and discarded on replay; the chain
  continues from the last complete record;
- **Chain continuation across restarts**: after a restart the tail is read to recover `prevHash` — no new chain is
  opened; audit continuity does not break on deploys;
- The private key stays on the writing side only; distribute the public key to anyone who needs to verify the audit.

## Relation to evals

The audit stream is the other half of [recording-replay reconciliation](./eval#recording-replay-reconciliation):
the audit records "what was ruled", the recording records "what was ruled on". Ship a new rule in observe → watch
hit rates in the audit stream → replay for the list of changed verdicts → switch to enforce — all three steps
backed by data.
