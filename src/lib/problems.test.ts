import assert from 'node:assert/strict'
import { overCapacityTechs, problemPredicate, problemTotal, summarizeProblems, type ProblemJob } from './problems.ts'

const D = '2026-10-05'
let id = 0
function job(p: Partial<ProblemJob>): ProblemJob {
  return {
    id: ++id,
    schedule_date: D,
    technician_name: 'TECH ADAMS',
    wo_number: '90006',
    is_capacity_block: 0,
    lat: 38.3,
    lng: -77.5,
    geocode_source: 'census',
    mismatch_flag: 0,
    checklist_open: 0,
    activity_1: 'GAS CHECK',
    ...p,
  }
}

// Empty day → nothing (strip shows "No problems today").
assert.equal(problemTotal(summarizeProblems([job({})], D)), 0)

const jobs = [
  job({ lat: null, lng: null, geocode_source: 'none' }), // unmapped
  job({ mismatch_flag: 1 }), // ≠
  job({ checklist_open: 2 }), // ⚑
  job({ wo_number: null }), // tentative
  job({ wo_number: null, is_capacity_block: 1, lat: null, lng: null, geocode_source: 'none' }), // capacity: never a problem
  job({ schedule_date: '2026-10-06', mismatch_flag: 1 }), // other day
  // TECH BAKER: 4h UG install + 3.5h generator + 1.5h regulator = 9h on an 8h shift
  job({ technician_name: 'TECH BAKER', activity_1: 'TANK INSTALL (UG)' }),
  job({ technician_name: 'TECH BAKER', activity_1: 'GENERATOR' }),
  job({ technician_name: 'TECH BAKER', activity_1: 'REGULATOR (HOOK UP)' }),
  job({ technician_name: null, activity_1: 'TANK INSTALL (UG)' }),
  job({ technician_name: null, activity_1: 'TANK INSTALL (UG)' }),
  job({ technician_name: null, activity_1: 'TANK INSTALL (UG)' }),
]
const s = summarizeProblems(jobs, D)
assert.equal(s.unmapped, 1)
assert.equal(s.mismatch, 1)
assert.equal(s.flags, 1)
assert.equal(s.tentative, 1)
assert.equal(s.boots, 0)
assert.equal(s.overCapacity.length, 1, 'unassigned is not a tech')
assert.equal(s.overCapacity[0]!.tech, 'TECH BAKER')
assert.equal(s.overCapacity[0]!.bookedHours, 9)
assert.equal(s.overCapacity[0]!.shiftHours, 8)
assert.equal(s.overCapacity[0]!.jobs, 3)
assert.ok(s.overCapacity[0]!.driveHours >= 0)
assert.ok(s.overCapacity[0]!.totalHours >= s.overCapacity[0]!.bookedHours)
assert.equal(problemTotal(s), 5)

// Exactly 8h work with no drive (unmapped) is not over. Mapped pins add crow-flies drive.
assert.deepEqual(
  overCapacityTechs(
    [
      job({ technician_name: 'T', activity_1: 'TANK INSTALL (UG)', lat: null, lng: null, geocode_source: 'none' }),
      job({ technician_name: 'T', activity_1: 'TANK INSTALL (UG)', lat: null, lng: null, geocode_source: 'none' }),
    ],
    D,
  ),
  [],
)

// Click filters: predicate matches only that problem on that day.
assert.equal(jobs.filter(problemPredicate({ kind: 'mismatch' }, D)).length, 1)
assert.equal(jobs.filter(problemPredicate({ kind: 'over_capacity', tech: 'TECH BAKER' }, D)).length, 3)
assert.equal(jobs.filter(problemPredicate({ kind: 'unmapped' }, D)).length, 1)
assert.equal(jobs.filter(problemPredicate({ kind: 'boots' }, D, jobs)).length, 0)

console.log('problems.test.ts: ok')
