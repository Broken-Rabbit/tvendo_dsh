/**
 * Read-only check against a real Tvendo deployment.
 *
 * It exercises exactly the calls that cost nothing: `/v1/info`, `/v1/balance`,
 * `/v1/budgets` and one catalog search. It never calls `/v1/run`, so running it
 * cannot spend money; the platform key is read from the environment and never
 * printed.
 *
 *   TVENDO_SERVER=https://t.zhitoken.com TVENDO_API_KEY=tv_live_... npm run check:live
 *
 * Without TVENDO_API_KEY only the public `/v1/info` check runs.
 */
import { TvendoApi } from '../lib/api.js'
import { describeSource, resolveConnection } from '../lib/connection.js'

const connection = resolveConnection({ server: process.env.TVENDO_SERVER, apiKey: process.env.TVENDO_API_KEY })
const api = new TvendoApi({ server: connection.server, apiKey: connection.apiKey, timeoutMs: 30_000 })

console.log(`服务地址：${api.server}（来源：${describeSource(connection)}）`)
console.log(`平台密钥：${api.authenticated ? '已配置' : '未配置，只做公开检查'}`)

const info = await api.info()
console.log(`\n[info] ${info.brand} ${info.version} · API v${info.api_version} · ${info.currency}`)
console.log(`       CLI：${info.cli_available ? `可用（${info.cli_version ?? '版本未公布'}）` : '本部署未提供'}`)
console.log(`       Skill：${info.skill_url ?? '未提供'}`)

if (api.authenticated) {
  const [balance, budgets] = await Promise.all([api.balance(), api.budgets()])
  console.log(`\n[balance] ${(balance.balance_micros ?? 0) / 1_000_000} ${balance.currency ?? info.currency}`)
  console.log(`[budgets] 单次上限=${budgets.call_limit_micros ?? '未设置'} 每日预算=${budgets.daily_limit_micros ?? '未设置'} 重置=${budgets.resets_at ?? '未提供'}`)

  const catalog = await api.catalog({ query: '网页搜索', limit: 3 })
  const items = Array.isArray(catalog.items) ? catalog.items : []
  console.log(`\n[catalog] 「网页搜索」命中 ${items.length} 个候选，检索模式 ${catalog.search?.mode ?? 'unknown'}`)
  for (const item of items) {
    console.log(`  - ${item.name} · ${item.provider} · ${(item.price_micros ?? 0) / 1_000_000} 元/次 · ${item.tool_ref}`)
  }
  console.log('\n以上全部是免费接口，未调用 /v1/run，没有产生费用。')
}

console.log('\ncheck:live 通过。')
