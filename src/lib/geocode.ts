/**
 * Local geocode chain: Census → site pin → Google → Unmapped.
 *
 * Port of the office chain in `src/lib/geocode.ts`, without Supabase and
 * without the office Try Google shortcut. Census is a public HTTP call to
 * geocoding.geo.census.gov. Callers must pass `callCensus: false` until the
 * user has allowed network geocoding. A Census transport failure is not
 * cached, so a later retry can run. A genuine empty match is cached as
 * `none` and is not sent to Census again.
 *
 * Google Geocoding runs after a Census miss or Census transport failure, only
 * when there is no usable site pin, and only when the caller passes a lookup
 * (resolved key from Settings disk file or `VITE_GOOGLE_MAPS_API_KEY`, plus
 * network geocoding already allowed). A Census WAF/outage must not block Google
 * when a key is present. No key means the chain stays Census → site pin → unmapped.
 *
 * Census, Google, and Nominatim GETs run in Rust (`geoGet` → `geo_http_get`).
 * Census has no CORS, so the old webview `fetch` always failed and drained
 * Google. Order after a Census miss: site pin → Google (key saved) → Nominatim.
 */

import { cleanStreetForLookup, streetWithoutUnit } from './address-clean.ts'
import { normalizePastedGoogleKey } from './google-key.ts'
import { geoGet } from './net.ts'
import { YARD } from './yard.ts'

export const GEOCODE_SOURCES = ['census', 'site_pin', 'manual', 'google', 'nominatim', 'none'] as const
export type GeocodeSource = (typeof GEOCODE_SOURCES)[number]

/** Pause between Census HTTP calls so a large Apply does not get blocked. */
export const CENSUS_DELAY_MS = 200
/** Pause between Google HTTP calls (Apply leftovers and Unmapped retry only). */
export const GOOGLE_DELAY_MS = 100
/** Stop calling Census for the rest of the batch after this many consecutive transport errors. */
export const CENSUS_ERROR_CIRCUIT = 3
/** Stop calling Google for the rest of the batch after this many consecutive transport errors. */
export const GOOGLE_ERROR_CIRCUIT = 3
/** Nominatim's usage policy allows about one request per second. */
export const NOMINATIM_DELAY_MS = 1100
/** Stop calling Nominatim for the rest of the batch after this many consecutive transport errors. */
export const NOMINATIM_ERROR_CIRCUIT = 3
/** Street level or finer (Nominatim place_rank 26 = road, 30 = house). Town centroids are not pins. */
export const NOMINATIM_MIN_PLACE_RANK = 26

export const CENSUS_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder'
export const GOOGLE_GEOCODER_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

export interface SitePin {
  lat: number
  lng: number
}

export interface GeocodeInput {
  address_street: string | null
  address_city_state_zip: string | null
  site?: SitePin | null
}

export interface GeocodeResult {
  lat: number | null
  lng: number | null
  geocode_source: GeocodeSource
  address_key: string | null
  matched_address: string | null
  census_called: boolean
  census_error?: boolean
  /** True when Google Geocoding was actually called (hit or genuine empty match). */
  google_called?: boolean
  /** True when Google HTTP/network/API failed (not a genuine empty match). */
  google_error?: boolean
  /** True when Nominatim was actually called (hit or genuine empty match). */
  nominatim_called?: boolean
  /** True when Nominatim HTTP/network failed. */
  nominatim_error?: boolean
}

export class CensusGeocoderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CensusGeocoderError'
  }
}

export function isCensusGeocoderError(err: unknown): boolean {
  return err instanceof CensusGeocoderError || (err instanceof Error && err.name === 'CensusGeocoderError')
}

export class GoogleGeocoderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleGeocoderError'
  }
}

export function isGoogleGeocoderError(err: unknown): err is GoogleGeocoderError {
  return err instanceof GoogleGeocoderError || (err instanceof Error && err.name === 'GoogleGeocoderError')
}

export interface GoogleMatch {
  lat: number
  lng: number
  matchedAddress: string
  /** ROOFTOP, RANGE_INTERPOLATED, GEOMETRIC_CENTER, APPROXIMATE. Absent in test doubles. */
  locationType?: string
}

const STREET_LEVEL_TYPES = new Set(['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest', 'intersection'])
const PRECISE_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED'])

/**
 * True when Google answered with a ZIP, town, or bare road instead of a
 * building. Pinning that would drop a job miles from the real site and look
 * correct on the map, so it counts as a miss and the job stays Unmapped.
 */
export function isCoarseGoogleResult(types: readonly string[] | undefined, locationType: string | undefined): boolean {
  const loc = (locationType ?? '').toUpperCase()
  if (!types?.length && !loc) return false
  if (loc && PRECISE_LOCATION_TYPES.has(loc)) return false
  if (types?.some((t) => STREET_LEVEL_TYPES.has(t))) return false
  return true
}

/**
 * Injected Google caller for tests and for the pasted-key path.
 * Must not be the live Geocoding API unless the caller built it from a key
 * that is already on this PC.
 */
export type GoogleLookup = (line: string) => Promise<GoogleMatch | null>

export function googleGeocoderDirectUrl(address: string, apiKey: string): string {
  const params = new URLSearchParams({
    address,
    region: 'us',
    key: apiKey,
  })
  return `${GOOGLE_GEOCODER_URL}?${params.toString()}`
}

/** Parse a Geocoding API JSON body. `ZERO_RESULTS` is a miss. Quota and denial throw. */
export function googleMatchFromPayload(payload: unknown): GoogleMatch | null {
  const root = payload as {
    status?: string
    error_message?: string
    results?: Array<{
      formatted_address?: string
      types?: string[]
      geometry?: { location?: { lat?: number; lng?: number }; location_type?: string }
    }>
  }
  const status = (root.status ?? '').toUpperCase()
  if (status === 'ZERO_RESULTS' || status === 'INVALID_REQUEST') return null
  if (status === 'OK') {
    const row = root.results?.[0]
    const lat = row?.geometry?.location?.lat
    const lng = row?.geometry?.location?.lng
    if (typeof lat === 'number' && typeof lng === 'number') {
      const locationType = row?.geometry?.location_type
      if (isCoarseGoogleResult(row?.types, locationType)) return null
      return {
        lat,
        lng,
        matchedAddress: row?.formatted_address ?? '',
        ...(locationType ? { locationType } : {}),
      }
    }
    return null
  }
  const detail = root.error_message ? `: ${root.error_message}` : ''
  throw new GoogleGeocoderError(`Google geocoder ${status || 'error'}${detail}`)
}

function scrubSecret(message: string, apiKey: string): string {
  const withoutKey = apiKey ? message.split(apiKey).join('[key]') : message
  return withoutKey.replace(/https?:\/\/\S+/g, 'maps.googleapis.com')
}

async function googleJson(url: string, apiKey: string): Promise<unknown> {
  try {
    const res = await geoGet('google', url)
    if (!res.ok) throw new GoogleGeocoderError(`Google geocoder HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    if (isGoogleGeocoderError(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleGeocoderError(`Google geocoder failed: ${scrubSecret(message, apiKey)}`)
  }
}

/**
 * Call Google Geocoding with an explicit key. A missing key returns `'skip'`
 * and does not touch the network. Callers resolve the key (disk then Vite env)
 * before passing it here — this helper does not read env itself.
 */
export async function geocodeWithGoogle(
  street: string | null,
  cityStateZip: string | null,
  apiKey: string | null,
): Promise<GoogleMatch | null | 'skip'> {
  const line = oneLineAddress(street, cityStateZip)
  if (!line) return null
  const key = normalizePastedGoogleKey(apiKey)
  if (!key) return 'skip'
  const payload = await googleJson(googleGeocoderDirectUrl(line, key), key)
  try {
    return googleMatchFromPayload(payload)
  } catch (err) {
    if (!isGoogleGeocoderError(err)) throw err
    throw new GoogleGeocoderError(scrubSecret(err.message, key))
  }
}

export class NominatimGeocoderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NominatimGeocoderError'
  }
}

export function isNominatimGeocoderError(err: unknown): err is NominatimGeocoderError {
  return err instanceof NominatimGeocoderError || (err instanceof Error && err.name === 'NominatimGeocoderError')
}

export type NominatimMatch = GoogleMatch

/** Injected Nominatim caller (tests) or `geocodeWithNominatim` (live, behind the opt-in). */
export type NominatimLookup = (line: string) => Promise<NominatimMatch | null>

export function nominatimSearchUrl(query: string, limit = 1): string {
  const d = 1.0
  const b = YARD
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: String(limit),
    countrycodes: 'us',
    q: query,
    viewbox: `${b.lng - d},${b.lat + d},${b.lng + d},${b.lat - d}`,
  })
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`
}

/** First street-level-or-finer row. Town/county centroids are a miss, not a pin. */
export function nominatimMatchFromPayload(payload: unknown): NominatimMatch | null {
  const rows = Array.isArray(payload) ? (payload as Array<Record<string, unknown>>) : []
  for (const row of rows) {
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    const rank = Number(row.place_rank ?? 0)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (rank < NOMINATIM_MIN_PLACE_RANK) continue
    return { lat, lng, matchedAddress: String(row.display_name ?? '') }
  }
  return null
}

/** Live Nominatim lookup (native GET). Callers gate it on the network-geocoding opt-in. */
export async function geocodeWithNominatim(line: string): Promise<NominatimMatch | null> {
  let res
  try {
    res = await geoGet('nominatim', nominatimSearchUrl(line))
  } catch (err) {
    throw new NominatimGeocoderError(`Street lookup failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new NominatimGeocoderError(`Street lookup HTTP ${res.status}`)
  try {
    return nominatimMatchFromPayload(await res.json())
  } catch {
    throw new NominatimGeocoderError('Street lookup returned a non-JSON page')
  }
}

export interface CacheEntry {
  address_key: string
  lat: number | null
  lng: number | null
  geocode_source: GeocodeSource
  matched_address: string | null
  address_street?: string | null
  address_city_state_zip?: string | null
}

export interface CacheStore {
  get(addressKey: string): CacheEntry | undefined
  set(entry: CacheEntry): void
}

export interface CensusMatch {
  lat: number
  lng: number
  matchedAddress: string
}

export type CensusLookup = (
  street: string | null,
  cityStateZip: string | null,
) => Promise<CensusMatch | null>

/** First CITY ST ZIP in a possibly slash-glued ADD city/state/zip field. */
export function firstCityStateZip(raw: string | null | undefined): string {
  if (!raw) return ''
  const m = raw.match(/([A-Za-z .'-]+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?/)
  if (m) return `${m[1]!.trim()} ${m[2]!.toUpperCase()} ${m[3]}`
  return raw.split('/')[0]?.trim() ?? ''
}

export function parseCityStateZip(
  raw: string | null | undefined,
): { city: string; state: string; zip: string } | null {
  const s = firstCityStateZip(raw)
  const m = s.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (!m) return null
  return { city: m[1]!.trim(), state: m[2]!.toUpperCase(), zip: m[3]! }
}

export function normalizeAddressKey(
  street: string | null | undefined,
  cityStateZip: string | null | undefined,
): string | null {
  const s = (street ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  const c = firstCityStateZip(cityStateZip).replace(/\s+/g, ' ').toUpperCase()
  if (!s && !c) return null
  return `${s}|${c}`
}

export function oneLineAddress(
  street: string | null | undefined,
  cityStateZip: string | null | undefined,
): string | null {
  // Cleaned: only the address itself may leave this PC (see address-clean.ts).
  const s = cleanStreetForLookup(street)
  const c = firstCityStateZip(cityStateZip)
  if (!s && !c) return null
  if (!s) return c
  if (!c) return s
  return `${s}, ${c}`
}

export function memoryCache(seed: CacheEntry[] = []): CacheStore {
  const map = new Map<string, CacheEntry>()
  for (const e of seed) map.set(e.address_key, e)
  return {
    get: (k) => map.get(k),
    set: (e) => {
      map.set(e.address_key, e)
    },
  }
}

export function censusOnelineUrl(base: string, line: string): string {
  return (
    `${base}/locations/onelineaddress` +
    `?address=${encodeURIComponent(line)}` +
    `&benchmark=Public_AR_Current&format=json`
  )
}

function matchesFromPayload(payload: unknown): CensusMatch[] {
  const root = payload as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string
        coordinates?: { x?: number; y?: number }
      }>
    }
  }
  const rows = root.result?.addressMatches ?? []
  const out: CensusMatch[] = []
  for (const row of rows) {
    const lng = row.coordinates?.x
    const lat = row.coordinates?.y
    if (typeof lat === 'number' && typeof lng === 'number') {
      out.push({
        lat,
        lng,
        matchedAddress: row.matchedAddress ?? '',
      })
    }
  }
  return out
}

async function censusJson(url: string): Promise<unknown> {
  try {
    const res = await geoGet('census', url)
    if (!res.ok) throw new CensusGeocoderError(`Census geocoder HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    if (isCensusGeocoderError(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new CensusGeocoderError(`Census geocoder failed: ${message}`)
  }
}

/** Live Census lookup. Tests inject `CensusLookup` instead of calling this. */
export async function geocodeWithCensus(
  street: string | null,
  cityStateZip: string | null,
  base = CENSUS_GEOCODER_URL,
): Promise<CensusMatch | null> {
  let lastError: CensusGeocoderError | null = null
  let gotResponse = false

  const line = oneLineAddress(street, cityStateZip)
  if (line) {
    try {
      const matches = matchesFromPayload(await censusJson(censusOnelineUrl(base, line)))
      gotResponse = true
      if (matches[0]) return matches[0]
    } catch (err) {
      lastError = isCensusGeocoderError(err)
        ? (err as CensusGeocoderError)
        : new CensusGeocoderError(err instanceof Error ? err.message : String(err))
    }
  }

  const parts = parseCityStateZip(cityStateZip)
  const cleanStreet = cleanStreetForLookup(street)
  if (cleanStreet && parts) {
    const params = new URLSearchParams({
      street: cleanStreet,
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
      benchmark: 'Public_AR_Current',
      format: 'json',
    })
    try {
      const matches = matchesFromPayload(await censusJson(`${base}/locations/address?${params.toString()}`))
      gotResponse = true
      if (matches[0]) return matches[0]
    } catch (err) {
      lastError = isCensusGeocoderError(err)
        ? (err as CensusGeocoderError)
        : new CensusGeocoderError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!gotResponse && lastError) throw lastError
  return null
}

function usableSitePin(site: SitePin | null | undefined): site is SitePin {
  return Boolean(site && Number.isFinite(site.lat) && Number.isFinite(site.lng))
}

function cacheHitHasCoords(hit: CacheEntry): boolean {
  return hit.lat != null && hit.lng != null
}

/** Cached Google miss (tried Google, ZERO_RESULTS) — do not call Google again. */
function cacheIsGoogleMiss(hit: CacheEntry): boolean {
  return hit.geocode_source === 'google' && !cacheHitHasCoords(hit)
}

/** Cached Nominatim miss — every network lookup already missed. Terminal. */
function cacheIsNominatimMiss(hit: CacheEntry): boolean {
  return hit.geocode_source === 'nominatim' && !cacheHitHasCoords(hit)
}

export type RunGeocodeChainOpts = {
  /** Default true. Pass false when network geocoding is not allowed. */
  callCensus?: boolean
  census?: CensusLookup
  /**
   * Default false. True only when network geocoding is allowed and a lookup
   * was built from a key stored on this PC (or a test double).
   */
  callGoogle?: boolean
  google?: GoogleLookup
  /**
   * Default false. Last network fallback after Google (or after Census when no
   * key is saved). True only when network geocoding is allowed.
   */
  callNominatim?: boolean
  nominatim?: NominatimLookup
  /**
   * The user asked to try Google again for addresses that already missed. A
   * cached OpenStreetMap miss is not final then, so Google runs once. A cached
   * Google miss still is: the same key gives the same answer. Skips
   * OpenStreetMap, which already ran.
   */
  retryGoogle?: boolean
}

type GoogleAttempt =
  | { kind: 'hit'; match: GoogleMatch }
  | { kind: 'miss' }
  | { kind: 'skip' }
  | { kind: 'error'; error: GoogleGeocoderError }

async function tryGoogleFallback(
  input: GeocodeInput,
  address_key: string,
  cache: CacheStore,
  opts: RunGeocodeChainOpts,
): Promise<GoogleAttempt> {
  if (opts.callGoogle !== true || !opts.google) return { kind: 'skip' }
  const line = oneLineAddress(input.address_street, input.address_city_state_zip)
  if (!line) return { kind: 'miss' }
  try {
    let match = await opts.google(line)
    if (!match) {
      // One more try without a trailing apt/unit/lot, which Google often rejects.
      const bare = streetWithoutUnit(input.address_street)
      const bareLine = bare ? oneLineAddress(bare, input.address_city_state_zip) : null
      if (bareLine && bareLine !== line) match = await opts.google(bareLine)
    }
    if (match) {
      cache.set({
        address_key,
        lat: match.lat,
        lng: match.lng,
        geocode_source: 'google',
        matched_address: match.matchedAddress,
        address_street: input.address_street,
        address_city_state_zip: input.address_city_state_zip,
      })
      return { kind: 'hit', match }
    }
    cache.set({
      address_key,
      lat: null,
      lng: null,
      geocode_source: 'google',
      matched_address: null,
      address_street: input.address_street,
      address_city_state_zip: input.address_city_state_zip,
    })
    return { kind: 'miss' }
  } catch (err) {
    if (isGoogleGeocoderError(err)) return { kind: 'error', error: err }
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', error: new GoogleGeocoderError(message) }
  }
}

function googleFields(g: GoogleAttempt | null): Pick<GeocodeResult, 'google_called' | 'google_error'> {
  if (!g || g.kind === 'skip') return { google_called: false, google_error: false }
  return {
    google_called: g.kind === 'hit' || g.kind === 'miss',
    google_error: g.kind === 'error',
  }
}

type NominatimAttempt =
  | { kind: 'hit'; match: NominatimMatch }
  | { kind: 'miss' }
  | { kind: 'skip' }
  | { kind: 'error' }

async function tryNominatimFallback(
  input: GeocodeInput,
  address_key: string,
  cache: CacheStore,
  opts: RunGeocodeChainOpts,
): Promise<NominatimAttempt> {
  if (opts.callNominatim !== true || !opts.nominatim) return { kind: 'skip' }
  const line = oneLineAddress(input.address_street, input.address_city_state_zip)
  if (!line || !input.address_street?.trim()) return { kind: 'skip' }
  try {
    const match = await opts.nominatim(line)
    cache.set({
      address_key,
      lat: match?.lat ?? null,
      lng: match?.lng ?? null,
      geocode_source: 'nominatim',
      matched_address: match?.matchedAddress ?? null,
      address_street: input.address_street,
      address_city_state_zip: input.address_city_state_zip,
    })
    return match ? { kind: 'hit', match } : { kind: 'miss' }
  } catch {
    return { kind: 'error' }
  }
}

function nominatimFields(n: NominatimAttempt | null): Pick<GeocodeResult, 'nominatim_called' | 'nominatim_error'> {
  if (!n || n.kind === 'skip') return { nominatim_called: false, nominatim_error: false }
  return { nominatim_called: n.kind === 'hit' || n.kind === 'miss', nominatim_error: n.kind === 'error' }
}

export async function runGeocodeChain(
  input: GeocodeInput,
  cache: CacheStore,
  opts: RunGeocodeChainOpts = {},
): Promise<GeocodeResult> {
  const callCensus = opts.callCensus !== false
  const address_key = normalizeAddressKey(input.address_street, input.address_city_state_zip)
  const lookup = opts.census ?? geocodeWithCensus

  async function afterCensusMiss(
    census_called: boolean,
    census_error: boolean,
    allowGoogle: boolean,
    allowNominatim = true,
  ): Promise<GeocodeResult> {
    if (usableSitePin(input.site)) {
      return {
        lat: input.site.lat,
        lng: input.site.lng,
        geocode_source: 'site_pin',
        address_key,
        matched_address: null,
        census_called,
        census_error,
        google_called: false,
        google_error: false,
      }
    }
    if (!address_key || (!allowGoogle && !allowNominatim)) {
      return {
        lat: null,
        lng: null,
        geocode_source: 'none',
        address_key,
        matched_address: null,
        census_called,
        census_error,
        google_called: false,
        google_error: false,
        nominatim_called: false,
        nominatim_error: false,
      }
    }
    // Census → Google (key saved) → Nominatim.
    const g = allowGoogle ? await tryGoogleFallback(input, address_key, cache, opts) : null
    if (g?.kind === 'hit') {
      return {
        lat: g.match.lat,
        lng: g.match.lng,
        geocode_source: 'google',
        address_key,
        matched_address: g.match.matchedAddress,
        census_called,
        census_error,
        ...googleFields(g),
        nominatim_called: false,
        nominatim_error: false,
      }
    }
    const n = allowNominatim ? await tryNominatimFallback(input, address_key, cache, opts) : null
    if (n?.kind === 'hit') {
      return {
        lat: n.match.lat,
        lng: n.match.lng,
        geocode_source: 'nominatim',
        address_key,
        matched_address: n.match.matchedAddress,
        census_called,
        census_error,
        ...googleFields(g),
        ...nominatimFields(n),
      }
    }
    return {
      lat: null,
      lng: null,
      geocode_source: 'none',
      address_key,
      matched_address: null,
      census_called,
      census_error,
      ...googleFields(g),
      ...nominatimFields(n),
    }
  }

  if (address_key) {
    const hit = cache.get(address_key)
    if (hit) {
      if (cacheHitHasCoords(hit)) {
        return {
          lat: hit.lat,
          lng: hit.lng,
          geocode_source: hit.geocode_source,
          address_key,
          matched_address: hit.matched_address,
          census_called: false,
          census_error: false,
          google_called: false,
          google_error: false,
        }
      }
      // Cached miss — skip Census. Site pin still applies. Google only if
      // this entry is a Census-era `none` (Google not tried yet), not a
      // recorded Google ZERO_RESULTS (`google` + null coords). A recorded
      // Nominatim miss means every network lookup already missed.
      if (opts.retryGoogle) return afterCensusMiss(false, false, !cacheIsGoogleMiss(hit), false)
      const terminal = cacheIsNominatimMiss(hit)
      return afterCensusMiss(false, false, !terminal && !cacheIsGoogleMiss(hit), !terminal)
    }
  }

  let census_error = false
  let census_called = false
  if (callCensus && address_key) {
    try {
      census_called = true
      const match = await lookup(input.address_street, input.address_city_state_zip)
      if (match) {
        cache.set({
          address_key,
          lat: match.lat,
          lng: match.lng,
          geocode_source: 'census',
          matched_address: match.matchedAddress,
          address_street: input.address_street,
          address_city_state_zip: input.address_city_state_zip,
        })
        return {
          lat: match.lat,
          lng: match.lng,
          geocode_source: 'census',
          address_key,
          matched_address: match.matchedAddress,
          census_called: true,
          census_error: false,
          google_called: false,
          google_error: false,
          nominatim_called: false,
          nominatim_error: false,
        }
      }
      cache.set({
        address_key,
        lat: null,
        lng: null,
        geocode_source: 'none',
        matched_address: null,
        address_street: input.address_street,
        address_city_state_zip: input.address_city_state_zip,
      })
    } catch (err) {
      if (!isCensusGeocoderError(err)) throw err
      census_error = true
    }
  }

  // Census transport failure is not cached (retry later). Site pin still
  // applies. When a Google lookup is enabled, still try Google — Census WAF or
  // outages (HTTP 200 HTML rejection, timeouts) must not leave the job unmapped
  // when a key is present. No key (callGoogle false) stays Census-only.
  return afterCensusMiss(census_called, census_error, true)
}

export function alreadyGeocoded(row: {
  lat: number | string | null
  lng: number | string | null
  geocode_source?: string | null
  geocode_address_key?: string | null
  address_street?: string | null
  address_city_state_zip?: string | null
}): boolean {
  const key = normalizeAddressKey(row.address_street, row.address_city_state_zip)
  if (row.geocode_address_key && key && row.geocode_address_key !== key) return false
  const lat = row.lat == null ? null : Number(row.lat)
  const lng = row.lng == null ? null : Number(row.lng)
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function asCoord(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function missingCoordinates(job: {
  lat?: number | string | null
  lng?: number | string | null
}): boolean {
  return asCoord(job.lat) == null || asCoord(job.lng) == null
}

export function jobHasMappedPin(job: {
  lat?: number | string | null
  lng?: number | string | null
  geocode_source?: string | null
}): boolean {
  if (missingCoordinates(job)) return false
  const src = job.geocode_source
  return src === 'census' || src === 'site_pin' || src === 'manual' || src === 'google' || src === 'nominatim'
}

export type PinConfidence = { level: 'high' | 'good' | 'check' | 'none'; label: string }

/** Plain-words trust level for a stored pin, shown on the Map and in the review list. */
export function pinConfidence(source: string | null | undefined): PinConfidence {
  switch (source) {
    case 'manual':
      return { level: 'high', label: 'Placed by hand' }
    case 'site_pin':
      return { level: 'high', label: 'Saved site pin' }
    case 'census':
      return { level: 'good', label: 'Census address match' }
    case 'google':
      return { level: 'good', label: 'Google match' }
    case 'nominatim':
      return { level: 'check', label: 'Street-level only (OpenStreetMap)' }
    default:
      return { level: 'none', label: 'No pin' }
  }
}

export type GeocodePersistJob = {
  id: number
  address_street: string | null
  address_city_state_zip: string | null
  lat: number | string | null
  lng: number | string | null
  geocode_source: string | null
  geocode_address_key: string | null
  is_capacity_block?: boolean | number | null
  customer_number?: string | null
  service_location_number?: number | null
}

export function jobNeedsApplyGeocode(row: GeocodePersistJob): boolean {
  if (row.is_capacity_block) return false
  if ((row.geocode_source ?? 'none') === 'none') return true
  return !alreadyGeocoded(row)
}

export type ApplyGeocodeCounts = {
  geocoded: number
  still_unmapped: number
  geocode_errors: number
}

export function applyGeocodeCounts(
  written: Array<{
    lat?: number | string | null
    lng?: number | string | null
    geocode_source?: string | null
    is_capacity_block?: boolean | number | null
  }>,
  geocode_errors = 0,
): ApplyGeocodeCounts {
  let geocoded = 0
  let still_unmapped = 0
  for (const job of written) {
    if (job.is_capacity_block) continue
    if (jobHasMappedPin(job)) geocoded++
    else still_unmapped++
  }
  return { geocoded, still_unmapped, geocode_errors }
}

export function siteKey(customerNumber: string | null | undefined, serviceLocation: number | null | undefined): string | null {
  const customer = (customerNumber ?? '').trim()
  if (!customer) return null
  return `${customer}|${serviceLocation ?? 0}`
}

export function parsePin(latRaw: string, lngRaw: string): { lat: number; lng: number } {
  const lat = Number(latRaw.trim())
  const lng = Number(lngRaw.trim())
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('Latitude must be a number from -90 to 90.')
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error('Longitude must be a number from -180 to 180.')
  }
  return { lat, lng }
}

export type GeocodePersistBatch = {
  attempted: number
  skipped: number
  census_calls: number
  google_calls: number
  nominatim_calls: number
  google_errors: number
  geocode_errors: number
  cache_writes: CacheEntry[]
}

export async function geocodeAndPersistRows(
  rows: GeocodePersistJob[],
  cache: CacheStore,
  siteByKey: Map<string, SitePin>,
  persistRow: (id: number, result: GeocodeResult) => Promise<void>,
  opts: {
    delayMs?: number
    googleDelayMs?: number
    callCensus?: boolean
    census?: CensusLookup
    /** Present only when network geocoding is allowed and a key is on this PC. */
    google?: GoogleLookup
    /** Present only when network geocoding is allowed. Runs after Google. */
    nominatim?: NominatimLookup
    nominatimDelayMs?: number
    /** Try Google again for addresses that missed before. See RunGeocodeChainOpts. */
    retryGoogle?: boolean
  } = {},
): Promise<GeocodePersistBatch> {
  const delayMs = opts.delayMs ?? CENSUS_DELAY_MS
  const googleDelayMs = opts.googleDelayMs ?? (opts.delayMs === 0 ? 0 : GOOGLE_DELAY_MS)
  let callCensus = opts.callCensus !== false
  let callGoogle = Boolean(opts.google)
  let callNominatim = Boolean(opts.nominatim)
  const nominatimDelayMs = opts.nominatimDelayMs ?? (opts.delayMs === 0 ? 0 : NOMINATIM_DELAY_MS)
  let consecutiveCensusErrors = 0
  let consecutiveGoogleErrors = 0
  let consecutiveNominatimErrors = 0
  let nominatim_calls = 0
  let attempted = 0
  let skipped = 0
  let census_calls = 0
  let google_calls = 0
  let geocode_errors = 0
  let google_errors = 0
  const cache_writes: CacheEntry[] = []

  for (const row of rows) {
    if (!jobNeedsApplyGeocode(row)) {
      skipped++
      continue
    }
    attempted++
    try {
      const key = siteKey(row.customer_number, row.service_location_number)
      const result = await runGeocodeChain(
        {
          address_street: row.address_street,
          address_city_state_zip: row.address_city_state_zip,
          site: key ? (siteByKey.get(key) ?? null) : null,
        },
        cache,
        {
          callCensus,
          census: opts.census,
          callGoogle,
          google: opts.google,
          callNominatim,
          nominatim: opts.nominatim,
          retryGoogle: opts.retryGoogle,
        },
      )
      if (result.census_called) {
        census_calls++
        if (delayMs > 0) await sleep(delayMs)
      }
      if (result.google_called) {
        google_calls++
        if (googleDelayMs > 0) await sleep(googleDelayMs)
      }
      if (result.nominatim_called || result.nominatim_error) {
        if (result.nominatim_called) nominatim_calls++
        if (nominatimDelayMs > 0) await sleep(nominatimDelayMs)
      }
      if (result.nominatim_error) {
        consecutiveNominatimErrors++
        if (consecutiveNominatimErrors >= NOMINATIM_ERROR_CIRCUIT) callNominatim = false
      } else if (result.nominatim_called) {
        consecutiveNominatimErrors = 0
      }
      if (result.census_error) {
        consecutiveCensusErrors++
        if (consecutiveCensusErrors >= CENSUS_ERROR_CIRCUIT) callCensus = false
        // A Census WAF/outage is not a user-facing geocode error when Google
        // (or a site pin) already placed the row, or Google returned a real miss.
        const recovered =
          result.geocode_source === 'site_pin' ||
          result.geocode_source === 'google' ||
          result.geocode_source === 'nominatim' ||
          result.google_called === true ||
          result.nominatim_called === true
        if (!recovered && !result.google_error) geocode_errors++
      } else if (result.census_called) {
        consecutiveCensusErrors = 0
      }
      if (result.google_error) {
        geocode_errors++
        google_errors++
        consecutiveGoogleErrors++
        if (consecutiveGoogleErrors >= GOOGLE_ERROR_CIRCUIT) callGoogle = false
      } else if (result.google_called) {
        consecutiveGoogleErrors = 0
      }
      // Persist cache hits/misses even when Census had a transport error but
      // Google then answered (hit or ZERO_RESULTS). Skip only on Google errors.
      if (result.address_key && !result.google_error) {
        const entry = cache.get(result.address_key)
        if (entry) cache_writes.push(entry)
      }
      try {
        await persistRow(row.id, result)
        row.lat = result.lat
        row.lng = result.lng
        row.geocode_source = result.geocode_source
        row.geocode_address_key = result.address_key
      } catch (err) {
        geocode_errors++
        console.warn('geocode persist skipped', row.id, err instanceof Error ? err.message : err)
      }
    } catch (err) {
      geocode_errors++
      consecutiveCensusErrors++
      if (consecutiveCensusErrors >= CENSUS_ERROR_CIRCUIT) callCensus = false
      console.warn('geocode row failed', row.id, err instanceof Error ? err.message : err)
    }
  }

  return { attempted, skipped, census_calls, google_calls, nominatim_calls, google_errors, geocode_errors, cache_writes }
}
