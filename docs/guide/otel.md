# OpenTelemetry 适配器

`@yiong/railguard/otel`。把每条护栏判定变成标准格式的事件,贴进宿主已有的
请求时间线——「这次注入在 onInput 被拦」「这条引用核验没过被丢」直接出现在
trace 面板里,而不是散在函数日志里翻。

```
/api/ask(宿主 HTTP span)
 ├─ chat gpt-4o                       120ms
 ├─ railguard.onInput                   2ms   ← traceGuard(可选)
 │    • gen_ai.evaluation.result  name=injection.block  label=blocked  score=0.75
 └─ railguard.onOutput                  3ms
      • gen_ai.evaluation.result  name=citation-faithfulness  label=modified
```

## 接线(两个零件,按需取用)

```ts
import { trace } from '@opentelemetry/api'
import { otelAuditSink, traceGuard } from '@yiong/railguard/otel'

// ① 判定事件贴到活跃 span 上——多数宿主只需要这一行
const guard = createGuard({
  audit: otelAuditSink({ getActiveSpan: () => trace.getActiveSpan() }),
  hooks: { /* ... */ },
})

// ② 可选:每道钩子画成独立时间段(要看护栏本身耗时时用)
const traced = traceGuard(guard, { tracer: trace.getTracer('railguard') })
```

**零依赖纪律**:本包不依赖 `@opentelemetry/api`——tracer/span/logger 都是宿主
递进来的结构化形状(api 1.x 消费面自 1.0 起零破坏,按形状调用零版本耦合;
Vercel AI SDK v7 同款做法)。没接任何目标时 sink 是纯 no-op。

## 字段映射

判定事件对齐已合并的 `gen_ai.evaluation.result` 约定(Development 状态),
细节走 `railguard.*` 自有命名空间——不自造 `gen_ai.*` 字段:

| 审计事件 | OTel 属性 |
|---|---|
| `ruleId` | `gen_ai.evaluation.name` |
| `verdict`(pass/modified/blocked/escalated) | `gen_ai.evaluation.score.label` |
| `score`(概率层才有) | `gen_ai.evaluation.score.value` |
| `reason`(**默认不发**,见下) | `gen_ai.evaluation.explanation` |
| hook / 规则版本 / mode / status / rescued / requestId / label | `railguard.hook` `railguard.rule.version` `railguard.mode` `railguard.status` `railguard.rescued` `railguard.request.id` `railguard.label` |

`traceGuard` 的钩子 span:名字固定 `railguard.{hook}`(6 个值,低基数——规则
身份全在属性里,不进 span 名),结束时附 `railguard.verdict` 与
`railguard.stopped_by`。

## 三条刻意的语义

- **`reason` 默认不进 trace**:它可能引用户内容片段(如「无据数字: 9999」),
  而 trace 通常发往第三方后端。`captureReason: true` 显式开启——内容默认
  不采集是 OTel 官方对 GenAI 遥测的要求,不是本包的洁癖;
- **拦截不标 ERROR**:blocked/escalated 是护栏干活干成了,span 状态不标红;
  只有 `run()` 自身抛异常才设 ERROR。规则自身挂掉(`status: 'error'`)体现在
  事件属性里,与 verdict 正交——和流水线的语义一致;
- **遥测不反噬**:sink 内部任何异常都被吞掉,exporter 挂了不影响判定。

## Log 事件(可选)

规范把 evaluation 定义为 log 事件,但 JS 的 Logs API 仍是 0.x 实验版、多数宿主
没接 LoggerProvider。传入 `logger`(`{ emit }` 形状)即切换为标准 log 事件,
属性与 span event 完全一致,迁移零成本;blocked/escalated 记 WARN,其余 INFO:

```ts
otelAuditSink({ logger: loggerProvider.getLogger('railguard') })
```

## 追踪中的标准

护栏专属的语义约定(`run_guardrail` 操作与 `gen_ai.guardrail.*` 字段)仍在
提案阶段、命名空间未定稳。本适配器对齐的是**已合并**的 evaluation 约定;
提案定稿后以 minor 版本跟进字段名。
