import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'railguard',
  base: '/railguard/',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap',
      },
    ],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/railguard/logo.svg' }],
  ],
  lastUpdated: true,
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [{ icon: 'github', link: 'https://github.com/yiongq/railguard' }],
    search: { provider: 'local' },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      description: 'LLM 应用与 Agent 的护栏流水线:数据访问守卫与 LLM I/O 守卫,零依赖 TypeScript',
      themeConfig: {
        nav: [
          { text: '指南', link: '/guide/quickstart' },
          { text: '规则参考', link: '/guide/rules' },
          { text: '评测', link: '/guide/eval' },
          { text: '覆盖矩阵', link: '/coverage' },
        ],
        sidebar: [
          {
            text: '开始',
            items: [
              { text: '快速开始', link: '/guide/quickstart' },
              { text: '核心概念', link: '/guide/concepts' },
            ],
          },
          {
            text: '规则半区',
            items: [
              { text: '内置规则', link: '/guide/rules' },
              { text: '流式护栏', link: '/guide/streaming' },
            ],
          },
          {
            text: '数据访问半区',
            items: [
              { text: 'RBAC / 行过滤 / 脱敏 / 审批', link: '/guide/data-access' },
              { text: '签名审计链', link: '/guide/audit' },
            ],
          },
          {
            text: '评测(M4)',
            items: [
              { text: '评测框架', link: '/guide/eval' },
              { text: 'OWASP 覆盖矩阵', link: '/coverage' },
            ],
          },
          {
            text: '适配器',
            items: [
              { text: 'Vercel AI SDK', link: '/guide/adapter-vercel-ai' },
              { text: 'Mastra', link: '/guide/adapter-mastra' },
            ],
          },
          {
            text: '迁移',
            items: [{ text: 'ai-edge → railguard', link: '/migrations/ai-edge' }],
          },
        ],
        outline: { label: '本页导航', level: [2, 3] },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdatedText: '最近更新',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'Guardrail pipeline for LLM apps and agents: data-access guards and LLM I/O guards, zero-dependency TypeScript',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/quickstart' },
          { text: 'Rules', link: '/en/guide/rules' },
          { text: 'Evals', link: '/en/guide/eval' },
          { text: 'Coverage', link: '/en/coverage' },
        ],
        sidebar: [
          {
            text: 'Getting started',
            items: [
              { text: 'Quickstart', link: '/en/guide/quickstart' },
              { text: 'Core concepts', link: '/en/guide/concepts' },
            ],
          },
          {
            text: 'Rules half',
            items: [
              { text: 'Built-in rules', link: '/en/guide/rules' },
              { text: 'Streaming guard', link: '/en/guide/streaming' },
            ],
          },
          {
            text: 'Data-access half',
            items: [
              { text: 'RBAC / rows / masking / approvals', link: '/en/guide/data-access' },
              { text: 'Signed audit chain', link: '/en/guide/audit' },
            ],
          },
          {
            text: 'Evals (M4)',
            items: [
              { text: 'Eval framework', link: '/en/guide/eval' },
              { text: 'OWASP coverage matrix', link: '/en/coverage' },
            ],
          },
          {
            text: 'Adapters',
            items: [
              { text: 'Vercel AI SDK', link: '/en/guide/adapter-vercel-ai' },
              { text: 'Mastra', link: '/en/guide/adapter-mastra' },
            ],
          },
        ],
      },
    },
  },
})
