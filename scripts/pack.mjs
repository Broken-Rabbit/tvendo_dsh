/**
 * Build the publishable tarball into `dist/`.
 *
 * A tarball (never a `file:` directory path) is what the DSH plugin manager must
 * install: a directory would be symlinked into the profile and the plugin's own
 * dependency (`@deepseek-ai/schemastery`) would never be installed next to it.
 */
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpm } from './npm.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dist = join(root, 'dist')
const tarball = join(dist, `${pkg.name}-${pkg.version}.tgz`)

mkdirSync(dist, { recursive: true })
rmSync(tarball, { force: true })

const status = runNpm(['pack', '--pack-destination', dist], { cwd: root })
if (status !== 0) process.exit(status)

const stats = statSync(tarball)
console.log(`\n打包完成：${tarball}（${(stats.size / 1024).toFixed(1)} KiB）`)
