/** attw 产物形状检查。不用 `attw --pack .`:它内部起 `npm pack`,在
 *  `npm publish --dry-run` 的生命周期里会继承 npm_config_dry_run,pack 静默
 *  不产出 tgz 而 ENOENT。这里显式用 pnpm pack 出包、attw 验包、无论成败删包。 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const tgz = 'railguard-attw-probe.tgz'
delete process.env.npm_config_dry_run

try {
  execFileSync('pnpm', ['pack', '--out', tgz], { stdio: 'inherit' })
  execFileSync('npx', ['attw', tgz, '--profile', 'esm-only'], { stdio: 'inherit' })
} finally {
  rmSync(tgz, { force: true })
}
