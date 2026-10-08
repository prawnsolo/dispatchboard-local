import assert from 'node:assert/strict'
import {
  bestInsertionForCandidate,
  estimateLegHours,
  estimateRouteHours,
  estimateTechDayDrive,
  haversineMiles,
  rankInsertions,
} from './driveEstimate.ts'
import { DRIVE_ROAD_FACTOR, DRIVE_SPEED_MPH } from './driveEstimateConfig.ts'
import { YARD } from './yard.ts'

// Config is one file; Step 2 swaps provider without changing these knobs' role.
assert.equal(DRIVE_ROAD_FACTOR, 1.3)
assert.equal(DRIVE_SPEED_MPH, 35)

const a = { lat: YARD.lat, lng: YARD.lng }
const b = { lat: YARD.lat + 0.1, lng: YARD.lng } // ~6.9 mi north
const miles = haversineMiles(a.lat, a.lng, b.lat, b.lng)
assert.ok(miles > 6 && miles < 8, `expected ~7 mi, got ${miles}`)
const leg = estimateLegHours(a, b)
const expected = (miles * DRIVE_ROAD_FACTOR) / DRIVE_SPEED_MPH
assert.ok(Math.abs(leg - expected) < 1e-9)

// Zero-length leg
assert.equal(estimateLegHours(a, a), 0)
assert.equal(estimateRouteHours([a]), 0)
assert.equal(estimateRouteHours([a, b, a]), estimateLegHours(a, b) + estimateLegHours(b, a))

const D = '2026-10-06'
const jobs = [
  {
    id: 1,
    schedule_date: D,
    technician_name: 'TECH A',
    is_capacity_block: 0,
    begin_time: '09:00:00',
    activity_1: 'GAS CHECK', // 1h
    lat: YARD.lat + 0.05,
    lng: YARD.lng,
    customer_name: 'First',
  },
  {
    id: 2,
    schedule_date: D,
    technician_name: 'TECH A',
    is_capacity_block: 0,
    begin_time: '13:00:00',
    activity_1: 'GAS CHECK',
    lat: YARD.lat + 0.1,
    lng: YARD.lng,
    customer_name: 'Second',
  },
  {
    id: 3,
    schedule_date: D,
    technician_name: 'TECH A',
    is_capacity_block: 0,
    begin_time: '11:00:00',
    activity_1: 'GAS CHECK',
    lat: null,
    lng: null,
    customer_name: 'Unmapped',
  },
]

const day = estimateTechDayDrive(jobs, 'TECH A', D)
assert.equal(day.jobs, 3)
assert.equal(day.mappedStops, 2)
assert.equal(day.unmappedCount, 1)
assert.equal(day.workHours, 3)
assert.ok(day.driveHours > 0, 'yard→j1→j2→yard has drive')
assert.equal(day.totalHours, Math.round((day.workHours + day.driveHours) * 10) / 10)
assert.equal(day.level, day.totalHours > 8 ? 'over' : day.totalHours > 7 ? 'near' : 'ok')

// Insertion: empty day → only yard→cand→yard
const emptyInsert = bestInsertionForCandidate([], 'TECH B', D, {
  lat: YARD.lat + 0.05,
  lng: YARD.lng,
  workHours: 2,
})
assert.equal(emptyInsert.insertIndex, 0)
assert.ok(emptyInsert.driveHours > 0)
assert.equal(emptyInsert.workHours, 2)
assert.ok(emptyInsert.label.includes('drive'))
assert.ok(emptyInsert.label.includes('fits') || emptyInsert.label.includes('over'))

// Insertion into existing route picks cheapest index
const insert = bestInsertionForCandidate(jobs, 'TECH A', D, {
  lat: YARD.lat + 0.06,
  lng: YARD.lng,
  workHours: 1,
})
assert.ok(insert.insertIndex >= 0 && insert.insertIndex <= 2)
assert.equal(insert.workHours, 4) // 3 existing work + 1 (unmapped still counted in work)

const ranked = rankInsertions([
  { ...insert, tech: 'TECH A', date: D, fits: false, totalHours: 9 },
  { ...emptyInsert, tech: 'TECH B', date: D, fits: true, totalHours: 3 },
])
assert.equal(ranked[0]!.tech, 'TECH B', 'fits before over')

console.log('driveEstimate.test.ts: ok')
