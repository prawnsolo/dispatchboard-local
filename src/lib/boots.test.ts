import assert from 'node:assert/strict'
import {
  BOOTS_CHIP_LABEL,
  bootsCountForDate,
  bootsFlagsForJobs,
  isDirtyJob,
  isInsideJob,
  wouldCreateBootsIssue,
  type BootsJob,
} from './boots.ts'

assert.equal(isDirtyJob({ activity_1: 'TANK INSTALL (UG)' }), true)
assert.equal(isDirtyJob({ activity_1: 'PIPE HOUSE LP (OUTSIDE)' }), true)
assert.equal(isDirtyJob({ activity_1: 'GAS CHECK' }), false)
assert.equal(isInsideJob({ activity_1: 'APPLIANCE (CONVERT)' }), true)
assert.equal(isInsideJob({ activity_1: 'GAS CHECK' }), true)
assert.equal(isInsideJob({ activity_1: 'FIREPLACE CLEANING' }), true)
assert.equal(isInsideJob({ activity_1: 'TANK INSTALL (UG)' }), false)
assert.equal(isDirtyJob({ activity_1: 'PTO', is_capacity_block: 1 }), false)

const D = '2026-10-06'
const j = (id: number, activity: string, begin: string | null, extra: Partial<BootsJob> = {}): BootsJob => ({
  id,
  schedule_date: D,
  technician_name: 'TECH A',
  is_capacity_block: 0,
  activity_1: activity,
  begin_time: begin,
  ...extra,
})

// Dirty then inside → flag the inside job
const flags = bootsFlagsForJobs([
  j(1, 'TANK INSTALL (UG)', '08:00:00'),
  j(2, 'APPLIANCE (CONVERT)', '13:00:00'),
  j(3, 'GAS CHECK', '10:00:00'), // also inside after dirty
])
assert.equal(flags.has('2'), true)
assert.equal(flags.has('3'), true)
assert.equal(flags.has('1'), false)
assert.equal(bootsCountForDate(flags, D), 2)
assert.equal(BOOTS_CHIP_LABEL.includes('boots'), true)

// Inside before dirty → no flag
const ok = bootsFlagsForJobs([
  j(10, 'GAS CHECK', '08:00:00'),
  j(11, 'TANK INSTALL (UG)', '12:00:00'),
])
assert.equal(ok.size, 0)

// Insertion preview
assert.equal(
  wouldCreateBootsIssue([j(1, 'TANK INSTALL (UG)', '08:00:00')], 'TECH A', D, {
    activity_1: 'APPLIANCE (CONVERT)',
    begin_time: '14:00:00',
  }),
  true,
)
assert.equal(
  wouldCreateBootsIssue([j(1, 'GAS CHECK', '08:00:00')], 'TECH A', D, {
    activity_1: 'APPLIANCE (CONVERT)',
    begin_time: '14:00:00',
  }),
  false,
)

// Dirty job that also matches inside via activity_2 must not self-flag.
const dual = bootsFlagsForJobs([
  j(20, 'TANK INSTALL (UG)', '08:00:00', { activity_2: 'GAS CHECK' }),
])
assert.equal(dual.size, 0)
assert.equal(isDirtyJob({ activity_1: 'TANK INSTALL (UG)', activity_2: 'GAS CHECK' }), true)
assert.equal(isInsideJob({ activity_1: 'TANK INSTALL (UG)', activity_2: 'GAS CHECK' }), true)
assert.equal(
  wouldCreateBootsIssue([j(1, 'GAS CHECK', '08:00:00')], 'TECH A', D, {
    activity_1: 'TANK INSTALL (UG)',
    activity_2: 'GAS CHECK',
    begin_time: '14:00:00',
  }),
  false,
)

// Later inside after a dual dirty+inside still flags.
const afterDual = bootsFlagsForJobs([
  j(21, 'TANK INSTALL (UG)', '08:00:00', { activity_2: 'GAS CHECK' }),
  j(22, 'APPLIANCE (CONVERT)', '13:00:00'),
])
assert.equal(afterDual.has('21'), false)
assert.equal(afterDual.has('22'), true)

console.log('boots.test.ts: ok')
