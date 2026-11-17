/**
 * The tool surface: what the model can call, what each call puts on the wire, and
 * what the model reads back. The platform is faked so the tests run offline.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTools } from '../lib/tools.js'

const CONFIG = { server: 'https://tv.example.com', apiKey: 'test-key' }
const DEFAULTS = { maxCostMicros: 0, timeoutMs: 5000 }
const EXEC = { signal: new AbortController().signal }

/** Build the tool set against the fake deployment. */
function tools(config = CONFIG, defaults = DEFAULTS) {
  const list = createTools({ config, defaults })
  const byName = new Map(list.map((tool) => [tool.name, tool]))
  return {
    list,
    get: (name) => {
      const tool = byName.get(name)
      assert.ok(tool, `tool ${name} is registered`)
      return tool
    },
  }
}

/** Render one tool result the way the registry would. */
function render(tool, args, value) {
  const blocks = tool.output.render(args, value)
  assert.ok(Array.isArray(blocks) && blocks.length > 0)
  assert.equal(blocks[0].type, 'text')
  return blocks.map((block) => block.text).join('\n')
}

/** Install a fetch stub whose routes are keyed by pathname. */
function stubRoutes(t, routes) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url))
    const call = {
      url: parsed,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    }
    calls.push(call)
    const route = routes[parsed.pathname]
    if (route === undefined) {
      return json({ ok: false, error: `unmapped ${parsed.pathname}`, code: 'NOT_FOUND' }, 404)
    }
    const resolved = typeof route === 'function' ? route(call) : route
    return json(resolved.body, resolved.status ?? 200, resolved.headers)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

/** Build a JSON response. */
function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
])

/** Assert a schema stays inside the subset the tool registry accepts. */
function assertSchemaSubset(node, path) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child, index) => assertSchemaSubset(child, `${path}[${index}]`))
    return
  }
  for (const key of Object.keys(node)) {
    assert.ok(ALLOWED_SCHEMA_KEYS.has(key), `${path} uses unsupported schema keyword ${key}`)
  }
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    assertSchemaSubset(child, `${path}.${key}`)
  }
  if (node.items !== undefined) assertSchemaSubset(node.items, `${path}[]`)
  for (const [index, child] of (node.oneOf ?? []).entries()) {
    assertSchemaSubset(child, `${path}|${index}`)
  }
}

test('the six tools are registered with registry-ready definitions', () => {
  const list = tools().list
  assert.deepEqual(list.map((tool) => tool.name), [
    'tvendo_info',
    'tvendo_search',
    'tvendo_show',
    'tvendo_run',
    'tvendo_runs',
    'tvendo_account',
  ])
  for (const tool of list) {
    assert.ok(tool.description.length > 40, `${tool.name} has a usable description`)
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.execute, 'function')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.timeoutMs, 'number')
    assert.equal(typeof tool.isConcurrencySafe, 'function')
    assertSchemaSubset(tool.parameters, `${tool.name}.parameters`)
    assertSchemaSubset(tool.output.schema, `${tool.name}.output`)
  }
  assert.equal(tools().get('tvendo_run').isConcurrencySafe(), false, 'charged calls must not overlap')
})

test('info reports the deployment and whether a key is configured', async (t) => {
  stubRoutes(t, {
    '/v1/info': {
      body: {
        ok: true,
        data: {
          brand: 'Fake Tvendo',
          version: '1.2.3',
          api_version: 1,
          currency: 'CNY',
          micros_per_unit: 1000000,
          cli_available: true,
          cli_version: '1.2.3',
          skill_url: 'https://example.invalid/SKILL.md',
        },
      },
    },
  })
  const tool = tools().get('tvendo_info')
  const value = await tool.execute({}, EXEC)
  assert.equal(value.brand, 'Fake Tvendo')
  assert.equal(value.keyConfigured, true)
  assert.equal(value.cliAvailable, true)
  const text = render(tool, {}, value)
  assert.match(text, /Fake Tvendo 1\.2\.3/)
  assert.match(text, /平台密钥：已配置/)
  assert.match(text, /SKILL\.md/)
})

test('search pages the catalog and bounds what the model reads', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/catalog': {
      body: {
        ok: true,
        data: {
          items: [
            {
              tool_ref: 'ref-1',
              name: 'Web Search',
              provider: 'acme',
              description: 'x'.repeat(600),
              price_micros: 1500,
              currency: 'CNY',
              schema_available: true,
              upstream_type: 'http',
            },
            { tool_ref: 'ref-2', name: 'No Schema', provider: 'acme', price_micros: 0 },
          ],
          next_cursor: 'cursor-2',
          search: { mode: 'hybrid', degraded: true, total: 12 },
        },
      },
    },
  })
  const tool = tools().get('tvendo_search')
  const args = { query: '网页搜索', limit: 2, cursor: 'cursor-1' }
  const value = await tool.execute(args, EXEC)

  assert.equal(value.mode, 'hybrid')
  assert.equal(value.degraded, true)
  assert.equal(value.total, 12)
  assert.equal(value.nextCursor, 'cursor-2')
  assert.equal(value.items[0].priceCny, '0.0015')
  assert.equal(value.items[0].descriptionTruncated, true)
  assert.ok(value.items[0].description.length <= 281)
  assert.equal(value.items[1].schemaAvailable, false)

  assert.equal(calls[0].url.searchParams.get('q'), '网页搜索')
  assert.equal(calls[0].url.searchParams.get('limit'), '2')
  assert.equal(calls[0].url.searchParams.get('cursor'), 'cursor-1')

  const text = render(tool, args, value)
  assert.match(text, /2 个候选/)
  assert.match(text, /检索已降级/)
  assert.match(text, /下一页 cursor：cursor-2/)
  assert.match(text, /候选不代表具备所需能力/)
})

test('search lists the whole catalog when the query is empty', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/catalog': { body: { ok: true, data: { items: [], search: { mode: 'directory' } } } },
  })
  const tool = tools().get('tvendo_search')
  const value = await tool.execute({ query: '' }, EXEC)
  assert.equal(calls[0].url.searchParams.get('q'), null)
  assert.match(render(tool, { query: '' }, value), /没有匹配的工具/)
})

test('show reads the schema, the example and the price', async (t) => {
  stubRoutes(t, {
    '/v1/catalog/ref-1': {
      body: {
        ok: true,
        data: {
          tool_ref: 'ref-1',
          name: 'Web Search',
          provider: 'acme',
          description: 'Search the web.',
          price_micros: 1500,
          currency: 'CNY',
          upstream_type: 'mcp',
          input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          input_example: { query: 'ai agents' },
        },
      },
    },
  })
  const tool = tools().get('tvendo_show')
  await assert.rejects(tool.execute({}, EXEC), /tool_ref 必须是非空字符串/)
  const value = await tool.execute({ tool_ref: 'ref-1' }, EXEC)
  assert.equal(value.schemaAvailable, true)
  assert.equal(value.upstreamType, 'mcp')
  const text = render(tool, { tool_ref: 'ref-1' }, value)
  assert.match(text, /0\.0015 元\/次/)
  assert.match(text, /输入 Schema/)
  assert.match(text, /tvendo_run\(tool_ref="ref-1"/)
})

test('run sends the arguments and the default ceiling, then renders the result', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/run': {
      body: { ok: true, data: { id: 42, cost_micros: 1500, data: { results: ['a', 'b'] } } },
    },
  })
  const tool = tools(CONFIG, { maxCostMicros: 2000, timeoutMs: 5000 }).get('tvendo_run')
  const value = await tool.execute({ tool_ref: 'ref-1', parameters: { query: 'ai' } }, EXEC)

  assert.equal(calls[0].body.tool_ref, 'ref-1')
  assert.deepEqual(calls[0].body.parameters, { query: 'ai' })
  assert.equal(calls[0].body.max_cost_micros, 2000)
  assert.equal(value.runId, 42)
  assert.equal(value.costMicros, 1500)
  assert.match(value.requestId, /^[0-9a-f-]{36}$/)

  const text = render(tool, {}, value)
  assert.match(text, /run #42/)
  assert.match(text, /0\.0015 元/)
  assert.match(text, /results/)
})

test('an explicit ceiling of 0 means "no extra ceiling" and is not sent', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/run': { body: { ok: true, data: { id: 1, cost_micros: 0, data: null } } },
  })
  const tool = tools().get('tvendo_run')
  await tool.execute({ tool_ref: 'ref-1', parameters: {}, max_cost_micros: 0 }, EXEC)
  assert.equal('max_cost_micros' in calls[0].body, false)
})

test('run validates its arguments before spending anything', async (t) => {
  const calls = stubRoutes(t, {})
  const tool = tools().get('tvendo_run')
  await assert.rejects(tool.execute({ tool_ref: 'ref-1', parameters: [] }, EXEC), /parameters 必须是 JSON 对象/)
  await assert.rejects(tool.execute({ tool_ref: 'ref-1', max_cost_micros: -1 }, EXEC), /max_cost_micros 必须是非负整数/)
  await assert.rejects(tool.execute({ tool_ref: 'ref-1', max_cost_micros: 1.5 }, EXEC), /max_cost_micros 必须是非负整数/)
  await assert.rejects(tool.execute({}, EXEC), /tool_ref 必须是非空字符串/)
  assert.equal(calls.length, 0)
})

test('a failed charged call is attempted exactly once and keeps the request id', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/run': {
      status: 403,
      body: { ok: false, error: 'cost ceiling too low', code: 'COST_LIMIT_EXCEEDED', settlement: 'not_started' },
    },
  })
  const tool = tools().get('tvendo_run')
  await assert.rejects(tool.execute({ tool_ref: 'ref-1', parameters: {}, max_cost_micros: 10 }, EXEC), (error) => {
    assert.match(error.message, /未开始也未扣费/)
    assert.match(error.message, /request_id=/)
    return true
  })
  assert.equal(calls.length, 1)
})

test('runs reconciles one call record by id or by request id', async (t) => {
  const calls = stubRoutes(t, {
    '/v1/runs/7': { body: { ok: true, data: { id: 7, status: 'success', cost_micros: 1500, request_id: 'req-7' } } },
    '/v1/runs': {
      body: {
        ok: true,
        data: {
          items: [{ id: 7, status: 'success', cost_micros: 1500, request_id: 'req-7', tool_name: 'web.search' }],
          next_cursor: 'next',
        },
      },
    },
  })
  const tool = tools().get('tvendo_runs')

  const record = await tool.execute({ id: 7 }, EXEC)
  assert.equal(calls[0].url.pathname, '/v1/runs/7')
  assert.equal(record.record.id, 7)
  assert.match(render(tool, { id: 7 }, record), /#7 · success/)

  const listed = await tool.execute({ request_id: 'req-7', limit: 5 }, EXEC)
  assert.equal(calls[1].url.searchParams.get('request_id'), 'req-7')
  assert.equal(calls[1].url.searchParams.get('limit'), '5')
  assert.equal(listed.items.length, 1)
  assert.equal(listed.nextCursor, 'next')
  assert.match(render(tool, {}, listed), /1 条/)
})

test('account merges balance and budgets and repeats the spending rule', async (t) => {
  stubRoutes(t, {
    '/v1/balance': { body: { ok: true, data: { balance_micros: 25_000_000, currency: 'CNY' } } },
    '/v1/budgets': {
      body: {
        ok: true,
        data: {
          currency: 'CNY',
          call_enabled: true,
          call_limit_micros: 5_000_000,
          daily_enabled: true,
          daily_limit_micros: 50_000_000,
          spent_micros: 1_500_000,
          held_micros: 0,
          resets_at: '2026-01-01T00:00:00Z',
        },
      },
    },
  })
  const tool = tools().get('tvendo_account')
  const value = await tool.execute({}, EXEC)
  assert.equal(value.balanceMicros, 25_000_000)
  assert.equal(value.dailyLimitMicros, 50_000_000)
  const text = render(tool, {}, value)
  assert.match(text, /余额：25 元/)
  assert.match(text, /每日预算：50 元/)
  assert.match(text, /账户预算不等于本次任务的费用授权/)
})
