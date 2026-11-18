/**
 * Install the packed tarball into an empty directory and drive it from zero.
 *
 * This is the check that catches what unit tests cannot: a `files` entry missing
 * from the package, a dependency the profile would fail to resolve, or an entry
 * point that only works because the source tree happens to be on disk. The
 * installed package runs against a local fake deployment, so no key and no
 * network are needed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNpm } from './npm.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tarball = process.argv[2] ?? join(root, 'dist', `${pkg.name}-${pkg.version}.tgz`)
if (!existsSync(tarball)) {
  console.error(`找不到 ${tarball}，先运行 npm run pack`)
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-tvendo-check-'))

/** Fail the whole check when a step fails, cleaning the scratch directory. */
function fail(status) {
  rmSync(work, { recursive: true, force: true })
  process.exit(status)
}

writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'dsh-tvendo-check', private: true, type: 'module' }, null, 2))
const installStatus = runNpm(['install', tarball, '--no-audit', '--no-fund', '--omit=dev'], { cwd: work })
if (installStatus !== 0) fail(installStatus)

writeFileSync(join(work, 'check.mjs'), String.raw`
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const manifest = require('dsh-tvendo/package.json')
assert.equal(manifest.dsh.client.platform, 'web')
assert.match(readFileSync(require.resolve('dsh-tvendo/client'), 'utf8'), /__ModuleLoader__/)
assert.equal(require('dsh-tvendo/locale/zh.json').meta.title, 'Tvendo 工具市场')

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/v1/info') {
    res.end(JSON.stringify({ ok: true, data: {
      api_version: 1, brand: 'Fake Tvendo', version: '9.9.9', currency: 'CNY',
      micros_per_unit: 1000000, cli_available: false, skill_url: 'https://example.invalid/SKILL.md',
    } }))
    return
  }
  if (url.pathname === '/v1/catalog') {
    res.end(JSON.stringify({ ok: true, data: {
      items: [{ tool_ref: 'ref-1', name: 'Fake Search', provider: 'acme', description: 'fake web search',
        price_micros: 1500, currency: 'CNY', schema_available: true, upstream_type: 'http' }],
      next_cursor: null, search: { mode: 'hybrid', degraded: false, total: 1 },
    } }))
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ ok: false, error: 'not found', code: 'NOT_FOUND' }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port

const plugin = await import('dsh-tvendo')
assert.equal(plugin.name, 'tvendo')
assert.deepEqual(plugin.inject, ['tools'])
assert.equal(typeof plugin.apply, 'function')
assert.ok(plugin.Config, 'the Config schema is exported for the settings page')

const registered = []
const disposers = []
plugin.apply({
  tools: { register: (definition) => { registered.push(definition); return () => {} } },
  effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
}, plugin.Config({ server: origin, apiKey: 'test-key' }))

assert.deepEqual(registered.map((tool) => tool.name).sort(),
  ['tvendo_account', 'tvendo_info', 'tvendo_run', 'tvendo_runs', 'tvendo_search', 'tvendo_show'])

const exec = { signal: new AbortController().signal }
const info = registered.find((tool) => tool.name === 'tvendo_info')
const infoValue = await info.execute({}, exec)
assert.equal(infoValue.brand, 'Fake Tvendo')
const infoText = info.output.render({}, infoValue)
assert.match(infoText[0].text, /Fake Tvendo/)

const search = registered.find((tool) => tool.name === 'tvendo_search')
const searchValue = await search.execute({ query: '网页搜索' }, exec)
assert.equal(searchValue.items.length, 1)
assert.equal(searchValue.items[0].toolRef, 'ref-1')
assert.equal(searchValue.items[0].priceCny, '0.0015')
assert.match(search.output.render({ query: '网页搜索' }, searchValue)[0].text, /Fake Search/)

for (const dispose of disposers) dispose()
await new Promise((done) => server.close(done))
console.log('check:pack 通过：tarball 安装后加载入口、注册 6 个工具并在假服务上完成调用。')
`)

const checkStatus = spawnSync(process.execPath, [join(work, 'check.mjs')], { cwd: work, stdio: 'inherit' }).status
if (checkStatus !== 0) fail(checkStatus ?? 1)
rmSync(work, { recursive: true, force: true })
