/** Browser-only stand-in for @tauri-apps/api/core (VITE_PREVIEW=1). */
;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ??= {}

try {
  // Skip the first-run network prompt; preview never makes network calls.
  if (localStorage.getItem('dispatchboard.local.allowNetworkGeocoding') === null) {
    localStorage.setItem('dispatchboard.local.allowNetworkGeocoding', '0')
  }
} catch {
  // storage blocked: the prompt just shows
}

const query = new URLSearchParams(location.search)

const GRID = 'https://api.weather.gov/gridpoints/LWX/84,87'

/**
 * Scripted National Weather Service answers for screenshots.
 * `?weather=rain` heavy rain tomorrow and a flood watch, `calm` a dry week, `down` an outage.
 */
function nwsReply(url: string): { status: number; body: string } {
  const script = query.get('weather')
  if (!script) throw new Error('Network lookups are off in preview.')
  if (script === 'down') throw new Error('offline')
  const ok = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })
  if (url.includes('/points/')) return ok({ properties: { forecastGridData: GRID, forecast: `${GRID}/forecast` } })
  const dayMs = 24 * 3_600_000
  // Start of today in New York, close enough for a picture: 04:00 UTC.
  const d = new Date()
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4) - (d.getUTCHours() < 4 ? dayMs : 0)
  const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', '+00:00')
  if (url.includes('/alerts/')) {
    return ok({
      features:
        script === 'rain'
          ? [{ properties: { event: 'Flood Watch', severity: 'Moderate', headline: 'Flood Watch', onset: iso(start + dayMs), ends: iso(start + 3 * dayMs) } }]
          : [],
    })
  }
  const rainByDay = script === 'rain' ? [0.05, 1.4, 0.6, 0.0, 0.3] : [0, 0, 0.02, 0, 0]
  const summaries =
    script === 'rain'
      ? ['Mostly Cloudy', 'Showers And Thunderstorms', 'Light Rain', 'Mostly Sunny', 'Chance Light Rain']
      : ['Sunny', 'Mostly Sunny', 'Partly Cloudy', 'Sunny', 'Mostly Sunny']
  if (url.endsWith('/forecast')) {
    return ok({ properties: { periods: summaries.map((shortForecast, i) => ({ startTime: iso(start + i * dayMs + 10 * 3_600_000), isDaytime: true, shortForecast })) } })
  }
  const rain: Array<{ validTime: string; value: number }> = []
  const temp: Array<{ validTime: string; value: number }> = []
  const pop: Array<{ validTime: string; value: number }> = []
  const gust: Array<{ validTime: string; value: number }> = []
  for (let i = 0; i < 5; i++) {
    for (let b = 0; b < 4; b++) rain.push({ validTime: `${iso(start + i * dayMs + b * 6 * 3_600_000)}/PT6H`, value: (rainByDay[i]! * 25.4) / 4 })
    temp.push({ validTime: `${iso(start + i * dayMs + 6 * 3_600_000)}/PT1H`, value: 9 + i })
    temp.push({ validTime: `${iso(start + i * dayMs + 18 * 3_600_000)}/PT1H`, value: 22 - i })
    pop.push({ validTime: `${iso(start + i * dayMs)}/PT24H`, value: rainByDay[i]! > 0.1 ? 80 : 10 })
    gust.push({ validTime: `${iso(start + i * dayMs + 12 * 3_600_000)}/PT3H`, value: script === 'rain' && i === 1 ? 72 : 25 })
  }
  return ok({
    properties: {
      quantitativePrecipitation: { uom: 'wmoUnit:mm', values: rain },
      temperature: { uom: 'wmoUnit:degC', values: temp },
      probabilityOfPrecipitation: { uom: 'wmoUnit:percent', values: pop },
      windGust: { uom: 'wmoUnit:km_h-1', values: gust },
    },
  })
}
// `?key=1` pretends a Google key is saved. `?google=miss|deny|ok` scripts what Google answers.
let savedKey: string | null = query.get('key') === '1' ? 'PREVIEW-KEY-0000' : null

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  switch (cmd) {
    case 'db_path':
      return 'preview (in memory)' as T
    case 'google_api_key_get':
      return savedKey as T
    case 'google_api_key_set':
      savedKey = ((args as { key?: string } | undefined)?.key ?? '') || null
      return undefined as T
    case 'backup_target':
      return 'preview-backup.db' as T
    case 'list_backups':
      return [
        { name: 'dispatchboard-20261008-081500.db', size: 1_480_000, modified_ms: Date.now() - 9 * 3_600_000, before_restore: false },
        { name: 'dispatchboard-20261007-081500.db', size: 1_470_000, modified_ms: Date.now() - 33 * 3_600_000, before_restore: false },
        { name: 'before-restore-1760000000.db', size: 1_390_000, modified_ms: Date.now() - 96 * 3_600_000, before_restore: true },
      ] as T
    case 'restore_stage':
    case 'restart_app':
      return undefined as T
    case 'restore_result_take':
      return null as T
    case 'geo_http_get': {
      const { provider, url } = args as { provider: string; url: string }
      if (provider === 'nws') return nwsReply(url) as T
      const script = query.get('google')
      if (!script) throw new Error('Network lookups are off in preview.')
      const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body) }) as T
      if (provider === 'census') return reply({ result: { addressMatches: [] } })
      if (provider === 'nominatim') return reply([])
      if (script === 'deny') return reply({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' })
      if (script === 'ok') {
        return reply({
          status: 'OK',
          results: [{ formatted_address: 'Preview', types: ['street_address'], geometry: { location: { lat: 38.31, lng: -77.46 }, location_type: 'ROOFTOP' } }],
        })
      }
      return reply({ status: 'ZERO_RESULTS', results: [] })
    }
    default:
      throw new Error(`Unknown command in preview: ${cmd}`)
  }
}
