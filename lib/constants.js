/**
 * Stable constants shared by the pure modules and the Config schema.
 *
 * They live outside `config.js` so connection resolution and its tests never
 * need the Host-side schema package: only the plugin entry point does.
 * @module dsh-tvendo/constants
 */

/** The public deployment shown by the Tvendo documentation; a default, not a lock-in. */
export const DEFAULT_SERVER = 'https://t.zhitoken.com'

/** The environment variable the Tvendo CLI and Skill already use. */
export const API_KEY_ENV = 'TVENDO_API_KEY'

/** The environment variable the Tvendo CLI and Skill already use. */
export const SERVER_ENV = 'TVENDO_SERVER'

/** Micro-units per unit of the platform currency (1 CNY = 1_000_000 micros). */
export const MICROS_PER_UNIT = 1_000_000
