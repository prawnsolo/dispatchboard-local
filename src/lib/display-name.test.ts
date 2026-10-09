import assert from 'node:assert/strict'
import { displayName } from './format.ts'

assert.equal(displayName('CHAD TAYLOR'), 'Chad Taylor')
assert.equal(displayName('PAT MCDONALD'), 'Pat McDonald')
assert.equal(displayName("JO O'BRIEN"), "Jo O'Brien")
assert.equal(displayName('ANN-MARIE LEE'), 'Ann-Marie Lee')
assert.equal(displayName('Unassigned'), 'Unassigned')
assert.equal(displayName('eli maston'), 'eli maston')
assert.equal(displayName(null), '')
console.log('display-name.test.ts: ok')
