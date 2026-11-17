/**
 * Presentation helpers shared by the Tvendo tools.
 *
 * Tvendo keeps every monetary amount as an integer of micro-units of CNY
 * (1 CNY = 1_000_000 micros), and platform descriptions can be long. Both need
 * a small amount of shaping before they reach the model: a human price and a
 * bounded text, because every character of a tool result is spent context.
 * @module dsh-tvendo/format
 */
import { MICROS_PER_UNIT } from './constants.js'

/** Micro-units per unit of the platform currency. */
export { MICROS_PER_UNIT }
/**
 * Render an integer micro-unit amount as a yuan string without trailing zeros.
 * @param micros - the amount in micro-units; non-finite input renders as `0`.
 * @returns the amount as a plain decimal string, e.g. `0.001` or `1.5`.
 */
export function formatYuan(micros) {
  const value = Number(micros)
  if (!Number.isFinite(value) || value === 0) return '0'
  return String(Number((value / MICROS_PER_UNIT).toFixed(6)))
}

/**
 * Render one per-call price for the model.
 * @param micros - the price in micro-units.
 * @returns `免费` for a zero price, otherwise `<amount> 元/次`.
 */
export function formatPrice(micros) {
  const value = Number(micros)
  if (!Number.isFinite(value) || value <= 0) return '免费'
  return `${formatYuan(value)} 元/次`
}

/**
 * Bound one string so a tool result cannot flood the context.
 * @param text - the text to bound.
 * @param max - the largest number of characters kept.
 * @returns the original text, or its head plus a truncation marker.
 */
export function clip(text, max = 12_000) {
  if (typeof text !== 'string') return ''
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[已截断，原长 ${text.length} 字符]`
}

/**
 * Pretty-print one JSON value for the model, bounded in length.
 * @param value - any JSON value; `undefined` renders as `null`.
 * @param max - the largest number of characters kept.
 * @returns the pretty JSON text.
 */
export function preview(value, max = 12_000) {
  if (value === undefined) return 'null'
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return clip(text ?? 'null', max)
}

/**
 * Collapse whitespace and bound a free-form description.
 * @param text - the raw description.
 * @param max - the largest number of characters kept.
 * @returns one-line description text.
 */
export function summarize(text, max = 240) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/**
 * Build one model-facing text content block.
 * @param text - the rendered text.
 * @returns the content-block list a tool render returns.
 */
export function textBlock(text) {
  return [{ type: 'text', text }]
}
