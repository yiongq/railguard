---
layout: home
title: railguard
---

<div class="rg-hero">
  <div class="rg-eyebrow">zero-dep guardrail pipeline · v0.5.0 · node + edge</div>
  <h1 class="rg-title">rail<span class="rg-title-guard">guard</span></h1>
  <p class="rg-tagline">
    LLM 应用与 Agent 的护栏流水线。<strong>当模型被骗时——它一定会被骗——重要的东西不能坏。</strong><br>
    数据访问守卫与 LLM I/O 守卫,装进同一条 in-process 生命周期钩子流水线。
  </p>
  <div class="rg-actions">
    <a class="rg-btn rg-btn-primary" href="./guide/quickstart">快速开始</a>
    <a class="rg-btn rg-btn-ghost" href="./coverage">OWASP 覆盖矩阵</a>
    <a class="rg-btn rg-btn-ghost" href="https://github.com/yiongq/railguard">GitHub</a>
  </div>

  <div class="rg-pipeline" aria-label="六个生命周期钩子的护栏流水线动画:通过、拦截、升级人工三种判定">
    <svg viewBox="0 0 760 158" role="img">
      <!-- 人工审批旁路 -->
      <rect x="404" y="14" width="104" height="26" rx="4" fill="none" stroke="#31517e" stroke-dasharray="3 3"/>
      <text x="456" y="31" text-anchor="middle" class="rg-gate-label" fill="#4f8dff" style="fill:#4f8dff">人工审批 · HITL</text>
      <text x="330" y="31" text-anchor="end" class="rg-esc-tag">escalated →</text>
      <!-- 轨道 -->
      <line x1="16" y1="92" x2="744" y2="92" class="rg-rail"/>
      <line x1="16" y1="98" x2="744" y2="98" class="rg-rail-tie"/>
      <!-- 六道闸门 -->
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
      <!-- BLOCKED 戳 -->
      <text x="310" y="50" text-anchor="middle" class="rg-stamp">BLOCKED</text>
      <!-- 三个数据包 -->
      <g class="rg-pkt rg-pkt-pass"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <g class="rg-pkt rg-pkt-block"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <g class="rg-pkt rg-pkt-esc"><rect x="20" y="83" width="14" height="8" rx="2"/></g>
      <!-- 旁路审计流 -->
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
    <div class="rg-stat"><b>0</b><span>运行时依赖(CI 断言)</span></div>
    <div class="rg-stat"><b>6</b><span>生命周期钩子</span></div>
    <div class="rg-stat"><b>101</b><span>双侧测试</span></div>
    <div class="rg-stat"><b><em>5.9%</em></b><span>参考数据集 ASR(诚实含表外攻击)</span></div>
    <div class="rg-stat"><b>2×10</b><span>OWASP 2026 双名录覆盖矩阵</span></div>
  </div>
</div>

<div class="rg-grid">
  <div class="rg-card" style="--card-accent:#00c98d">
    <h3>per-rule 三态灰度</h3>
    <p><code>enforce / observe / off</code>。新规则先影子运行,对账审计流之后再切执法——上线不是赌博。</p>
  </div>
  <div class="rg-card" style="--card-accent:#f5a524">
    <h3>verdict 与 status 正交</h3>
    <p>规则自己挂了 ≠ 内容违规。per-rule <code>failMode: open | closed</code>,末道闸类规则挂了也不放行。</p>
  </div>
  <div class="rg-card" style="--card-accent:#f4485d">
    <h3>致命三要素守卫</h3>
    <p>私有数据 + 不可信内容 + 对外通信,三要素齐备即升级人工。交给审批人的是原始底层调用,不是模型写的摘要。</p>
  </div>
  <div class="rg-card" style="--card-accent:#4f8dff">
    <h3>Ed25519 签名审计链</h3>
    <p>防篡改哈希链审计:离线校验、断电残行截断、跨重启续链。WebCrypto 实现,edge 也能签验。</p>
  </div>
  <div class="rg-card" style="--card-accent:#00c98d">
    <h3>ASR + utility 双指标评测</h3>
    <p>只考核拦截率,护栏会被调成拦一切。内置版本戳数据集与参考守卫,CI 直接钉住指标数值。</p>
  </div>
  <div class="rg-card" style="--card-accent:#8a97a8">
    <h3>Vercel AI SDK / Mastra 适配器</h3>
    <p>零依赖结构化类型:不引入 peer 依赖,一行接入 <code>wrapLanguageModel</code> 或 <code>inputProcessors</code>。</p>
  </div>
</div>

## 三十秒看形状

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

> 设计哲学(OWASP GenAI 2026):概率层(注入启发式)单独 enforce **不构成安全边界**——
> 真正的边界是输出侧核验与确定性规则。这是本包的文档承诺,不是免责声明。
