# @yiong/railguard

LLM 应用与 Agent 的护栏流水线:**数据访问守卫**(RBAC/行过滤/脱敏/审批)与
**LLM I/O 守卫**(注入/引用忠实性/链接白名单)装进同一条 in-process 生命周期钩子流水线。
TypeScript,零运行时依赖,Node + edge 双运行时。

> 设计哲学(OWASP GenAI 2026):"build the system around it, so that when the model
> is fooled — and it will be — nothing important breaks."

## 形状

```
onInput → onPromptBuild → beforeToolCall → afterToolCall → onModelResponse → onOutput
                                └──────────── 审计事件流(旁路)────────────┘
```

- **规则 = 纯函数 + 元数据**(不碰网络/env/时钟/随机),浏览器与服务端双端复用
- **per-rule 三态**:`enforce / observe / off`——新规则先 observe 影子运行,对账后再执法
- **动作分级**:pass / modified(改写)/ blocked(拦截)/ escalated(升级人工,payload 必须是原始底层操作)
- **status 与 verdict 正交**:规则自身挂了 ≠ 内容违规;per-rule `failMode: open | closed`
- **顺序承重**:规则按注册顺序执行,不自动重排

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
| `linkPolicy({allow})` | onOutput | 确定 | URL 白名单(allowlist 语义),Tag 隐形字符剥除 |
| `outputCaps(opts)` | onOutput | 确定 | 回答长度/引用条数封顶 |

概率层(注入启发式)单独 enforce **不构成安全边界**——真正的边界是输出侧核验与确定性规则,
这是本包的文档承诺,不是免责声明。

## 路线图

- M2:spotlighting、污点跟踪 + lethal-trifecta、无据数字溯源(FactProvider)、流式输出护栏、PII
- M3:数据访问半区(AuthzProvider / 行过滤双模式 / 审批 ApprovalProvider)、Ed25519 审计链
- M4:评测框架(Trace 重放、ASR+utility 双指标)、覆盖矩阵、Vercel AI SDK / Mastra 适配器

## 工程承诺

零 `dependencies`(CI 断言);ESM-only;产物不打包不压缩(逐文件可 diff 回源码);
`src/` 随包分发;规则表版本戳,判定变化不进 patch。

MIT
