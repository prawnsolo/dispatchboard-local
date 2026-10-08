import assert from 'node:assert/strict'
import { daySheetPages } from './day-sheet.ts'
import type { JobRow } from './store.ts'

const D = '2026-10-05'
let id = 0
const j = (p: Partial<JobRow>): JobRow =>
  ({ id: ++id, schedule_date: D, technician_name: 'B TECH', is_capacity_block: 0, wo_number: String(1000 + id), begin_time: '08:00:00', ...p }) as JobRow

const jobs = [
  j({ begin_time: '13:00:00' }),
  j({ begin_time: '09:00:00' }),
  j({ begin_time: null }),
  j({ technician_name: 'A TECH' }),
  j({ technician_name: null }),
  j({ is_capacity_block: 1, wo_number: null }),
  j({ schedule_date: '2026-10-06' }),
]
const pages = daySheetPages(jobs, D)
assert.deepEqual(pages.map((p) => p.tech), ['A TECH', 'B TECH', 'Unassigned'])
assert.deepEqual(pages[1]!.jobs.map((x) => x.begin_time), ['09:00:00', '13:00:00', null])
assert.equal(daySheetPages(jobs, D, 'A TECH').length, 1)
assert.equal(daySheetPages(jobs, '2030-01-01').length, 0)
console.log('day-sheet.test.ts: ok')
