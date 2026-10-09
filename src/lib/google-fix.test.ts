import assert from 'node:assert/strict'
import { memoryCache, runGeocodeChain, normalizeAddressKey } from './geocode.ts'
import { googleErrorLine, googleFixState, notFoundLine, unmappedFixableIds } from './google-fix.ts'

const base = { unmapped: 3, networkAllowed: true, hasKey: true, googleErrors: 0 }

assert.deepEqual(googleFixState({ ...base, unmapped: 0 }), { kind: 'none' })
assert.deepEqual(googleFixState({ ...base, networkAllowed: false, hasKey: false }), { kind: 'allow-network', count: 3 })
assert.deepEqual(googleFixState({ ...base, hasKey: false }), { kind: 'need-key', count: 3 })
assert.deepEqual(googleFixState({ ...base, googleErrors: 2 }), { kind: 'google-error', count: 3 })
assert.deepEqual(googleFixState(base), { kind: 'google-missed', count: 3 })

assert.equal(notFoundLine(1, true), "1 address couldn't be found, even with Google.")
assert.equal(notFoundLine(4, true), "4 addresses couldn't be found, even with Google.")
assert.equal(notFoundLine(2, false), "2 addresses couldn't be found.")

assert.match(googleErrorLine('REQUEST_DENIED: The provided API key is invalid'), /Geocoding API/)
assert.match(googleErrorLine('OVER_QUERY_LIMIT'), /over its limit/)
assert.match(googleErrorLine('network timeout'), /reach Google/)
assert.doesNotMatch(googleErrorLine('key AIzaSyFAKEKEY denied'), /AIza/)

const job = (id: number, street: string | null, lat: number | null, src: string | null, cap = 0) => ({
  id,
  address_street: street,
  lat,
  lng: lat == null ? null : -77,
  geocode_source: src,
  is_capacity_block: cap,
})
assert.deepEqual(
  unmappedFixableIds([
    job(1, '1 MAIN ST', null, 'none'),
    job(2, '2 MAIN ST', 38, 'census'),
    job(3, null, null, 'none'),
    job(4, '4 MAIN ST', null, null, 1),
    job(5, '5 MAIN ST', 38, 'nominatim'),
    job(6, '  ', null, 'none'),
    job(7, '7 OAK RD', null, 'nominatim'),
  ]),
  [1, 7],
)

// "Try again with Google": an OpenStreetMap miss from before the key existed must not block it.
const input = { address_street: '9 NOWHERE LN', address_city_state_zip: 'STAFFORD VA 22554', site: null }
const key = normalizeAddressKey(input.address_street, input.address_city_state_zip)!
const missed = () =>
  memoryCache([
    { address_key: key, lat: null, lng: null, geocode_source: 'nominatim', matched_address: null, address_street: input.address_street, address_city_state_zip: input.address_city_state_zip },
  ])
let googleCalls = 0
const google = async () => {
  googleCalls++
  return { lat: 38.4, lng: -77.4, matchedAddress: '9 Nowhere Ln' }
}
let osmCalls = 0
const nominatim = async () => {
  osmCalls++
  return null
}
const plain = await runGeocodeChain(input, missed(), { callCensus: false, callGoogle: true, google, callNominatim: true, nominatim })
assert.equal(plain.geocode_source, 'none')
assert.equal(googleCalls, 0, 'a cached OpenStreetMap miss stays final on a normal run')
const retry = await runGeocodeChain(input, missed(), { callCensus: false, callGoogle: true, google, callNominatim: true, nominatim, retryGoogle: true })
assert.equal(retry.geocode_source, 'google')
assert.equal(googleCalls, 1)
assert.equal(osmCalls, 0, 'retry does not ask OpenStreetMap again')

// A recorded Google miss stays final: same key, same answer.
const googleMissed = memoryCache([
  { address_key: key, lat: null, lng: null, geocode_source: 'google', matched_address: null, address_street: input.address_street, address_city_state_zip: input.address_city_state_zip },
])
const again = await runGeocodeChain(input, googleMissed, { callCensus: false, callGoogle: true, google, retryGoogle: true })
assert.equal(again.geocode_source, 'none')
assert.equal(googleCalls, 1)

console.log('google-fix.test.ts: ok')
