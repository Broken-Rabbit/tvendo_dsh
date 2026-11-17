/**
 * A small, dependency-free client for the Tvendo agent API (`/v1/...`).
 *
 * The platform is the source of truth for catalog contents, prices and
 * settlement, so this client deliberately does three things and no more:
 * describe a failure precisely enough for the model to act on it, never retry a
 * possibly-charged call, and never log the platform key.
 * @module dsh-tvendo/api
 */
import { randomUUID } from 'node:crypto'

/** The one currency the platform bills in today. */
const CURRENCY_HEADER = 'x-tvendo-currency'

/** Concise, actionable guidance for the status codes the API documents. */
const STATUS_GUIDANCE = {
  400: '请求参数或服务端配置有误；未开始的调用不会计费，按工具 Schema 修正后重试',
  401: `API Key 无效或已撤销；在「设置 → 插件 → Tvendo」中重新填写，或设置环境变量 TVENDO_API_KEY`,
  402: '余额不足；到 Tvendo 控制台钱包充值后再试',
  403: '账户预算或本次费用上限拦截；未开始的调用不计费',
  404: '工具或调用记录不存在；检查 tool_ref 是否来自本次搜索',
  429: '请求频率超限；稍后再试',
  502: '上游执行失败；仅当 settlement=refunded 时预留费用才已退回',
  503: '结算状态未知；保留 request_id 与 run_id，先查询调用记录，不要自动重试',
}

/** Guidance that is more precise than the status code alone. */
const CODE_GUIDANCE = {
  INSUFFICIENT_BALANCE: '余额不足；到 Tvendo 控制台钱包充值后再试',
  BUDGET_EXCEEDED: '账户预算拦截；未开始的调用不计费，检查控制台预算设置或等待 UTC 重置',
  COST_LIMIT_EXCEEDED: '实际售价高于本次 max_cost_micros，调用未开始也未扣费；提高上限需要用户授权，不要自行放宽',
  SETTLEMENT_UNKNOWN: '结算状态未知；保留 request_id 与 run_id，先查询调用记录，不要自动重试',
  UPSTREAM_FAILED: '上游执行失败；仅当 settlement=refunded 时预留费用才已退回',
}

/**
 * One failed platform exchange, carrying the facts the model needs to decide
 * what to do next instead of guessing from a message.
 */
export class TvendoRequestError extends Error {
  /**
   * @param message - the user-facing diagnostic.
   * @param facts - structured failure metadata.
   */
  constructor(message, facts = {}) {
    super(message)
    this.name = 'TvendoRequestError'
    this.code = facts.code ?? 'tvendo/request-failed'
    this.status = facts.status ?? 0
    this.requestId = facts.requestId
    this.runId = facts.runId
    this.settlement = facts.settlement
    this.retryable = facts.retryable ?? false
  }
}

/**
 * Turn one non-2xx response body into a message a model can act on.
 * @param facts - the response facts.
 * @returns the diagnostic text.
 */
function failureMessage(facts) {
  const { status, payload, requestId, runId, settlement } = facts
  const serverText = typeof payload?.error === 'string' ? payload.error.trim() : ''
  const serverCode = typeof payload?.code === 'string' ? payload.code : ''
  const guidance = CODE_GUIDANCE[serverCode] ?? STATUS_GUIDANCE[status] ?? '请求失败'
  const head = serverCode.length > 0 ? `HTTP ${status} / ${serverCode}` : `HTTP ${status}`
  const parts = [`Tvendo 请求失败（${head}）：${guidance}`]
  if (serverText.length > 0) parts.push(`服务端说明：${serverText.slice(0, 400)}`)
  if (settlement !== undefined) parts.push(`settlement=${settlement}`)
  if (runId !== undefined) parts.push(`run_id=${runId}`)
  if (requestId !== undefined) parts.push(`request_id=${requestId}`)
  return parts.join('\n')
}

/** The Tvendo agent API. */
export class TvendoApi {
  #server
  #apiKey
  #timeoutMs
  #fetch

  /**
   * @param options - resolved connection facts.
   * @param options.server - base URL, already normalized.
   * @param options.apiKey - platform key; empty means "unauthenticated".
   * @param options.timeoutMs - per-request timeout.
   * @param options.fetchImpl - fetch implementation, injectable for tests.
   */
  constructor({ server, apiKey, timeoutMs = 120_000, fetchImpl = globalThis.fetch }) {
    this.#server = server
    this.#apiKey = apiKey
    this.#timeoutMs = timeoutMs
    this.#fetch = fetchImpl
  }

  /** The configured base URL. */
  get server() {
    return this.#server
  }

  /** Whether a platform key is configured. */
  get authenticated() {
    return this.#apiKey.length > 0
  }

  /**
   * Public deployment metadata; needs no key.
   * @param signal - caller cancellation.
   * @returns the `data` object of `/v1/info`.
   */
  info(signal) {
    return this.#send('/v1/info', { signal, auth: false })
  }

  /**
   * Search the tool catalog.
   * @param query - the need or keyword; empty lists the directory.
   * @param limit - page size, 1–50.
   * @param cursor - opaque next-page cursor from a previous search.
   * @param signal - caller cancellation.
   * @returns `items`, `next_cursor`, `search` and `suggested_tools`.
   */
  catalog({ query, limit, cursor, signal } = {}) {
    return this.#send('/v1/catalog', { query: { q: query, limit, cursor }, signal })
  }

  /**
   * Read one tool's schema, example and price.
   * @param toolRef - opaque reference returned by a search.
   * @param signal - caller cancellation.
   * @returns the tool detail object.
   */
  tool(toolRef, signal) {
    return this.#send(`/v1/catalog/${encodeURIComponent(toolRef)}`, { signal })
  }

  /**
   * Run one tool synchronously. Never retried: a lost response may still have
   * been executed and charged.
   * @param options - the call to make.
   * @param options.toolRef - opaque reference returned by a search.
   * @param options.parameters - arguments matching the tool's schema.
   * @param options.maxCostMicros - optional per-call price ceiling.
   * @param options.signal - caller cancellation.
   * @returns the run record fields returned by the platform.
   */
  async run({ toolRef, parameters, maxCostMicros, signal }) {
    const requestId = randomUUID()
    const body = { tool_ref: toolRef, parameters: parameters ?? {} }
    if (Number.isInteger(maxCostMicros)) body.max_cost_micros = maxCostMicros
    const data = await this.#send('/v1/run', {
      method: 'POST',
      body,
      signal,
      requestId,
      headers: { 'x-request-id': requestId },
    })
    return { ...data, request_id: data?.request_id ?? requestId }
  }

  /**
   * List this account's call records, optionally filtered by request id.
   * @param options - the listing parameters.
   * @param options.limit - page size, 1–50.
   * @param options.cursor - opaque next-page cursor.
   * @param options.requestId - the client-generated id of a lost call.
   * @param options.signal - caller cancellation.
   * @returns `items` and `next_cursor`.
   */
  runs({ limit, cursor, requestId, signal } = {}) {
    return this.#send('/v1/runs', {
      query: { limit, cursor, request_id: requestId },
      signal,
    })
  }

  /**
   * Read one call record of this account.
   * @param id - the numeric run id.
   * @param signal - caller cancellation.
   * @returns the run record.
   */
  runRecord(id, signal) {
    return this.#send(`/v1/runs/${encodeURIComponent(String(id))}`, { signal })
  }

  /**
   * Read the account balance.
   * @param signal - caller cancellation.
   * @returns the balance object.
   */
  balance(signal) {
    return this.#send('/v1/balance', { signal })
  }

  /**
   * Read the account budgets and their UTC reset time.
   * @param signal - caller cancellation.
   * @returns the budgets object.
   */
  budgets(signal) {
    return this.#send('/v1/budgets', { signal })
  }

  /**
   * Perform one request and unwrap the platform envelope.
   * @param path - path below the base URL, already encoded.
   * @param options - request options.
   * @returns the `data` payload.
   */
  async #send(path, options = {}) {
    if (!this.authenticated && options.auth !== false) {
      throw new TvendoRequestError(
        `未配置 Tvendo API Key：在「设置 → 插件 → Tvendo」中填写，或设置环境变量 TVENDO_API_KEY。服务地址：${this.#server}`,
        { code: 'tvendo/missing-api-key' },
      )
    }

    const headers = { accept: 'application/json', ...options.headers }
    if (this.#apiKey.length > 0) headers.authorization = `Bearer ${this.#apiKey}`
    if (options.body !== undefined) headers['content-type'] = 'application/json'

    const url = new URL(`${this.#server}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }

    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

    let response
    try {
      response = await this.#fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
        redirect: 'error',
      })
    } catch (error) {
      if (timeout.aborted) {
        throw new TvendoRequestError(
          `Tvendo 请求超时（${Math.round(this.#timeoutMs / 1000)} 秒）：${this.#server}${path}\n若这是一次收费调用，先用 request_id 查询调用记录，不要自动重试。`,
          { code: 'tvendo/timeout', requestId: options.requestId, retryable: false },
        )
      }
      if (options.signal?.aborted) {
        throw new TvendoRequestError('Tvendo 请求已取消', { code: 'tvendo/aborted' })
      }
      const cause = error instanceof Error ? error.message : String(error)
      throw new TvendoRequestError(`无法连接 Tvendo 服务 ${this.#server}：${cause}`, {
        code: 'tvendo/unreachable',
      })
    }

    const headerRequestId = response.headers.get('x-request-id') ?? undefined
    const requestId = headerRequestId ?? options.requestId
    const currency = response.headers.get(CURRENCY_HEADER) ?? undefined

    const text = await response.text()
    let payload
    try {
      payload = text.length === 0 ? undefined : JSON.parse(text)
    } catch {
      payload = undefined
    }

    if (!response.ok) {
      const runId = payload?.id ?? undefined
      throw new TvendoRequestError(failureMessage({
        status: response.status,
        payload,
        requestId,
        runId,
        settlement: payload?.settlement,
      }), {
        code: typeof payload?.code === 'string' ? payload.code : 'tvendo/request-failed',
        status: response.status,
        requestId,
        runId,
        settlement: payload?.settlement,
        retryable: response.status === 429,
      })
    }

    if (payload === undefined) {
      throw new TvendoRequestError(
        `Tvendo 返回了无法解析的响应（HTTP ${response.status}）：${text.slice(0, 200)}`,
        { code: 'tvendo/bad-response', status: response.status, requestId },
      )
    }

    if (typeof payload.ok === 'boolean') {
      if (payload.ok && payload.data !== undefined) {
        const data = payload.data
        if (currency === undefined || typeof data !== 'object' || data === null) return data
        return data.currency === undefined ? { ...data, currency } : data
      }
      throw new TvendoRequestError(failureMessage({
        status: response.status,
        payload,
        requestId,
        runId: payload.id,
        settlement: payload.settlement,
      }), {
        code: typeof payload.code === 'string' ? payload.code : 'tvendo/request-failed',
        status: response.status,
        requestId,
        runId: payload.id,
        settlement: payload.settlement,
      })
    }

    return payload
  }
}
