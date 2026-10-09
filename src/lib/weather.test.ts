import assert from 'node:assert/strict'
import {
  assessDays,
  DEFAULT_THRESHOLDS,
  inches,
  nyDateKey,
  parseAlerts,
  parseDuration,
  parseValidTime,
  rollupDays,
  tankRisks,
  type DayWeather,
  type NwsGrid,
} from './weather.ts'

// Durations and valid times.
assert.equal(parseDuration('PT6H'), 6 * 3_600_000)
assert.equal(parseDuration('PT30M'), 30 * 60_000)
assert.equal(parseDuration('P1DT6H'), 30 * 3_600_000)
assert.equal(parseDuration('nope'), null)
const span = parseValidTime('2026-10-09T12:00:00+00:00/PT6H')!
assert.equal(span.end.getTime() - span.start.getTime(), 6 * 3_600_000)
assert.equal(parseValidTime('garbage'), null)

// New York day keys follow the local clock, not UTC.
assert.equal(nyDateKey(new Date('2026-10-10T02:30:00Z')), '2026-10-09')
assert.equal(nyDateKey(new Date('2026-10-10T04:30:00Z')), '2026-10-10')

// A grid payload shaped like the real one. October is EDT, UTC-4.
// Rain: 0.5 in (12.7 mm) over 12 h that straddles local midnight (8pm to 8am).
const grid: NwsGrid = {
  properties: {
    quantitativePrecipitation: {
      uom: 'wmoUnit:mm',
      values: [
        { validTime: '2026-10-10T00:00:00+00:00/PT12H', value: 12.7 },
        { validTime: '2026-10-10T12:00:00+00:00/PT12H', value: 30 },
        { validTime: '2026-10-11T00:00:00+00:00/PT24H', value: 0 },
      ],
    },
    temperature: {
      uom: 'wmoUnit:degC',
      values: [
        { validTime: '2026-10-09T16:00:00+00:00/PT1H', value: 20 },
        { validTime: '2026-10-09T20:00:00+00:00/PT1H', value: 25 },
        { validTime: '2026-10-10T08:00:00+00:00/PT1H', value: 10 },
        { validTime: '2026-10-10T18:00:00+00:00/PT1H', value: 18 },
      ],
    },
    probabilityOfPrecipitation: {
      uom: 'wmoUnit:percent',
      values: [{ validTime: '2026-10-10T12:00:00+00:00/PT12H', value: 85 }],
    },
    windGust: {
      uom: 'wmoUnit:km_h-1',
      values: [{ validTime: '2026-10-10T14:00:00+00:00/PT3H', value: 80 }],
    },
  },
}
const forecast = {
  properties: {
    periods: [
      { startTime: '2026-10-09T06:00:00-04:00', isDaytime: true, shortForecast: 'Mostly Sunny' },
      { startTime: '2026-10-10T06:00:00-04:00', isDaytime: true, shortForecast: 'Showers And Thunderstorms' },
    ],
  },
}
const days = rollupDays(grid, forecast, '2026-10-09', 3)
const byDate = Object.fromEntries(days.map((d) => [d.date, d]))
// 8pm to midnight on the 9th is 4 of the first 12 hours: a third of 12.7 mm.
assert.equal(byDate['2026-10-09']!.rainIn, 0.17)
// The rest of that block (8 h) plus the 12 h block is the 10th: 8.47 + 30 mm.
assert.equal(byDate['2026-10-10']!.rainIn, 1.51)
assert.equal(byDate['2026-10-10']!.popPct, 85)
assert.equal(byDate['2026-10-10']!.gustMph, 50) // 80 km/h
assert.equal(byDate['2026-10-09']!.highF, 77)
assert.equal(byDate['2026-10-09']!.icon, 'cloud-rain') // 0.17 in of rain outranks "Mostly Sunny"
assert.equal(byDate['2026-10-10']!.icon, 'cloud-lightning')

const week: DayWeather[] = [0.0, 1.2, 0.3, 0.9, 0.2].map((rainIn, i) => ({
  date: `2026-10-0${i + 9 > 9 ? i + 9 : '9'}`,
  rainIn,
  popPct: null,
  highF: 70,
  lowF: 50,
  gustMph: 10,
  summary: '',
  icon: 'cloud' as const,
}))
week[0]!.date = '2026-10-09'
week[1]!.date = '2026-10-10'
week[2]!.date = '2026-10-11'
week[3]!.date = '2026-10-12'
week[4]!.date = '2026-10-13'
const a = assessDays(week, DEFAULT_THRESHOLDS)
assert.equal(a[0]!.rain, 'none')
assert.equal(a[1]!.rain, 'heavy')
assert.match(a[1]!.reasons.join(' '), /1\.2 in of rain/)
// 1.2 + 0.3 + 0.9 = 2.4 in over 3 days is extreme for the days that got wet; the heavy day stays heavy.
assert.equal(a[2]!.rain, 'extreme')
assert.equal(a[3]!.rain, 'extreme')
assert.match(a[2]!.reasons.join(' '), /2\.4 in over 3 days/)

// Thresholds are the user's to change.
const strict = assessDays(week, { ...DEFAULT_THRESHOLDS, heavyRainIn: 0.25, multiDayRainIn: 9 })
assert.equal(strict[2]!.rain, 'heavy')
assert.equal(strict[4]!.rain, 'some')
const lax = assessDays(week, { ...DEFAULT_THRESHOLDS, heavyRainIn: 5, multiDayRainIn: 9 })
assert.ok(lax.every((d) => d.rain === 'none' || d.rain === 'some'))

// Wind, heat and cold.
const rough: DayWeather = { ...week[0]!, gustMph: 45, highF: 97, lowF: 18 }
const r = assessDays([rough], DEFAULT_THRESHOLDS)[0]!
assert.deepEqual([r.windy, r.hot, r.cold], [true, true, true])

// Flood alerts count as heavy rain even when the model amount is small.
const alerts = parseAlerts({
  features: [
    { properties: { event: 'Wind Advisory', severity: 'Minor', onset: '2026-10-09T10:00:00-04:00', ends: '2026-10-09T20:00:00-04:00' } },
    { properties: { event: 'Flood Watch', severity: 'Moderate', headline: 'Flood Watch until Sunday', onset: '2026-10-12T08:00:00-04:00', ends: '2026-10-13T20:00:00-04:00' } },
    { properties: { severity: 'Severe' } },
  ],
})
assert.deepEqual(alerts.map((x) => x.event), ['Flood Watch', 'Wind Advisory'])
const flooded = assessDays(week, { ...DEFAULT_THRESHOLDS, heavyRainIn: 9, multiDayRainIn: 99 }, alerts)
assert.equal(flooded[3]!.rain, 'heavy')
assert.equal(flooded[4]!.rain, 'heavy')
assert.equal(flooded[2]!.rain, 'some')
assert.match(flooded[3]!.reasons.join(' '), /Flood Watch/)

// Tank risk: UG installs on, the day after, or the day before a warning day. Nothing else.
const job = (id: number, date: string | null, activity: string, extra: Record<string, unknown> = {}) => ({
  id,
  schedule_date: date,
  activity_1: activity,
  ...extra,
})
const risks = tankRisks(
  [
    job(1, '2026-10-10', 'TANK INSTALL (UG)'), // heavy day itself
    job(2, '2026-10-09', 'TANK INSTALL (UG)'), // day before heavy
    job(3, '2026-10-13', 'TANK INSTALL (UG)'), // wet window, 3 days after nothing heavy but extreme on 12th
    job(4, '2026-10-09', 'TANK INSTALL (AG)'), // above ground: not floatable
    job(5, '2026-10-10', 'GAS CHECK'),
    job(6, null, 'TANK INSTALL (UG)'),
    job(7, '2026-10-10', 'TANK INSTALL (UG)', { is_capacity_block: 1 }),
    job(8, '2026-10-20', 'TANK INSTALL (UG)'), // outside the forecast
  ],
  a,
)
assert.deepEqual(risks.map((x) => x.jobId), [2, 1, 3])
assert.equal(risks[0]!.rainDate, '2026-10-10')
assert.equal(risks[1]!.rainDate, '2026-10-10')
assert.match(risks[0]!.reason, /1\.2 in of rain/)
// A calm week flags nothing.
assert.deepEqual(tankRisks([job(1, '2026-10-10', 'TANK INSTALL (UG)')], assessDays(week, { ...DEFAULT_THRESHOLDS, heavyRainIn: 5, multiDayRainIn: 99 })), [])

assert.equal(inches(0.04), '0.04 in')
assert.equal(inches(0.4), '0.4 in')
assert.equal(inches(1.04), '1.0 in')
assert.equal(inches(12.3), '12 in')

console.log('weather.test.ts: ok')
