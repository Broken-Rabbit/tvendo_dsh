import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { apply, Config } from '../lib/index.js'
import { resolveConnection } from '../lib/connection.js'

// A minimal contract double for DSH's public SettingsFormModel. The same
// controller was also smoke-tested locally against the shipped DSH model.
class Model {
  constructor(scope, specs) { this.scope = scope; this.specs = new Map(specs.map(s => [s.field, s])); this.staged = new Map() }
  field(field) { const spec = this.specs.get(field); return { text: this.staged.get(field) ?? spec.format(this.scope.getSnapshot().value[field]) } }
  shell() { return { available: true, writable: true, dirty: this.plan().length > 0 } }
  plan() {
    return [...this.staged].flatMap(([field, text]) => {
      const spec = this.specs.get(field)
      if (text === spec.format(this.scope.getSnapshot().value[field])) return []
      const parsed = spec.parse(text)
      return [{ field, op: parsed ? { op: 'set', path: [field], value: parsed.value } : undefined }]
    })
  }
  bind(project) { return { getSnapshot: project } }
  actions() { return { edit: (field, text) => this.staged.set(field, text) } }
  dispose() {}
}
function loadClient({ fetchImpl } = {}) {
  let plugin
  const textField = field => ({ field, format: v => typeof v === 'string' ? v : '', parse: text => ({ kind: 'set', value: text.trim() }) })
  const primitives = { SettingsFormModel: Model, settingsTextField: textField, settingsNumberField: textField }
  const jsx = (component, props) => ({ component, props })
  let state
  const ref = { current: null }
  const react = { useState(initial) { state ??= initial; return [state, next => { state = next }] }, useRef() { return ref }, useEffect() {} }
  const sandbox = { URL, AbortSignal, AbortController, fetch: fetchImpl, window: { __ModuleLoader__: { load(definition) {
    assert.equal(definition.id, 'dsh-tvendo')
    plugin = definition.factory(name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'react' ? react : primitives)
  } } } }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox)
  plugin.testState = () => state
  return plugin
}
function scope() {
  return { getSnapshot: () => ({ value: { server: 'https://t.zhitoken.com', defaultMaxCostMicros: 0, requestTimeoutMs: 120000 }, secrets: [{ path: ['apiKey'], set: true }] }) }
}
const plain = value => JSON.parse(JSON.stringify(value))
function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findNode(child, predicate)
    if (found) return found
  }
}

test('Config exposes live references and keeps API key secret', () => {
  const json = Config.toJSON()
  const dict = json.refs[json.uid].dict
  assert.equal(json.refs[dict.apiKey].meta.role, 'secret')
  for (const field of ['server', 'apiKey', 'defaultMaxCostMicros', 'requestTimeoutMs']) {
    assert.equal(json.refs[dict[field]].meta.volatile, true)
    assert.equal(typeof Config({})[field].get, 'function')
  }
})

test('settings card registers in plugins.item only while tvendo is served', () => {
  const plugin = loadClient()
  let registered
  let disposed = false
  plugin.apply({
    locale: { register: () => () => {}, bind: () => key => key },
    configForms: { get: ns => { assert.equal(ns, 'tvendo'); return scope() }, whileServed(names, callback) { assert.deepEqual(plain(names), ['tvendo']); return callback() } },
    slots: { inject(name, callback) { assert.ok(['plugins.item', 'settings.section', 'plugins.detail.section'].includes(name)); return callback() }, register(definition, component) { registered = { definition, component }; return () => { disposed = true } } },
    effect: fn => fn(),
  })
  assert.equal(registered.definition.id, 'tvendo')
  assert.equal(registered.component, plugin.TvendoCard)
  assert.equal(disposed, false)
  assert.ok(registered.definition.inject().hooks.tvendoCard)
})

test('saved credential stays out of the draft while key presence is reported', () => {
  const { TvendoCardController } = loadClient()
  const card = new TvendoCardController(scope())
  const state = card.store.getSnapshot()
  assert.equal(state.apiKey.text, '')
  assert.equal(state.keyConfigured, true)
  card.inject().edit('defaultMaxCostMicros', '1500')
  assert.deepEqual(plain(card.form.plan()).map(item => item.field), ['defaultMaxCostMicros'])
  card.inject().edit('apiKey', '')
  assert.equal(card.form.plan().some(item => item.field === 'apiKey'), false)
})

test('new keys are visible while typing without changing the entered value', () => {
  const { TvendoSecretField } = loadClient()
  let edited
  const value = 'test-key-12345'
  const field = TvendoSecretField({ id: 'test-key', text: value, configured: false, onEdit: text => { edited = text } })
  const input = findNode(field, node => node.component === 'input')
  assert.equal(input.props.type, 'text')
  assert.equal(input.props.style.WebkitTextSecurity, undefined)
  assert.equal(input.props.value, value)
  assert.equal(input.props.autoComplete, 'off')
  input.props.onChange({ target: { value: 'updated-test-key' } })
  assert.equal(edited, 'updated-test-key')
})

test('saved key has a grey bold italic label, never an input value', () => {
  const { TvendoSecretField } = loadClient()
  for (const configured of [true, false]) {
    const field = TvendoSecretField({ id: 'test-key', text: '', configured, savedLabel: '已保存密钥', disabled: true, onEdit() {} })
    const input = findNode(field, node => node.component === 'input')
    const indicator = findNode(field, node => node.props?.id === 'test-key-saved')
    assert.equal(input.props.value, '')
    assert.equal(input.props.placeholder, '')
    assert.equal(input.props.disabled, true)
    assert.equal(Boolean(indicator), configured)
    if (configured) {
      assert.equal(indicator.props.children, '已保存密钥')
      assert.equal(indicator.props.style.fontWeight, 700)
      assert.equal(indicator.props.style.fontStyle, 'italic')
      assert.equal(indicator.props.style.color, '#888')
      assert.equal(indicator.props.style.pointerEvents, 'none')
    }
  }
  const editing = TvendoSecretField({ id: 'test-key', text: 'replacement', configured: true, onEdit() {} })
  assert.equal(findNode(editing, node => node.props?.id === 'test-key-saved'), undefined)
})

test('typing then clearing a key preserves the saved credential', () => {
  const { TvendoCardController } = loadClient()
  const card = new TvendoCardController(scope())
  card.inject().edit('apiKey', 'new-test-key')
  assert.equal(card.store.getSnapshot().apiKey.text, 'new-test-key')
  assert.equal(card.form.plan()[0].op.value, 'new-test-key')
  card.inject().edit('apiKey', '')
  assert.equal(card.form.plan().length, 0)
  assert.equal(card.store.getSnapshot().keyConfigured, true)
})

test('new key and server are saved together; old key is cleared on endpoint change', () => {
  const { TvendoCardController } = loadClient()
  const card = new TvendoCardController(scope())
  card.inject().edit('server', 'https://other.example.com/')
  assert.deepEqual(plain(card.form.plan()).map(item => item.op), [
    { op: 'set', path: ['server'], value: 'https://other.example.com' },
    { op: 'set', path: ['apiKey'], value: '' },
  ])
  card.inject().edit('apiKey', 'replacement-test-key')
  const keyOps = card.form.plan().filter(item => item.field === 'apiKey')
  assert.equal(keyOps.length, 1)
  assert.equal(keyOps[0].op.value, 'replacement-test-key')
})

test('UI rejects invalid numbers and URLs with embedded credentials', () => {
  const { TvendoCardController } = loadClient()
  const card = new TvendoCardController(scope())
  for (const [field, text] of [['server', 'javascript:alert(1)'], ['server', 'https://key@example.com'], ['requestTimeoutMs', '999'], ['defaultMaxCostMicros', '-1'], ['defaultMaxCostMicros', '1.5']]) {
    assert.equal(card.form.specs.get(field).parse(text), undefined)
  }
})

test('environment credentials cannot be reused for another endpoint', () => {
  const env = { TVENDO_SERVER: 'https://old.example.com', TVENDO_API_KEY: 'env-test-key', TVENDO_CONFIG: 'nonexistent-test-config' }
  assert.equal(resolveConnection({ server: 'https://other.example.com' }, env).apiKey, '')
  assert.equal(resolveConnection({ server: 'https://old.example.com' }, env).apiKey, 'env-test-key')
})

test('tools read updated volatile credentials and defaults without remounting', async (t) => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), ...init })
    return new Response(JSON.stringify({ ok: true, data: { items: [] } }))
  }
  t.after(() => { globalThis.fetch = original })
  let key = 'before-test-key'
  let maxCost = 1500
  const config = { ...Config({}), apiKey: { get: () => key }, defaultMaxCostMicros: { get: () => maxCost } }
  const tools = []
  apply({ tools: { register: tool => { tools.push(tool); return () => {} } }, effect: fn => fn() }, config)
  const search = tools.find(tool => tool.name === 'tvendo_search')
  await search.execute({ query: 'test' }, {})
  key = 'after-test-key'
  await search.execute({ query: 'test' }, {})
  assert.equal(calls[0].headers.authorization, 'Bearer before-test-key')
  assert.equal(calls[1].headers.authorization, 'Bearer after-test-key')
  maxCost = 1700
  const run = tools.find(tool => tool.name === 'tvendo_run')
  await run.execute({ tool_ref: 'offline-test' }, {})
  assert.equal(JSON.parse(calls[2].body).max_cost_micros, 1700)
})

test('updates are registered on the installed plugin detail page', () => {
  const plugin = loadClient()
  const registrations = []
  plugin.apply({
    locale: { register: () => () => {}, bind: () => key => key },
    configForms: { get: () => scope(), whileServed: () => () => {} },
    slots: { inject: (_name, callback) => callback(), register(definition, component) { registrations.push({ definition, component }); return () => {} } },
    effect: fn => fn(),
  })
  const slot = registrations.find(item => item.definition.name === 'plugins.detail.section')
  assert.equal(slot.component, plugin.TvendoUpdateSection)
  assert.equal(slot.definition.id, 'tvendo-updates')
  const subject = { kind: 'bundle', pkg: { name: 'dsh-tvendo', installed: true, version: '0.3.2' } }
  const element = slot.component({ subject, t: key => key })
  assert.equal(element.props.currentVersion, '0.3.2')
  assert.equal(slot.component({ subject: { ...subject, pkg: { ...subject.pkg, name: 'unrelated' } } }), null)
  assert.equal(slot.component({ subject: { ...subject, pkg: { ...subject.pkg, installed: false } } }), null)
  assert.equal(slot.component({ subject: { kind: 'item', id: 'tvendo' } }), null)
})

test('update comparison follows SemVer including prereleases', () => {
  const { compareVersions } = loadClient()
  for (const [a, b, result] of [
    ['0.3.2', '0.3.1', 1], ['0.3.1', '0.3.2', -1], ['1.0.0', '1.0.0', 0],
    ['1.0.0-rc.10', '1.0.0-rc.2', 1], ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-rc.1', '1.0.0', -1], ['1.0.0+build1', '1.0.0+build2', 0],
    ['1.0.0-1', '1.0.0-alpha', -1], ['1.0.0-alpha', '1.0.0-alpha.1', -1],
  ]) assert.equal(compareVersions(a, b), result)
  for (const bad of ['1.01.0', 'latest', '<script>', '1.0.0-01', undefined]) assert.throws(() => compareVersions(bad, '1.0.0'))
})

test('update check requests only the fixed GitHub manifest without credentials', async () => {
  const { checkForUpdates } = loadClient()
  const calls = []
  const result = await checkForUpdates('0.3.2', { fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ name: 'dsh-tvendo', version: '0.4.0' }))
  } })
  assert.deepEqual(plain(result), { currentVersion: '0.3.2', latestVersion: '0.4.0', comparison: 1 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/Broken-Rabbit/tvendo_dsh/main/package.json')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.equal(calls[0].init.body, undefined)
})

test('update check rejects HTTP errors and invalid or oversized manifests', async () => {
  const { checkForUpdates } = loadClient()
  for (const response of [
    new Response('{}', { status: 429 }), new Response('not JSON'),
    new Response(JSON.stringify({ name: 'other', version: '9.0.0' })),
    new Response(JSON.stringify({ name: 'dsh-tvendo', version: 'latest' })),
    new Response('x'.repeat(65537)),
  ]) await assert.rejects(checkForUpdates('0.3.2', { fetchImpl: async () => response }))
  await assert.rejects(checkForUpdates('0.3.2', { fetchImpl: async () => { throw new Error('offline') } }))
})

test('update panel checks only on click, blocks concurrent requests and shows the result', async () => {
  let resolve, count = 0
  const plugin = loadClient({ fetchImpl: () => { count++; return new Promise(done => { resolve = done }) } })
  const props = { t: key => key, currentVersion: '0.3.2' }
  const element = plugin.TvendoUpdatePanel(props)
  assert.equal(count, 0)
  const button = findNode(element, node => node.component === 'button')
  const first = button.props.onClick()
  await button.props.onClick()
  assert.equal(count, 1)
  assert.equal(findNode(plugin.TvendoUpdatePanel(props), node => node.component === 'button').props.disabled, true)
  resolve(new Response(JSON.stringify({ name: 'dsh-tvendo', version: '0.4.0' })))
  await first
  assert.equal(plugin.testState().status, 'ready')
  assert.equal(plugin.testState().comparison, 1)
  assert.match(JSON.stringify(plugin.TvendoUpdatePanel(props)), /updateAvailable/)
})

test('update failure re-enables the button for retry', async () => {
  const plugin = loadClient({ fetchImpl: async () => { throw new Error('offline') } })
  const props = { t: key => key, currentVersion: '0.3.2' }
  await findNode(plugin.TvendoUpdatePanel(props), node => node.component === 'button').props.onClick()
  assert.equal(plugin.testState().status, 'error')
  assert.equal(findNode(plugin.TvendoUpdatePanel(props), node => node.component === 'button').props.disabled, false)
  assert.match(JSON.stringify(plugin.TvendoUpdatePanel(props)), /updateFailed/)
})
