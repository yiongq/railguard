# Core Concepts

## Rule = pure function + metadata

```ts
interface Rule<T> {
  id: string
  hook: HookPoint            // declares the mount point; mounting on the wrong hook throws at startup
  tier: 'deterministic' | 'probabilistic'
  cost: 'zero' | 'ms' | 'llm'
  mode?: 'enforce' | 'observe' | 'off'
  failMode?: 'open' | 'closed'
  threats?: Threats          // OWASP threat mapping; data source for the coverage matrix
  version: string            // bump whenever verdict logic changes — metrics need a reproducible denominator
  check(input: T, ctx: GuardContext): RuleOutcome<T> | Promise<RuleOutcome<T>>
}
```

**Pure-function red line**: `check` never touches the network / env / clock / randomness.
External data (fact allowlists, corpora) comes in through constructor parameters or `ctx` injection.
What this red line buys: the same rule reused on both browser and server,
deterministic and reproducible evals, trustworthy audits.

## Tri-state staged rollout: enforce / observe / off

The rollout path for a new rule is not "write it, then enforce":

1. **observe**: runs for real and writes audit events, but never blocks or modifies — a shadow run;
2. use [record-replay reconciliation](./eval#record-replay-reconciliation) to answer "which historical requests would get a different verdict if we flip to enforce";
3. flip to **enforce** only after reconciliation comes back clean.

`rescued: true` in audit events is set only while enforce is live — "the code saved this one"
and "an observe-mode hit" are two different things in the metrics.

## verdict and status are orthogonal

`verdict` (pass / modified / blocked / escalated) speaks about the **content**;
`status` (ok / error / skipped) speaks about the **rule itself**. A rule throwing ≠ the content violating:

- `failMode: 'open'` (default): if the rule dies, let the content through as pass, record `status: 'error'`;
- `failMode: 'closed'`: if the rule dies, treat as blocked — **last-gate** rules like citation verification must be closed;
  "the verifier crashed, so we let it through" is unacceptable.

## Action tiers

| verdict | Semantics | Pipeline behavior |
|---|---|---|
| `pass` | nothing to do | continue |
| `modified` | rewrite (masking / defang / degrade-to-refusal) | continue running downstream rules on `transformed` |
| `blocked` | blocked | short-circuits the whole hook chain, `ok: false` |
| `escalated` | escalated to a human | short-circuits; `evidence` must be the raw underlying operation — a model-written summary alone is forbidden, to prevent approval manipulation |

## lens: reuse string rules over structured payloads

Business payloads come in all shapes; rules should not fork over that. `lens` lifts a rule that acts on an inner value up to the outer payload:

```ts
lens(linkPolicy({ allow }), (p) => p.answer, (p, v) => ({ ...p, answer: v }))
```

## Taint and context

`GuardContext` flows with the request: dual-principal identity via `principal`/`agent`, the `channel`,
`taint` (untrusted source / private data touched / requests outbound communication —
the raw ingredients of the [lethal trifecta](./rules#lethaltrifecta)), and `trace`, the tool-call record.
The host calls `markUntrustedSource` / `markPrivateDataTouched` for marking as events happen; the marks propagate across hooks.

## The probabilistic tier is not a security boundary

Injection heuristics, classifiers — `tier: 'probabilistic'` rules — enforced on their own **do not constitute a security boundary**:
adaptive attacks always route around pattern tables. The real boundary is **output-side verification plus deterministic rules**: verbatim citation verification,
link allowlists, RBAC, row-level filtering, the lethal trifecta. The probabilistic tier's value is stopping non-adaptive attacks at the door
and feeding scores into the audit stream. This is a documented commitment of this package, not a disclaimer.
