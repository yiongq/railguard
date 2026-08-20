# 签名审计链

`@yiong/railguard/audit` + `@yiong/railguard/node`。护栏没有审计流就没有指标,
没有防篡改就没有可信指标。

## 审计事件

每条规则每次执行产出一条 `AuditEvent`:时间戳、requestId、钩子、规则 id 与**版本**、
三态 mode、verdict、status、score、`rescued`(true = 这次是 enforce 真实拦的;
观察态命中不算 rescued——两者在指标上是两回事)。

Sink 就是一个函数:

```ts
import { consoleSink, memorySink } from '@yiong/railguard/audit'

createGuard({ audit: consoleSink(), hooks: { ... } })  // 每事件一行 JSON,Node 与 edge 通用
```

## Ed25519 签名哈希链

`SignedJsonlAuditSink`(Node)把事件写成 JSONL,每行带
`hash = H(prevHash ‖ event)` 与 Ed25519 签名——篡改任何一行,链在那一行断:

```ts
import { SignedJsonlAuditSink, readSignedAuditLog } from '@yiong/railguard/node'
import { generateAuditKeypair, verifyAuditChain } from '@yiong/railguard/audit'

const keys = await generateAuditKeypair()
const signed = await SignedJsonlAuditSink.create('audit.jsonl', keys.privateKey) // 从文件尾部续链
const guard = createGuard({ audit: signed.sink, hooks: { /* ... */ } })
```

校验是**离线**的——拿公钥就能验,不需要访问写入方。逐条查 seq 连续、prevHash 链接、
hash 复算一致、签名有效,把「日志没被动过」变成可复现的密码学事实:

```ts
const records = await readSignedAuditLog('audit.jsonl')   // 或 parseSignedAuditLog(text)
const result = await verifyAuditChain(records, keys.publicKey)
// { ok, count, brokenAt?: { seq, reason } } —— 第一处断裂精确到序号与原因
```

密钥用 JWK 进出:`exportKeyJwk` / `importPrivateKeyJwk` / `importPublicKeyJwk`。

## 工程语义

- **WebCrypto 实现**:签名与校验在 edge 运行时同样可用(`/audit` 无 node: 导入;
  只有 JSONL 文件写入在 `/node`);
- **断电残行截断**:崩溃留下的半行在回放时被截断丢弃,链从最后一条完整记录续起;
- **跨重启续链**:重启后读尾部恢复 `prevHash`,不开新链——审计连续性不因部署中断;
- 私钥只在写入侧;公钥分发给任何需要审计核查的一方。

## 与评测的关系

审计流是[录制-重放对账](./eval#录制-重放对账)的另一半:审计记录「判了什么」,
录制记录「判的是什么内容」。observe 上新规则 → 审计流看命中率 → 重放看改判清单 →
切 enforce,三步都有数据支撑。
