import assert from 'node:assert/strict'
import { shortcutFor, type KeyFacts } from './shortcuts.ts'

const k = (key: string, extra: Partial<KeyFacts> = {}): KeyFacts => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  inField: false,
  ...extra,
})

assert.deepEqual(shortcutFor(k('k', { ctrlKey: true })), { type: 'palette' })
assert.deepEqual(shortcutFor(k('K', { metaKey: true, inField: true })), { type: 'palette' })
assert.deepEqual(shortcutFor(k('3', { altKey: true, inField: true })), { type: 'tab', index: 2 })
assert.deepEqual(shortcutFor(k('7', { altKey: true })), { type: 'tab', index: 6 })
assert.equal(shortcutFor(k('8', { altKey: true })), null)
assert.deepEqual(shortcutFor(k('t')), { type: 'today' })
assert.deepEqual(shortcutFor(k(']')), { type: 'day', delta: 1 })
assert.deepEqual(shortcutFor(k('[')), { type: 'day', delta: -1 })
assert.deepEqual(shortcutFor(k('/')), { type: 'focus-search' })
assert.deepEqual(shortcutFor(k('?', { shiftKey: true })), { type: 'help' })
// typing in a field never triggers plain-key shortcuts
for (const key of ['t', '[', ']', '/', '?']) assert.equal(shortcutFor(k(key, { inField: true })), null)
// Ctrl+Z and friends are left alone
assert.equal(shortcutFor(k('z', { ctrlKey: true })), null)
assert.equal(shortcutFor(k('t', { ctrlKey: true })), null)
console.log('shortcuts.test.ts: ok')
