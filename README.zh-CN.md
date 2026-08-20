# @yiong/railguard

[English](./README.md) | 简体中文

LLM 应用与 Agent 的护栏流水线:**数据访问守卫**(RBAC / 行过滤 / 脱敏 / 人工审批)与
**LLM I/O 守卫**(注入 / 引用忠实性 / 链接白名单)装进同一条 in-process 生命周期钩子流水线。
TypeScript,零运行时依赖,Node + edge 双运行时。

> 设计哲学(OWASP GenAI 2026):"build the system around it, so that when the model
> is fooled — and it will be — nothing important breaks."

## 形状

```
onInput → onPromptBuild → beforeToolCall → afterToolCall → onModelResponse → onOutput
                    └──────────── 审计事件流(旁路)────────────┘
```

- **规则 = 纯函数 + 元数据**——不碰网络/env/时钟/随机,同一条规则浏览器与服务端双端复用
- **per-rule 三态**:`enforce / observe / off`——新规则先 observe 影子运行,对账审计流后再切 enforce
- **动作分级**:pass / modified(改写)/ blocked(拦截)/ escalated(升级人工;交给审批人的 payload
  必须是原始底层操作,禁止只给模型写的摘要)
- **status 与 verdict 正交**:规则自身挂了 ≠ 内容违规;per-rule `failMode: open | closed`
- **顺序承重**:规则按注册顺序执行,流水线不做任何自动重排

## 快速开始

```ts
import { createGuard, lens } from '@yiong/railguard'
import { faithfulness, injection, inputHygiene, linkPolicy, maxLength } from '@yiong/railguard/rules'
import { consoleSink } from '@yiong/railguard/audit'

const guard = createGuard({
  audit: consoleSink(),
  hooks: {
    onInput: [inputHygiene(), maxLength(200), injection({ mode: 'block' })],
    onOutput: [
      faithfulness({ resolve: (c) => corpus.slice(c), quoteOf: (c) => c.quote }),
      lens(linkPolicy({ allow: ['https://github.com/you/'] }), (p) => p.answer, (p, v) => ({ ...p, answer: v })),
    ],
  },
})

const ctx = guard.context()
const input = await guard.run('onInput', userQuestion, ctx)
if (!input.ok) return refuse(input.blocked?.reason)
// ... 模型调用与工具循环 ...
const output = await guard.run('onOutput', answerPayload, ctx)
```

## 内置规则(M1)

| 规则 | 钩子 | 层 | 说明 |
|---|---|---|---|
| `injection({mode})` | onInput / 任意 | 概率 | 注入模式表(数据文件+版本戳);block / defang(消毒不删除)/ flag 三模式 |
| `inputHygiene()` | onInput | 确定 | 隐形 Unicode(Tag 块/零宽)剥除,控制字符拦截 |
| `maxLength(n)` | onInput | 确定 | 输入长度上限 |
| `faithfulness(opts)` | onOutput | 确定 | 引用逐字核验,核不上丢弃,全丢强制降级拒答(failMode: closed) |
| `linkPolicy({allow})` | onOutput | 确定 | URL 白名单(allowlist 语义——blocklist 可被绕过),剥隐形 Tag 字符 |
| `outputCaps(opts)` | onOutput | 确定 | 回答长度/引用条数封顶 |
| `spotlight({mode})` | afterToolCall / 任意 | 概率 | 不可信内容打标(标记符自 requestId 派生,每请求不同);delimit / datamark |
| `lethalTrifecta(opts)` | beforeToolCall | 确定 | 私有数据+不可信内容+对外通信三要素齐备即升级人工;evidence 为原始调用 |
| `numericTrace({provider})` | onOutput | 确定 | 数据型数字必须溯源到分信任级的事实白名单;容差按书写精度推导 |
| `pii({kinds, strategy})` | onOutput | 确定 | 大陆手机号/身份证/邮箱/银行卡;mask / redact / block |
| `admitPromptBoundText` | 辅助函数 | 确定 | prompt 域文本(记忆/计划)写入准入:净化后仍命中注入即拒存 |

概率层(注入启发式)单独 enforce **不构成安全边界**——真正的边界是输出侧核验与确定性规则。
这是本包的文档承诺,不是免责声明。

流式:`createStreamGuard(guard, ctx)` 按句边界攒批,增量跑同一套 onOutput 规则——中途拦截即切流。

## 数据访问守卫(`/data`)

自生产守卫管线沉淀(fail-closed、防存在性枚举预言机、防重放):

| API | 钩子 | 说明 |
|---|---|---|
| `rbacToolGate({config})` | beforeToolCall | 角色→工具白名单;未知角色/无身份一律拦(fail-closed) |
| `allowedTools(config, principal, names)` | 辅助 | 工具列表在展示前就收窄 |
| `rowFilter({config})` | afterToolCall | `$self` 引用的行级过滤;「不存在」与「越权」返回一致的拒绝 |
| `fieldMask({config})` | afterToolCall | 按角色递归抹除字段 |
| `approvalGate({config, store})` | beforeToolCall | 分级人工审批:幂等开单、重试消票、一票一次、预写日志存储 |
| `MemoryApprovalStore` / `JsonlApprovalStore`(`/node`) | — | 事件溯源审批存储;崩溃残行容忍回放 |
| `SignedJsonlAuditSink`(`/node`)+ `verifyAuditChain`(`/audit`) | — | 防篡改审计:Ed25519 签名哈希链、离线校验、断电残行截断、跨重启续链 |

## 评测与适配器(M4,`/eval` 与 `/adapters/*`)

| API | 说明 |
|---|---|
| `evaluate(guard, cases)` | ASR + utility 双指标报告(单看拦截率会把护栏调成拦一切);byRule/byTag 归因 |
| `ioCases()` / `dataCases()` + `referenceIoGuard()` / `referenceDataGuard()` | 版本戳数据集与参考守卫,开箱即评;CI 钉住指标数值 |
| `scoreCurve(guard, cases)` | 概率层阈值曲线(observe 全跑,假想拦截率 vs 假想误伤率) |
| `recordingGuard` / `diffReplay` | 录制真实流量 → 换配置重放 → 改判清单;observe → enforce 的对账工序 |
| `coverageMatrix(rules, cases)` | 规则 threats 元数据 × OWASP 2026 官方名录(LLM Top 10 + Agentic/ASI Top 10),未覆盖明列 |
| `railguardMiddleware(guard)` + `guardTools(tools, guard)` | Vercel AI SDK v7 中间件 + 工具包裹(`@yiong/railguard/adapters/vercel-ai`,零依赖结构化类型) |
| `railguardProcessor(guard)` | Mastra v1 Processor(`@yiong/railguard/adapters/mastra`);规则层零模型调用,与内置 LLM 检测器叠加使用 |
| `otelAuditSink(opts)` + `traceGuard(guard, opts)` | OpenTelemetry 适配器(`@yiong/railguard/otel`):判定映射为 `gen_ai.evaluation.result` 事件贴进宿主 trace;零依赖结构化注入,reason 默认不采集 |

内置数据集的诚实承诺:含表外新话术攻击用例,概率层预期漏掉——ASR 不为零是文档化的事实,不是缺陷。

## 路线图

- M2 规则半区 ✅(0.2.0);M3 数据访问半区 + Ed25519 签名审计链 ✅(0.4.0)
- M4 ✅(0.5.0):评测框架(ASR + utility 双指标、阈值曲线、录制-重放对账)、OWASP 2026 覆盖矩阵、Vercel AI SDK / Mastra 适配器、文档站
- 后续:首个下游项目迁移落地、更多攻击语料、NER 层 PII 适配器

## 工程承诺

零 `dependencies`(CI 断言);ESM-only;产物不打包不压缩(发布的每个文件都能 diff 回源码);
`src/` 随包分发;规则表带版本戳,判定变化不进 patch 版本。

MIT
