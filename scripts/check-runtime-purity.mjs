/** 双运行时纪律检查:core/rules/audit 禁止 node: 导入与顶层 await。
 *  Node 专属能力只允许出现在未来的 src/node/ 子路径。 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = new URL('../src', import.meta.url).pathname
const violations = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry)
    if (fs.statSync(abs).isDirectory()) {
      if (path.basename(abs) === 'node') continue // src/node/ 是唯一豁免区
      walk(abs)
      continue
    }
    if (!/\.ts$/.test(entry)) continue
    const text = fs.readFileSync(abs, 'utf8')
    const rel = path.relative(SRC, abs)
    if (/from\s+['"]node:/.test(text)) violations.push(`${rel}: 引入了 node: 模块`)
    // 顶层 await 会破坏 require(esm);粗粒度检测:非缩进行首的 await
    if (/^await\s/m.test(text)) violations.push(`${rel}: 疑似顶层 await`)
  }
}
walk(SRC)

if (violations.length) {
  console.error('运行时纯度检查失败:')
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('runtime purity OK')
