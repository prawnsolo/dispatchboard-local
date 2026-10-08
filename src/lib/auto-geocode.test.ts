import assert from 'node:assert/strict'
import { localToday, pickAutoGeocodeIds, type AutoGeocodeCandidate } from './auto-geocode.ts'

const base: AutoGeocodeCandidate = {
  id: 1,
  is_capacity_block: 0,
  schedule_date: '2026-10-10',
  address_street: '100 SAMPLE HOLLOW TR',
  address_city_state_zip: 'SAMPLETOWN VA 22407',
  lat: null,
  lng: null,
  geocode_source: 'none',
  geocode_address_key: null,
}
const row = (over: Partial<AutoGeocodeCandidate>): AutoGeocodeCandidate => ({ ...base, ...over })

const rows = [
  row({ id: 1 }),
  row({ id: 2, schedule_date: '2026-10-09' }), // sooner, goes first
  row({ id: 3, schedule_date: '2026-10-07' }), // past
  row({ id: 4, is_capacity_block: 1 }), // capacity block
  row({ id: 5, address_street: null, address_city_state_zip: null }), // no address
  row({ id: 6, lat: 38, lng: -77, geocode_source: 'census', geocode_address_key: '100 SAMPLE HOLLOW TR|SAMPLETOWN VA 22407' }), // already mapped
  row({ id: 7, lat: 38, lng: -77, geocode_source: 'census', geocode_address_key: 'OLD ADDRESS|X VA 22407' }), // address edited since
  row({ id: 8, lat: 38, lng: -77, geocode_source: 'manual', geocode_address_key: 'OLD ADDRESS|X VA 22407' }), // hand pin, leave alone
  row({ id: 9, schedule_date: null }), // undated
]
assert.deepEqual(pickAutoGeocodeIds(rows, '2026-10-08'), [2, 1, 7])
assert.deepEqual(pickAutoGeocodeIds(rows, '2026-10-08', 2), [2, 1])
assert.match(localToday(new Date(2026, 9, 8)), /^2026-10-08$/)
console.log('auto-geocode tests passed')
