# Mastra 适配器

`@yiong/railguard/adapters/mastra`,对齐 @mastra/core v1 的 `Processor` 接口。
零依赖:`Processor` 是纯结构类型,适配器按源码手写最小镜像,直接挂进 Agent。

```ts
import { Agent } from '@mastra/core/agent'
import { railguardProcessor } from '@yiong/railguard/adapters/mastra'

const rg = railguardProcessor(guard)
const agent = new Agent({
  // ...
  inputProcessors: [rg],
  outputProcessors: [rg],
})
```

## 钩子映射

| Mastra 挂点 | railguard 钩子 | 行为 |
|---|---|---|
| `processInput` | `onInput` | 最后一条 user 消息送检;modified 改写;blocked 即 `abort()` 触发 tripwire |
| `processOutputStream` | `onOutput`(流式) | text-delta [按句攒批](./streaming):半句吞掉攒着,成句放行(文本可能被改写);拦截 `abort()` 切流 |
| `processOutputResult` | `onOutput` | 冲洗流式缓冲(违规即 `abort()`)后,最终 assistant 消息**全文再过闸**并改写——流式与非流式路径都守住落库文本 |
| `processToolResult` | `afterToolCall` | 工具结果过数据访问规则;blocked 即 `abort()` |

tripwire 语义:`abort(reason, { metadata: { ruleId } })`——非流式在 `result.tripwire`
拿到原因,流式收到 `tripwire` chunk。`metadata.ruleId` 用于归因。

## 定位:规则层在前,LLM 检测器在后

Mastra 内置的 `PIIDetector` / `PromptInjectionDetector` / `ModerationProcessor`
每次检测要走一遍模型(需要配 `model`)。railguardProcessor 是**规则层**:
零模型调用、确定性、可离线[评测](./eval)。两者不是二选一——规则层放前面,
确定性命中直接拦掉,省掉大多数 LLM 检测调用;真正模糊的再交给模型层。

```ts
inputProcessors: [railguardProcessor(guard), new PromptInjectionDetector({ model })]
```

## 边界(文档承诺)

- `processToolResult` 只做**检查与拦截**,不改写工具结果——改写需要 Mastra 的
  `MessageList` API,零依赖层不做。需要行过滤/脱敏改写的,用
  `@yiong/railguard/data` 的规则直接包 `tool.execute`(与
  [Vercel 适配器的 guardTools](./adapter-vercel-ai#工具包裹-beforetoolcall-aftertoolcall) 同法);
- 流式路径的残余缓冲(流在句中途结束)只能拦不能补发——Mastra 的
  processor 无法在流末尾注入文本。缓冲以句边界收尾时会立刻送检放行,
  正常标点的输出不受影响;直播流里可能少看到最后一截半句,但
  `processOutputResult` 会对最终消息全文再过一遍 onOutput,落库文本不失守;
- ctx 存放在 Mastra 的 per-request `state`,同一请求内四个挂点自动共享
  (污点得以从输入流到工具再到输出)。
