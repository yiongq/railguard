import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // M2 在此加 workerd project(@cloudflare/vitest-pool-workers)组成双运行时矩阵
  },
})
