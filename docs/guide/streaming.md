# 流式护栏

网关型方案对流式输出普遍直接跳过护栏——railguard 把它做成一等公民:
**与非流式 `run()` 完全同一套规则与三态**,不为流式单独降级。

```ts
import { createStreamGuard } from '@yiong/railguard'

const stream = createStreamGuard(guard, ctx)          // hook 默认 onOutput

for await (const chunk of modelStream) {
  const out = await stream.push(chunk)
  if (out.emit) send(out.emit)                        // 通过守卫的文本(可能被改写)
  if (out.blocked) return cutStream(out.blocked)      // 中途拦截即切流
}
const rest = await stream.flush()                     // 流结束冲洗残余缓冲
if (rest.emit) send(rest.emit)
if (rest.blocked) return cutStream(rest.blocked)
```

## 语义

- **按句攒批**:chunk 按句边界攒成完整句,每批过一遍 onOutput 规则再放行。
  默认边界含中英句读、换行,以及「ASCII 句点 + 空白」——英文陈述句正常切分,
  而 `3.5` 这类小数不会被拦腰切开。规则看到的是完整句子,不是碎片——
  `linkPolicy` 不会被拆成两半的 URL 骗过。
- **缓冲恰好以边界收尾**即视为完整段立刻送检,不等下一个 chunk——
  依赖宿主 flush 的场景(如 Mastra 流末尾无法补发文本)不会吞句。
- **自定义边界**:零宽(lookaround)与消耗型(如 `/\n/`)都支持,消耗型的
  分隔符保留在前一段里,不会从流里被吃掉;`m`/`y` flag 会被安全剥除;
  不要使用捕获组。
- **超限强制送检**:`maxBuffer`(默认 480 字符)防无标点长流把缓冲憋死。
- **拦截即死流**:一旦 blocked,后续 `push` 一律返回空——不存在「拦了半截又继续」。

## 选项

```ts
createStreamGuard(guard, ctx, {
  boundary: /(?<=[。!?;\n!?;])|(?<=\.)(?=\s)/,  // 攒批边界(默认值)
  maxBuffer: 480,
  hook: 'onOutput',
})
```

两个适配器([Vercel AI SDK](./adapter-vercel-ai) 的 `wrapStream`、
[Mastra](./adapter-mastra) 的 `processOutputStream`)内部就是这一套,无需自己接。

## 代价的诚实说明

按句攒批意味着下发延迟增加约一个句子的生成时间;拦截发生在句边界,
已下发的前几句收不回来。这是流式护栏的固有几何,不是实现缺陷——
真正敏感的场景(承诺语境、对外发送)应当走非流式 + 全文核验。
