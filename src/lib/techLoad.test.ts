import assert from 'node:assert/strict'
import { durationHoursForJob, formatTechDayLoad } from './jobDurations.ts'
import { loadKey, loadLabel, loadLevel, techDayLoads, type LoadJob } from './techLoad.ts'

const D = '2026-10-05'
const j = (tech: string | null, activity: string, extra: Partial<LoadJob> = {}): LoadJob => ({
  id: Math.random(),
  schedule_date: D,
  technician_name: tech,
  is_capacity_block: 0,
  activity_1: activity,
  ...extra,
})

// Thresholds on an 8h shift: amber above 7h, red above 8h (full total).
assert.equal(loadLevel(6.5, 8), 'ok')
assert.equal(loadLevel(7, 8), 'ok')
assert.equal(loadLevel(7.5, 8), 'near')
assert.equal(loadLevel(8, 8), 'near')
assert.equal(loadLevel(8.5, 8), 'over')

assert.equal(durationHoursForJob(j('X', 'SOMETHING NEW')), 1)
assert.equal(durationHoursForJob(j('X', 'PTO', { is_capacity_block: 1 })), 0)

// No coords → drive 0; work hours unchanged vs 0.2.4.
const loads = techDayLoads([
  j('NICHOLAS PENLEY', 'TANK INSTALL (UG)'), // 4
  j('NICHOLAS PENLEY', 'REGULATOR (HOOK UP)'), // 1.5
  j('NICHOLAS PENLEY', 'SOMETHING NEW'), // 1
  j('NICHOLAS PENLEY', 'PTO', { is_capacity_block: 1 }),
  j('TECH BAKER', 'TANK INSTALL (UG)'),
  j('TECH BAKER', 'GENERATOR'),
  j('TECH BAKER', 'REGULATOR (HOOK UP)'),
  j('TECH CRUZ', 'PTO', { is_capacity_block: 1 }),
  j(null, 'TANK INSTALL (UG)'),
  j('NICHOLAS PENLEY', 'TANK INSTALL (UG)', { schedule_date: '2026-10-06' }),
])
const np = loads.get(loadKey('NICHOLAS PENLEY', D))!
assert.deepEqual([np.bookedHours, np.driveHours, np.shiftHours, np.jobs, np.level], [6.5, 0, 8, 3, 'ok'])
assert.equal(loadLabel(np), '6.5h work + 0h drive = 6.5h / 8h')
assert.equal(
  formatTechDayLoad(null, null, 5.5, 8, 1.2).hours,
  '5.5h work + 1.2h drive = 6.7h / 8h',
)
assert.equal(formatTechDayLoad(null, null, 5.5, 8, 1.2).level, 'ok')
assert.equal(formatTechDayLoad(null, null, 6.5, 8, 1.2).level, 'near') // 7.7
assert.equal(formatTechDayLoad(null, null, 7, 8, 1.5).level, 'over') // 8.5
const baker = loads.get(loadKey('TECH BAKER', D))!
assert.equal(loadLabel(baker), '9h work + 0h drive = 9h / 8h · Over')
assert.equal(loads.has(loadKey('TECH CRUZ', D)), false, 'PTO-only day books nothing')
assert.equal(loads.get(loadKey('NICHOLAS PENLEY', '2026-10-06'))?.bookedHours, 4)
assert.equal([...loads.keys()].some((k) => k.startsWith('Unassigned')), false)

console.log('techLoad.test.ts: ok')
