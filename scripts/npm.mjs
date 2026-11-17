/**
 * Run the npm CLI without depending on how npm is exposed on this platform.
 *
 * On Windows `npm` is a `.cmd` shim, which Node refuses to spawn without a shell;
 * going through the CLI script that sits next to `node` is both portable and free
 * of shell quoting rules.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Run one npm command with inherited stdio.
 * @param args - arguments for npm itself, e.g. `['pack']`.
 * @param options - spawn options; `cwd` is required in practice.
 * @returns the exit code (1 when npm could not be started).
 */
export function runNpm(args, { cwd }) {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const result = existsSync(cli)
    ? spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}
