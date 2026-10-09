import assert from 'node:assert/strict'
import { overlappingJobIds, type OverlapJob } from './overlap.ts'

const D = '2026-10-05'
let id = 0
const j = (p: Partial<OverlapJob>): OverlapJob => ({
  id: ++id,
  schedule_date: D,
  technician_name: 'CHAD TAYLOR',
  is_capacity_block: 0,
  activity_1: 'GAS CHECK',
  begin_time: '08:00:00',
  end_time: '10:00:00',
  ...p,
})

const a = j({})
const b = j({ begin_time: '09:30:00', end_time: '11:00:00' }) // overlaps a
const c = j({ begin_time: '11:00:00', end_time: '12:00:00' }) // starts when b ends: fine
const d = j({ technician_name: 'ELI MASTON', begin_time: '09:00:00', end_time: '09:45:00' }) // other tech
const e = j({ begin_time: null, end_time: null }) // no time: skipped
const f = j({ technician_name: null, begin_time: '08:00:00', end_time: '10:00:00' }) // unassigned: skipped
const g = j({ technician_name: null, begin_time: '08:00:00', end_time: '10:00:00' })
let hit = overlappingJobIds([a, b, c, d, e, f, g], D)
assert.deepEqual([...hit].sort(), [a.id, b.id].sort())
assert.ok(!hit.has(c.id))

// Chain: a overlaps b, b overlaps c' that starts before b ends.
const c2 = j({ begin_time: '10:30:00', end_time: '12:00:00' })
hit = overlappingJobIds([a, b, c2], D)
assert.ok(hit.has(a.id) && hit.has(b.id) && hit.has(c2.id))

// Wrong day.
assert.equal(overlappingJobIds([a, b], '2026-10-06').size, 0)

// Job on a PTO day for the same tech; other techs unaffected.
const pto = j({ is_capacity_block: 1, wo_number: null, activity_1: 'PTO', customer_name: 'PTO', begin_time: null, end_time: null })
const onPto = j({ begin_time: null, end_time: null })
hit = overlappingJobIds([pto, onPto, d], D)
assert.deepEqual([...hit], [onPto.id])
console.log('overlap.test.ts: ok')
