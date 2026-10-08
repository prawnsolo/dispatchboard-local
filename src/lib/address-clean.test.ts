import assert from 'node:assert/strict'
import { cleanStreetForLookup, streetWithoutUnit } from './address-clean.ts'
import {
  censusOnelineUrl,
  googleGeocoderDirectUrl,
  googleMatchFromPayload,
  isCoarseGoogleResult,
  memoryCache,
  oneLineAddress,
  runGeocodeChain,
} from './geocode.ts'

// Plain addresses pass through untouched.
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('12 OLD GATE RD'), '12 OLD GATE RD')

// Anything identifying is cut before a request is built.
assert.equal(cleanStreetForLookup("100 SAMPLE HOLLOW TR **NOAH'S HOUSE**"), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR (SAMPLE CONTACT A)'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR C/O SAMPLE CONTACT B'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR GATE CODE 1234'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR 540-555-0101'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup('100 SAMPLE HOLLOW TR sample@example.com'), '100 SAMPLE HOLLOW TR')
assert.equal(cleanStreetForLookup(null), '')

// Unit stripping only when it changes something.
assert.equal(streetWithoutUnit('100 SAMPLE HOLLOW TR APT 4B'), '100 SAMPLE HOLLOW TR')
assert.equal(streetWithoutUnit('100 SAMPLE HOLLOW TR #12'), '100 SAMPLE HOLLOW TR')
assert.equal(streetWithoutUnit('100 SAMPLE HOLLOW TR LOT 7'), '100 SAMPLE HOLLOW TR')
assert.equal(streetWithoutUnit('100 SAMPLE HOLLOW TR'), null)

// Every outbound URL carries the address and nothing else.
const dirty = "100 SAMPLE HOLLOW TR **NOAH'S HOUSE** C/O SAMPLE CONTACT A 540-555-0101"
const line = oneLineAddress(dirty, 'SAMPLETOWN VA 22407')
assert.equal(line, '100 SAMPLE HOLLOW TR, SAMPLETOWN VA 22407')
for (const url of [censusOnelineUrl('https://x.test', line!), googleGeocoderDirectUrl(line!, 'KEY')]) {
  const decoded = decodeURIComponent(url)
  assert.ok(!/NOAH|CONTACT|555|\*\*/.test(decoded), decoded)
}

// Coarse Google answers are misses, precise ones are hits.
assert.equal(isCoarseGoogleResult(['postal_code'], 'APPROXIMATE'), true)
assert.equal(isCoarseGoogleResult(['route'], 'GEOMETRIC_CENTER'), true)
assert.equal(isCoarseGoogleResult(['locality', 'political'], undefined), true)
assert.equal(isCoarseGoogleResult(['street_address'], 'ROOFTOP'), false)
assert.equal(isCoarseGoogleResult(['route'], 'RANGE_INTERPOLATED'), false)
assert.equal(isCoarseGoogleResult(undefined, undefined), false)
const body = (types: string[], location_type: string) => ({
  status: 'OK',
  results: [{ formatted_address: 'X', types, geometry: { location: { lat: 38, lng: -77 }, location_type } }],
})
assert.equal(googleMatchFromPayload(body(['postal_code'], 'APPROXIMATE')), null)
assert.equal(googleMatchFromPayload(body(['street_address'], 'ROOFTOP'))?.lat, 38)

// Chain: Google gets a second, unit-free try after a miss.
{
  const seen: string[] = []
  const result = await runGeocodeChain(
    { address_street: '100 SAMPLE HOLLOW TR APT 4B', address_city_state_zip: 'SAMPLETOWN VA 22407', site: null },
    memoryCache(),
    {
      callCensus: true,
      census: async () => null,
      callGoogle: true,
      google: async (l) => {
        seen.push(l)
        return l.includes('APT') ? null : { lat: 38.1, lng: -77.1, matchedAddress: 'M' }
      },
    },
  )
  assert.equal(result.geocode_source, 'google')
  assert.deepEqual(seen, [
    '100 SAMPLE HOLLOW TR APT 4B, SAMPLETOWN VA 22407',
    '100 SAMPLE HOLLOW TR, SAMPLETOWN VA 22407',
  ])
}

console.log('address-clean tests passed')
