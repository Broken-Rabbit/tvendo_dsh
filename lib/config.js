/**
 * The plugin's Config schema.
 *
 * DSH derives a settings page from this schema (Settings → Plugins → Tvendo), so
 * every field here is also a form field: keep descriptions user-facing. The
 * schema is validated by the Host before `apply` runs, and a write to the page
 * re-applies the plugin with the new value.
 * @module dsh-tvendo/config
 */
import z from '@deepseek-ai/schemastery'
import { API_KEY_ENV, DEFAULT_SERVER, SERVER_ENV } from './constants.js'

export { API_KEY_ENV, DEFAULT_SERVER, SERVER_ENV }

/** Validated plugin configuration. */
export const Config = z.object({
  server: z
    .string()
    .description('Tvendo 服务地址，例如 https://tvendo.example.com')
    .default(DEFAULT_SERVER),
  apiKey: z
    .string()
    .role('secret')
    .description(
      `平台 API Key，在控制台「API 密钥」页创建。留空时依次读取 ${API_KEY_ENV} 环境变量与 tvendo CLI 的本地配置`,
    )
    .default(''),
  defaultMaxCostMicros: z
    .natural()
    .description('每次调用默认的单次费用上限，单位微元（1000000 = 1 元）；0 表示不额外限制，仍受账户预算约束')
    .default(0),
  requestTimeoutMs: z
    .natural()
    .min(1000)
    .max(300000)
    .description('单次 HTTP 请求超时（毫秒）。平台执行超时为 60 秒，结算另需时间')
    .default(120000),
})

/**
 * Read the numeric fields with the same fallbacks the schema declares, so a
 * caller that omits `config` entirely still behaves like a defaulted one.
 * @param config - live plugin configuration.
 * @returns the effective plugin defaults.
 */
export function pluginDefaults(config) {
  const maxCost = Number(config?.defaultMaxCostMicros)
  const timeout = Number(config?.requestTimeoutMs)
  return {
    maxCostMicros: Number.isFinite(maxCost) && maxCost > 0 ? Math.trunc(maxCost) : 0,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.trunc(timeout) : 120_000,
  }
}
