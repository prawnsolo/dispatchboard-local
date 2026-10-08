/**
 * Geocoding goes through the native side (Rust `geo_http_get`), in the order
 * Census → (site pin) → Google (key saved) → Nominatim, with the existing
 * Census cutoff and stat counters. No network: the transport is swapped.
 *
 * Live check of the same Rust path: `cargo test --release --lib geo:: -- --include-ignored`
 * (runs in the Windows workflow) asserts the yard lands in ZIP 22407.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CENSUS_ERROR_CIRCUIT,
  geocodeAndPersistRows,
  geocodeWithGoogle,
  geocodeWithNominatim,
  jobHasMappedPin,
  memoryCache,
  nominatimMatchFromPayload,
  runGeocodeChain,
  type GoogleLookup,
} from './geocode.ts'
import { geoGet, setGeoTransport, type GeoProvider } from './net.ts'
import { geocodeSearchCandidates } from './proximity.ts'
import { YARD } from './yard.ts'

const yardCensus = readFileSync(new URL('./fixtures/census-yard.json', import.meta.url), 'utf8')
const EMPTY_CENSUS = JSON.stringify({ result: { addressMatches: [] } })
const GOOGLE_HIT = JSON.stringify({
  status: 'OK',
  results: [{ formatted_address: '10 Main St, Spotsylvania, VA 22553, USA', geometry: { location: { lat: 38.2, lng: -77.6 } } }],
})
const GOOGLE_ZERO = JSON.stringify({ status: 'ZERO_RESULTS', results: [] })
const NOMINATIM_HOUSE = JSON.stringify([
  { lat: '38.25', lon: '-77.49', display_name: '5 Sample Ln, Fredericksburg, VA', place_rank: 30, category: 'place' },
])
const NOMINATIM_TOWN = JSON.stringify([
  { lat: '38.30', lon: '-77.46', display_name: 'Fredericksburg, Virginia', place_rank: 16, category: 'boundary' },
])

type Call = { provider: GeoProvider; url: string }
function transport(responses: Partial<Record<GeoProvider, Array<string | Error>>>) {
  const calls: Call[] = []
  const queues = { census: [...(responses.census ?? [])], google: [...(responses.google ?? [])], nominatim: [...(responses.nominatim ?? [])] }
  setGeoTransport(async (provider, url) => {
    calls.push({ provider, url })
    const next = queues[provider].shift()
    if (next === undefined) throw new Error(`unexpected ${provider} call`)
    if (next instanceof Error) throw next
    return { ok: true, status: 200, json: async () => JSON.parse(next) as unknown }
  })
  return calls
}

const google: GoogleLookup = async (line) => {
  const m = await geocodeWithGoogle(line, null, 'AIzaTESTKEY')
  return m === 'skip' ? null : m
}

// 1) Yard geocodes to ZIP 22407 through the native transport (Census answers first; no Google/OSM).
{
  const calls = transport({ census: [yardCensus] })
  const r = await runGeocodeChain(
    { address_street: '1600 Beulah Salisbury Dr', address_city_state_zip: 'Fredericksburg VA 22407' },
    memoryCache(),
    { callGoogle: true, google, callNominatim: true, nominatim: geocodeWithNominatim },
  )
  assert.equal(r.geocode_source, 'census')
  assert.match(r.matched_address ?? '', /22407$/)
  assert.ok(Math.abs((r.lat ?? 0) - YARD.lat) < 0.01 && Math.abs((r.lng ?? 0) - YARD.lng) < 0.01)
  assert.deepEqual(calls.map((c) => c.provider), ['census'])
  assert.ok(calls[0]!.url.startsWith('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?'))
}

// 2) Order: Census miss → Google (key saved) → Nominatim.
{
  const calls = transport({ census: [EMPTY_CENSUS, EMPTY_CENSUS], google: [GOOGLE_ZERO], nominatim: [NOMINATIM_HOUSE] })
  const r = await runGeocodeChain(
    { address_street: '5 Sample Ln', address_city_state_zip: 'Fredericksburg VA 22401' },
    memoryCache(),
    { callGoogle: true, google, callNominatim: true, nominatim: geocodeWithNominatim },
  )
  assert.deepEqual(calls.map((c) => c.provider), ['census', 'census', 'google', 'nominatim'])
  assert.equal(r.geocode_source, 'nominatim')
  assert.equal(r.google_called, true)
  assert.equal(r.nominatim_called, true)
  assert.ok(jobHasMappedPin(r))
  assert.ok(calls[3]!.url.startsWith('https://nominatim.openstreetmap.org/search?'))
}

// 3) Google hit stops the chain (Nominatim not called). No key → Census then Nominatim.
{
  let calls = transport({ census: [EMPTY_CENSUS, EMPTY_CENSUS], google: [GOOGLE_HIT] })
  let r = await runGeocodeChain(
    { address_street: '10 Main St', address_city_state_zip: 'Spotsylvania VA 22553' },
    memoryCache(),
    { callGoogle: true, google, callNominatim: true, nominatim: geocodeWithNominatim },
  )
  assert.equal(r.geocode_source, 'google')
  assert.deepEqual(calls.map((c) => c.provider), ['census', 'census', 'google'])

  calls = transport({ census: [EMPTY_CENSUS, EMPTY_CENSUS], nominatim: [NOMINATIM_TOWN] })
  r = await runGeocodeChain(
    { address_street: '999 Nowhere Rd', address_city_state_zip: 'Fredericksburg VA 22401' },
    memoryCache(),
    { callGoogle: false, callNominatim: true, nominatim: geocodeWithNominatim },
  )
  assert.deepEqual(calls.map((c) => c.provider), ['census', 'census', 'nominatim'])
  assert.equal(r.geocode_source, 'none', 'a town centroid is not a job pin')
}

// 4) Cached terminal miss: Nominatim + Google are not called again.
{
  const cache = memoryCache()
  transport({ census: [EMPTY_CENSUS, EMPTY_CENSUS], google: [GOOGLE_ZERO], nominatim: ['[]'] })
  const input = { address_street: '1 Lost Rd', address_city_state_zip: 'Fredericksburg VA 22401' }
  const opts = { callGoogle: true, google, callNominatim: true, nominatim: geocodeWithNominatim }
  await runGeocodeChain(input, cache, opts)
  const calls = transport({})
  const again = await runGeocodeChain(input, cache, opts)
  assert.equal(again.geocode_source, 'none')
  assert.equal(calls.length, 0)
}

// 5) Batch: stat counters + Census cutoff unchanged. 4 rows, Census transport down.
{
  const down = new Error('Census geocoder failed: connection reset')
  const calls = transport({
    // Each Census lookup tries oneline + address. Circuit opens after CENSUS_ERROR_CIRCUIT rows.
    census: Array.from({ length: CENSUS_ERROR_CIRCUIT * 2 }, () => down),
    google: [GOOGLE_HIT, GOOGLE_HIT, GOOGLE_HIT, GOOGLE_HIT],
  })
  const rows = [1, 2, 3, 4].map((id) => ({
    id,
    address_street: `${id}0 Main St`,
    address_city_state_zip: 'Spotsylvania VA 22553',
    lat: null,
    lng: null,
    geocode_source: 'none',
    geocode_address_key: null,
  }))
  const batch = await geocodeAndPersistRows(rows, memoryCache(), new Map(), async () => {}, {
    delayMs: 0,
    google,
    nominatim: geocodeWithNominatim,
  })
  assert.equal(batch.census_calls, CENSUS_ERROR_CIRCUIT, 'Census stops after the cutoff')
  assert.equal(batch.google_calls, 4)
  assert.equal(batch.nominatim_calls, 0)
  assert.equal(calls.filter((c) => c.provider === 'census').length, CENSUS_ERROR_CIRCUIT * 2)
}

// 6) Nearby: Census → Google (key) → Nominatim, all through the native transport.
{
  const calls = transport({ census: [EMPTY_CENSUS], google: [GOOGLE_ZERO], nominatim: [NOMINATIM_HOUSE] })
  const googleCandidates = async (line: string) => {
    const m = await geocodeWithGoogle(line, null, 'AIzaTESTKEY')
    return m && m !== 'skip' ? [{ lat: m.lat, lng: m.lng, label: m.matchedAddress }] : []
  }
  const found = await geocodeSearchCandidates('5 Sample Ln, Fredericksburg VA 22401', { google: googleCandidates, sleep: async () => {} })
  assert.deepEqual(calls.map((c) => c.provider), ['census', 'google', 'nominatim'])
  assert.equal(found[0]?.source, 'nominatim')
}

// 7) nominatimMatchFromPayload: street level or finer only.
assert.equal(nominatimMatchFromPayload(JSON.parse(NOMINATIM_TOWN)), null)
assert.equal(nominatimMatchFromPayload(JSON.parse(NOMINATIM_HOUSE))?.lat, 38.25)
assert.equal(nominatimMatchFromPayload({ error: 'x' }), null)

// 8) Inside Tauri the GET is an invoke of `geo_http_get` (not a webview fetch).
{
  setGeoTransport(null)
  const invoked: Array<{ cmd: string; args: unknown }> = []
  const g = globalThis as unknown as { window?: unknown }
  const hadWindow = 'window' in g
  g.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args: unknown) => {
        invoked.push({ cmd, args })
        return { status: 200, body: yardCensus }
      },
      transformCallback: () => 0,
    },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('webview fetch must not be used for geocoding')
  }) as typeof fetch
  try {
    const res = await geoGet('census', 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=x')
    assert.equal(res.status, 200)
    assert.equal(invoked[0]?.cmd, 'geo_http_get')
    assert.deepEqual(invoked[0]?.args, {
      provider: 'census',
      url: 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=x',
    })
  } finally {
    globalThis.fetch = realFetch
    if (!hadWindow) delete g.window
  }
}

setGeoTransport(null)
console.log('native-geocode.test.ts: ok (native transport, Census → Google → Nominatim, cutoff, yard 22407 fixture)')
