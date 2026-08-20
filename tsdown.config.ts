import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/rules/index.ts', 'src/audit/index.ts', 'src/data/index.ts', 'src/node/index.ts'],
  platform: 'neutral',
  // oxc-transform 0.x 与 rolldown-plugin-dts 0.16 返回形状失配(result.errors undefined),
  // 先走 tsc 生成 dts;上游修复后再切回 oxc 快路径
  dts: { oxc: false },
  // 不打平、不压缩:npm 产物逐文件可 diff 回源码,安全库的可审计性是功能不是妥协
  unbundle: true,
  minify: false,
  sourcemap: true,
})
