/**
 * Nearby search for Local. Straight-line haversine, same radius idea as
 * office `src/lib/proximity.ts` (about 30 mph). Census first, then Google when
 * a key is saved on this PC, then Nominatim street-level fallback. All three
 * GETs run in Rust (`geoGet`); Census has no CORS, so the old webview fetch
 * always failed. Everything stays behind the network-geocoding opt-in.
 */

import {
  asCoord,
  censusOnelineUrl,
  CENSUS_GEOCODER_URL,
  geocodeWithGoogle,
  nominatimSearchUrl,
  sleep,
} from './geocode.ts'
import { normalizePastedGoogleKey, readGoogleMapsApiKey } from './google-key.ts'
import { geoGet } from './net.ts'
import { wouldCreateBootsIssue } from './boots.ts'
import { ptoDayKeys } from './pto.ts'
import { bestInsertionForCandidate, estimateTechDayDrive } from './driveEstimate.ts'
import type { JobDurationInput } from './jobDurations.ts'
import { isCapacityBlock, techKey } from './schedule.ts'
import { YARD } from './yard.ts'

/** ~30 mph average for this rural county. Same constant as the office app. */
export const MILES_PER_MINUTE = 0.5

export const PROXIMITY_RADIUS_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '60 min' },
] as const

export function minutesToMiles(minutes: number): number {
  return minutes * MILES_PER_MINUTE
}

const EARTH_RADIUS_MI = 3958.8

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a))
}

export type ProximityLookupSource = 'census' | 'google' | 'nominatim'

export type ProximityCenter = {
  lat: number
  lng: number
  label: string
  source: ProximityLookupSource
}

export function isNominatimCenter(center: Pick<ProximityCenter, 'source'>): boolean {
  return center.source === 'nominatim'
}

export const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright'

/** Nominatim's usage policy allows about one request per second. */
export const NOMINATIM_GAP_MS = 1100


export function nearbyJobDistances(
  jobs: ReadonlyArray<{ id: number | string; lat: number | string | null; lng: number | string | null }>,
  center: ProximityCenter,
  radiusMiles: number,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const job of jobs) {
    const lat = asCoord(job.lat)
    const lng = asCoord(job.lng)
    if (lat == null || lng == null) continue
    const dist = haversineMiles(center.lat, center.lng, lat, lng)
    if (dist <= radiusMiles) out.set(String(job.id), dist)
  }
  return out
}

const STREET_SUFFIXES = new Set([
  'RD', 'ROAD', 'ST', 'STREET', 'DR', 'DRIVE', 'LN', 'LANE', 'CT', 'COURT', 'CIR', 'CIRCLE',
  'AVE', 'AVENUE', 'BLVD', 'BOULEVARD', 'WAY', 'PL', 'PLACE', 'TRL', 'TRAIL', 'HWY', 'HIGHWAY',
  'PKWY', 'PARKWAY', 'PIKE', 'TER', 'TERRACE', 'LOOP', 'RUN', 'PATH', 'ALY', 'ALLEY', 'XING',
  'CROSSING', 'SQ', 'SQUARE', 'BND', 'BEND',
])

function hasStateOrZip(text: string): boolean {
  return /\b\d{5}(-\d{4})?\b/.test(text) || /\b(VA|MD|DC|WV|NC|PA|Virginia)\b/i.test(text)
}

/**
 * Census returns nothing for a bare street until a state is present. Same
 * query expansion as the office Nearby box.
 */
export function searchQueries(raw: string): string[] {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const base = clean
    .replace(/[,\s]+(VA|Virginia)?[,\s]*(\d{5}(-\d{4})?)?$/i, '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = base.split(' ')
  const out = [hasStateOrZip(clean) ? clean : `${clean}, VA`]
  let last = -1
  words.forEach((w, i) => {
    if (i >= 1 && STREET_SUFFIXES.has(w.replace(/\./g, '').toUpperCase())) last = i
  })
  if (last >= 0 && last < words.length - 1) {
    out.push(`${words.slice(0, last + 1).join(' ')}, VA`)
  }
  return out
}

export type AddressCandidate = { lat: number; lng: number; label: string }

export async function censusCandidates(line: string, base = CENSUS_GEOCODER_URL): Promise<AddressCandidate[]> {
  const res = await geoGet('census', censusOnelineUrl(base, line))
  if (!res.ok) throw new Error(`Address lookup failed (HTTP ${res.status}).`)
  const payload = (await res.json()) as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string
        coordinates?: { x?: number; y?: number }
      }>
    }
  }
  const out: AddressCandidate[] = []
  for (const m of payload.result?.addressMatches ?? []) {
    const lng = m.coordinates?.x
    const lat = m.coordinates?.y
    if (typeof lat === 'number' && typeof lng === 'number') {
      out.push({ lat, lng, label: m.matchedAddress ?? '' })
    }
  }
  return out
}

/** Street-level fallback (OpenStreetMap Nominatim). Biased toward the yard. */
export async function nominatimCandidates(query: string): Promise<AddressCandidate[]> {
  // User-Agent is set in Rust (geo.rs); a webview cannot set it.
  const res = await geoGet('nominatim', nominatimSearchUrl(query, 5))
  if (!res.ok) throw new Error(`Street lookup failed (HTTP ${res.status}).`)
  const rows = (await res.json()) as Array<{
    lat?: string
    lon?: string
    display_name?: string
    category?: string
  }>
  const out: AddressCandidate[] = []
  for (const row of rows) {
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const place = (row.display_name ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && p !== 'United States' && !/ County$/.test(p))
      .join(', ')
    out.push({
      lat,
      lng,
      label: row.category === 'highway' ? `${place} (street-level, approximate)` : place,
    })
  }
  return out
}

const MAX_CHOICES = 8

export function milesFromYard(c: { lat: number; lng: number }): number {
  return haversineMiles(YARD.lat, YARD.lng, c.lat, c.lng)
}

export function rankChoices(
  candidates: AddressCandidate[],
  raw: string,
  source: ProximityLookupSource,
): ProximityCenter[] {
  const seen = new Set<string>()
  return [...candidates]
    .sort((a, b) => milesFromYard(a) - milesFromYard(b))
    .filter((c) => {
      const key = (c.label || raw).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CHOICES)
    .map((c) => ({ lat: c.lat, lng: c.lng, label: c.label || raw.trim(), source }))
}

type CandidateLookup = (line: string) => Promise<AddressCandidate[]>

export type SearchLookupOpts = {
  census?: CandidateLookup
  /**
   * Google with the key saved on this PC. `null` skips Google. Omitted reads
   * the saved key; no key means no Google call.
   */
  google?: CandidateLookup | null
  nominatim?: CandidateLookup
  sleep?: (ms: number) => Promise<void>
}

/** Google lookup from the key saved on this PC, or null when no key is saved. */
export async function savedKeyGoogleCandidates(): Promise<CandidateLookup | null> {
  const key = normalizePastedGoogleKey(await readGoogleMapsApiKey().catch(() => null))
  if (!key) return null
  return async (line) => {
    const match = await geocodeWithGoogle(line, null, key)
    if (!match || match === 'skip') return []
    return [{ lat: match.lat, lng: match.lng, label: match.matchedAddress }]
  }
}

/**
 * Census → Google (key saved) → Nominatim. Stops at the first lookup that finds
 * anything. Google runs once, on the typed query, so a miss costs one call.
 * Throws only when every lookup failed to respond.
 */
export async function geocodeSearchCandidates(raw: string, opts: SearchLookupOpts = {}): Promise<ProximityCenter[]> {
  const [typed, streetOnly] = searchQueries(raw)
  if (!typed) return []
  const census = opts.census ?? censusCandidates
  const google = opts.google === undefined ? await savedKeyGoogleCandidates() : opts.google
  const nominatim = opts.nominatim ?? nominatimCandidates
  const pause = opts.sleep ?? sleep
  type Attempt = { run: () => Promise<AddressCandidate[]>; source: ProximityLookupSource }
  const attempts: Attempt[] = [{ run: () => census(typed), source: 'census' }]
  if (google) attempts.push({ run: () => google(typed), source: 'google' })
  attempts.push({ run: () => nominatim(typed), source: 'nominatim' })
  if (streetOnly) {
    attempts.push({ run: () => census(streetOnly), source: 'census' })
    attempts.push({ run: () => nominatim(streetOnly), source: 'nominatim' })
  }
  let lastError: unknown = null
  let gotResponse = false
  let nominatimCalls = 0
  for (const attempt of attempts) {
    try {
      if (attempt.source === 'nominatim' && nominatimCalls++ > 0) await pause(NOMINATIM_GAP_MS)
      const candidates = await attempt.run()
      gotResponse = true
      if (candidates.length === 0) continue
      return rankChoices(candidates, raw, attempt.source)
    } catch (err) {
      lastError = err
    }
  }
  if (!gotResponse && lastError) {
    throw lastError instanceof Error ? lastError : new Error('Address lookup failed.')
  }
  return []
}

/**
 * Approximate geographic circle as a polygon (equirectangular offset).
 * Accurate enough under 100 miles.
 */
export function circlePolygon(
  center: ProximityCenter,
  radiusMiles: number,
  points = 64,
): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'Polygon'; coordinates: [number, number][][] } } {
  const latRad = (center.lat * Math.PI) / 180
  const milesPerDegLat = 69.0
  const milesPerDegLng = 69.172 * Math.cos(latRad)
  const coords: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const dx = (radiusMiles * Math.cos(angle)) / milesPerDegLng
    const dy = (radiusMiles * Math.sin(angle)) / milesPerDegLat
    coords.push([center.lng + dx, center.lat + dy])
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}

export type NearbyJob = {
  id: number
  customer_name: string
  technician_name: string | null
  schedule_date: string | null
  begin_time: string | null
  end_time: string | null
  activity_1: string | null
  lat: number | string | null
  lng: number | string | null
  is_capacity_block: number | boolean
}

export type NearbyBacklog = {
  id: number
  customer_name: string | null
  backlog_type: string
  campaign: string | null
  status: string
  lat: number | string | null
  lng: number | string | null
}

export type NearbyWhy = 'closest' | 'lightest load' | 'same zone'

export type NearbyJobHit = { job: NearbyJob; miles: number }
export type NearbyBacklogHit = { item: NearbyBacklog; miles: number }
export type NearbyTechDay = {
  tech: string
  hits: NearbyJobHit[]
  dayJobCount: number
  bookedHours: number
  /** Step 1 drive estimate for the existing day route (yard→jobs→yard). */
  driveHours: number
  /** work + drive. */
  totalHours: number
  shiftHours: number
  remainingHours: number
  why?: NearbyWhy
  /** When a candidate pin is scored: insertion summary for Best days. */
  insertionLabel?: string
  insertionFits?: boolean
  addedDriveHours?: number
  bootsRisk?: boolean
}
export type NearbyDay = {
  date: string
  nearestMiles: number
  jobCount: number
  maxRemainingHours: number
  techs: NearbyTechDay[]
}
export type NearbySummary = {
  days: NearbyDay[]
  unscheduled: NearbyJobHit[]
  backlog: NearbyBacklogHit[]
}

/**
 * Rank upcoming work near a Nearby center. Closest day first.
 * Today and later only. Capacity blocks are skipped.
 * Straight-line miles, same radius as the map circle.
 */
export function summarizeNearby(
  jobs: readonly NearbyJob[],
  backlog: readonly NearbyBacklog[],
  center: ProximityCenter,
  radiusMiles: number,
  today: string,
  opts?: {
    /** Candidate job pin for Best-days insertion ranking (selected / new-job-here). */
    candidate?: (JobDurationInput & {
      /** Selected job id: left out of its own insertion route if already booked. */
      id?: number | string
      lat: number
      lng: number
      workHours?: number
      begin_time?: string | null
    }) | null
  },
): NearbySummary {
  const distances = nearbyJobDistances(jobs, center, radiusMiles)
  const byDate = new Map<string, NearbyJobHit[]>()
  const unscheduled: NearbyJobHit[] = []

  for (const job of jobs) {
    if (isCapacityBlock(job)) continue
    const miles = distances.get(String(job.id))
    if (miles == null) continue
    if (!job.schedule_date) {
      unscheduled.push({ job, miles })
      continue
    }
    if (job.schedule_date < today) continue
    const list = byDate.get(job.schedule_date) ?? []
    list.push({ job, miles })
    byDate.set(job.schedule_date, list)
  }

  const days: NearbyDay[] = []
  for (const [date, hits] of byDate) {
    hits.sort((a, b) => a.miles - b.miles)
    const byTech = new Map<string, NearbyJobHit[]>()
    for (const hit of hits) {
      const key = techKey(hit.job.technician_name)
      const list = byTech.get(key) ?? []
      list.push(hit)
      byTech.set(key, list)
    }
    const dayJobsByTech = new Map<string, NearbyJob[]>()
    for (const job of jobs) {
      if (isCapacityBlock(job)) continue
      if (job.schedule_date !== date) continue
      const key = techKey(job.technician_name)
      const list = dayJobsByTech.get(key) ?? []
      list.push(job)
      dayJobsByTech.set(key, list)
    }

    const techs: NearbyTechDay[] = [...byTech].map(([tech, techHits]) => {
      const dayJobs = dayJobsByTech.get(tech) ?? []
      const drive = estimateTechDayDrive(
        dayJobs.map((j) => ({ ...j, id: j.id })),
        tech,
        date,
      )
      const bookedHours = drive.workHours
      const driveHours = drive.driveHours
      const totalHours = drive.totalHours
      const shiftHours = drive.shiftHours
      const remainingHours = Math.max(0, Math.round((shiftHours - totalHours) * 10) / 10)
      const row: NearbyTechDay = {
        tech,
        hits: techHits,
        dayJobCount: dayJobs.length,
        bookedHours,
        driveHours,
        totalHours,
        shiftHours,
        remainingHours,
      }
      const candidate = opts?.candidate
      if (candidate) {
        const mapped = dayJobs.map((j) => ({ ...j, id: j.id }))
        const others =
          candidate.id != null && candidate.id !== ''
            ? mapped.filter((j) => String(j.id) !== String(candidate.id))
            : mapped
        const insertion = bestInsertionForCandidate(others, tech, date, candidate)
        row.insertionLabel = insertion.label
        row.insertionFits = insertion.fits
        row.addedDriveHours = insertion.addedDriveHours
        row.totalHours = insertion.totalHours
        row.driveHours = insertion.driveHours
        row.bookedHours = insertion.workHours
        row.remainingHours = Math.max(0, Math.round((shiftHours - insertion.totalHours) * 10) / 10)
        row.bootsRisk = wouldCreateBootsIssue(others, tech, date, candidate)
      }
      return row
    })

    const ptoKeys = ptoDayKeys(jobs)
    // Leave PTO techs out of Best days candidates for those dates (0h available).
    const available = techs.filter((row) => !ptoKeys.has(`${row.tech}|${date}`))
    techs.length = 0
    techs.push(...available)

    techs.sort((a, b) => {
      if (opts?.candidate) {
        const aFit = a.insertionFits ? 0 : 1
        const bFit = b.insertionFits ? 0 : 1
        if (aFit !== bFit) return aFit - bFit
        const aBoots = a.bootsRisk ? 1 : 0
        const bBoots = b.bootsRisk ? 1 : 0
        if (aBoots !== bBoots) return aBoots - bBoots
        if (Math.abs(a.totalHours - b.totalHours) > 1e-9) return a.totalHours - b.totalHours
        if ((a.addedDriveHours ?? 0) !== (b.addedDriveHours ?? 0)) {
          return (a.addedDriveHours ?? 0) - (b.addedDriveHours ?? 0)
        }
      }
      const aNear = a.hits[0]?.miles ?? Number.POSITIVE_INFINITY
      const bNear = b.hits[0]?.miles ?? Number.POSITIVE_INFINITY
      return aNear - bNear || b.remainingHours - a.remainingHours || a.tech.localeCompare(b.tech)
    })

    if (techs.length > 0) {
      techs[0]!.why = 'closest'
      let lightest = techs[0]!
      for (const t of techs) {
        if (t.remainingHours > lightest.remainingHours) lightest = t
      }
      if (lightest !== techs[0] && lightest.why == null) {
        lightest.why = 'lightest load'
      }
    }

    const maxRemainingHours = techs.reduce((m, t) => Math.max(m, t.remainingHours), 0)
    days.push({
      date,
      nearestMiles: hits[0]!.miles,
      jobCount: hits.length,
      maxRemainingHours,
      techs,
    })
  }
  days.sort(
    (a, b) =>
      a.nearestMiles - b.nearestMiles ||
      b.maxRemainingHours - a.maxRemainingHours ||
      a.date.localeCompare(b.date),
  )
  unscheduled.sort((a, b) => a.miles - b.miles)

  const backlogHits: NearbyBacklogHit[] = []
  for (const item of backlog) {
    if (item.status !== 'open') continue
    const lat = asCoord(item.lat)
    const lng = asCoord(item.lng)
    if (lat == null || lng == null) continue
    const miles = haversineMiles(center.lat, center.lng, lat, lng)
    if (miles <= radiusMiles) backlogHits.push({ item, miles })
  }
  backlogHits.sort((a, b) => a.miles - b.miles)

  return { days, unscheduled, backlog: backlogHits }
}
