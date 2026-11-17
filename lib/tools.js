/**
 * The model-facing tools: search the catalog, inspect one tool, run it, and read
 * the account.
 *
 * Every definition is a plain {@link ToolDefinition} object with raw JSON Schema.
 * That is deliberate: a bundle installed into a profile resolves only its own
 * dependencies, so importing a Host-side helper package would either duplicate it
 * or fail to resolve. The schemas below stay inside the subset the tool registry
 * enforces (type/oneOf/properties/required/additionalProperties/items/enum/const
 * plus annotations), and each `execute` validates its own arguments, because the
 * registry hands the tool the model's parsed arguments as-is.
 * @module dsh-tvendo/tools
 */
import { TvendoApi } from './api.js'
import { resolveConnection } from './connection.js'
import { clip, formatPrice, formatYuan, preview, summarize, textBlock } from './format.js'

/** Yuan unit used in every price description. */
const MICROS_NOTE = '微元，1000000 = 1 元'

/** An unconstrained lossless-JSON schema node (annotation-only in the registry subset). */
const JSON_VALUE = {}

/**
 * One search hit as the model sees it: a bounded description, a price, and the
 * opaque reference it must pass back to inspect or run the tool.
 */
const catalogItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    toolRef: { type: 'string', description: 'Opaque reference for tvendo_show / tvendo_run' },
    name: { type: 'string' },
    provider: { type: 'string' },
    description: { type: 'string', description: 'Bounded excerpt of the platform description' },
    descriptionTruncated: { type: 'boolean' },
    priceMicros: { type: 'integer' },
    priceCny: { type: 'string' },
    currency: { type: 'string' },
    schemaAvailable: { type: 'boolean' },
    upstreamType: JSON_VALUE,
  },
  required: [
    'toolRef',
    'name',
    'provider',
    'description',
    'descriptionTruncated',
    'priceMicros',
    'priceCny',
    'currency',
    'schemaAvailable',
    'upstreamType',
  ],
}

/**
 * Read a required, non-empty string argument.
 * @param args - the parsed arguments.
 * @param key - the argument name.
 * @returns the trimmed value.
 */
function requireString(args, key) {
  const value = args?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} 必须是非空字符串`)
  }
  return value.trim()
}

/**
 * Read an optional integer argument within a range.
 * @param args - the parsed arguments.
 * @param key - the argument name.
 * @param bounds - inclusive fallback bounds.
 * @returns the value, or undefined when omitted.
 */
function optionalInteger(args, key, bounds) {
  const value = args?.[key]
  if (value === undefined || value === null) return undefined
  if (!Number.isInteger(value)) throw new Error(`${key} 必须是整数`)
  if (bounds !== undefined && (value < bounds.min || value > bounds.max)) {
    throw new Error(`${key} 必须在 ${bounds.min}–${bounds.max} 之间（当前 ${value}）`)
  }
  return value
}

/**
 * Read an optional string argument.
 * @param args - the parsed arguments.
 * @param key - the argument name.
 * @returns the trimmed value, or undefined when omitted or empty.
 */
function optionalString(args, key) {
  const value = args?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串`)
  return value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Project one catalog entry onto the bounded search-hit shape.
 * @param item - one entry of `/v1/catalog` `data.items`.
 * @returns the model-facing hit.
 */
function toCatalogItem(item) {
  const description = typeof item?.description === 'string' ? item.description : ''
  const bounded = summarize(description, 280)
  return {
    toolRef: String(item?.tool_ref ?? ''),
    name: String(item?.name ?? ''),
    provider: String(item?.provider ?? ''),
    description: bounded,
    descriptionTruncated: bounded.length < description.replace(/\s+/g, ' ').trim().length,
    priceMicros: Number.parseInt(String(item?.price_micros ?? 0), 10) || 0,
    priceCny: formatYuan(item?.price_micros ?? 0),
    currency: String(item?.currency ?? 'CNY'),
    schemaAvailable: item?.schema_available === true,
    upstreamType: item?.upstream_type ?? null,
  }
}

/**
 * Render the search result as a compact numbered list.
 * @param args - the validated arguments.
 * @param value - the canonical search value.
 * @returns the model-facing content.
 */
function renderSearch(args, value) {
  const lines = []
  const heading = args.query && args.query.length > 0 ? `「${args.query}」` : '工具目录'
  const stats = [`${value.items.length} 个候选`, `模式 ${value.mode}`]
  if (value.total !== null) stats.push(`匹配 ${value.total}`)
  if (value.degraded) stats.push('检索已降级')
  lines.push(`Tvendo 搜索 ${heading}：${stats.join(' · ')}`)
  lines.push('')

  if (value.items.length === 0) {
    lines.push('没有匹配的工具。可换更具体的能力词重试，或用空 query 分页浏览目录。')
  }
  value.items.forEach((item, index) => {
    const flags = item.schemaAvailable ? '有参数 Schema' : '无参数 Schema（示例不代表完整定义）'
    lines.push(`${index + 1}. ${item.name} — ${item.provider} · ${formatPrice(item.priceMicros)} · ${flags}`)
    lines.push(`   ref: ${item.toolRef}`)
    if (item.description.length > 0) lines.push(`   ${item.description}`)
  })

  if (value.nextCursor !== null && value.nextCursor !== '') {
    lines.push('')
    lines.push(`下一页 cursor：${String(value.nextCursor)}`)
  }
  if (Array.isArray(value.suggestedTools) && value.suggestedTools.length > 0) {
    lines.push('')
    lines.push('平台兜底推荐（未匹配查询，仅作参考）：')
    for (const suggestion of value.suggestedTools.slice(0, 5)) {
      const name = suggestion?.name ?? suggestion?.tool_ref ?? '未命名'
      lines.push(`- ${name}`)
    }
  }
  lines.push('')
  lines.push('候选不代表具备所需能力：先 tvendo_show 查看准确参数与价格，再决定是否 tvendo_run。')
  return textBlock(lines.join('\n'))
}

/**
 * Render one tool detail with its schema and example.
 * @param args - the validated arguments.
 * @param value - the canonical detail value.
 * @returns the model-facing content.
 */
function renderTool(args, value) {
  const lines = []
  lines.push(`${value.name} — ${value.provider}`)
  lines.push(`价格：${formatPrice(value.priceMicros)}（${value.currency}）`)
  if (value.upstreamType !== null) lines.push(`上游类型：${String(value.upstreamType)}`)
  lines.push(`参数 Schema：${value.schemaAvailable ? '已提供' : '未提供（不能把示例当作完整定义）'}`)
  if (value.description.length > 0) {
    lines.push('')
    lines.push(clip(value.description, 1200))
  }
  lines.push('')
  lines.push('输入 Schema：')
  lines.push(typeof value.inputSchema === 'string' ? clip(value.inputSchema, 6000) : preview(value.inputSchema, 6000))
  if (value.inputExample !== null) {
    lines.push('')
    lines.push('输入示例：')
    lines.push(typeof value.inputExample === 'string' ? clip(value.inputExample, 2000) : preview(value.inputExample, 2000))
  }
  lines.push('')
  lines.push(`调用方式：tvendo_run(tool_ref="${args.tool_ref}", parameters={...}, max_cost_micros=${value.priceMicros})`)
  return textBlock(lines.join('\n'))
}

/**
 * Render one completed run, with the result body bounded.
 * @param _args - the validated arguments.
 * @param value - the canonical run value.
 * @returns the model-facing content.
 */
function renderRun(_args, value) {
  const lines = []
  lines.push(`Tvendo 调用成功（run #${value.runId} · request_id=${value.requestId}）`)
  lines.push(`费用：${formatYuan(value.costMicros)} 元（${value.currency}）`)
  lines.push('')
  lines.push('结果：')
  lines.push(typeof value.data === 'string' ? clip(value.data, 14_000) : preview(value.data, 14_000))
  return textBlock(lines.join('\n'))
}

/**
 * Format one call record defensively: the platform owns this shape, and a record
 * missing a field must not hide the rest of the line.
 * @param record - one run record.
 * @returns one line of text.
 */
function runLine(record) {
  if (record === null || typeof record !== 'object') return `- ${String(record)}`
  const parts = [`#${record.id ?? '?'}`, String(record.status ?? '?')]
  if (record.cost_micros !== undefined) parts.push(`${formatYuan(record.cost_micros)} 元`)
  const target = [record.tool_name, record.endpoint].filter((part) => typeof part === 'string' && part.length > 0).join('.')
  if (target.length > 0) parts.push(target)
  if (record.duration_ms !== undefined) parts.push(`${record.duration_ms}ms`)
  if (typeof record.created_at === 'string') parts.push(record.created_at)
  if (typeof record.request_id === 'string' && record.request_id.length > 0) parts.push(`request_id=${record.request_id}`)
  const error = [record.error_code, record.error_message].filter((part) => typeof part === 'string' && part.length > 0).join(': ')
  if (error.length > 0) parts.push(error)
  return `- ${parts.join(' · ')}`
}

/**
 * Render the account snapshot.
 * @param _args - the validated arguments.
 * @param value - the canonical account value.
 * @returns the model-facing content.
 */
function renderAccount(_args, value) {
  const lines = ['Tvendo 账户']
  lines.push(`余额：${formatYuan(value.balanceMicros)} 元（${value.currency}）`)
  const callLimit = value.callLimitMicros === null
    ? '未设置'
    : `${formatYuan(value.callLimitMicros)} 元（${value.callEnabled ? '启用' : '未启用'}）`
  const dailyLimit = value.dailyLimitMicros === null
    ? '未设置'
    : `${formatYuan(value.dailyLimitMicros)} 元（${value.dailyEnabled ? '启用' : '未启用'}）`
  lines.push(`单次上限：${callLimit}`)
  lines.push(`每日预算：${dailyLimit}`)
  if (value.spentMicros !== null) lines.push(`今日已用：${formatYuan(value.spentMicros)} 元`)
  if (value.heldMicros !== null) lines.push(`预留中：${formatYuan(value.heldMicros)} 元`)
  if (value.resetsAt !== null) lines.push(`预算重置：${String(value.resetsAt)}（UTC）`)
  lines.push('')
  lines.push('账户预算不等于本次任务的费用授权：调用前仍需用户明确同意。')
  return textBlock(lines.join('\n'))
}

/**
 * Build every tool against one live configuration.
 * @param options - the plugin runtime inputs.
 * @param options.config - the live plugin configuration.
 * @param options.defaults - resolved numeric defaults.
 * @returns the registry-ready tool definitions.
 */
export function createTools({ config, defaults }) {
  /**
   * Resolve the connection for this call. Cheap enough to repeat: it only reads
   * a small local file when neither the settings nor the environment answered.
   * @returns the resolved connection.
   */
  const connection = () => resolveConnection(config, process.env)

  /**
   * Build a client for one call.
   * @returns a client bound to the resolved connection.
   */
  const client = () => {
    const resolved = connection()
    return new TvendoApi({ server: resolved.server, apiKey: resolved.apiKey, timeoutMs: defaults.timeoutMs })
  }

  return [
    {
      name: 'tvendo_info',
      description:
        "Read a Tvendo deployment's public metadata (brand, version, API version, currency, CLI/skill availability) without an API key. Use it to check that the configured server address is the deployment the user means.",
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            server: { type: 'string' },
            brand: { type: 'string' },
            version: { type: 'string' },
            apiVersion: JSON_VALUE,
            currency: { type: 'string' },
            microsPerUnit: JSON_VALUE,
            cliAvailable: { type: 'boolean' },
            cliVersion: JSON_VALUE,
            skillUrl: JSON_VALUE,
            keyConfigured: { type: 'boolean' },
          },
          required: [
            'server',
            'brand',
            'version',
            'apiVersion',
            'currency',
            'microsPerUnit',
            'cliAvailable',
            'cliVersion',
            'skillUrl',
            'keyConfigured',
          ],
        },
        render: (_args, value) => {
          const lines = [
            `${value.brand} ${value.version} · API v${String(value.apiVersion)} · ${value.currency}`,
            `服务地址：${value.server}`,
            `CLI：${value.cliAvailable ? `可用（${String(value.cliVersion ?? '版本未公布')}）` : '本部署未提供'}`,
            `Skill 说明：${value.skillUrl ?? '未提供'}`,
            `平台密钥：${value.keyConfigured ? '已配置' : '未配置（调用工具前需在插件设置中填写）'}`,
          ]
          if (value.microsPerUnit !== null) lines.push(`金额单位：1 ${value.currency} = ${value.microsPerUnit} 微元`)
          return textBlock(lines.join('\n'))
        },
      },
      timeoutMs: 20_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: '读取 Tvendo 服务信息', kind: 'read' }),
      async execute(_args, exec) {
        const api = client()
        const info = await api.info(exec.signal)
        return {
          server: api.server,
          brand: String(info?.brand ?? 'Tvendo'),
          version: String(info?.version ?? 'unknown'),
          apiVersion: info?.api_version ?? null,
          currency: String(info?.currency ?? 'CNY'),
          microsPerUnit: info?.micros_per_unit ?? null,
          cliAvailable: info?.cli_available === true,
          cliVersion: info?.cli_version ?? null,
          skillUrl: info?.skill_url ?? null,
          keyConfigured: api.authenticated,
        }
      },
    },

    {
      name: 'tvendo_search',
      description:
        'Search the Tvendo tool marketplace for callable external tools (web search, maps, weather, data APIs, remote MCP tools) priced per call in CNY. Returns candidate `tool_ref` values with name, provider, description and price. Candidates are not proof of capability: call tvendo_show for the exact input schema and price before running anything. Searching is free.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'The concrete need or capability keyword, e.g. 网页搜索, 地理编码, weather. Pass an empty string to page through the whole catalog.',
          },
          limit: { type: 'integer', description: 'Page size, 1-50 (default 10).' },
          cursor: { type: 'string', description: 'Opaque next_cursor from a previous tvendo_search page.' },
        },
        required: ['query'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            mode: { type: 'string' },
            degraded: { type: 'boolean' },
            total: JSON_VALUE,
            items: { type: 'array', items: catalogItemSchema },
            nextCursor: JSON_VALUE,
            suggestedTools: JSON_VALUE,
          },
          required: ['query', 'mode', 'degraded', 'total', 'items', 'nextCursor', 'suggestedTools'],
        },
        render: renderSearch,
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      presentCall: (args) => ({ card: 'generic', title: '搜索 Tvendo 工具', kind: 'search', rawInput: args.query }),
      async execute(args, exec) {
        const query = typeof args?.query === 'string' ? args.query : ''
        const limit = optionalInteger(args, 'limit', { min: 1, max: 50 }) ?? 10
        const cursor = optionalString(args, 'cursor')
        const data = await client().catalog({ query, limit, cursor, signal: exec.signal })
        return {
          query,
          mode: String(data?.search?.mode ?? 'unknown'),
          degraded: data?.search?.degraded === true,
          total: data?.search?.total ?? null,
          items: (Array.isArray(data?.items) ? data.items : []).map(toCatalogItem),
          nextCursor: data?.next_cursor ?? null,
          suggestedTools: Array.isArray(data?.suggested_tools) ? data.suggested_tools : [],
        }
      },
    },

    {
      name: 'tvendo_show',
      description:
        "Read one Tvendo tool's input schema, example input and per-call price before calling it. Use the `tool_ref` returned by tvendo_search; never construct or guess a reference. A missing schema means the example is not a complete parameter definition.",
      parameters: {
        type: 'object',
        properties: {
          tool_ref: { type: 'string', description: 'Exact opaque `tool_ref` returned by tvendo_search.' },
        },
        required: ['tool_ref'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            toolRef: { type: 'string' },
            name: { type: 'string' },
            provider: { type: 'string' },
            description: { type: 'string' },
            priceMicros: { type: 'integer' },
            currency: { type: 'string' },
            upstreamType: JSON_VALUE,
            schemaAvailable: { type: 'boolean' },
            inputSchema: JSON_VALUE,
            inputExample: JSON_VALUE,
          },
          required: [
            'toolRef',
            'name',
            'provider',
            'description',
            'priceMicros',
            'currency',
            'upstreamType',
            'schemaAvailable',
            'inputSchema',
            'inputExample',
          ],
        },
        render: renderTool,
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: '查看 Tvendo 工具详情', kind: 'read' }),
      async execute(args, exec) {
        const toolRef = requireString(args, 'tool_ref')
        const data = await client().tool(toolRef, exec.signal)
        return {
          toolRef: String(data?.tool_ref ?? toolRef),
          name: String(data?.name ?? ''),
          provider: String(data?.provider ?? ''),
          description: typeof data?.description === 'string' ? data.description : '',
          priceMicros: Number.parseInt(String(data?.price_micros ?? 0), 10) || 0,
          currency: String(data?.currency ?? 'CNY'),
          upstreamType: data?.upstream_type ?? null,
          schemaAvailable: data?.schema_available === true || data?.input_schema !== undefined,
          inputSchema: data?.input_schema ?? null,
          inputExample: data?.input_example ?? null,
        }
      },
    },

    {
      name: 'tvendo_run',
      description:
        "Run one Tvendo tool synchronously and return its result. Call tvendo_show first and pass arguments matching its input schema. Pass `max_cost_micros` as the user-authorized ceiling: the platform refuses the call before charging when the price is higher. Never retry a charged call automatically when the outcome is unknown — use tvendo_runs with the request id instead.",
      parameters: {
        type: 'object',
        properties: {
          tool_ref: { type: 'string', description: 'Exact opaque `tool_ref` returned by tvendo_search.' },
          parameters: {
            type: 'object',
            additionalProperties: true,
            description: 'Arguments object matching the tool input schema; defaults to {}.',
          },
          max_cost_micros: {
            type: 'integer',
            description: `Per-call price ceiling in ${MICROS_NOTE}. Omit to use the plugin default; 0 means no extra ceiling (the account budget still applies).`,
          },
        },
        required: ['tool_ref'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            runId: JSON_VALUE,
            requestId: { type: 'string' },
            costMicros: { type: 'integer' },
            currency: { type: 'string' },
            status: { type: 'string' },
            data: JSON_VALUE,
          },
          required: ['runId', 'requestId', 'costMicros', 'currency', 'status', 'data'],
        },
        render: renderRun,
      },
      timeoutMs: Math.max(defaults.timeoutMs, 60_000),
      isConcurrencySafe: () => false,
      presentCall: (args) => ({
        card: 'generic',
        title: '调用 Tvendo 工具',
        kind: 'execute',
        rawInput: { tool_ref: args?.tool_ref ?? '', parameters: args?.parameters ?? {} },
      }),
      async execute(args, exec) {
        const toolRef = requireString(args, 'tool_ref')
        const parameters = args?.parameters ?? {}
        if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
          throw new Error('parameters 必须是 JSON 对象，例如 {"query": "AI agents"}')
        }
        const requested = args?.max_cost_micros === undefined ? defaults.maxCostMicros : args.max_cost_micros
        if (!Number.isInteger(requested) || requested < 0) {
          throw new Error(`max_cost_micros 必须是非负整数（${MICROS_NOTE}）`)
        }
        const data = await client().run({
          toolRef,
          parameters,
          maxCostMicros: requested === 0 ? undefined : requested,
          signal: exec.signal,
        })
        return {
          runId: data?.id ?? null,
          requestId: String(data?.request_id ?? ''),
          costMicros: Number.parseInt(String(data?.cost_micros ?? 0), 10) || 0,
          currency: String(data?.currency ?? 'CNY'),
          status: String(data?.status ?? 'success'),
          data: data?.data ?? null,
        }
      },
    },

    {
      name: 'tvendo_runs',
      description:
        "Read this account's Tvendo call records. Use `request_id` to reconcile a call whose response was lost, `id` for one record, or neither to list recent calls. The platform keeps settlement records only; it cannot return the original result body, so this tool is for accounting and diagnosis, never for replaying a result.",
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'Read one call record by numeric run id.' },
          request_id: {
            type: 'string',
            description: 'Find the record created with this X-Request-ID (the id printed with a lost call).',
          },
          limit: { type: 'integer', description: 'Page size, 1-50 (default 20).' },
          cursor: { type: 'string', description: 'Opaque next_cursor from a previous list.' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            record: JSON_VALUE,
            items: JSON_VALUE,
            nextCursor: JSON_VALUE,
          },
          required: ['record', 'items', 'nextCursor'],
        },
        render: (_args, value) => {
          const lines = []
          const items = Array.isArray(value.items) ? value.items : []
          if (value.record !== null) {
            lines.push('Tvendo 调用记录')
            lines.push(runLine(value.record))
          } else if (items.length === 0) {
            lines.push('没有匹配的调用记录。')
          } else {
            lines.push(`Tvendo 调用记录（${items.length} 条）`)
            for (const item of items) lines.push(runLine(item))
          }
          if (value.nextCursor !== null && value.nextCursor !== '') {
            lines.push('')
            lines.push(`下一页 cursor：${String(value.nextCursor)}`)
          }
          return textBlock(lines.join('\n'))
        },
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: '查询 Tvendo 调用记录', kind: 'read' }),
      async execute(args, exec) {
        const api = client()
        const id = optionalInteger(args, 'id')
        if (id !== undefined) {
          const record = await api.runRecord(id, exec.signal)
          return { record: record ?? null, items: [], nextCursor: null }
        }
        const limit = optionalInteger(args, 'limit', { min: 1, max: 50 }) ?? 20
        const requestId = optionalString(args, 'request_id')
        const cursor = optionalString(args, 'cursor')
        const data = await api.runs({ limit, cursor, requestId, signal: exec.signal })
        return {
          record: null,
          items: Array.isArray(data?.items) ? data.items : [],
          nextCursor: data?.next_cursor ?? null,
        }
      },
    },

    {
      name: 'tvendo_account',
      description:
        "Read this account's Tvendo balance, per-call limit, daily budget and the UTC reset time. The balance and budget are platform facts, not permission to spend: obtain the user's explicit spending authorization for the task and stay inside it.",
      parameters: { type: 'object', properties: {} },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            balanceMicros: { type: 'integer' },
            currency: { type: 'string' },
            callEnabled: { type: 'boolean' },
            callLimitMicros: JSON_VALUE,
            dailyEnabled: { type: 'boolean' },
            dailyLimitMicros: JSON_VALUE,
            spentMicros: JSON_VALUE,
            heldMicros: JSON_VALUE,
            resetsAt: JSON_VALUE,
          },
          required: [
            'balanceMicros',
            'currency',
            'callEnabled',
            'callLimitMicros',
            'dailyEnabled',
            'dailyLimitMicros',
            'spentMicros',
            'heldMicros',
            'resetsAt',
          ],
        },
        render: renderAccount,
      },
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      presentCall: () => ({ card: 'generic', title: '查询 Tvendo 账户', kind: 'read' }),
      async execute(_args, exec) {
        const api = client()
        const [balance, budgets] = await Promise.all([api.balance(exec.signal), api.budgets(exec.signal)])
        return {
          balanceMicros: Number.parseInt(String(balance?.balance_micros ?? 0), 10) || 0,
          currency: String(balance?.currency ?? budgets?.currency ?? 'CNY'),
          callEnabled: budgets?.call_enabled === true,
          callLimitMicros: budgets?.call_limit_micros ?? null,
          dailyEnabled: budgets?.daily_enabled === true,
          dailyLimitMicros: budgets?.daily_limit_micros ?? null,
          spentMicros: budgets?.spent_micros ?? null,
          heldMicros: budgets?.held_micros ?? null,
          resetsAt: budgets?.resets_at ?? null,
        }
      },
    },
  ]
}
