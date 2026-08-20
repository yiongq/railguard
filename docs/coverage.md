---
title: OWASP 覆盖矩阵
---

# OWASP 覆盖矩阵

> 本页由 `pnpm gen:coverage` 从规则的 `threats` 元数据与评测用例生成,不手工维护。
> 名录版本 2026.08.0(OWASP LLM Top 10 2026 · Agentic/ASI Top 10 2026)。
> 「攻击用例验证」列出内置数据集中真实打到该威胁的攻击用例——声称覆盖与验证过覆盖是两回事。

## OWASP LLM 应用 Top 10(2026)

| 威胁 | 名称 | 防护规则 | 攻击用例验证 |
|---|---|---|---|
| LLM01:2026 | 提示词注入 | `input-hygiene`<br>`injection.block` *(概率层)*<br>`injection.defang` *(概率层)*<br>`spotlight.delimit` *(概率层)*<br>`lethal-trifecta` | `inj-override-zh`<br>`inj-override-en`<br>`inj-persona-hijack`<br>`inj-unicode-tag`<br>`inj-zero-width`<br>`inj-control-chars`<br>`inj-tool-result`<br>`inj-forged-freeze-mark`<br>`exp-novel-phrasing`<br>`exf-lethal-trifecta` |
| LLM02:2026 | 敏感信息泄露 | `lethal-trifecta`<br>`pii.redact`<br>`row-filter`<br>`field-mask` | `exf-lethal-trifecta`<br>`out-pii-leak`<br>`dat-row-exfil` |
| LLM03:2026 | 过度代理 | `rbac-tool-gate`<br>`approval-gate` | `dat-no-identity`<br>`dat-unknown-role`<br>`dat-tool-escape`<br>`dat-big-refund`<br>`dat-missing-amount` |
| LLM04:2026 | 供应链 | **——未覆盖** | — |
| LLM05:2026 | 数据与模型投毒 | **——未覆盖** | — |
| LLM06:2026 | 无界消耗 | `max-length`<br>`output-caps` | `inj-flood` |
| LLM07:2026 | 虚假信息 | `citation-faithfulness`<br>`numeric-trace` | `out-ungrounded-number`<br>`out-userstated-commit`<br>`out-fake-citation`<br>`out-refusal-smuggle` |
| LLM08:2026 | 隐藏上下文暴露 | **——未覆盖** | — |
| LLM09:2026 | 向量与嵌入弱点 | `citation-faithfulness` | `out-fake-citation` |
| LLM10:2026 | 输出处理不当 | `link-policy` | `exf-output-link` |

## OWASP Agentic 应用 Top 10(2026)

| 威胁 | 名称 | 防护规则 | 攻击用例验证 |
|---|---|---|---|
| ASI01:2026 | 代理目标劫持 | `injection.block` *(概率层)*<br>`injection.defang` *(概率层)* | `inj-override-zh`<br>`inj-override-en`<br>`inj-persona-hijack` |
| ASI02:2026 | 工具滥用与利用 | `lethal-trifecta`<br>`link-policy`<br>`rbac-tool-gate`<br>`approval-gate` | `exf-lethal-trifecta`<br>`exf-output-link`<br>`dat-tool-escape`<br>`dat-big-refund` |
| ASI03:2026 | 身份与权限滥用 | `rbac-tool-gate` | `dat-no-identity`<br>`dat-unknown-role`<br>`dat-tool-escape` |
| ASI04:2026 | 代理供应链漏洞 | **——未覆盖** | — |
| ASI05:2026 | 意外代码执行 | **——未覆盖** | — |
| ASI06:2026 | 记忆与上下文投毒 | `spotlight.delimit` *(概率层)* | `inj-tool-result`<br>`inj-forged-freeze-mark` |
| ASI07:2026 | 不安全的代理间通信 | **——未覆盖** | — |
| ASI08:2026 | 级联故障 | **——未覆盖** | — |
| ASI09:2026 | 人-代理信任利用 | **——未覆盖** | — |
| ASI10:2026 | 失控代理 | **——未覆盖** | — |

> 未覆盖:LLM04:2026、LLM05:2026、LLM08:2026、ASI04:2026、ASI05:2026、ASI07:2026、ASI08:2026、ASI09:2026、ASI10:2026。空格是事实,不是遗漏——按需自写规则或等后续里程碑。

