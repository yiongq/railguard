# @yiong/railguard

## 0.6.0

### Minor Changes

- 33f2cb4: 新增 OpenTelemetry 适配器(`@yiong/railguard/otel`):`otelAuditSink` 把每条护栏判定
  映射为 `gen_ai.evaluation.result` 事件(对齐已合并的 Development 状态约定,细节走
  `railguard.*` 命名空间)贴进宿主的活跃 span 或经 api-logs Logger 发标准 log 事件;
  `traceGuard` 可选地把每次 guard.run() 画成低基数命名的钩子 span。零依赖结构化注入
  (不依赖 @opentelemetry/api),reason 默认不采集,拦截不标 ERROR,遥测异常不反噬主流程。

## 0.5.1

### Patch Changes

- fba39c7: 发布链路首验:Trusted Publishing(OIDC 无 token)+ provenance 自动发布走通。无代码变更。
