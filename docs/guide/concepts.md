# 核心概念

## 规则 = 纯函数 + 元数据

```ts
interface Rule<T> {
  id: string
  hook: HookPoint            // 声明挂载点,挂错门启动期直接抛
  tier: 'deterministic' | 'probabilistic'
  cost: 'zero' | 'ms' | 'llm'
  mode?: 'enforce' | 'observe' | 'off'
  failMode?: 'open' | 'closed'
  threats?: Threats          // OWASP 威胁映射,覆盖矩阵的数据源
  version: string            // 判定逻辑一变就 bump——指标要有可复现分母
  check(input: T, ctx: GuardContext): RuleOutcome<T> | Promise<RuleOutcome<T>>
}
```

**纯函数红线**:`check` 不碰网络 / env / 时钟 / 随机。需要外部数据(事实白名单、语料)
走构造参数或 `ctx` 注入。这条红线换来的是:同一条规则浏览器与服务端双端复用、
评测确定可复现、审计可信。

## 三态灰度:enforce / observe / off

新规则的上线路径不是「写完就 enforce」:

1. **observe**:真实执行并写审计,但不拦截不改写——影子运行;
2. 用[录制-重放对账](./eval#录制-重放对账)回答「切 enforce 会改判哪些历史请求」;
3. 对账干净再切 **enforce**。

审计事件里的 `rescued: true` 只在 enforce 生效时标记——「这次是代码救的」
与「观察态命中」在指标上是两回事。

## verdict 与 status 正交

`verdict`(pass / modified / blocked / escalated)说的是**内容**;
`status`(ok / error / skipped)说的是**规则自身**。规则抛异常 ≠ 内容违规:

- `failMode: 'open'`(默认):规则挂了按 pass 放行,记 `status: 'error'`;
- `failMode: 'closed'`:规则挂了按 blocked 处理——引用核验这类**末道闸**必须 closed,
  「核验器崩了所以放行」不可接受。

## 动作分级

| verdict | 语义 | 流水线行为 |
|---|---|---|
| `pass` | 无事 | 继续 |
| `modified` | 改写(脱敏 / defang / 降级拒答) | 用 `transformed` 继续跑后续规则 |
| `blocked` | 拦截 | 短路整条钩子链,`ok: false` |
| `escalated` | 升级人工 | 短路;`evidence` 必须是原始底层操作,禁止只给模型写的摘要——防审批操纵 |

## lens:结构化载荷复用字符串规则

业务载荷形状各异,规则不该为此分叉。`lens` 把作用于内层值的规则提升到外层:

```ts
lens(linkPolicy({ allow }), (p) => p.answer, (p, v) => ({ ...p, answer: v }))
```

## 污点与上下文

`GuardContext` 随请求流动:`principal`/`agent` 双主体身份、`channel` 信道、
`taint` 污点(不可信来源 / 触达私有数据 / 请求对外通信——
[致命三要素](./rules#lethaltrifecta)的原料)、`trace` 工具调用记录。
宿主在事件发生时调 `markUntrustedSource` / `markPrivateDataTouched` 打标,标记随钩子传播。

## 概率层不是安全边界

注入启发式、分类器这类 `tier: 'probabilistic'` 规则,单独 enforce **不构成安全边界**——
自适应攻击总能绕过模式表。真正的边界是**输出侧核验与确定性规则**:引用逐字核验、
链接白名单、RBAC、行过滤、致命三要素。概率层的价值是把非自适应攻击拦在门口、
给审计流喂 score。这是本包的文档承诺,不是免责声明。
