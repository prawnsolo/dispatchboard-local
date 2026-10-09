import assert from 'node:assert/strict'
import { fetchSnapshot, parseThresholds, roundedPoint, weatherIsStale, WeatherError } from './weather-store.ts'
import { DEFAULT_THRESHOLDS } from './weather.ts'
import type { GeoHttpResponse } from './net.ts'
import { YARD } from './yard.ts'

const res = (status: number, body: unknown): GeoHttpResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const noWait = async () => {}

const GRID = 'https://api.weather.gov/gridpoints/LWX/84,87'
const grid = {
  properties: {
    quantitativePrecipitation: { uom: 'wmoUnit:mm', values: [{ validTime: '2026-10-10T12:00:00+00:00/PT12H', value: 30 }] },
    temperature: { uom: 'wmoUnit:degC', values: [{ validTime: '2026-10-10T14:00:00+00:00/PT1H', value: 18 }] },
  },
}

function server(overrides: Record<string, GeoHttpResponse | (() => GeoHttpResponse)> = {}) {
  const seen: string[] = []
  const get = async (url: string) => {
    seen.push(url)
    for (const [needle, reply] of Object.entries(overrides)) {
      if (url.includes(needle)) return typeof reply === 'function' ? reply() : reply
    }
    if (url.includes('/points/')) return res(200, { properties: { forecastGridData: GRID, forecast: `${GRID}/forecast` } })
    if (url.endsWith('/forecast')) return res(200, { properties: { periods: [{ startTime: '2026-10-10T06:00:00-04:00', isDaytime: true, shortForecast: 'Rain' }] } })
    if (url.includes('/alerts/')) return res(200, { features: [] })
    return res(200, grid)
  }
  return { get, seen }
}

const now = new Date('2026-10-10T14:00:00Z')

// Only the yard's rounded coordinates go out. No customer, address or job data can be in these URLs.
const ok = server()
const got = await fetchSnapshot(ok.get, YARD, { now, wait: noWait })
assert.equal(got.snapshot.days[0]!.date, '2026-10-10')
assert.equal(got.snapshot.days[0]!.rainIn, 1.18)
assert.deepEqual(roundedPoint(YARD.lat, YARD.lng), { lat: '38.28', lng: '-77.45' })
for (const url of ok.seen) {
  assert.ok(url.startsWith('https://api.weather.gov/'), url)
  assert.ok(!/customer|address|street|wo_|name/i.test(url), url)
}
assert.equal(ok.seen.filter((u) => u.includes('/points/')).length, 1)
assert.ok(ok.seen.some((u) => u.includes('/alerts/active?point=38.28,-77.45')))

// Second time around, the cached grid URLs skip the lookup.
const again = server()
await fetchSnapshot(again.get, YARD, { now, urls: got.urls, wait: noWait })
assert.equal(again.seen.filter((u) => u.includes('/points/')).length, 0)

// Alerts and the text forecast are extras: losing them still gives a forecast.
const noExtras = server({ '/alerts/': res(503, {}), '/forecast': res(503, {}) })
const partial = await fetchSnapshot(noExtras.get, YARD, { now, wait: noWait })
assert.equal(partial.snapshot.alerts.length, 0)
assert.equal(partial.snapshot.days.length > 0, true)

// The grid itself is not: say so in plain words.
const noGrid = server({ '/gridpoints/LWX/84,87': res(503, {}) })
await assert.rejects(() => fetchSnapshot(noGrid.get, YARD, { now, wait: noWait }), (e: unknown) => e instanceof WeatherError && /busy/.test(e.message))

// One retry for a flaky answer.
let tries = 0
const flaky = server({ '/points/': () => (++tries === 1 ? res(500, {}) : res(200, { properties: { forecastGridData: GRID, forecast: `${GRID}/forecast` } })) })
await fetchSnapshot(flaky.get, YARD, { now, wait: noWait })
assert.equal(tries, 2)

// A location the service does not cover is not retried.
let outside = 0
const away = server({ '/points/': () => (outside++, res(404, {})) })
await assert.rejects(() => fetchSnapshot(away.get, YARD, { now, wait: noWait }), /doesn't cover/)
assert.equal(outside, 1)

// Offline.
await assert.rejects(
  () => fetchSnapshot(async () => { throw new Error('dns') }, YARD, { now, wait: noWait }),
  /Check the internet connection/,
)

// A reply that points somewhere else is refused, not followed.
const rogue = server({ '/points/': res(200, { properties: { forecastGridData: 'https://evil.test/x', forecast: 'https://evil.test/y' } }) })
await assert.rejects(() => fetchSnapshot(rogue.get, YARD, { now, wait: noWait }), /unexpected/)
assert.ok(!rogue.seen.some((u) => u.includes('evil.test')))

// Staleness.
const snap = got.snapshot
assert.equal(weatherIsStale(snap, new Date(now.getTime() + 3_600_000)), false)
assert.equal(weatherIsStale(snap, new Date(now.getTime() + 3 * 3_600_000)), true)
assert.equal(weatherIsStale(snap, new Date(snap.fetchedAt + 1_000)), false)
assert.equal(weatherIsStale({ ...snap, days: [{ ...snap.days[0]!, date: '2026-10-08' }] }, new Date(snap.fetchedAt + 1_000)), true)
assert.equal(weatherIsStale(null), true)

// Thresholds: bad input falls back to the defaults, good input sticks.
assert.deepEqual(parseThresholds(null), DEFAULT_THRESHOLDS)
assert.deepEqual(parseThresholds({ heavyRainIn: -3, multiDayRainIn: 'x', gustMph: 55 }), { ...DEFAULT_THRESHOLDS, gustMph: 55 })
assert.equal(parseThresholds({ coldF: -5 }).coldF, -5)

console.log('weather-store.test.ts: ok')
