/**
 * Resolve "which Tvendo deployment does this session talk to, with which key".
 *
 * Tvendo has three places a connection already lives, and this plugin must not
 * invent a fourth one that silently disagrees with them:
 *
 *  1. the plugin's own settings page (`server` / `apiKey`);
 *  2. the `TVENDO_SERVER` / `TVENDO_API_KEY` environment variables the Skill and
 *     the CLI use;
 *  3. the CLI's local `tvendo/config.json`.
 *
 * The resolution keeps a key pinned to the server it was written for: an
 * environment or CLI key is never sent to a different server, because the CLI
 * itself refuses to do that. A key typed on the settings page is trusted for
 * the configured server, which is the only place the user could have aimed it.
 * @module dsh-tvendo/connection
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { API_KEY_ENV, DEFAULT_SERVER, SERVER_ENV } from './constants.js'

/**
 * Normalize a service address: require http(s), drop a trailing slash and any
 * query/fragment. A malformed address yields `undefined` rather than throwing,
 * because every resolution source is optional.
 * @param value - the candidate address.
 * @returns the normalized base URL, or undefined when unusable.
 */
export function normalizeServer(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * Locate the Tvendo CLI's configuration file the same way the Go CLI does
 * (`os.UserConfigDir`): platform-specific, with `TVENDO_CONFIG` overriding it.
 * @param env - the environment to read.
 * @param platform - the platform to resolve for; defaults to the running one.
 * @returns the absolute path the CLI would use.
 */
export function cliConfigPath(env = process.env, platform = process.platform) {
  const override = typeof env.TVENDO_CONFIG === 'string' ? env.TVENDO_CONFIG.trim() : ''
  if (override.length > 0) return override
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : ''
    return join(appData.length > 0 ? appData : homedir(), 'tvendo', 'config.json')
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'tvendo', 'config.json')
  }
  const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : ''
  return join(xdg.length > 0 ? xdg : join(homedir(), '.config'), 'tvendo', 'config.json')
}

/**
 * Read the CLI's stored connection, if any. A missing, unreadable or malformed
 * file is not an error: the plugin simply has one fewer fallback.
 * @param env - the environment to read.
 * @param platform - the platform to resolve for.
 * @returns the stored server and key, or undefined.
 */
export function readCliConfig(env = process.env, platform = process.platform) {
  let raw
  try {
    raw = JSON.parse(readFileSync(cliConfigPath(env, platform), 'utf8'))
  } catch {
    return undefined
  }
  const server = normalizeServer(raw?.server)
  if (server === undefined) return undefined
  const apiKey = typeof raw?.api_key === 'string' ? raw.api_key.trim() : ''
  return { server, apiKey }
}

/**
 * Resolve the effective connection.
 * @param config - the live plugin configuration (may omit every field).
 * @param env - the environment to read.
 * @param platform - the platform to resolve the CLI config path for.
 * @returns the base URL, the key (empty when unconfigured) and where they came from.
 */
export function resolveConnection(config, env = process.env, platform = process.platform) {
  const cli = readCliConfig(env, platform)

  const configuredServer = normalizeServer(config?.server)
  const environmentServer = normalizeServer(env?.[SERVER_ENV])

  let server
  let source
  if (configuredServer !== undefined) {
    server = configuredServer
    source = 'settings'
  } else if (environmentServer !== undefined) {
    server = environmentServer
    source = 'environment'
  } else if (cli !== undefined) {
    server = cli.server
    source = 'cli-config'
  } else {
    server = DEFAULT_SERVER
    source = 'default'
  }

  const configuredKey = typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
  const environmentKey = typeof env?.[API_KEY_ENV] === 'string' ? env[API_KEY_ENV].trim() : ''
  let apiKey = ''
  if (configuredKey.length > 0) {
    apiKey = configuredKey
  } else if (environmentKey.length > 0 && server === (environmentServer ?? DEFAULT_SERVER)) {
    apiKey = environmentKey
  } else if (cli !== undefined && cli.server === server) {
    apiKey = cli.apiKey
  }

  return { server, apiKey, source }
}

/**
 * Explain where a connection came from, for diagnostics a user can act on.
 * @param connection - a resolved connection.
 * @returns a short human-readable origin label.
 */
export function describeSource(connection) {
  switch (connection.source) {
    case 'settings':
      return '插件设置'
    case 'environment':
      return `环境变量 ${SERVER_ENV}`
    case 'cli-config':
      return 'tvendo CLI 本地配置'
    default:
      return '内置默认地址'
  }
}
