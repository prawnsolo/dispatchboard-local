/**
 * Five-day forecast from the National Weather Service, turned into what a
 * dispatcher needs: rain per day, extreme-weather flags, and which underground
 * tank installs a heavy rain could float before they are inspected and covered.
 *
 * Pure. Parsing, rollup and risk rules live here; fetching lives in
 * weather-store.ts. Nothing here knows anything about a customer.
 */

import { jobIcon } from './job-icons.ts'

export type WeatherThresholds = {
  /** Inches in one day that counts as heavy rain. */
  heavyRainIn: number
  /** Inches over any three days in a row that counts as extreme. */
  multiDayRainIn: number
  /** Wind gust in mph that counts as extreme. */
  gustMph: number
  hotF: number
  coldF: number
}

export const DEFAULT_THRESHOLDS: WeatherThresholds = {
  heavyRainIn: 1,
  multiDayRainIn: 2,
  gustMph: 40,
  hotF: 95,
  coldF: 20,
}

export type WeatherIconName =
  | 'sun'
  | 'cloud'
  | 'cloud-sun'
  | 'cloud-rain'
  | 'cloud-lightning'
  | 'cloud-fog'
  | 'snowflake'
  | 'wind'

export type DayWeather = {
  /** YYYY-MM-DD in New York, like the rest of the app. */
  date: string
  rainIn: number
  popPct: number | null
  highF: number | null
  lowF: number | null
  gustMph: number | null
  summary: string
  icon: WeatherIconName
}

export type WeatherAlert = {
  event: string
  severity: string
  headline: string
  onset: string | null
  ends: string | null
}

export type WeatherSnapshot = {
  fetchedAt: number
  days: DayWeather[]
  alerts: WeatherAlert[]
}

// ---------------------------------------------------------------- time helpers

const NY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })

export function nyDateKey(at: Date): string {
  return NY_DATE.format(at)
}

const HOUR = 3_600_000

/** ISO-8601 duration like PT6H, PT30M, P1D or P1DT12H, in milliseconds. */
export function parseDuration(raw: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(raw)
  if (!m) return null
  const [, d, h, min] = m
  const ms = (Number(d ?? 0) * 24 + Number(h ?? 0)) * HOUR + Number(min ?? 0) * 60_000
  return ms > 0 ? ms : null
}

/** "2026-10-09T12:00:00+00:00/PT6H" to a start and end. */
export function parseValidTime(raw: string): { start: Date; end: Date } | null {
  const [from, dur] = raw.split('/')
  if (!from || !dur) return null
  const start = new Date(from)
  const ms = parseDuration(dur)
  if (Number.isNaN(start.getTime()) || ms == null) return null
  return { start, end: new Date(start.getTime() + ms) }
}

// ---------------------------------------------------------------- grid data

type GridSeries = { uom?: string; values?: Array<{ validTime?: string; value?: number | null }> }

export type NwsGrid = {
  properties?: {
    temperature?: GridSeries
    quantitativePrecipitation?: GridSeries
    probabilityOfPrecipitation?: GridSeries
    windGust?: GridSeries
  }
}

export type NwsForecast = {
  properties?: {
    periods?: Array<{
      startTime?: string
      endTime?: string
      isDaytime?: boolean
      shortForecast?: string
    }>
  }
}

function toF(value: number, uom: string | undefined): number {
  if (uom?.includes('degF')) return value
  if (uom?.includes('degK')) return ((value - 273.15) * 9) / 5 + 32
  return (value * 9) / 5 + 32
}

function toMm(value: number, uom: string | undefined): number {
  if (uom?.includes('[in_i]') || uom?.endsWith(':in')) return value * 25.4
  if (uom?.endsWith(':cm')) return value * 10
  return value
}

function toMph(value: number, uom: string | undefined): number {
  if (uom?.includes('[mi_i]')) return value
  if (uom?.includes('m_s-1')) return value * 2.236936
  if (uom?.includes('knot')) return value * 1.150779
  return value * 0.621371 // km/h
}

/** Split [start,end) into real-clock hour slices, each tagged with its New York day. */
function slices(start: Date, end: Date): Array<{ day: string; share: number }> {
  const total = end.getTime() - start.getTime()
  if (total <= 0) return []
  const out: Array<{ day: string; share: number }> = []
  for (let t = start.getTime(); t < end.getTime(); ) {
    const next = Math.min(end.getTime(), t + HOUR)
    out.push({ day: nyDateKey(new Date((t + next) / 2)), share: (next - t) / total })
    t = next
  }
  return out
}

/** Per-day total of an amount series (rain). An interval's amount is shared by the time in each day. */
function sumByDay(series: GridSeries | undefined, convert: (v: number, uom?: string) => number): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of series?.values ?? []) {
    if (row.value == null || !row.validTime) continue
    const span = parseValidTime(row.validTime)
    if (!span) continue
    const amount = convert(row.value, series?.uom)
    for (const part of slices(span.start, span.end)) {
      out.set(part.day, (out.get(part.day) ?? 0) + amount * part.share)
    }
  }
  return out
}

/** Highest and lowest value of a level series that touches each day. */
function extremesByDay(
  series: GridSeries | undefined,
  convert: (v: number, uom?: string) => number,
): Map<string, { max: number; min: number }> {
  const out = new Map<string, { max: number; min: number }>()
  for (const row of series?.values ?? []) {
    if (row.value == null || !row.validTime) continue
    const span = parseValidTime(row.validTime)
    if (!span) continue
    const value = convert(row.value, series?.uom)
    for (const part of slices(span.start, span.end)) {
      const cur = out.get(part.day)
      if (!cur) out.set(part.day, { max: value, min: value })
      else {
        cur.max = Math.max(cur.max, value)
        cur.min = Math.min(cur.min, value)
      }
    }
  }
  return out
}

function iconFor(summary: string, rainIn: number, gustMph: number | null): WeatherIconName {
  const s = summary.toLowerCase()
  if (/thunder|t-storm/.test(s)) return 'cloud-lightning'
  if (/snow|sleet|ice|flurr|wintry|freezing/.test(s)) return 'snowflake'
  if (rainIn >= 0.1 || /rain|shower|drizzle/.test(s)) return 'cloud-rain'
  if (/fog|haze|mist|smoke/.test(s)) return 'cloud-fog'
  if (gustMph != null && gustMph >= 40) return 'wind'
  if (/partly|mostly sunny|mostly clear|few clouds/.test(s)) return 'cloud-sun'
  if (/cloud|overcast/.test(s)) return 'cloud'
  if (/sunny|clear|fair/.test(s)) return 'sun'
  return 'cloud-sun'
}

function summaryFor(forecast: NwsForecast | null | undefined, day: string): string {
  const periods = (forecast?.properties?.periods ?? []).filter((p) => p.startTime && nyDateKey(new Date(p.startTime)) === day)
  const pick = periods.find((p) => p.isDaytime) ?? periods[0]
  return pick?.shortForecast ?? ''
}

/** Five days starting at `from` (YYYY-MM-DD, New York). */
export function rollupDays(grid: NwsGrid, forecast: NwsForecast | null | undefined, from: string, count = 5): DayWeather[] {
  const p = grid.properties ?? {}
  const rain = sumByDay(p.quantitativePrecipitation, toMm)
  const temp = extremesByDay(p.temperature, toF)
  const pop = extremesByDay(p.probabilityOfPrecipitation, (v) => v)
  const gust = extremesByDay(p.windGust, toMph)
  const days: DayWeather[] = []
  let cursor = new Date(`${from}T12:00:00Z`)
  for (let i = 0; i < count; i++) {
    const date = cursor.toISOString().slice(0, 10)
    cursor = new Date(cursor.getTime() + 24 * HOUR)
    const t = temp.get(date)
    const g = gust.get(date)
    const rainIn = Math.round(((rain.get(date) ?? 0) / 25.4) * 100) / 100
    const summary = summaryFor(forecast, date)
    // A day with no data at all is not a day we can speak for.
    if (!t && !rain.has(date) && !summary) continue
    days.push({
      date,
      rainIn,
      popPct: pop.has(date) ? Math.round(pop.get(date)!.max) : null,
      highF: t ? Math.round(t.max) : null,
      lowF: t ? Math.round(t.min) : null,
      gustMph: g ? Math.round(g.max) : null,
      summary,
      icon: iconFor(summary, rainIn, g ? g.max : null),
    })
  }
  return days
}

export function parseAlerts(payload: unknown): WeatherAlert[] {
  const features = (payload as { features?: Array<{ properties?: Record<string, unknown> }> } | null)?.features ?? []
  const rank: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 }
  const out: WeatherAlert[] = []
  for (const f of features) {
    const a = f.properties ?? {}
    if (typeof a.event !== 'string') continue
    out.push({
      event: a.event,
      severity: typeof a.severity === 'string' ? a.severity : 'Unknown',
      headline: typeof a.headline === 'string' ? a.headline : a.event,
      onset: typeof a.onset === 'string' ? a.onset : typeof a.effective === 'string' ? a.effective : null,
      ends: typeof a.ends === 'string' ? a.ends : typeof a.expires === 'string' ? a.expires : null,
    })
  }
  return out.sort((x, y) => (rank[x.severity] ?? 4) - (rank[y.severity] ?? 4))
}

// ---------------------------------------------------------------- what it means

export type RainLevel = 'none' | 'some' | 'heavy' | 'extreme'

export type DayAssessment = {
  date: string
  rain: RainLevel
  /** Plain-language reasons this day is flagged. Empty for an ordinary day. */
  reasons: string[]
  /** The part of `reasons` about water: rain amounts and flood alerts. */
  rainReasons: string[]
  /** Name of the flood alert covering this day, if any. */
  flood: string | null
  windy: boolean
  hot: boolean
  cold: boolean
}

const FLOOD = /flood/i

function floodAlertDays(alerts: readonly WeatherAlert[], days: readonly DayWeather[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const alert of alerts) {
    if (!FLOOD.test(alert.event)) continue
    const from = alert.onset ? nyDateKey(new Date(alert.onset)) : days[0]?.date
    const to = alert.ends ? nyDateKey(new Date(alert.ends)) : days[days.length - 1]?.date
    if (!from || !to) continue
    for (const day of days) if (day.date >= from && day.date <= to) out.set(day.date, alert.event)
  }
  return out
}

export function inches(value: number): string {
  return `${value < 10 ? value.toFixed(value < 0.095 ? 2 : 1) : Math.round(value)} in`
}

export function assessDays(days: readonly DayWeather[], th: WeatherThresholds, alerts: readonly WeatherAlert[] = []): DayAssessment[] {
  const flood = floodAlertDays(alerts, days)
  const out: DayAssessment[] = days.map((d) => {
    const reasons: string[] = []
    let rain: RainLevel = d.rainIn >= 0.1 ? 'some' : 'none'
    if (d.rainIn >= th.heavyRainIn) {
      rain = 'heavy'
      reasons.push(`${inches(d.rainIn)} of rain`)
    }
    const alert = flood.get(d.date) ?? null
    if (alert) {
      if (rain !== 'heavy') rain = 'heavy'
      reasons.push(alert)
    }
    const rainReasons = [...reasons]
    const windy = d.gustMph != null && d.gustMph >= th.gustMph
    const hot = d.highF != null && d.highF >= th.hotF
    const cold = d.lowF != null && d.lowF <= th.coldF
    if (windy) reasons.push(`gusts to ${d.gustMph} mph`)
    if (hot) reasons.push(`high of ${d.highF}°F`)
    if (cold) reasons.push(`low of ${d.lowF}°F`)
    return { date: d.date, rain, reasons, rainReasons, flood: alert, windy, hot, cold }
  })
  // Three wet days in a row can be as bad as one downpour.
  const spans = days.length >= 3 ? days.length - 2 : days.length > 0 ? 1 : 0
  for (let i = 0; i < spans; i++) {
    const window = days.slice(i, i + 3)
    const total = window.reduce((sum, d) => sum + d.rainIn, 0)
    if (total < th.multiDayRainIn) continue
    for (let k = i; k < i + window.length; k++) {
      if (days[k]!.rainIn < 0.1) continue
      const a = out[k]!
      if (a.rain !== 'heavy') a.rain = 'extreme'
      const note = `${inches(total)} over ${window.length} days`
      if (!a.reasons.includes(note)) a.reasons.push(note)
      if (!a.rainReasons.includes(note)) a.rainReasons.push(note)
    }
  }
  return out
}

export function isWetWarning(a: DayAssessment | undefined): boolean {
  return a?.rain === 'heavy' || a?.rain === 'extreme'
}

export type TankRisk = {
  jobId: number
  date: string
  /** The day the rain is the problem, and why. */
  rainDate: string
  reason: string
}

type RiskJob = {
  id: number
  schedule_date: string | null
  is_capacity_block?: number | boolean | null
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
  location_definition?: string | null
  activity_note?: string | null
}

function shiftYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10)
}

/**
 * Underground tank installs the forecast puts at risk. A tank set in the ground
 * stays uncovered until it is inspected and backfilled, and a wet hole can float
 * it. So an install is flagged when heavy or extreme rain lands on its day, the
 * day before (the hole is already wet) or the day after (still uncovered).
 */
export function tankRisks(jobs: readonly RiskJob[], assessed: readonly DayAssessment[]): TankRisk[] {
  const byDate = new Map(assessed.map((a) => [a.date, a]))
  const out: TankRisk[] = []
  for (const job of jobs) {
    if (job.is_capacity_block || !job.schedule_date) continue
    if (jobIcon(job).icon !== 'tank-ug') continue
    if (!byDate.has(job.schedule_date)) continue
    for (const offset of [0, -1, 1]) {
      const rainDate = shiftYmd(job.schedule_date, offset)
      const a = byDate.get(rainDate)
      if (!isWetWarning(a)) continue
      out.push({ jobId: job.id, date: job.schedule_date, rainDate, reason: a!.rainReasons.join(', ') })
      break
    }
  }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.jobId - y.jobId)
}
