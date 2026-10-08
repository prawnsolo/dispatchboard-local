import assert from 'node:assert/strict'
import { formatPtoDayLine, isPtoCapacity, ptoDayKeys, ptoTechsOnDate, techHasPto } from './pto.ts'

assert.equal(isPtoCapacity({ is_capacity_block: 1, activity_1: 'PTO', schedule_date: '2026-10-05', technician_name: 'CHAD TAYLOR' }), true)
assert.equal(isPtoCapacity({ is_capacity_block: 1, activity_1: 'Holiday', schedule_date: '2026-10-05', technician_name: 'A' }), true)
assert.equal(isPtoCapacity({ is_capacity_block: 1, activity_1: 'Training', schedule_date: '2026-10-05', technician_name: 'A' }), false)
assert.equal(isPtoCapacity({ is_capacity_block: 0, activity_1: 'PTO', schedule_date: '2026-10-05', technician_name: 'A' }), false)
// ADD often leaves Customer blank; capacity rows may store activity in customer_name
assert.equal(
  isPtoCapacity({ is_capacity_block: 1, activity_1: null, customer_name: 'PTO', schedule_date: '2026-10-05', technician_name: 'A' }),
  true,
)

const D = '2026-10-05'
const jobs = [
  { schedule_date: D, technician_name: 'CHAD TAYLOR', is_capacity_block: 1, activity_1: 'PTO' },
  { schedule_date: D, technician_name: 'SHAWN GREEN', is_capacity_block: 1, activity_1: 'Training' },
  { schedule_date: D, technician_name: 'ELI MASTON', is_capacity_block: 1, activity_1: 'PTO' },
  { schedule_date: '2026-10-06', technician_name: 'CHAD TAYLOR', is_capacity_block: 1, activity_1: 'PTO' },
]
const keys = ptoDayKeys(jobs)
assert.equal(techHasPto(keys, 'CHAD TAYLOR', D), true)
assert.equal(techHasPto(keys, 'SHAWN GREEN', D), false)
assert.deepEqual(ptoTechsOnDate(jobs, D), ['CHAD TAYLOR', 'ELI MASTON'])
assert.equal(formatPtoDayLine(['CHAD TAYLOR']), 'PTO: CHAD TAYLOR')
assert.equal(formatPtoDayLine(['CHAD TAYLOR', 'ELI MASTON']), 'PTO: CHAD TAYLOR, ELI MASTON')
assert.equal(formatPtoDayLine([]), null)

console.log('pto.test.ts: ok')
