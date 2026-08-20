# 数据访问半区

`@yiong/railguard/data`,自生产环境的守卫管线沉淀。三条纪律贯穿:
**fail-closed**(身份/角色/规则缺失一律拒)、**防存在性枚举预言机**
(「不存在」与「越权」同形拒绝)、**防重放**(审批一票一次)。

## RBAC 配置模型

宿主传结构化对象(YAML 解析留给宿主),`validateRbacConfig` 做零依赖结构校验——
配置错误要在启动期炸,不能到请求期才发现。

```ts
const config: RbacConfig = {
  roles: {
    admin: { tools: '*', approver: true },
    support: {
      tools: ['list_orders', 'get_customer', 'refund'],
      rows: [{ field: 'assignee', equals: '$self.id' }],   // 行级:只看自己名下
      mask: ['id_card', 'salary'],                          // 字段脱敏
      approval: [{ tool: 'refund', when: { field: 'amount', gt: 1000 } }], // 分级审批
    },
  },
}
```

- `$self.id` / `$self.attrs.<key>` 引用提问人。**刻意不做表达式 DSL**——
  可求值字符串是注入面,结构化对象不是。
- 多帽子:`principal.attrs['role:<system>']` 按目标系统覆盖角色,缺省回落 `role`。
- 审批条件数值缺失/非数值一律判真——fail-safe,「不填金额」绕不过分级。

## rbacToolGate(beforeToolCall)

角色 → 工具白名单。未知角色、无身份一律拦(fail-closed,`failMode: 'closed'`)。
配套 `allowedTools()` 在 tools/list 阶段就收窄:不该用的工具连列表都不出现,
而不是等模型调了再拦。

## rowFilter(afterToolCall)

行级过滤:数组逐行筛,单对象不匹配即整体拒绝。两条硬语义:

- **「不存在」与「越权」返回同一种拒绝**——差异会成为存在性枚举预言机
  (攻击者用报错措辞探测数据是否存在);
- 规则字段缺失或 `$self` 解析失败按不匹配处理——宁可错拒,不可错放。

一行未滤时返回 `pass` 而非 `modified`(1.1.0 起)——verdict 语义要诚实,
评测里的良性用例不该显示「被改写」。

## fieldMask(afterToolCall)

按角色递归抹除字段(含嵌套对象与数组)。数据里不含目标字段时报 `pass`(1.1.0 起)。

## approvalGate(beforeToolCall)

分级人工审批,事件溯源存储:

```
涉审调用 → 幂等开单(escalated,附单号 + 原始调用)
        → 审批人批复
        → 同人同参重试 → 消费该单放行(approved)或拦截(denied)
```

- **幂等开单**:重复调用不重复开单;**一票一次**:已决单消费后失效,防重放;
- **重试消票**的恢复语义天然适配无状态 HTTP——不需要挂起的长连接;
- 分级条件求值上下文 = 调用参数 + 宿主注入的 `signals`(如「本月已退款几笔」);
- 涉审但未接存储 = fail-closed。

存储:`MemoryApprovalStore`(内存,评测/测试用)、`JsonlApprovalStore`
(`@yiong/railguard/node`,预写日志 + 崩溃残行容忍回放)。审批单存 args 原文
(审批人要看清在批什么),持久化文件与审计日志同级保密对待。

## 与规则半区合流

两半区共用一条流水线与一份上下文——RBAC 拦截和注入检测出现在同一条审计流里:

```ts
const guard = createGuard({
  hooks: {
    beforeToolCall: [rbacToolGate({ config }), approvalGate({ config, store }), lethalTrifecta({ ... })],
    afterToolCall: [rowFilter({ config }), fieldMask({ config })],
  },
})
```
