# Vercel AI SDK 适配器

`@yiong/railguard/adapters/vercel-ai`,对齐 ai@7(LanguageModelV4 中间件形状)。
**零依赖纪律**:不引入 `ai` 的运行时或 peer 依赖——中间件对象按公开 d.ts
手写结构化镜像,`wrapLanguageModel` 只做结构消费,镜像即可赋值。

## 模型中间件:onInput / onOutput

```ts
import { wrapLanguageModel } from 'ai'
import { railguardMiddleware } from '@yiong/railguard/adapters/vercel-ai'

const model = wrapLanguageModel({
  model: yourModel,
  middleware: railguardMiddleware(guard, { blockedText: '(内容未通过输出护栏)' }),
})
```

| SDK 挂点 | railguard 钩子 | 行为 |
|---|---|---|
| `transformParams` | `onInput` | 最后一条 user 消息送检;modified 改写后继续;blocked 抛 `RailguardBlockedError` |
| `wrapGenerate` | `onOutput` | 输出全文送检;modified 替换文本;blocked 换成 `blockedText` |
| `wrapStream` | `onOutput`(流式) | [按句攒批](./streaming);中途拦截切流并补发 `blockedText`,后续 delta 丢弃 |

输入被拦是**抛错**而不是静默改写——在调用侧接住转成拒绝响应:

```ts
try {
  const { text } = await generateText({ model, prompt, tools })
} catch (err) {
  if (err instanceof RailguardBlockedError) return refuse(err.message) // err.ruleId 可归因
  throw err
}
```

## 工具包裹:beforeToolCall / afterToolCall

AI SDK 的工具执行不经过模型中间件——工具侧的挂点是包 `execute`:

```ts
import { guardTools, RailguardEscalationError } from '@yiong/railguard/adapters/vercel-ai'

const ctx = guard.context({ principal })
const tools = guardTools(rawTools, guard, { context: () => ctx })
```

- `beforeToolCall` 过 `{ name, args }`:blocked 抛 `RailguardBlockedError`
  (SDK 记为 tool-error 回给模型);escalated 抛 `RailguardEscalationError`,
  `payload` 是原始调用 + 审批单号——接住走你的审批流;
- `afterToolCall` 过 `{ name, data }`:行过滤/脱敏的改写结果就是工具返回值。

## 关键接线:共享上下文

致命三要素要跨步累积污点(读了不可信网页 → 又要对外发信)。让中间件与工具包裹
**共用同一个 `context` 工厂**,一次请求一份 ctx:

```ts
const ctx = guard.context()
const middleware = railguardMiddleware(guard, { context: () => ctx })
const tools = guardTools(rawTools, guard, { context: () => ctx })
```

同一次调用内部,`transformParams` 与 `wrapGenerate/wrapStream` 已按 params
对象身份自动共享 ctx,无需额外接线。

## 类型兼容说明

适配器的结构化类型按 ai@7.0 / @ai-sdk/provider@4.0 核对。若宿主的 SDK 版本
类型面更严导致赋值报错,行为不受影响,断言过去即可:
`middleware: railguardMiddleware(guard) as unknown as LanguageModelMiddleware`。
