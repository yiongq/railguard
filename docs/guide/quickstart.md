# 快速开始

## 安装

```sh
npm i @yiong/railguard
```

零运行时依赖,ESM-only,Node ≥ 20.19 与 edge 运行时(Cloudflare Workers / Vercel Edge)双端可用。
产物不打包不压缩,`src/` 随包分发——发布的每个文件都能 diff 回源码。

## 一条流水线

```
onInput → onPromptBuild → beforeToolCall → afterToolCall → onModelResponse → onOutput
                    └──────────── 审计事件流(旁路)────────────┘
```

规则按钩子挂载,**数组顺序即执行顺序**——流水线不做任何自动重排,顺序是承重的
(「先建审批单再核链接」这类依赖真实存在)。

```ts
import { createGuard, lens } from '@yiong/railguard'
import { faithfulness, injection, inputHygiene, linkPolicy, maxLength } from '@yiong/railguard/rules'
import { consoleSink } from '@yiong/railguard/audit'

const guard = createGuard({
  audit: consoleSink(),
  hooks: {
    onInput: [inputHygiene(), maxLength(2000), injection({ mode: 'block' })],
    onOutput: [
      faithfulness({ resolve: (c) => corpus[c.source] ?? null, quoteOf: (c) => c.quote }),
      lens(linkPolicy({ allow: ['https://docs.example.com/'] }), (p) => p.answer, (p, v) => ({ ...p, answer: v })),
    ],
  },
})
```

## 接线

```ts
const ctx = guard.context()                       // 每请求一份上下文

const input = await guard.run('onInput', userQuestion, ctx)
if (!input.ok) return refuse(input.blocked?.reason) // blocked / escalated 都会让 ok=false

// …… 模型调用与工具循环(工具前后分别过 beforeToolCall / afterToolCall)……

const output = await guard.run('onOutput', answerPayload, ctx)
if (!output.ok) return refuse(output.blocked?.reason)
reply(output.output)                              // 可能被规则改写过(脱敏/去链/降级拒答)
```

三个要点:

- **`run` 是执法,`check` 是彩排**:`guard.check()` 把全部规则按 observe 跑一遍,
  永不改变输入——单测与评测的地基。
- **`!ok` 有两种**:`blocked`(拦截,拿 `blocked.reason` 回给用户)与
  `escalation`(升级人工,`escalation.payload` 是原始底层操作,交给审批人看的必须是它)。
- **`output.output` 才是要下发的内容**:规则可能改写(PII 打码、白名单外链接移除、
  引用核验失败降级拒答),不要下发你手里的原始值。

## 处理升级(escalated)

```ts
const call = await guard.run('beforeToolCall', { name, args }, ctx)
if (call.verdict === 'escalated') {
  // escalation.payload 含审批单号与原始调用;推给审批人,批复后同参重试自动消票放行
  return askForApproval(call.escalation)
}
```

审批的恢复语义是「重试消票」:同人同参重试命中已批单即放行,一票一次防重放,
天然适配无状态 HTTP。详见[数据访问半区](./data-access)。

## 下一步

- [核心概念](./concepts):三态灰度、verdict×status 正交、failMode、lens
- [内置规则](./rules):每条规则的选项与语义
- [评测框架](./eval):上线前先量 ASR 与 utility
