# 内置规则

全部来自 `@yiong/railguard/rules`。列出的威胁 ID 对应 [OWASP 覆盖矩阵](../coverage)。

| 规则 | 钩子(默认) | 层 | 威胁 |
|---|---|---|---|
| [`injection`](#injection) | onInput / 任意 | 概率 | LLM01 · ASI01 |
| [`inputHygiene`](#inputhygiene) | onInput | 确定 | LLM01 |
| [`maxLength`](#maxlength) | onInput | 确定 | LLM06 |
| [`faithfulness`](#faithfulness) | onOutput | 确定 | LLM07 · LLM09 |
| [`outputCaps`](#outputcaps) | onOutput | 确定 | LLM06 |
| [`linkPolicy`](#linkpolicy) | onOutput | 确定 | LLM10 · ASI02 |
| [`numericTrace`](#numerictrace) | onOutput | 确定 | LLM07 |
| [`pii`](#pii) | onOutput | 确定 | LLM02 |
| [`spotlight`](#spotlight) | afterToolCall | 概率 | LLM01 · ASI06 |
| [`lethalTrifecta`](#lethaltrifecta) | beforeToolCall | 确定 | LLM01 · LLM02 · ASI02 |
| [`admitPromptBoundText`](#admitpromptboundtext) | 辅助函数 | 确定 | ASI06 |

## injection

注入检测,规则表驱动(数据文件带版本戳 `INJECTION_TABLE_VERSION`,任何语言可加载同一张表)。

```ts
injection({ mode: 'block' })                          // 用户输入:命中即拦
injection({ mode: 'defang', hook: 'afterToolCall' })  // 检索/工具内容:消毒不删除
injection({ mode: 'flag' })                           // 只标记(score + reason),交给下游
```

- **表的纪律**:零误报硬线——role-marker 行首锚定(「操作系统:Linux」不命中),
  override/persona 匹配劫持短语而非裸词(「扮演导游介绍景点」不命中)。改一条 bump 版本。
- **defang 冻结块**:标记 token 由 `fnv1a(requestId + content)` 派生,攻击者无法预知;
  预埋的假标记先被 `breakForgedMarks` 破坏——伪装「已消毒」不可行。
- 宿主自有模式用 `extraPatterns` 追加,不要 fork 表。
- 概率层:单独 enforce 不构成安全边界,见[核心概念](./concepts#概率层不是安全边界)。

## inputHygiene

隐形 Unicode 剥除与控制字符拦截。Unicode Tag 块(U+E0000–E007F)与零宽字符是
「藏起来的注入指令」的常用载体——剥掉即失效,不必拒绝整条输入;裸控制字符直接拦。

## maxLength

输入长度上限(字符数)。`maxLength(2000)`,或 `maxLength(500, 'onOutput')` 挂到别的钩子。

## faithfulness

引用逐字核验——输出侧的最后一道闸,`failMode: 'closed'`(核验器自己挂了也不放行)。

```ts
faithfulness<C>({
  resolve: (c) => corpus[c.source] ?? null, // 引用声称的出处原文;找不到返回 null
  quoteOf: (c) => c.quote,                  // 被引的逐字文本
})
```

语义:每条引用的 quote 必须逐字存在于 resolve 出的原文里(空白折叠后比对);
核不上就丢弃;非拒答回答丢到一条不剩时,**强制降级为拒答**;拒答不许夹带引用。

## outputCaps

回答长度与引用条数封顶,防超长输出与引用洪泛。

## linkPolicy

URL 白名单——**allowlist 语义**,blocklist 可被同域中转绕过。模型会连域名一起编,
只有白名单前缀的 URL 保留,其余替换成 `[链接已移除]`;顺带剥输出里的隐形 Tag 字符
(隐藏外传通道)。结构化载荷用 [lens](./concepts#lens-结构化载荷复用字符串规则) 提升。

## numericTrace

无据数字溯源:输出里每个数据型数字必须能在**分信任级的事实白名单**里找到出处。

```ts
numericTrace({
  provider: { facts: () => [{ value: 58, trust: 'authoritative' }] },
  committing: true,        // 承诺语境:userStated 事实不作数(「客户喊 6800 你答应就过」不可以)
  onUngrounded: 'redact',  // 或 'block'
})
```

- 信任级:`authoritative`(工具/系统产出)> `derived`(规则推导)> `userStated`(用户自述);
- 容差按书写精度推导:「5.8」±0.05、「120」±0.5——固定百分比在密集数值域等于放行一切;
- 年份与孤立小整数不算数据型;中文金额单位(万/元)解析由宿主 `extract` 注入。

## pii

大陆手机号 / 身份证 / 邮箱 / 银行卡,`mask`(保留首尾打码)/ `redact` / `block` 三策略。
确定性正则层;更高召回的 NER 检测规划走可选适配器(路线图项,尚未提供),不进零依赖核心。

## spotlight

Spotlighting(Microsoft 2024):给不可信内容打标,让模型把它当数据而非指令。
标记符从 `ctx.requestId` 派生——每请求不同,读过系统提示的攻击者无法预先伪造。
`delimit`(定界符包裹,默认)/ `datamark`(逐词插标,更强但有可读性代价)。
概率层缓解,必须与输出侧核验叠加。

## lethalTrifecta

致命三要素(Willison lethal trifecta / Meta Rule of Two 的代码化):
**触达过私有数据 + 摄入过不可信内容 + 现在要对外通信**,三者齐备即升级人工审批。

```ts
lethalTrifecta({
  isExternalComm: (name) => ['send_email', 'http_post'].includes(name),
  touchesPrivateData: (name) => name === 'read_crm',
})
```

确定性规则:不猜内容是不是注入,只看三要素是否齐备。`escalated` 的 evidence
是原始调用(工具名 + 参数)。污点由宿主用 `markUntrustedSource` 等辅助函数打标。

## admitPromptBoundText

prompt 域文本准入:凡是将进入 system prompt 的持久文本(记忆、计划、用户偏好),
写入前必须过这道闸——防投毒内容诱导模型「把 payload 存成记忆」形成持续污染(ASI06)。
净化后仍命中注入模式的一律拒存。
