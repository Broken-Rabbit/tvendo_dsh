/**
 * Host half of the Tvendo bundle.
 *
 * Tvendo is a self-hosted marketplace of callable tools: an administrator points
 * it at HTTP endpoints and remote MCP servers, sets a CNY price per call, and
 * users reach it with a platform key. This plugin turns that platform into
 * ordinary DSH tools, so a session can discover a tool and call it without
 * installing the CLI or a Skill first.
 *
 * The split of responsibility is deliberate:
 *
 *  - the platform stays authoritative for the catalog, prices, authorization,
 *    balance, budgets and settlement; this plugin never caches or re-implements
 *    billing;
 *  - DSH stays authoritative for who may call the tools (the usual permission
 *    and approval pipeline), and for where the endpoint and key come from (the
 *    Config schema, which DSH renders as a settings page);
 *  - every call is a single attempt. A possibly-charged request is never retried
 *    automatically; the failure text carries the `request_id` so the agent can
 *    reconcile it with `tvendo_runs`.
 *
 * The tools are registered as effects, so they disappear when the plugin
 * unloads or its configuration is re-applied.
 * @module dsh-tvendo
 */
import { Config, pluginDefaults } from './config.js'
import { createTools } from './tools.js'

/** The plugin's stable id, used for logging and effect labels. */
export const name = 'tvendo'

/** Services this plugin contributes to. */
export const inject = ['tools']

export { Config }

/**
 * Register the six Tvendo tools.
 * @param ctx - Host context carrying the tool registry.
 * @param config - validated plugin configuration from the settings page.
 */
export function apply(ctx, config) {
  // Volatile fields are Cordis references. Resolve them at call time, not once
  // at mount time, so a saved key applies immediately without restarting DSH.
  const live = {}
  for (const field of ['server', 'apiKey', 'defaultMaxCostMicros', 'requestTimeoutMs']) {
    Object.defineProperty(live, field, {
      enumerable: true,
      get: () => typeof config?.[field]?.get === 'function' ? config[field].get() : config?.[field],
    })
  }
  const defaults = {
    get maxCostMicros() { return pluginDefaults(live).maxCostMicros },
    get timeoutMs() { return pluginDefaults(live).timeoutMs },
  }
  ctx.inject?.(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  for (const definition of createTools({ config: live, defaults })) {
    ctx.effect(() => ctx.tools.register(definition), `tvendo: ${definition.name}`)
  }
}
