/**
 * Five-day forecast: opt-in, off by default.
 *
 * What leaves the PC: the yard's coordinates, rounded to two decimals (about a
 * mile), to api.weather.gov. Nothing about a job, a customer or an address.
 * The call runs in Rust like the geocoders (see src-tauri/src/geo.rs).
 *
 * The last answer is kept in localStorage so the screens fill in at once and an
 * outage still shows yesterday's numbers, labelled as old.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { geoGet, type GeoHttpResponse } from './net.ts'
import { todayInNewYork } from './format.ts'
import {
  DEFAULT_THRESHOLDS,
  parseAlerts,
  rollupDays,
  type NwsForecast,
  type NwsGrid,
  type WeatherAlert,
  type WeatherSnapshot,
  type WeatherThresholds,
} from './weather.ts'
import { YARD } from './yard.ts'

export const WEATHER_ENABLED_KEY = 'dispatchboard.local.weatherEnabled'
export const WEATHER_THRESHOLDS_KEY = 'dispatchboard.local.weatherThresholds'
export const WEATHER_CACHE_KEY = 'dispatchboard.local.weatherCache'

/** Refresh when the last answer is older than this. */
export const WEATHER_STALE_MS = 2 * 3_600_000
const API = 'https://api.weather.gov'

export class WeatherError extends Error {}

// ---------------------------------------------------------------- fetching

type Get = (url: string) => Promise<GeoHttpResponse>

type Urls = { grid: string; forecast: string }

/** Two decimals is about a mile: plenty for a 2.5 km forecast grid, and less exact than the street. */
export function roundedPoint(lat: number, lng: number): { lat: string; lng: string } {
  return { lat: lat.toFixed(2), lng: lng.toFixed(2) }
}

async function json(get: Get, url: string): Promise<unknown> {
  let res: GeoHttpResponse
  try {
    res = await get(url)
  } catch {
    throw new WeatherError("Couldn't reach the weather service. Check the internet connection.")
  }
  if (res.status === 404) throw new WeatherError("The weather service doesn't cover this location.")
  if (!res.ok) throw new WeatherError('The weather service is busy. Try again in a few minutes.')
  try {
    return await res.json()
  } catch {
    throw new WeatherError('The weather service sent something unreadable. Try again in a few minutes.')
  }
}

function nwsUrl(url: unknown, prefix: string): string {
  if (typeof url !== 'string' || !url.startsWith(`${API}${prefix}`)) {
    throw new WeatherError('The weather service sent something unexpected. Try again later.')
  }
  return url
}

/** The slow, flaky part gets one retry. */
async function withRetry<T>(work: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof WeatherError && /doesn't cover/.test(err.message)) throw err
    await wait(1200)
    return work()
  }
}

export async function fetchSnapshot(
  get: Get,
  point: { lat: number; lng: number },
  opts: { now?: Date; urls?: Urls | null; wait?: (ms: number) => Promise<void> } = {},
): Promise<{ snapshot: WeatherSnapshot; urls: Urls }> {
  const now = opts.now ?? new Date()
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const p = roundedPoint(point.lat, point.lng)

  let urls = opts.urls ?? null
  if (!urls) {
    const found = (await withRetry(() => json(get, `${API}/points/${p.lat},${p.lng}`), wait)) as {
      properties?: { forecastGridData?: unknown; forecast?: unknown }
    }
    urls = {
      grid: nwsUrl(found.properties?.forecastGridData, '/gridpoints/'),
      forecast: nwsUrl(found.properties?.forecast, '/gridpoints/'),
    }
  }

  const [grid, forecast, alerts] = await Promise.allSettled([
    withRetry(() => json(get, urls!.grid), wait),
    withRetry(() => json(get, urls!.forecast), wait),
    withRetry(() => json(get, `${API}/alerts/active?point=${p.lat},${p.lng}`), wait),
  ])
  if (grid.status === 'rejected') throw grid.reason
  const days = rollupDays(
    grid.value as NwsGrid,
    forecast.status === 'fulfilled' ? (forecast.value as NwsForecast) : null,
    todayInNewYork(now),
  )
  if (days.length === 0) throw new WeatherError('The weather service had no forecast for this location right now.')
  const list: WeatherAlert[] = alerts.status === 'fulfilled' ? parseAlerts(alerts.value) : []
  return { snapshot: { fetchedAt: now.getTime(), days, alerts: list }, urls }
}

// ---------------------------------------------------------------- settings + cache

function readJson<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked: the forecast still works for this session.
  }
}

export function readWeatherEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(WEATHER_ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function parseThresholds(raw: unknown): WeatherThresholds {
  const out = { ...DEFAULT_THRESHOLDS }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof WeatherThresholds>) {
      const v = (raw as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        const sane = key === 'coldF' ? v >= -40 && v <= 60 : v > 0 && v <= 200
        if (sane) out[key] = v
      }
    }
  }
  return out
}

type CacheEntry = { point: string; urls: Urls | null; snapshot: WeatherSnapshot }

function readCache(): CacheEntry | null {
  const c = readJson<CacheEntry>(WEATHER_CACHE_KEY)
  if (!c || !c.snapshot || !Array.isArray(c.snapshot.days)) return null
  const p = roundedPoint(YARD.lat, YARD.lng)
  return c.point === `${p.lat},${p.lng}` ? c : null
}

// ---------------------------------------------------------------- shared state

export type WeatherStatus = 'off' | 'loading' | 'ok' | 'error'

export type WeatherState = {
  enabled: boolean
  status: WeatherStatus
  snapshot: WeatherSnapshot | null
  error: string | null
  thresholds: WeatherThresholds
}

const listeners = new Set<() => void>()
let urlsCache: Urls | null = null
let inFlight: Promise<void> | null = null

function initial(): WeatherState {
  const enabled = readWeatherEnabled()
  const cached = enabled ? readCache() : null
  urlsCache = cached?.urls ?? null
  return {
    enabled,
    status: enabled ? (cached ? 'ok' : 'loading') : 'off',
    snapshot: cached?.snapshot ?? null,
    error: null,
    thresholds: parseThresholds(readJson(WEATHER_THRESHOLDS_KEY)),
  }
}

let state: WeatherState = initial()

function set(next: Partial<WeatherState>): void {
  state = { ...state, ...next }
  for (const fn of listeners) fn()
}

/** Tests only: start over from storage. */
export function resetWeatherState(): void {
  inFlight = null
  state = initial()
}

export function getWeatherState(): WeatherState {
  return state
}

export function setWeatherEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WEATHER_ENABLED_KEY, enabled ? '1' : '0')
      if (!enabled) localStorage.removeItem(WEATHER_CACHE_KEY)
    }
  } catch {
    // The in-memory state still follows the choice.
  }
  if (!enabled) {
    urlsCache = null
    set({ enabled: false, status: 'off', snapshot: null, error: null })
    return
  }
  set({ enabled: true, status: state.snapshot ? 'ok' : 'loading', error: null })
  void refreshWeather(true)
}

export function setWeatherThresholds(next: WeatherThresholds): void {
  const clean = parseThresholds(next)
  writeJson(WEATHER_THRESHOLDS_KEY, clean)
  set({ thresholds: clean })
}

export function weatherIsStale(snapshot: WeatherSnapshot | null, now = new Date()): boolean {
  if (!snapshot) return true
  if (now.getTime() - snapshot.fetchedAt > WEATHER_STALE_MS) return true
  // Fetched yesterday: the first day on the strip is no longer today.
  return snapshot.days[0]?.date !== undefined && snapshot.days[0].date < todayInNewYork(now)
}

export function refreshWeather(force = false, get: Get = (url) => geoGet('nws', url)): Promise<void> {
  if (!state.enabled) return Promise.resolve()
  if (inFlight) return inFlight
  if (!force && !weatherIsStale(state.snapshot)) return Promise.resolve()
  set({ status: state.snapshot ? state.status : 'loading', error: null })
  const run = (async () => {
    try {
      const got = await fetchSnapshot(get, YARD, { urls: urlsCache })
      urlsCache = got.urls
      const p = roundedPoint(YARD.lat, YARD.lng)
      writeJson(WEATHER_CACHE_KEY, { point: `${p.lat},${p.lng}`, urls: got.urls, snapshot: got.snapshot } satisfies CacheEntry)
      set({ status: 'ok', snapshot: got.snapshot, error: null })
    } catch (err) {
      // A bad grid URL (the service moved the cell) is worth one clean start.
      urlsCache = null
      set({
        status: 'error',
        error: err instanceof WeatherError ? err.message : "Couldn't reach the weather service. Check the internet connection.",
      })
    } finally {
      inFlight = null
    }
  })()
  inFlight = run
  return run
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Current forecast state. Passive: safe to use in every small badge. */
export function useWeatherState(): WeatherState {
  return useSyncExternalStore(subscribe, getWeatherState, getWeatherState)
}

/** Mount once at the top of the app: refresh when the last answer is old, then every half hour. */
export function useWeatherRefresh(): void {
  const { enabled } = useWeatherState()
  useEffect(() => {
    void refreshWeather()
    const timer = setInterval(() => void refreshWeather(), 30 * 60_000)
    return () => clearInterval(timer)
  }, [enabled])
}
