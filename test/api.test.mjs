/**
 * The HTTP client's contract with the platform: unwrap the envelope, carry the
 * request id, map failures to actionable facts, and never retry a charged call.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { TvendoApi, TvendoRequestError } from '../lib/api.js'

/** Install a fetch stub that records every call. */
function stubFetch(t, handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const call = { url: new URL(String(url)), init }
    calls.push(call)
    return handler(call)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

/** Build a JSON response with optional extra headers. */
function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const api = (overrides = {}) =>
  new TvendoApi({ server: 'https://tv.example.com', apiKey: 'test-key', timeoutMs: 1000, ...overrides })

test('info unwraps the data envelope and needs no key', async (t) => {
  const calls = stubFetch(t, () => json({ ok: true, data: { brand: 'Fake', api_version: 1 } }))
  const data = await api({ apiKey: '' }).info()
  assert.deepEqual(data, { brand: 'Fake', api_version: 1 })
  assert.equal(calls[0].url.pathname, '/v1/info')
  assert.equal(calls[0].init.headers.authorization, undefined)
})

test('an authenticated call sends the key and the currency header is folded into data', async (t) => {
  const calls = stubFetch(t, () => json({ ok: true, data: { items: [] } }, 200, { 'x-tvendo-currency': 'EUR' }))
  const data = await api().catalog({ query: 'x' })
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-key')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(data.currency, 'EUR')
})

test('a call without a key fails before touching the network', async (t) => {
  const calls = stubFetch(t, () => json({ ok: true, data: {} }))
  await assert.rejects(api({ apiKey: '' }).catalog({ query: 'x' }), (error) => {
    assert.ok(error instanceof TvendoRequestError)
    assert.equal(error.code, 'tvendo/missing-api-key')
    return true
  })
  assert.equal(calls.length, 0)
})

test('run carries a client request id and the cost ceiling, and returns it', async (t) => {
  const calls = stubFetch(t, () =>
    json({ ok: true, data: { id: 42, cost_micros: 1500, data: { answer: 1 } } }),
  )
  const result = await api().run({ toolRef: 'ref-1', parameters: { q: 'hi' }, maxCostMicros: 2000 })
  const [call] = calls
  assert.equal(call.url.pathname, '/v1/run')
  assert.equal(call.init.method, 'POST')
  const requestId = call.init.headers['x-request-id']
  assert.equal(call.init.headers['content-type'], 'application/json')
  assert.match(requestId, /^[0-9a-f-]{36}$/)
  assert.deepEqual(JSON.parse(call.init.body), {
    tool_ref: 'ref-1',
    parameters: { q: 'hi' },
    max_cost_micros: 2000,
  })
  assert.equal(result.request_id, requestId)
  assert.equal(result.cost_micros, 1500)
})

test('an omitted cost ceiling is not sent, so the account budget alone applies', async (t) => {
  const calls = stubFetch(t, () => json({ ok: true, data: { id: 1, cost_micros: 0, data: null } }))
  await api().run({ toolRef: 'ref-1', parameters: {} })
  assert.equal('max_cost_micros' in JSON.parse(calls[0].init.body), false)
})

test('a platform failure becomes a diagnostic with the facts needed to recover', async (t) => {
  stubFetch(t, () =>
    json(
      { ok: false, error: 'not enough balance', code: 'INSUFFICIENT_BALANCE', request_id: 'srv-req' },
      402,
      { 'x-request-id': 'srv-req' },
    ),
  )
  await assert.rejects(api().run({ toolRef: 'ref-1', parameters: {} }), (error) => {
    assert.ok(error instanceof TvendoRequestError)
    assert.equal(error.status, 402)
    assert.equal(error.code, 'INSUFFICIENT_BALANCE')
    assert.equal(error.requestId, 'srv-req')
    assert.equal(error.retryable, false)
    assert.match(error.message, /余额不足/)
    assert.match(error.message, /request_id=srv-req/)
    return true
  })
})

test('an unknown settlement is reported as such, with the run id', async (t) => {
  stubFetch(t, () =>
    json({ ok: false, error: 'settlement not confirmed', code: 'SETTLEMENT_UNKNOWN', id: 77, settlement: 'unknown' }, 503),
  )
  await assert.rejects(api().run({ toolRef: 'ref-1', parameters: {} }), (error) => {
    assert.equal(error.runId, 77)
    assert.equal(error.settlement, 'unknown')
    assert.match(error.message, /不要自动重试/)
    return true
  })
})

test('only a 429 is marked retryable', async (t) => {
  stubFetch(t, () => json({ ok: false, error: 'slow down' }, 429))
  await assert.rejects(api().catalog({ query: 'x' }), (error) => {
    assert.equal(error.retryable, true)
    return true
  })
})

test('a non-JSON success body is a bad response, not a silent null', async (t) => {
  stubFetch(t, () => new Response('<html>proxy error</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  await assert.rejects(api().info(), (error) => {
    assert.equal(error.code, 'tvendo/bad-response')
    assert.match(error.message, /无法解析/)
    return true
  })
})

test('a timeout names the address and refuses to suggest a retry', async (t) => {
  stubFetch(t, (call) => new Promise((_resolve, reject) => {
    call.init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const short = new TvendoApi({ server: 'https://tv.example.com', apiKey: 'k', timeoutMs: 20 })
  await assert.rejects(short.run({ toolRef: 'ref-1', parameters: {} }), (error) => {
    assert.equal(error.code, 'tvendo/timeout')
    assert.match(error.message, /request_id/)
    return true
  })
})
