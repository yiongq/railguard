# 发布 `@yiong/railguard`

经 **Changesets** + **npm Trusted Publishing(OIDC,无 token)** 发布,附 **provenance 签发**。
流水线在 [`.github/workflows/release.yml`](.github/workflows/release.yml),
是同作者其它公开包上验证过的同款路径,已知的坑都已避开。

## 0. 首发引导(一次性,人工)

Trusted Publisher 配在 npm 包的 Settings 页——**包不存在就没有这个页面**,
所以第一个版本必须本地手动发:

```sh
npm login                        # 如未登录
npm publish --provenance=false   # webauthn 确认;access: public 已在 publishConfig
```

`--provenance=false` 是必须的:`publishConfig.provenance: true` 会让**本地**发布
直接报错——provenance 只能在 CI 的 OIDC 环境里生成。首发这一次没有不影响,
之后 CI 发的每个版本都会带。

`prepublishOnly` 会自动跑全部质量门:零依赖断言 + 运行时纯度 + typecheck + test
+ build + publint/attw。

## 1. 配置 Trusted Publisher(一次性,人工)

1. 登录 npmjs.com,进 **`@yiong/railguard` → Settings → Trusted Publisher**;
2. 添加 GitHub Actions publisher,值必须精确匹配:
   - Organization or user:`yiongq`
   - Repository:`railguard`
   - Workflow filename:`release.yml`
   - Environment:留空
3. **勾选 `npm publish` 动作**——2026-05-20 起新建的配置不勾选任何 allowed action
   会直接拒发(旧教程都没写这条,是首配最容易踩的坑);
4. 保存。之后不需要任何 NPM_TOKEN,不要往 secrets 里加。

## 2. 日常发布流程

1. 改代码,同分支附一个 changeset(写用户可见的变化,选 bump 级别):
   ```sh
   pnpm changeset
   ```
2. 合并到 main → `release.yml` 开/更新「**Version Packages**」PR
   (消费 changesets、bump 版本、更新 CHANGELOG);
3. 合并 Version Packages PR → `release.yml` 再跑一次,这次执行
   `pnpm run release`(= `changeset publish`)真正发布;
4. 到 npm 包页确认新版本带 **Provenance** 标记。

## 规矩

- **判定变化不进 patch**:规则表、判定逻辑一变,changeset 至少 minor
  (README 工程承诺;拦截率指标的分母是版本戳);
- 发布产物不打包不压缩、`src/` 随包分发——publint/attw 在 CI 与 prepublishOnly
  双处把关,出口形状歪了合不进 main;
- workflow 里必须写 `pnpm run version` / `pnpm run release`(带 `run`):
  `pnpm version` 是内建命令,会遮蔽 npm script,changesets 永远不被消费。
