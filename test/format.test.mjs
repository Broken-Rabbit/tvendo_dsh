/**
 * Money and text shaping: every tool result passes through these helpers, so a
 * rounding or truncation bug would quietly misreport a price or flood context.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clip, formatPrice, formatYuan, preview, summarize, textBlock } from '../lib/format.js'

test('formatYuan renders micro-units as a trimmed decimal string', () => {
  assert.equal(formatYuan(0), '0')
  assert.equal(formatYuan(1), '0.000001')
  assert.equal(formatYuan(1500), '0.0015')
  assert.equal(formatYuan(1_000_000), '1')
  assert.equal(formatYuan(1_500_000), '1.5')
  assert.equal(formatYuan(12_340_000), '12.34')
})

test('formatYuan degrades gracefully on unusable input', () => {
  assert.equal(formatYuan(undefined), '0')
  assert.equal(formatYuan(null), '0')
  assert.equal(formatYuan('abc'), '0')
  assert.equal(formatYuan(Number.NaN), '0')
})

test('formatPrice marks a zero price as free and keeps the per-call unit', () => {
  assert.equal(formatPrice(0), '免费')
  assert.equal(formatPrice(-5), '免费')
  assert.equal(formatPrice(undefined), '免费')
  assert.equal(formatPrice(1500), '0.0015 元/次')
})

test('clip keeps short text and marks a truncated head', () => {
  assert.equal(clip('abc', 10), 'abc')
  assert.equal(clip('hello world', 5), 'hello\n…[已截断，原长 11 字符]')
  assert.equal(clip(undefined), '')
})

test('preview pretty-prints JSON and bounds it', () => {
  assert.equal(preview(undefined), 'null')
  assert.equal(preview({ a: 1 }), '{\n  "a": 1\n}')
  assert.match(preview({ a: 'x'.repeat(50) }, 20), /…\[已截断/)
})

test('summarize flattens whitespace and truncates with an ellipsis', () => {
  assert.equal(summarize('  a \n\t b  '), 'a b')
  assert.equal(summarize('abcdef', 3), 'abc…')
  assert.equal(summarize(undefined), '')
})

test('textBlock produces a single text content block', () => {
  assert.deepEqual(textBlock('hi'), [{ type: 'text', text: 'hi' }])
})
