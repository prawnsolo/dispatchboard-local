import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import {
  CensusGeocoderError,
  GoogleGeocoderError,
  applyGeocodeCounts,
  censusOnelineUrl,
  geocodeAndPersistRows,
  geocodeWithGoogle,
  googleMatchFromPayload,
  jobHasMappedPin,
  memoryCache,
  normalizeAddressKey,
  runGeocodeChain,
  type CensusLookup,
  type GoogleLookup,
} from './geocode.ts'
import { normalizePastedGoogleKey } from './google-key.ts'
import { geocodeStoredJobs } from './geocode-db.ts'
import {
  readAllowNetworkGeocoding,
  writeAllowNetworkGeocoding,
  NETWORK_GEOCODE_KEY,
} from './prefs.ts'
import {
  geocodeSearchCandidates,
  haversineMiles,
  minutesToMiles,
  nearbyJobDistances,
  searchQueries,
  circlePolygon,
} from './proximity.ts'
import {
  SCHEMA_STATEMENTS,
  blankJobDraft,
  ensureSchema,
  saveJob,
  saveManualPin,
  updateJobAddress,
  wipeDatabase,
  type SqlDb,
} from './store.ts'
import { YARD } from './yard.ts'

const require = createRequire(import.meta.url)

type SqlJsDatabase = {
  run(sql: string, params?: readonly unknown[]): void
  prepare(sql: string): {
    bind(params?: readonly unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, string | number | null | Uint8Array>
    free(): void
  }
}

function wrap(db: SqlJsDatabase): SqlDb {
  return {
    async execute(sql, params) {
      if (params && params.length) db.run(sql, params)
      else db.run(sql)
      const idStmt = db.prepare('SELECT last_insert_rowid() AS id')
      const stepped = idStmt.step()
      const row = stepped ? idStmt.getAsObject() : null
      idStmt.free()
      const id = row?.id
      return { lastInsertId: typeof id === 'number' && id > 0 ? id : null }
    },
    async select(sql, params) {
      const stmt = db.prepare(sql)
      if (params && params.length) stmt.bind(params)
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows as never
    },
  }
}

async function memoryDb(): Promise<SqlDb> {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  return wrap(new SQL.Database() as unknown as SqlJsDatabase)
}

const hit: CensusLookup = async () => ({ lat: 38.301, lng: -77.47, matchedAddress: '1 MAIN ST, FREDERICKSBURG, VA, 22401' })

assert.equal(normalizeAddressKey('  1 main st ', 'Fredericksburg VA 22401'), '1 MAIN ST|FREDERICKSBURG VA 22401')
assert.equal(normalizeAddressKey('1 MAIN ST', 'Fredericksburg VA 22401 / other'), '1 MAIN ST|FREDERICKSBURG VA 22401')
assert.equal(normalizeAddressKey('  ', ''), null)
assert.ok(censusOnelineUrl('https://geocoding.geo.census.gov/geocoder', '1 MAIN ST, FREDERICKSBURG VA 22401').includes('benchmark=Public_AR_Current'))

const cache = memoryCache()
const first = await runGeocodeChain(
  { address_street: '1 MAIN ST', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  cache,
  { census: hit },
)
assert.equal(first.geocode_source, 'census')
assert.equal(first.census_called, true)
assert.equal(first.lat, 38.301)
const second = await runGeocodeChain(
  { address_street: '1 main st', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  cache,
  {
    census: async () => {
      throw new Error('Census must not be called on a cache hit')
    },
  },
)
assert.equal(second.census_called, false)
assert.equal(second.lat, 38.301)
assert.equal(second.geocode_source, 'census')

const missCache = memoryCache()
const missed = await runGeocodeChain(
  {
    address_street: '9 NOWHERE RD',
    address_city_state_zip: 'FREDERICKSBURG VA 22401',
    site: { lat: 38.2, lng: -77.5 },
  },
  missCache,
  { census: async () => null },
)
assert.equal(missed.geocode_source, 'site_pin')
assert.equal(missed.lat, 38.2)
assert.equal(missed.census_called, true)
const missedAgain = await runGeocodeChain(
  {
    address_street: '9 NOWHERE RD',
    address_city_state_zip: 'FREDERICKSBURG VA 22401',
    site: { lat: 38.2, lng: -77.5 },
  },
  missCache,
  {
    census: async () => {
      throw new Error('cached miss must not call Census')
    },
  },
)
assert.equal(missedAgain.census_called, false)
assert.equal(missedAgain.geocode_source, 'site_pin')

const offline = await runGeocodeChain(
  {
    address_street: '9 NOWHERE RD',
    address_city_state_zip: 'FREDERICKSBURG VA 22408',
    site: { lat: 38.11, lng: -77.44 },
  },
  memoryCache(),
  {
    callCensus: false,
    census: async () => {
      throw new Error('network geocoding is off')
    },
  },
)
assert.equal(offline.census_called, false)
assert.equal(offline.geocode_source, 'site_pin')
assert.equal(offline.lat, 38.11)

const outageCache = memoryCache()
const outage = await runGeocodeChain(
  { address_street: '1 MAIN ST', address_city_state_zip: 'FREDERICKSBURG VA 22401', site: { lat: 38.1, lng: -77.4 } },
  outageCache,
  {
    census: async () => {
      throw new CensusGeocoderError('down')
    },
  },
)
assert.equal(outage.census_error, true)
assert.equal(outage.geocode_source, 'site_pin')
assert.equal(outageCache.get('1 MAIN ST|FREDERICKSBURG VA 22401'), undefined)

let calls = 0
const failing: CensusLookup = async () => {
  calls++
  throw new CensusGeocoderError('down')
}
const batchRows = [1, 2, 3, 4].map((id) => ({
  id,
  address_street: `${id} MAIN ST`,
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  lat: null,
  lng: null,
  geocode_source: 'none',
  geocode_address_key: null,
  is_capacity_block: 0,
}))
const batch = await geocodeAndPersistRows(batchRows, memoryCache(), new Map(), async () => {}, {
  delayMs: 0,
  census: failing,
})
assert.equal(calls, 3, 'Census circuit opens after 3 transport errors')
assert.equal(batch.geocode_errors, 3)
assert.equal(batch.census_calls, 3)

const counts = applyGeocodeCounts(
  [
    { lat: 1, lng: 2, geocode_source: 'census', is_capacity_block: 0 },
    { lat: null, lng: null, geocode_source: 'none', is_capacity_block: 0 },
    { lat: 1, lng: 2, geocode_source: 'census', is_capacity_block: 1 },
  ],
  0,
)
assert.equal(counts.geocoded, 1)
assert.equal(counts.still_unmapped, 1)
assert.equal(jobHasMappedPin({ lat: 1, lng: 2, geocode_source: 'manual' }), true)
assert.equal(jobHasMappedPin({ lat: 1, lng: 2, geocode_source: 'none' }), false)

assert.equal(haversineMiles(YARD.lat, YARD.lng, YARD.lat, YARD.lng), 0)
const oneDegree = haversineMiles(38, -77, 39, -77)
assert.ok(Math.abs(oneDegree - 69.1) < 1, `expected ~69 miles, got ${oneDegree}`)
assert.equal(minutesToMiles(30), 15)
const distances = nearbyJobDistances(
  [
    { id: 1, lat: YARD.lat, lng: YARD.lng },
    { id: 2, lat: YARD.lat + 1, lng: YARD.lng },
  ],
  { lat: YARD.lat, lng: YARD.lng, label: 'yard', source: 'census' },
  10,
)
assert.equal(distances.size, 1)
assert.ok(distances.has('1'))
const queries = searchQueries('376 Greenbank Rd')
assert.ok(queries.some((q) => q.includes('VA')))
const choices = await geocodeSearchCandidates('376 Greenbank Rd', {
  census: async () => [],
  nominatim: async () => [{ lat: 38.25, lng: -77.49, label: 'Greenbank Road (street-level, approximate)' }],
  sleep: async () => {},
})
assert.equal(choices.length, 1)
assert.equal(choices[0]?.source, 'nominatim')
const ring = circlePolygon(choices[0]!, 5, 8)
const coords = ring.geometry.coordinates[0]!
assert.ok(Math.abs((coords[0]![0] ?? 0) - (coords[coords.length - 1]![0] ?? 0)) < 1e-6)
assert.ok(Math.abs((coords[0]![1] ?? 0) - (coords[coords.length - 1]![1] ?? 0)) < 1e-6)

assert.equal(YARD.lat, 38.284478)
assert.equal(YARD.lng, -77.4529472)

const mem = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value)
    },
    removeItem: (key: string) => {
      mem.delete(key)
    },
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  },
})
mem.clear()
assert.equal(readAllowNetworkGeocoding(), false)
writeAllowNetworkGeocoding(true)
assert.equal(mem.get(NETWORK_GEOCODE_KEY), '1')
assert.equal(readAllowNetworkGeocoding(), true)
writeAllowNetworkGeocoding(false)
assert.equal(readAllowNetworkGeocoding(), false)

const migrated = await memoryDb()
for (const sql of SCHEMA_STATEMENTS) await migrated.execute(sql)
const before = await migrated.select<{ name: string }>('PRAGMA table_info(jobs)')
assert.equal(before.some((col) => col.name === 'lat'), false)
await ensureSchema(migrated)
const after = await migrated.select<{ name: string }>('PRAGMA table_info(jobs)')
for (const name of ['lat', 'lng', 'geocode_source', 'geocode_address_key']) {
  assert.equal(after.some((col) => col.name === name), true, name)
}
const siteCols = await migrated.select<{ name: string }>('PRAGMA table_info(sites)')
for (const name of ['lat', 'lng', 'pin_source']) {
  assert.equal(siteCols.some((col) => col.name === name), true, name)
}
const cacheTable = await migrated.select<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'geocode_cache'",
)
assert.equal(cacheTable.length, 1)

const db = await memoryDb()
const created = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'PIN CUSTOMER',
  customer_number: '42',
  service_location_number: '1',
  address_street: '1 MAIN ST',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  schedule_date: '2026-09-02',
})
const summary = await geocodeStoredJobs(db, [created.id], {
  allowNetwork: true,
  delayMs: 0,
  census: hit,
  google: async () => {
    throw new Error('Google must not run after a Census hit')
  },
})
assert.equal(summary.geocoded, 1)
assert.equal(summary.still_unmapped, 0)
assert.equal(summary.census_calls, 1)
assert.equal(summary.network, true)
const stored = await db.select<{ lat: number; lng: number; geocode_source: string }>(
  'SELECT lat, lng, geocode_source FROM jobs WHERE id = ?',
  [created.id],
)
assert.equal(stored[0]?.geocode_source, 'census')
assert.equal(stored[0]?.lat, 38.301)
const cached = await db.select<{ address_key: string; lat: number; geocode_source: string }>(
  'SELECT address_key, lat, geocode_source FROM geocode_cache',
)
assert.equal(cached.length, 1)
assert.equal(cached[0]?.geocode_source, 'census')
assert.equal(cached[0]?.address_key, '1 MAIN ST|FREDERICKSBURG VA 22401')

let liveCalls = 0
const again = await geocodeStoredJobs(db, [created.id], {
  allowNetwork: true,
  delayMs: 0,
  census: async () => {
    liveCalls++
    return { lat: 1, lng: 2, matchedAddress: 'should not replace' }
  },
})
assert.equal(liveCalls, 0)
assert.equal(again.census_calls, 0)
assert.equal(again.geocoded, 1)

const sibling = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'PIN CUSTOMER',
  customer_number: '42',
  service_location_number: '1',
  address_street: '500 OTHER RD',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  schedule_date: '2026-09-03',
})
await saveManualPin(db, { jobId: created.id, lat: 38.284478, lng: -77.4529472, saveOnSite: true })
const site = await db.select<{ lat: number; lng: number; pin_source: string }>(
  'SELECT lat, lng, pin_source FROM sites WHERE customer_number = ? AND service_location_number = ?',
  ['42', 1],
)
assert.equal(site[0]?.pin_source, 'manual')
assert.equal(site[0]?.lat, 38.284478)
const fromSite = await geocodeStoredJobs(db, [sibling.id], {
  allowNetwork: false,
  delayMs: 0,
  census: async () => {
    throw new Error('Census must stay off')
  },
  google: async () => {
    throw new Error('Google must stay off when network geocoding is off')
  },
  googleApiKey: 'pasted-key-must-not-be-used',
})
assert.equal(fromSite.network, false)
assert.equal(fromSite.census_calls, 0)
assert.equal(fromSite.geocoded, 1)
const siblingRow = await db.select<{ geocode_source: string; lat: number }>(
  'SELECT geocode_source, lat FROM jobs WHERE id = ?',
  [sibling.id],
)
assert.equal(siblingRow[0]?.geocode_source, 'site_pin')
assert.equal(siblingRow[0]?.lat, 38.284478)

await updateJobAddress(db, created.id, {
  address_street: '2 MAIN ST',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
})
const cleared = await db.select<{ lat: number | null; geocode_source: string }>(
  'SELECT lat, geocode_source FROM jobs WHERE id = ?',
  [created.id],
)
assert.equal(cleared[0]?.lat, null)
assert.equal(cleared[0]?.geocode_source, 'none')

await wipeDatabase(db)
const left = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM geocode_cache')
assert.equal(Number(left[0]?.n), 0)

assert.equal(normalizePastedGoogleKey('  abc-123  '), 'abc-123')
assert.equal(normalizePastedGoogleKey(''), null)
assert.equal(normalizePastedGoogleKey('has space'), null)
assert.equal(normalizePastedGoogleKey('line\nbreak'), null)
assert.equal(normalizePastedGoogleKey('x'.repeat(257)), null)

assert.equal(googleMatchFromPayload({ status: 'ZERO_RESULTS', results: [] }), null)
assert.deepEqual(
  googleMatchFromPayload({
    status: 'OK',
    results: [{ formatted_address: '9 NOWHERE RD', geometry: { location: { lat: 38.4, lng: -77.6 } } }],
  }),
  { lat: 38.4, lng: -77.6, matchedAddress: '9 NOWHERE RD' },
)
assert.throws(
  () => googleMatchFromPayload({ status: 'REQUEST_DENIED', error_message: 'key rejected' }),
  (err: unknown) => err instanceof GoogleGeocoderError && !String(err).includes('secret-key'),
)

const previousFetch = globalThis.fetch
const previousGoogleEnv = process.env.GOOGLE_MAPS_API_KEY
process.env.GOOGLE_MAPS_API_KEY = 'env-key-must-not-be-used'
let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls++
  throw new Error('fetch must not run without a pasted key')
}
const skippedGoogle = await geocodeWithGoogle('1 MAIN ST', 'FREDERICKSBURG VA 22401', null)
assert.equal(skippedGoogle, 'skip')
assert.equal(fetchCalls, 0)
const skippedEnv = await runGeocodeChain(
  { address_street: '8 ENV RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  memoryCache(),
  { census: async () => null },
)
assert.equal(skippedEnv.geocode_source, 'none')
assert.equal(skippedEnv.google_called, false)
assert.equal(fetchCalls, 0)

const googleHit: GoogleLookup = async () => ({
  lat: 38.41,
  lng: -77.61,
  matchedAddress: '9 NOWHERE RD, FREDERICKSBURG, VA 22401',
})
let googleCalls = 0
const countingGoogle: GoogleLookup = async (line) => {
  googleCalls++
  assert.equal(line, '9 NOWHERE RD, FREDERICKSBURG VA 22401')
  return googleHit(line)
}
const googleCache = memoryCache()
const fromGoogle = await runGeocodeChain(
  { address_street: '9 NOWHERE RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  googleCache,
  { census: async () => null, callGoogle: true, google: countingGoogle },
)
assert.equal(fromGoogle.geocode_source, 'google')
assert.equal(fromGoogle.census_called, true)
assert.equal(fromGoogle.google_called, true)
assert.equal(fromGoogle.lat, 38.41)
assert.equal(googleCalls, 1)
assert.equal(googleCache.get('9 NOWHERE RD|FREDERICKSBURG VA 22401')?.geocode_source, 'google')

googleCalls = 0
const googleAfterCachedMiss = await runGeocodeChain(
  { address_street: '9 NOWHERE RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  googleCache,
  {
    census: async () => {
      throw new Error('cached address must not call Census again')
    },
    callGoogle: true,
    google: async () => {
      googleCalls++
      throw new Error('cached Google hit must not call Google again')
    },
  },
)
assert.equal(googleAfterCachedMiss.census_called, false)
assert.equal(googleAfterCachedMiss.google_called, false)
assert.equal(googleAfterCachedMiss.geocode_source, 'google')
assert.equal(googleCalls, 0)

const siteBeatsGoogle = await runGeocodeChain(
  {
    address_street: '10 SITE RD',
    address_city_state_zip: 'FREDERICKSBURG VA 22401',
    site: { lat: 38.2, lng: -77.5 },
  },
  memoryCache(),
  {
    census: async () => null,
    callGoogle: true,
    google: async () => {
      throw new Error('site pin must win over Google')
    },
  },
)
assert.equal(siteBeatsGoogle.geocode_source, 'site_pin')
assert.equal(siteBeatsGoogle.google_called, false)

const censusOutageFallsBackToGoogle = await runGeocodeChain(
  { address_street: '11 OUTAGE RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  memoryCache(),
  {
    census: async () => {
      throw new CensusGeocoderError('down')
    },
    callGoogle: true,
    google: async () => ({ lat: 38.3, lng: -77.46, matchedAddress: '11 Outage Rd (Google)' }),
  },
)
assert.equal(censusOutageFallsBackToGoogle.census_error, true)
assert.equal(censusOutageFallsBackToGoogle.google_called, true)
assert.equal(censusOutageFallsBackToGoogle.geocode_source, 'google')
assert.equal(censusOutageFallsBackToGoogle.lat, 38.3)
assert.equal(censusOutageFallsBackToGoogle.lng, -77.46)

const censusOutageRecovered = await geocodeAndPersistRows(
  [
    {
      id: 11,
      address_street: '11 OUTAGE RD',
      address_city_state_zip: 'FREDERICKSBURG VA 22401',
      lat: null,
      lng: null,
      geocode_source: 'none',
      geocode_address_key: null,
      is_capacity_block: 0,
    },
  ],
  memoryCache(),
  new Map(),
  async () => {},
  {
    delayMs: 0,
    census: async () => {
      throw new CensusGeocoderError('waf')
    },
    google: async () => ({ lat: 38.3, lng: -77.46, matchedAddress: '11 Outage Rd (Google)' }),
  },
)
assert.equal(censusOutageRecovered.geocode_errors, 0, 'Google hit after Census outage is not a geocode error')
assert.equal(censusOutageRecovered.google_calls, 1)
assert.equal(censusOutageRecovered.census_calls, 1)

const noneThenGoogle = memoryCache()
const censusOnlyMiss = await runGeocodeChain(
  { address_street: '12 LATER RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  noneThenGoogle,
  { census: async () => null },
)
assert.equal(censusOnlyMiss.geocode_source, 'none')
assert.equal(censusOnlyMiss.google_called, false)
let laterGoogle = 0
const promoted = await runGeocodeChain(
  { address_street: '12 LATER RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  noneThenGoogle,
  {
    census: async () => {
      throw new Error('Census miss is already cached')
    },
    callGoogle: true,
    google: async () => {
      laterGoogle++
      return { lat: 38.12, lng: -77.12, matchedAddress: '12 LATER RD' }
    },
  },
)
assert.equal(laterGoogle, 1)
assert.equal(promoted.census_called, false)
assert.equal(promoted.geocode_source, 'google')
assert.equal(promoted.lat, 38.12)

const googleMissCache = memoryCache()
const googleMiss = await runGeocodeChain(
  { address_street: '13 MISS RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  googleMissCache,
  { census: async () => null, callGoogle: true, google: async () => null },
)
assert.equal(googleMiss.geocode_source, 'none')
assert.equal(googleMiss.google_called, true)
assert.equal(googleMissCache.get('13 MISS RD|FREDERICKSBURG VA 22401')?.geocode_source, 'google')
const googleMissAgain = await runGeocodeChain(
  { address_street: '13 MISS RD', address_city_state_zip: 'FREDERICKSBURG VA 22401' },
  googleMissCache,
  {
    census: async () => {
      throw new Error('Google miss must not call Census')
    },
    callGoogle: true,
    google: async () => {
      throw new Error('Google ZERO_RESULTS must not be retried')
    },
  },
)
assert.equal(googleMissAgain.google_called, false)
assert.equal(googleMissAgain.geocode_source, 'none')

let googleErrors = 0
const googleCircuit = await geocodeAndPersistRows(
  [1, 2, 3, 4].map((id) => ({
    id,
    address_street: `${id} GOOGLE ST`,
    address_city_state_zip: 'FREDERICKSBURG VA 22401',
    lat: null,
    lng: null,
    geocode_source: 'none',
    geocode_address_key: null,
    is_capacity_block: 0,
  })),
  memoryCache(),
  new Map(),
  async () => {},
  {
    delayMs: 0,
    census: async () => null,
    google: async () => {
      googleErrors++
      throw new GoogleGeocoderError('quota')
    },
  },
)
assert.equal(googleErrors, 3, 'Google circuit opens after 3 transport errors')
assert.equal(googleCircuit.google_calls, 0)
assert.equal(googleCircuit.geocode_errors, 3)
assert.equal(googleCircuit.census_calls, 4)

const googleJob = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'GOOGLE CUSTOMER',
  customer_number: '77',
  address_street: '14 KEY RD',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  schedule_date: '2026-09-04',
})
globalThis.fetch = async (input) => {
  fetchCalls++
  const url = String(input)
  assert.ok(url.startsWith('https://maps.googleapis.com/maps/api/geocode/json?'))
  assert.ok(url.includes('key=test-key-not-real'))
  assert.equal(url.includes('VITE_'), false)
  assert.equal(url.includes('env-key-must-not-be-used'), false)
  return new Response(
    JSON.stringify({
      status: 'OK',
      results: [
        {
          formatted_address: '14 KEY RD, FREDERICKSBURG, VA 22401',
          geometry: { location: { lat: 38.44, lng: -77.64 } },
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
const keyed = await geocodeStoredJobs(db, [googleJob.id], {
  allowNetwork: true,
  delayMs: 0,
  census: async () => null,
  googleApiKey: 'test-key-not-real',
})
assert.equal(keyed.google_calls, 1)
assert.equal(keyed.census_calls, 1)
assert.equal(keyed.geocoded, 1)
assert.equal(fetchCalls, 1)
const keyedRow = await db.select<{ geocode_source: string; lat: number }>(
  'SELECT geocode_source, lat FROM jobs WHERE id = ?',
  [googleJob.id],
)
assert.equal(keyedRow[0]?.geocode_source, 'google')
assert.equal(keyedRow[0]?.lat, 38.44)
const keyedCache = await db.select<{ geocode_source: string }>(
  'SELECT geocode_source FROM geocode_cache WHERE address_key = ?',
  ['14 KEY RD|FREDERICKSBURG VA 22401'],
)
assert.equal(keyedCache[0]?.geocode_source, 'google')

const deniedJob = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'DENIED CUSTOMER',
  customer_number: '78',
  address_street: '15 DENIED RD',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  schedule_date: '2026-09-05',
})
globalThis.fetch = async () =>
  new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'key rejected' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
const denied = await geocodeStoredJobs(db, [deniedJob.id], {
  allowNetwork: true,
  delayMs: 0,
  census: async () => null,
  googleApiKey: 'test-key-not-real',
})
assert.equal(denied.geocoded, 0)
assert.equal(denied.still_unmapped, 1)
assert.equal(denied.google_calls, 0)
assert.ok(denied.geocode_errors >= 1)
const deniedCache = await db.select<{ geocode_source: string }>(
  'SELECT geocode_source FROM geocode_cache WHERE address_key = ?',
  ['15 DENIED RD|FREDERICKSBURG VA 22401'],
)
assert.equal(deniedCache.length, 0, 'a Google API error must not be cached as a miss')

globalThis.fetch = previousFetch
if (previousGoogleEnv === undefined) delete process.env.GOOGLE_MAPS_API_KEY
else process.env.GOOGLE_MAPS_API_KEY = previousGoogleEnv

console.log('geocode cache ok: census chain, site pin, opt-in off, Google paste-key, manual pin, migration')

{
  const { pinConfidence } = await import('./geocode.ts')
  assert.equal(pinConfidence('nominatim').level, 'check')
  assert.equal(pinConfidence('census').level, 'good')
  assert.equal(pinConfidence('manual').level, 'high')
  assert.equal(pinConfidence(null).level, 'none')
}
