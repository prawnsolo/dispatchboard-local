import assert from 'node:assert/strict'
import { explainError } from './errors.ts'

assert.match(explainError("Cannot read properties of undefined (reading 'invoke')").summary, /local database/)
assert.equal(explainError('database is locked').detail, 'database is locked')
assert.match(explainError(new Error('REQUEST_DENIED: bad key')).summary, /Google refused/)
assert.match(explainError('TypeError: Failed to fetch').summary, /Could not reach/)
assert.deepEqual(explainError('Pick a date first.'), { summary: 'Pick a date first.', detail: '' })
assert.deepEqual(explainError(''), { summary: 'Something went wrong.', detail: '' })
const long = 'Import stopped. ' + 'row 5 had a bad value; '.repeat(12)
const e = explainError(long)
assert.equal(e.summary, 'Import stopped.')
assert.equal(e.detail, long.trim())
console.log('errors.test.ts: ok')
