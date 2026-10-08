import assert from 'node:assert/strict'
import { jobPinColor, mapScheduleSignal, mapScheduleStroke } from './colors.ts'

assert.equal(mapScheduleSignal({ wo_number: null, is_capacity_block: 0 }), 'tentative')
assert.equal(mapScheduleSignal({ wo_number: '1', is_capacity_block: 0 }), 'locked')
assert.equal(mapScheduleSignal({ wo_number: null, is_capacity_block: 1 }), 'locked')
assert.equal(mapScheduleStroke({ wo_number: null, is_capacity_block: 0 }), '#d97706')
assert.equal(jobPinColor({ activity_1: 'TANK INSTALL (UG)' }), '#B45309')
assert.equal(jobPinColor({ activity_1: null, card_color: '#112233' }), '#112233')

console.log('colors.test.ts: ok')
