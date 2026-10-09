import assert from 'node:assert/strict'
import { announceJobEdited, makeEditUndoEntry, onJobEdited, pruneExpired, pushUndo, UNDO_TTL_MS } from './undo.ts'
import { blankJobDraft } from './store.ts'

const before = { ...blankJobDraft(), id: 7, customer_name: 'SAMPLE CUSTOMER 07', schedule_date: '2026-09-02', technician_name: 'CHAD TAYLOR' }
const entry = makeEditUndoEntry(before, 1000)
assert.equal(entry.label, 'Saved SAMPLE CUSTOMER 07')
assert.equal(entry.restoreDraft, before)
assert.equal(entry.previous.jobId, 7)
assert.equal(entry.expiresAt, 1000 + UNDO_TTL_MS)
assert.equal(pruneExpired([entry], 1000 + UNDO_TTL_MS + 1).length, 0)
assert.equal(pushUndo([], entry, 1000).length, 1)

const seen: number[] = []
onJobEdited((b) => seen.push(b.id ?? -1))
announceJobEdited(before)
onJobEdited(null)
announceJobEdited(before)
assert.deepEqual(seen, [7])
console.log('undo-edit.test.ts: ok')
