/**
 * One-technician, one-day routed drive times.
 *
 * Ported from office `src/lib/drive-times.ts`. Local calls Google Routes
 * `computeRoutes` from this PC when a key is saved and network geocoding is
 * allowed. It does not call a cloud Edge Function or `/google-routes`.
 */

import { parseTimeMinutes } from './schedule.ts'
import { YARD } from './yard.ts'

export const LONG_LEG_MINUTES = 30
export const LONG_LEG_SECONDS = LONG_LEG_MINUTES * 60
/** origin + 25 intermediates + destination (Routes API computeRoutes). */
export const MAX_ROUTE_STOPS = 27
export const DRIVE_TIMES_PROVIDER = 'routes' as const

export const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
export const COMPUTE_ROUTES_FIELD_MASK = 'routes.legs.duration,routes.legs.distanceMeters'

export type DriveEligibilityReason = 'multi_tech' | 'multi_day'

export type DriveEligibility =
  | { ok: true; technicianName: string; scheduleDate: string }
  | { ok: false; reason: DriveEligibilityReason }

export type DriveJob = {
  id: string
  customer_name?: string | null
  technician_name?: string | null
  schedule_date?: string | null
  begin_time?: string | null
  lat?: number | string | null
  lng?: number | string | null
}

export type DriveWaypointKind = 'yard' | 'job'

export type DriveWaypoint = {
  id: string
  kind: DriveWaypointKind
  label: string
  lat: number
  lng: number
}

export type DriveLatLng = { lat: number; lng: number }

export type DriveLeg = {
  fromId: string
  toId: string
  fromKind: DriveWaypointKind
  toKind: DriveWaypointKind
  fromLabel: string
  toLabel: string
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
  durationSeconds: number
  durationMinutes: number
  warn: boolean
}

export type CachedDriveTimes = {
  technicianName: string
  scheduleDate: string
  fingerprint: string
  includeYard: boolean
  legs: DriveLeg[]
  provider: string
  computedAt: string
}

export type DriveTimeCacheStore = {
  get(technicianName: string, scheduleDate: string): Promise<CachedDriveTimes | null>
  set(row: CachedDriveTimes): Promise<void>
}

export type RoutesCallResult =
  | { ok: true; durationsSeconds: number[] }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string }

export type RoutesFn = (stops: DriveLatLng[]) => Promise<RoutesCallResult>

export type DriveTimesOutcome = {
  googleCalled: boolean
  fromCache: boolean
  skipped: boolean
  skipReason?: string
  error?: string
  reason?: DriveEligibilityReason | 'too_few_stops'
  legs: DriveLeg[]
  waypoints: DriveWaypoint[]
  fingerprint: string
  cached?: CachedDriveTimes
}

export function driveTimeEligibility(opts: {
  techFilter: string
  scheduleDate: string
  allDates: boolean
}): DriveEligibility {
  const technicianName = opts.techFilter.trim()
  if (!technicianName) return { ok: false, reason: 'multi_tech' }
  if (opts.allDates || !opts.scheduleDate.trim()) return { ok: false, reason: 'multi_day' }
  return { ok: true, technicianName, scheduleDate: opts.scheduleDate.trim() }
}

export function shouldCallGoogleRoutes(opts: { eligible: boolean; cacheHit: boolean; refresh: boolean }): boolean {
  if (!opts.eligible) return false
  if (opts.refresh) return true
  return !opts.cacheHit
}

export function isDriveCacheHit(cached: { fingerprint: string } | null | undefined, fingerprint: string): boolean {
  return Boolean(cached && cached.fingerprint === fingerprint)
}

export function scheduleSortMinutes(beginTime: string | null | undefined): number {
  const parsed = parseTimeMinutes(beginTime)
  if (parsed != null) return parsed
  const raw = (beginTime ?? '').trim()
  if (!raw) return 24 * 60
  const hasAm = /\bAM\b/i.test(raw)
  const hasPm = /\bPM\b/i.test(raw)
  if (hasAm && !hasPm) return 8 * 60
  if (hasPm) return 13 * 60
  return 24 * 60
}

export function orderStopsBySchedule<T extends DriveJob>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const ta = scheduleSortMinutes(a.begin_time)
    const tb = scheduleSortMinutes(b.begin_time)
    if (ta !== tb) return ta - tb
    const name = (a.customer_name ?? '').localeCompare(b.customer_name ?? '')
    if (name) return name
    return a.id.localeCompare(b.id)
  })
}

function numOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function jobHasMapPin(job: DriveJob): boolean {
  return numOrNull(job.lat) != null && numOrNull(job.lng) != null
}

export function driveScheduleFingerprint(jobs: DriveJob[], opts?: { includeYard?: boolean }): string {
  const includeYard = opts?.includeYard !== false
  const parts = orderStopsBySchedule(jobs.filter(jobHasMapPin)).map((job) => {
    return [job.id, job.begin_time ?? '', numOrNull(job.lat), numOrNull(job.lng)].join(':')
  })
  return `yard=${includeYard ? 1 : 0}|${parts.join('|')}`
}

export function buildRouteWaypoints(jobs: DriveJob[], opts?: { includeYard?: boolean }): DriveWaypoint[] {
  const includeYard = opts?.includeYard !== false
  const ordered = orderStopsBySchedule(jobs).filter(jobHasMapPin)
  if (ordered.length === 0) return []

  const jobPoints: DriveWaypoint[] = ordered.map((job) => ({
    id: job.id,
    kind: 'job',
    label: job.customer_name?.trim() || job.id,
    lat: numOrNull(job.lat) as number,
    lng: numOrNull(job.lng) as number,
  }))

  const points: DriveWaypoint[] = []
  if (includeYard) {
    points.push({
      id: YARD.id,
      kind: 'yard',
      label: YARD.label,
      lat: YARD.lat,
      lng: YARD.lng,
    })
  }
  points.push(...jobPoints)
  if (includeYard) {
    points.push({
      id: `${YARD.id}-return`,
      kind: 'yard',
      label: `${YARD.label} (return)`,
      lat: YARD.lat,
      lng: YARD.lng,
    })
  }

  if (points.length <= MAX_ROUTE_STOPS) return points

  if (includeYard && points[points.length - 1]?.kind === 'yard') {
    const withoutReturn = points.slice(0, -1)
    if (withoutReturn.length <= MAX_ROUTE_STOPS) return withoutReturn
    return [withoutReturn[0]!, ...withoutReturn.slice(1, MAX_ROUTE_STOPS)]
  }
  return points.slice(0, MAX_ROUTE_STOPS)
}

export function isLongLeg(durationSeconds: number): boolean {
  return durationSeconds > LONG_LEG_SECONDS
}

export function displayDriveMinutes(durationSeconds: number): number {
  return Math.max(1, Math.round(durationSeconds / 60))
}

export function formatDriveMinutes(durationSeconds: number): string {
  if (durationSeconds < 45) return '<1 min'
  return `${displayDriveMinutes(durationSeconds)} min`
}

export function assembleLegs(waypoints: DriveWaypoint[], durationsSeconds: number[]): DriveLeg[] {
  const n = Math.min(Math.max(0, waypoints.length - 1), durationsSeconds.length)
  const legs: DriveLeg[] = []
  for (let i = 0; i < n; i++) {
    const from = waypoints[i]!
    const to = waypoints[i + 1]!
    const durationSeconds = durationsSeconds[i]!
    legs.push({
      fromId: from.id,
      toId: to.id,
      fromKind: from.kind,
      toKind: to.kind,
      fromLabel: from.label,
      toLabel: to.label,
      fromLat: from.lat,
      fromLng: from.lng,
      toLat: to.lat,
      toLng: to.lng,
      durationSeconds,
      durationMinutes: displayDriveMinutes(durationSeconds),
      warn: isLongLeg(durationSeconds),
    })
  }
  return legs
}

export function warnLegCount(legs: DriveLeg[]): number {
  return legs.filter((leg) => leg.warn).length
}

export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/i)
  if (!match) return null
  return Number(match[1])
}

export function durationsFromComputeRoutes(body: unknown): number[] | null {
  const routes = (body as { routes?: Array<{ legs?: unknown }> } | null)?.routes
  const legs = routes?.[0]?.legs
  if (!Array.isArray(legs) || legs.length === 0) return null
  const out: number[] = []
  for (const leg of legs) {
    const row = leg as { duration?: unknown; staticDuration?: unknown }
    const seconds = parseDurationSeconds(row.duration) ?? parseDurationSeconds(row.staticDuration)
    if (seconds == null) return null
    out.push(seconds)
  }
  return out
}

export function toLatLngWaypoint(point: DriveLatLng): {
  location: { latLng: { latitude: number; longitude: number } }
} {
  return {
    location: { latLng: { latitude: point.lat, longitude: point.lng } },
  }
}

export function buildComputeRoutesBody(stops: DriveLatLng[]): Record<string, unknown> {
  if (stops.length < 2) throw new Error('computeRoutes needs at least two stops')
  return {
    origin: toLatLngWaypoint(stops[0]!),
    destination: toLatLngWaypoint(stops[stops.length - 1]!),
    intermediates: stops.slice(1, -1).map(toLatLngWaypoint),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
    units: 'IMPERIAL',
  }
}

export function computeRoutesHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': COMPUTE_ROUTES_FIELD_MASK,
  }
}

export function memoryDriveTimeCache(seed: CachedDriveTimes[] = []): DriveTimeCacheStore {
  const map = new Map<string, CachedDriveTimes>()
  for (const row of seed) map.set(`${row.technicianName}|${row.scheduleDate}`, row)
  return {
    async get(technicianName, scheduleDate) {
      return map.get(`${technicianName}|${scheduleDate}`) ?? null
    },
    async set(row) {
      map.set(`${row.technicianName}|${row.scheduleDate}`, row)
    },
  }
}

export async function resolveDriveTimes(input: {
  eligibility: DriveEligibility
  jobs: DriveJob[]
  includeYard?: boolean
  refresh?: boolean
  allowGoogle?: boolean
  cache: DriveTimeCacheStore | null
  callRoutes: RoutesFn
  now?: Date
}): Promise<DriveTimesOutcome> {
  const includeYard = input.includeYard !== false
  const allowGoogle = input.allowGoogle !== false
  const refresh = Boolean(input.refresh)
  const waypoints = buildRouteWaypoints(input.jobs, { includeYard })
  const fingerprint = driveScheduleFingerprint(input.jobs, { includeYard })

  if (!input.eligibility.ok) {
    return {
      googleCalled: false,
      fromCache: false,
      skipped: false,
      reason: input.eligibility.reason,
      legs: [],
      waypoints: [],
      fingerprint,
    }
  }

  if (waypoints.length < 2) {
    return {
      googleCalled: false,
      fromCache: false,
      skipped: false,
      reason: 'too_few_stops',
      legs: [],
      waypoints,
      fingerprint,
    }
  }

  const tech = input.eligibility.technicianName
  const date = input.eligibility.scheduleDate
  let cached: CachedDriveTimes | null = null
  if (input.cache) {
    try {
      cached = await input.cache.get(tech, date)
    } catch (err) {
      console.warn('[drive-times] cache read skipped:', err instanceof Error ? err.message : err)
    }
  }

  const cacheHit = isDriveCacheHit(cached, fingerprint)
  if (cacheHit && cached && !shouldCallGoogleRoutes({ eligible: true, cacheHit: true, refresh })) {
    return {
      googleCalled: false,
      fromCache: true,
      skipped: false,
      legs: cached.legs,
      waypoints,
      fingerprint,
      cached,
    }
  }

  if (!allowGoogle || !shouldCallGoogleRoutes({ eligible: true, cacheHit, refresh })) {
    return {
      googleCalled: false,
      fromCache: false,
      skipped: false,
      legs: cacheHit && cached ? cached.legs : [],
      waypoints,
      fingerprint,
      cached: cacheHit ? (cached ?? undefined) : undefined,
    }
  }

  const result = await input.callRoutes(waypoints.map((waypoint) => ({ lat: waypoint.lat, lng: waypoint.lng })))
  if (!result.ok && result.skipped) {
    return {
      googleCalled: false,
      fromCache: false,
      skipped: true,
      skipReason: result.reason,
      legs: [],
      waypoints,
      fingerprint,
    }
  }
  if (!result.ok) {
    return {
      googleCalled: true,
      fromCache: false,
      skipped: false,
      error: result.error,
      legs: [],
      waypoints,
      fingerprint,
    }
  }

  if (result.durationsSeconds.length !== waypoints.length - 1) {
    return {
      googleCalled: true,
      fromCache: false,
      skipped: false,
      error: `Routes returned ${result.durationsSeconds.length} leg(s); expected ${waypoints.length - 1}.`,
      legs: [],
      waypoints,
      fingerprint,
    }
  }

  const legs = assembleLegs(waypoints, result.durationsSeconds)
  const row: CachedDriveTimes = {
    technicianName: tech,
    scheduleDate: date,
    fingerprint,
    includeYard,
    legs,
    provider: DRIVE_TIMES_PROVIDER,
    computedAt: (input.now ?? new Date()).toISOString(),
  }
  if (input.cache) {
    try {
      await input.cache.set(row)
    } catch (err) {
      console.warn('[drive-times] cache write skipped:', err instanceof Error ? err.message : err)
    }
  }

  return {
    googleCalled: true,
    fromCache: false,
    skipped: false,
    legs,
    waypoints,
    fingerprint,
    cached: row,
  }
}

export const NO_GOOGLE_KEY_REASON = 'No Google Maps API key is saved on this PC.'

/**
 * One computeRoutes call. The key is sent as `X-Goog-Api-Key` and is not
 * written into the JSON body. A missing key does not call the network.
 */
export async function callGoogleComputeRoutes(
  apiKey: string | null,
  stops: DriveLatLng[],
  fetchImpl: typeof fetch = fetch,
): Promise<RoutesCallResult> {
  if (!apiKey) return { ok: false, skipped: true, reason: NO_GOOGLE_KEY_REASON }
  if (stops.length < 2) return { ok: false, skipped: false, error: 'computeRoutes needs at least two stops.' }
  try {
    const res = await fetchImpl(COMPUTE_ROUTES_URL, {
      method: 'POST',
      headers: computeRoutesHeaders(apiKey),
      body: JSON.stringify(buildComputeRoutesBody(stops)),
    })
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    if (!res.ok) {
      return {
        ok: false,
        skipped: false,
        error: body?.error?.message || `Routes HTTP ${res.status}`,
      }
    }
    const durations = durationsFromComputeRoutes(body)
    if (!durations) return { ok: false, skipped: false, error: 'Routes response had no legs.' }
    return { ok: true, durationsSeconds: durations }
  } catch (err) {
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : String(err) }
  }
}
