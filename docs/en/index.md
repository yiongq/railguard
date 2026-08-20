---
layout: home
title: railguard
---

<div class="rg-hero">
  <div class="rg-eyebrow">zero-dep guardrail pipeline · v0.5.0 · node + edge</div>
  <h1 class="rg-title">rail<span class="rg-title-guard">guard</span></h1>
  <p class="rg-tagline">
    A guardrail pipeline for LLM apps and agents. <strong>When the model is fooled — and it will be — nothing important breaks.</strong><br>
    Data-access guards and LLM I/O guards in one in-process lifecycle-hook pipeline.
  </p>
  <div class="rg-actions">
    <a class="rg-btn rg-btn-primary" href="./guide/quickstart">Quickstart</a>
    <a class="rg-btn rg-btn-ghost" href="./coverage">OWASP coverage</a>
    <a class="rg-btn rg-btn-ghost" href="https://github.com/yiongq/railguard">GitHub</a>
  </div>

  <div class="rg-pipeline" aria-label="Animated pipeline of six lifecycle hooks: pass, blocked, and escalated verdicts">
    <svg viewBox="0 0 760 158" role="img">
      <rect x="404" y="14" width="104" height="26" rx="4" fill="none" stroke="#31517e" stroke-dasharray="3 3"/>
      <text x="456" y="31" text-anchor="middle" class="rg-gate-label" style="fill:#4f8dff">human approval</text>
      <text x="330" y="31" text-anchor="end" class="rg-esc-tag">escalated →</text>
      <line x1="16" y1="92" x2="744" y2="92" class="rg-rail"/>
      <line x1="16" y1="98" x2="744" y2="98" class="rg-rail-tie"/>
      <g>
        <rect x="80"  y="58" width="20" height="66" class="rg-gate"/><circle cx="90"  cy="66" r="3" class="rg-gate-lamp"/>
        <rect x="190" y="58" width="20" height="66" class="rg-gate"/><circle cx="200" cy="66" r="3" class="rg-gate-lamp"/>
        <rect x="300" y="58" width="20" height="66" class="rg-gate"/><circle cx="310" cy="66" r="3" class="rg-gate-lamp rg-lamp-block"/>
        <rect x="410" y="58" width="20" height="66" class="rg-gate"/><circle cx="420" cy="66" r="3" class="rg-gate-lamp"/>
        <rect x="520" y="58" width="20" height="66" class="rg-gate"/><circle cx="530" cy="66" r="3" class="rg-gate-lamp"/>
        <rect x="630" y="58" width="20" height="66" class="rg-gate"/><circle cx="640" cy="66" r="3" class="rg-gate-lamp"/>
      </g>
      <text x="90"  y="140" text-anchor="middle" class="rg-gate-label">onInput</text>
      <text x="200" y="140" text-anchor="middle" class="rg-gate-label">onPromptBuild</text>
      <text x="310" y="140" text-anchor="middle" class="rg-gate-label">beforeToolCall</text>
      <text x="420" y="140" text-anchor="middle" class="rg-gate-label">afterToolCall</text>
      <text x="530" y="140" text-anchor="middle" class="rg-gate-label">onModelResponse</text>
      <text x="640" y="140" text-anchor="middle" class="rg-gate-label">onOutput</text>
      <text x="310" y="50" text-anchor="middle" class="rg-stamp">BLOCKED</text>
      <g class="rg-pkt rg-pkt-pass"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <g class="rg-pkt rg-pkt-block"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <g class="rg-pkt rg-pkt-esc"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <line x1="16" y1="152" x2="744" y2="152" stroke="#1e2833" stroke-width="1" stroke-dasharray="2 5"/>
      <g>
        <circle cx="90"  cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:0s"/>
        <circle cx="200" cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:.4s"/>
        <circle cx="310" cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:.8s"/>
        <circle cx="420" cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:1.2s"/>
        <circle cx="530" cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:1.6s"/>
        <circle cx="640" cy="152" r="2.4" class="rg-audit-dot" style="animation-delay:2s"/>
      </g>
    </svg>
  </div>

  <div class="rg-stats">
    <div class="rg-stat"><b>0</b><span>runtime dependencies (CI-asserted)</span></div>
    <div class="rg-stat"><b>6</b><span>lifecycle hooks</span></div>
    <div class="rg-stat"><b>101</b><span>tests, both halves</span></div>
    <div class="rg-stat"><b><em>5.9%</em></b><span>reference-dataset ASR (honestly non-zero)</span></div>
    <div class="rg-stat"><b>2×10</b><span>OWASP 2026 coverage matrix</span></div>
  </div>
</div>

<div class="rg-grid">
  <div class="rg-card" style="--card-accent:#00c98d">
    <h3>Per-rule tri-state rollout</h3>
    <p><code>enforce / observe / off</code>. New rules shadow-run first, reconcile against the audit stream, then enforce — shipping is not a gamble.</p>
  </div>
  <div class="rg-card" style="--card-accent:#f5a524">
    <h3>Verdict ⊥ status</h3>
    <p>A crashed rule ≠ violating content. Per-rule <code>failMode: open | closed</code>; last-gate rules stay closed even when they crash.</p>
  </div>
  <div class="rg-card" style="--card-accent:#f4485d">
    <h3>Lethal-trifecta guard</h3>
    <p>Private data + untrusted content + outbound comms — all three present escalates to a human, with the raw underlying call, never a model-written summary.</p>
  </div>
  <div class="rg-card" style="--card-accent:#4f8dff">
    <h3>Ed25519 signed audit chain</h3>
    <p>Tamper-evident hash chain: offline verification, torn-write truncation, chain continuation across restarts. WebCrypto — signs on edge too.</p>
  </div>
  <div class="rg-card" style="--card-accent:#00c98d">
    <h3>ASR + utility dual-metric evals</h3>
    <p>Interception rate alone drifts toward blocking everything. Versioned dataset + reference guards; CI pins the exact numbers.</p>
  </div>
  <div class="rg-card" style="--card-accent:#8a97a8">
    <h3>Vercel AI SDK / Mastra adapters</h3>
    <p>Zero-dep structural typing: no peer dependencies; one line into <code>wrapLanguageModel</code> or <code>inputProcessors</code>.</p>
  </div>
</div>

## The shape in thirty seconds

```ts
import { createGuard, lens } from '@yiong/railguard'
import { faithfulness, injection, inputHygiene, linkPolicy } from '@yiong/railguard/rules'
import { consoleSink } from '@yiong/railguard/audit'

const guard = createGuard({
  audit: consoleSink(),
  hooks: {
    onInput: [inputHygiene(), injection({ mode: 'block' })],
    onOutput: [
      faithfulness({ resolve: (c) => corpus.slice(c), quoteOf: (c) => c.quote }),
      lens(linkPolicy({ allow: ['https://docs.example.com/'] }), (p) => p.answer, (p, v) => ({ ...p, answer: v })),
    ],
  },
})

const input = await guard.run('onInput', userQuestion, guard.context())
if (!input.ok) return refuse(input.blocked?.reason)
```

> Design philosophy (OWASP GenAI 2026): the probabilistic layer (injection heuristics) alone
> is **not a security boundary** — the boundary is output-side verification and deterministic rules.
> That is a documented commitment of this package, not a disclaimer.
