/**
 * Step 1 drive-time estimates: crow-flies × road factor at fixed mph.
 * No Google calls. Techs start/end every day at the yard (yard.ts).
 *
 * Step 2 can replace estimateLegHours via a DriveHoursProvider that returns
 * Google Routes cached times — Calendar / Best days keep the same fields.
 */

import { DRIVE_ROAD_FACTOR, DRIVE_SPEED_MPH } from './driveEstimateConfig.ts'
import { asCoord } from './geocode.ts'
import { durationHoursForJob, formatHours, shiftHoursForTech, techLoadLevel, type JobDurationInput, type TechLoadLevel } from './jobDurations.ts'
import { orderStopsBySchedule, scheduleSortMinutes, type DriveJob } from './drive-times.ts'
import { isCapacityBlock, techKey } from './schedule.ts'
import { YARD } from './yard.ts'

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

export type LatLng = { lat: number; lng: number }

/** Crow-flies miles × road factor ÷ speed. */
export function estimateLegHours(
  from: LatLng,
  to: LatLng,
  opts?: { roadFactor?: number; speedMph?: number },
): number {
  const factor = opts?.roadFactor ?? DRIVE_ROAD_FACTOR
  const speed = opts?.speedMph ?? DRIVE_SPEED_MPH
  const miles = haversineMiles(from.lat, from.lng, to.lat, to.lng)
  if (!Number.isFinite(miles) || miles <= 0 || speed <= 0) return 0
  return (miles * factor) / speed
}

export type DriveStop = {
  id: string | number
  lat: number
  lng: number
  begin_time?: string | null
  customer_name?: string | null
}

/**
 * Hours for a fixed ordered route of mapped stops (no yard).
 * Callers prepend/append yard when building a tech day.
 */
export function estimateRouteHours(stops: readonly LatLng[]): number {
  if (stops.length < 2) return 0
  let total = 0
  for (let i = 0; i < stops.length - 1; i++) {
    total += estimateLegHours(stops[i]!, stops[i + 1]!)
  }
  return total
}

const round1 = (n: number) => Math.round(n * 10) / 10

export type MappedJobStop = JobDurationInput & {
  id: string | number
  schedule_date?: string | null
  technician_name?: string | null
  is_capacity_block?: number | boolean
  lat?: number | string | null
  lng?: number | string | null
  begin_time?: string | null
  customer_name?: string | null
}

function jobLatLng(job: { lat?: number | string | null; lng?: number | string | null }): LatLng | null {
  const lat = asCoord(job.lat)
  const lng = asCoord(job.lng)
  if (lat == null || lng == null) return null
  return { lat, lng }
}

export type TechDayDrive = {
  tech: string
  date: string
  /** Wrench hours (duration table). */
  workHours: number
  /** Estimated drive hours yard→jobs→yard (mapped only). */
  driveHours: number
  /** work + drive. */
  totalHours: number
  shiftHours: number
  jobs: number
  /** Mapped stops used in the route. */
  mappedStops: number
  /** Non-capacity jobs skipped for missing coords. */
  unmappedCount: number
  level: TechLoadLevel
}

/**
 * Build yard → ordered mapped jobs → yard, sum leg hours.
 * Unmapped (non-capacity) jobs are skipped and counted.
 */
export function estimateTechDayDrive(
  jobs: readonly MappedJobStop[],
  tech: string,
  date: string,
): TechDayDrive {
  const shift = shiftHoursForTech(tech)
  const dayJobs = jobs.filter(
    (j) => j.schedule_date === date && techKey(j.technician_name) === tech && !isCapacityBlock(j as { is_capacity_block: number | boolean }),
  )
  let work = 0
  let unmapped = 0
  const mapped: DriveJob[] = []
  for (const job of dayJobs) {
    work += durationHoursForJob(job)
    const ll = jobLatLng(job)
    if (!ll) {
      unmapped += 1
      continue
    }
    mapped.push({
      id: String(job.id),
      customer_name: job.customer_name ?? null,
      begin_time: job.begin_time ?? null,
      lat: ll.lat,
      lng: ll.lng,
      technician_name: tech,
      schedule_date: date,
    })
  }
  const ordered = orderStopsBySchedule(mapped)
  const points: LatLng[] = [{ lat: YARD.lat, lng: YARD.lng }]
  for (const stop of ordered) {
    points.push({ lat: asCoord(stop.lat)!, lng: asCoord(stop.lng)! })
  }
  points.push({ lat: YARD.lat, lng: YARD.lng })
  // Only count drive when there is at least one mapped job (yard→job→yard).
  const drive = ordered.length === 0 ? 0 : estimateRouteHours(points)
  const workHours = round1(work)
  const driveHours = round1(drive)
  const totalHours = round1(workHours + driveHours)
  return {
    tech,
    date,
    workHours,
    driveHours,
    totalHours,
    shiftHours: shift,
    jobs: dayJobs.length,
    mappedStops: ordered.length,
    unmappedCount: unmapped,
    level: techLoadLevel(totalHours, shift),
  }
}

export type InsertionResult = {
  /** Index in the existing ordered mapped list (0 = after yard, before first job). */
  insertIndex: number
  /** Drive hours of the resulting full day route. */
  driveHours: number
  /** Delta vs drive without the candidate. */
  addedDriveHours: number
  workHours: number
  totalHours: number
  shiftHours: number
  fits: boolean
  level: TechLoadLevel
  /** `+0.4h drive · 7.1h / 8h, fits` or `… over`. */
  label: string
}

/**
 * Insert candidate at the cheapest position in the tech's day route
 * (ordered by existing begin times; candidate is inserted by position, not time).
 * Rank by smallest resulting totalHours still under shift when possible.
 */
export function bestInsertionForCandidate(
  existingJobs: readonly MappedJobStop[],
  tech: string,
  date: string,
  candidate: LatLng & { workHours?: number },
): InsertionResult {
  const shift = shiftHoursForTech(tech)
  const dayJobs = existingJobs.filter(
    (j) => j.schedule_date === date && techKey(j.technician_name) === tech && !isCapacityBlock(j as { is_capacity_block: number | boolean }),
  )
  let workExisting = 0
  const orderedMeta: DriveJob[] = []
  for (const job of dayJobs) {
    workExisting += durationHoursForJob(job)
    const ll = jobLatLng(job)
    if (!ll) continue
    orderedMeta.push({
      id: String(job.id),
      begin_time: job.begin_time ?? null,
      customer_name: job.customer_name ?? null,
      lat: ll.lat,
      lng: ll.lng,
    })
  }
  const ordered = orderStopsBySchedule(orderedMeta).map((j) => ({ lat: asCoord(j.lat)!, lng: asCoord(j.lng)! }))
  const candWork = candidate.workHours ?? 0
  const workHours = round1(workExisting + candWork)

  const baselinePoints: LatLng[] = [{ lat: YARD.lat, lng: YARD.lng }, ...ordered, { lat: YARD.lat, lng: YARD.lng }]
  const baselineDrive = ordered.length === 0 ? 0 : estimateRouteHours(baselinePoints)

  let best: InsertionResult | null = null
  const n = ordered.length
  for (let i = 0; i <= n; i++) {
    const route = [{ lat: YARD.lat, lng: YARD.lng }, ...ordered.slice(0, i), { lat: candidate.lat, lng: candidate.lng }, ...ordered.slice(i), { lat: YARD.lat, lng: YARD.lng }]
    const drive = estimateRouteHours(route)
    const driveHours = round1(drive)
    const addedDriveHours = round1(drive - baselineDrive)
    const totalHours = round1(workHours + driveHours)
    const fits = totalHours <= shift + 1e-9
    const level = techLoadLevel(totalHours, shift)
    const sign = addedDriveHours >= 0 ? '+' : ''
    const label = `${sign}${formatHours(addedDriveHours)}h drive · ${formatHours(totalHours)}h / ${formatHours(shift)}h, ${fits ? 'fits' : 'over'}`
    const row: InsertionResult = { insertIndex: i, driveHours, addedDriveHours, workHours, totalHours, shiftHours: shift, fits, level, label }
    if (!best) {
      best = row
      continue
    }
    // Prefer fits, then smaller total, then smaller added drive, then earlier index.
    const bestRank = (best.fits ? 0 : 1) * 1e6 + best.totalHours * 100 + best.addedDriveHours
    const rowRank = (row.fits ? 0 : 1) * 1e6 + row.totalHours * 100 + row.addedDriveHours
    if (rowRank < bestRank - 1e-9 || (Math.abs(rowRank - bestRank) < 1e-9 && i < best.insertIndex)) {
      best = row
    }
  }
  return best!
}

/** Rank tech/day candidates for placing a job: smallest total under shift first. */
export function rankInsertions(
  rows: readonly (InsertionResult & { tech: string; date: string })[],
): (InsertionResult & { tech: string; date: string })[] {
  return [...rows].sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1
    if (Math.abs(a.totalHours - b.totalHours) > 1e-9) return a.totalHours - b.totalHours
    if (Math.abs(a.addedDriveHours - b.addedDriveHours) > 1e-9) return a.addedDriveHours - b.addedDriveHours
    return a.tech.localeCompare(b.tech) || a.date.localeCompare(b.date)
  })
}

export { scheduleSortMinutes, orderStopsBySchedule }
