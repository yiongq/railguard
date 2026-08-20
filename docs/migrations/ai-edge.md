# ai-edge → railguard 迁移指南

> 写给正在重构 ai-edge 的人(人或 Claude 会话皆可)。目标:三份手抄注入规则表
> 与两份冻结 loop 的守卫逻辑,换成对 `@yiong/railguard` 的 import。
> **不要求一次全换**——每格独立可迁,迁一格验一格。

## 对照表

| ai-edge 现有 | railguard 替代 | 备注 |
|---|---|---|
| `apps/web/src/services/guard.ts` 的 `detectDirectInjection` + RULES 表 | `injection({ mode: 'block' })` | 规则表是数据文件带版本戳(`INJECTION_TABLE_VERSION`);ai-edge 自有模式用 `extraPatterns` 追加,不 fork |
| `apps/agent/src/loop/guard.ts`(同上的手抄副本) | 同一个 import | 双 loop 同步税就此消失 |
| toolkit `sanitize.ts` 的 `sanitizeRetrievedContent`(defang+标注) | `injection({ mode: 'defang', hook: 'afterToolCall' })` | 冻结块含内容哈希 token(`freezeWrap`),预埋假标记先被 `breakForgedMarks` 破坏——与 sanitize 的幂等/防伪造语义对齐 |
| mcp-docs/mcp-search 的 `deps.sanitize` 注入缝 | 传入基于上面规则的函数 | 注入缝本身保留,只换实现 |
| `memory.ts` / `task.ts` 的写入前净化+检测 | `admitPromptBoundText(text, ctx)` | 拒存语义一致:净化后仍命中即 `ok: false` |
| `findUngroundedNumbers` + `buildPriorText` | `numericTrace({ provider })` | prior 构造纪律(args 不进 prior/失败条目不进 prior)由宿主的 `FactProvider.facts()` 实现承接——只放工具成功输出,信任级 `authoritative` |
| `GUARD_RULES_VERSION` 版本戳 | `INJECTION_TABLE_VERSION` | 拦截率指标的分母改引包版本 |
| 输入侧 BLOCK / 检索侧 defang 的双模式不对称 | `mode: 'block'` vs `mode: 'defang'` | 同一张表两种动作,与 ai-edge 设计同构 |

## 迁移步骤(建议顺序)

1. `npm i` 包(发布前用 tarball:railguard 仓 `pnpm build && npm pack`);
2. **先换 web 端 guard.ts**:保留原文件为薄壳 re-export,跑 web 侧测试;
3. 换 agent 端 → 305 条拷贝测试应原样通过(它们就是这次迁移的验收标准);
4. 换 toolkit sanitize → 跑红队拦截率脚本,比对版本戳前后的分母;
5. memory/task 准入换 `admitPromptBoundText`;
6. 无据数字(settle B1' 分支)换 `numericTrace`——此步最深,可最后做或暂缓。

## 红线

- 规则纯函数契约与 ai-edge 相同(无 IO/时钟/随机),浏览器与服务端双端复用不变;
- 若某条 ai-edge 自有模式在包表里没有:用 `extraPatterns` 加,**并给 railguard 提 PR**
  (表是数据文件,加条目不改代码);
- 迁移期间不要同时改判定逻辑——先等价替换、测试全绿,再谈演进。
