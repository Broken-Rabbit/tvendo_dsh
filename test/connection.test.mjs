/**
 * Connection resolution decides which server a key is sent to. Sending the wrong
 * key to the wrong deployment is the one mistake this module must never make, so
 * the pinning rules are covered explicitly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cliConfigPath,
  describeSource,
  normalizeServer,
  readCliConfig,
  resolveConnection,
} from '../lib/connection.js'

/** Write one CLI config file and return an environment pointing at it. */
function cliEnv(config) {
  const dir = mkdtempSync(join(tmpdir(), 'tvendo-cli-'))
  const file = join(dir, 'config.json')
  writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config))
  return { dir, env: { TVENDO_CONFIG: file } }
}

test('normalizeServer requires http(s) and drops trailing slash, query and fragment', () => {
  assert.equal(normalizeServer('https://tv.example.com'), 'https://tv.example.com')
  assert.equal(normalizeServer('https://tv.example.com/'), 'https://tv.example.com')
  assert.equal(normalizeServer(' https://tv.example.com/base/ '), 'https://tv.example.com/base')
  assert.equal(normalizeServer('https://tv.example.com/?a=1#x'), 'https://tv.example.com')
  assert.equal(normalizeServer('ftp://tv.example.com'), undefined)
  assert.equal(normalizeServer('not a url'), undefined)
  assert.equal(normalizeServer(''), undefined)
  assert.equal(normalizeServer(undefined), undefined)
})

test('cliConfigPath follows the platform and honours TVENDO_CONFIG', () => {
  assert.equal(cliConfigPath({ TVENDO_CONFIG: 'D:/tv/c.json' }, 'win32'), 'D:/tv/c.json')
  assert.equal(
    cliConfigPath({ APPDATA: 'C:/Users/x/AppData/Roaming' }, 'win32'),
    join('C:/Users/x/AppData/Roaming', 'tvendo', 'config.json'),
  )
  assert.equal(
    cliConfigPath({ XDG_CONFIG_HOME: '/home/x/.config' }, 'linux'),
    join('/home/x/.config', 'tvendo', 'config.json'),
  )
  assert.match(cliConfigPath({}, 'darwin'), /Library[\\/]Application Support[\\/]tvendo[\\/]config\.json$/)
})

test('readCliConfig tolerates a missing or malformed file', () => {
  const broken = cliEnv('{not json')
  try {
    assert.equal(readCliConfig(broken.env, 'win32'), undefined)
  } finally {
    rmSync(broken.dir, { recursive: true, force: true })
  }
  assert.equal(readCliConfig({ TVENDO_CONFIG: join(tmpdir(), 'does-not-exist', 'c.json') }, 'win32'), undefined)
})

test('resolveConnection prefers settings, then environment, then the CLI file', () => {
  const { dir, env } = cliEnv({ server: 'https://cli.example.com', api_key: 'cli-key' })
  try {
    const fromSettings = resolveConnection({ server: 'https://settings.example.com', apiKey: 'set-key' }, env)
    assert.deepEqual(fromSettings, { server: 'https://settings.example.com', apiKey: 'set-key', source: 'settings' })

    const fromEnvironment = resolveConnection({}, { ...env, TVENDO_SERVER: 'https://env.example.com', TVENDO_API_KEY: 'env-key' })
    assert.deepEqual(fromEnvironment, { server: 'https://env.example.com', apiKey: 'env-key', source: 'environment' })

    assert.deepEqual(resolveConnection({}, env), { server: 'https://cli.example.com', apiKey: 'cli-key', source: 'cli-config' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveConnection falls back to the documented default address', () => {
  const resolved = resolveConnection({}, {})
  assert.equal(resolved.server, 'https://t.zhitoken.com')
  assert.equal(resolved.apiKey, '')
  assert.equal(resolved.source, 'default')
  assert.equal(describeSource(resolved), '内置默认地址')
})

test('a CLI key is never sent to a different server', () => {
  const { dir, env } = cliEnv({ server: 'https://cli.example.com', api_key: 'cli-key' })
  try {
    const resolved = resolveConnection({ server: 'https://other.example.com' }, env)
    assert.equal(resolved.server, 'https://other.example.com')
    assert.equal(resolved.apiKey, '', 'the CLI key belongs to cli.example.com')

    const sameHost = resolveConnection({ server: 'https://cli.example.com/' }, env)
    assert.equal(sameHost.apiKey, 'cli-key')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('settings may pin a key without pinning a server', () => {
  const resolved = resolveConnection({ apiKey: 'typed-key' }, { TVENDO_SERVER: 'https://env.example.com' })
  assert.deepEqual(resolved, { server: 'https://env.example.com', apiKey: 'typed-key', source: 'environment' })
  assert.equal(describeSource(resolved), '环境变量 TVENDO_SERVER')
})
