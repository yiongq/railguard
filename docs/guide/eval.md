# 评测框架

`@yiong/railguard/eval`。回答两个问题:**攻击拦得住吗**(ASR,attack success rate)
与**正常流量伤不伤**(utility)。单指标必然漂移——只考核拦截率,护栏会被调成拦一切;
两个指标一起看才是工程事实。

## 开箱即评

```ts
import { evaluate, ioCases, referenceIoGuard, EVAL_DATASET_VERSION } from '@yiong/railguard/eval'

const report = await evaluate(referenceIoGuard(), ioCases(), { datasetVersion: EVAL_DATASET_VERSION })
report.asr            // 攻击成功率(越低越好)
report.utility        // 良性原样通过率(越高越好)
report.benignDegraded // 良性被改写比例(打标/脱敏也算,单列供裁量)
report.byRule         // 每条规则:拦下几次 / 误伤几次 / 改写几次
report.byTag          // 按场景标签(injection / pii / exfil …)分组
```

内置数据集(版本戳 `EVAL_DATASET_VERSION`)分两半:`ioCases()`(注入 / 外传 /
PII / 无据数字 / 引用伪造 / 致命三要素)配 `referenceIoGuard()`;
`dataCases()`(RBAC 越权 / 行级外泄 / 分级审批)配 `referenceDataGuard()`。

**诚实承诺**:数据集含一条表外新话术攻击(`exp-novel-phrasing`),概率层**预期漏掉**——
参考数据集的 ASR 不为零是文档化的事实,不是缺陷。真正的防线在确定性规则,
这条用例就是提醒你别把启发式当边界。

## 用例模型

```ts
const case_: EvalCase = {
  id: 'exf-lethal-trifecta',
  kind: 'attack',                       // 或 'benign'
  steps: [{ hook: 'beforeToolCall', payload: { name: 'send_email', args: { ... } } }],
  context: { taint: { untrustedSources: ['email:attachment'], touchedPrivateData: true, externalCommsRequested: false } },
  threats: { llm: ['LLM01:2026'] },     // 覆盖矩阵「已验证」列的数据源
}
```

- **多步共享同一 ctx**——污点跨步累积,致命三要素这类跨调用场景可以真实重放;
- `context` 种前置状态(「已读过不可信邮件」);
- **`neutralizedBy`**:哪些规则的 modified 算「成功消解」。挂着 spotlight 这类
  对一切内容打标的规则时必须收窄,否则攻击永远显示被拦,ASR 虚假归零。
  blocked / escalated 一律算拦住,不受此限。

判定五档:攻击 → `caught` / `leaked`;良性 → `clean` / `degraded`(被改写:
打标、脱敏——防护动作不算误伤,单列)/ `harmed`(被拦:误伤)。

## CI 钉指标

评测不读时钟不读随机——同 guard 同 cases 必出同报告,数值可以直接断言:

```ts
expect(report.asr).toBeCloseTo(1 / 17, 10)   // 数据集或规则表一变,这里就红
expect(report.cases.filter((c) => c.outcome === 'harmed')).toHaveLength(0)
```

## 阈值曲线(概率层)

```ts
const curve = await scoreCurve(guard, cases, { ruleIds: ['injection.block'] })
// [{ threshold, attackCatchRate, benignFlagRate }, ...]
```

observe 全跑(`guard.check`,不拦不改),取每条用例的最高 score,按阈值网格算
「假想拦截率 vs 假想误伤率」——给启发式定阈值的 ROC 式取舍数据。
确定性规则不给 score,天然不进曲线。

## 录制-重放对账

observe → enforce 的对账工序落成代码。新规则上线前先回答:**它会改判哪些历史请求?**

```ts
import { recordingGuard, diffReplay, serializeRuns, parseRuns } from '@yiong/railguard/eval'

// ① 生产侧:录制真实流量(observe 态,谁也不拦)
const store: RecordedRun[] = []
const guard = recordingGuard(createGuard({ defaultMode: 'observe', hooks }), store)

// ② 评测侧:换 enforce 配置重放,拿改判清单
const replay = await diffReplay(createGuard({ hooks }), store)
replay.changed  // [{ seq, hook, before: 'pass', after: 'blocked', ruleAfter: 'injection.block' }]
```

录制内容:钩子、载荷原文、污点/身份/信道快照、判定。`kv` 与外部存储不入录——
依赖审批存储的规则重放结果可能不同,这是文档承诺的边界。
持久化用 `serializeRuns` / `parseRuns`(带版本封套)。

## 覆盖矩阵

```ts
import { coverageMatrix, renderCoverageMarkdown } from '@yiong/railguard/eval'

const matrix = coverageMatrix(guard.rules(), cases)
matrix.uncovered   // 没有任何规则声称覆盖的威胁——空格是事实,不是遗漏
matrix.unknownIds  // 规则引用了名录外的 ID(拼写错误或名录过期的信号)
```

名录数据文件(`THREAT_CATALOG`,版本戳)收录 OWASP 2026 双清单官方条目:
LLM Top 10(2026-08 发布,较 2025 有 8/10 条改号)与 Agentic 应用 Top 10(ASI)。
本站的[覆盖矩阵页](../coverage)由 `pnpm gen:coverage` 从规则元数据生成,不手抄。
