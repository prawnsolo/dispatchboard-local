/**
 * Desktop calendar math for Local DispatchBoard.
 * Adapted from the office `src/lib/calendar.ts` time-grid and week-grid helpers.
 * Local rows have no status column: a job can be dragged when it is not a
 * capacity block and has no work order number.
 */

import type { ScheduleVisualKind } from './colors.ts'

export type { ScheduleVisualKind }

export const UNASSIGNED_TECH = 'Unassigned'

/** Survives webviews that drop custom dataTransfer MIME types. */
let draggingJobId: string | null = null

export function setDraggingJobId(id: string | null): void {
  draggingJobId = id
}

export function getDraggingJobId(): string | null {
  return draggingJobId
}

export type DragJob = {
  wo_number: string | null
  is_capacity_block: number | boolean
}

export function isCapacityBlock(job: { is_capacity_block: number | boolean | string }): boolean {
  const value = job.is_capacity_block
  // Some SQLite drivers return INTEGER as string; treat only real capacity as capacity.
  return value === true || value === 1 || value === '1'
}

export function workOrderNumber(job: { wo_number: string | null }): string {
  if (job.wo_number == null) return ''
  return String(job.wo_number).trim()
}

/**
 * Local has no status column. Map capacity / WO / no-WO onto office visual kinds
 * without inventing planned/scheduled.
 */
export function calendarKind(job: {
  wo_number: string | null
  is_capacity_block: number | boolean
}): ScheduleVisualKind {
  if (isCapacityBlock(job)) return 'capacity'
  if (workOrderNumber(job)) return 'in_pegasus'
  return 'tentative'
}

export function glanceLocation(job: {
  address_street?: string | null
  address_descriptor?: string | null
  city?: string | null
  zone_code?: string | null
}): string {
  const parts = [job.address_street, job.address_descriptor, job.city || job.zone_code]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  return parts.join(' · ') || '—'
}

/** Tentative and other no-WO rows. Capacity and work orders stay locked. */
export function canDragJob(job: DragJob): boolean {
  if (isCapacityBlock(job)) return false
  return workOrderNumber(job).length === 0
}

export function dragLockReason(job: DragJob): string | null {
  if (canDragJob(job)) return null
  if (isCapacityBlock(job)) return 'Capacity — locked'
  const wo = workOrderNumber(job)
  if (wo) return `WO ${wo} — locked`
  return 'Locked'
}

export function techKey(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : UNASSIGNED_TECH
}

export function uniqueTechs<T extends { technician_name: string | null }>(jobs: T[]): string[] {
  const names = [...new Set(jobs.map((job) => techKey(job.technician_name)))]
  names.sort((a, b) => {
    if (a === UNASSIGNED_TECH) return 1
    if (b === UNASSIGNED_TECH) return -1
    return a.localeCompare(b)
  })
  return names
}

export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

export function addUtcDays(date: Date, n: number): Date {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

export function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function parseYmd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function addDaysYmd(dateYmd: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return dateYmd
  return ymd(addUtcDays(parseYmd(dateYmd), days))
}

export function weekStartOf(dateYmd: string): string {
  return ymd(mondayOf(parseYmd(dateYmd)))
}

export function weekDays(weekStartYmd: string): Date[] {
  const start = mondayOf(parseYmd(weekStartYmd))
  return Array.from({ length: 7 }, (_, i) => addUtcDays(start, i))
}

export function jobsOnDate<T extends { schedule_date: string | null }>(jobs: T[], date: string): T[] {
  return jobs.filter((job) => job.schedule_date === date)
}

export function jobsInRange<T extends { schedule_date: string | null }>(
  jobs: T[],
  start: string,
  end: string,
): T[] {
  return jobs.filter((job) => {
    const date = job.schedule_date
    return Boolean(date && date >= start && date <= end)
  })
}

export function firstScheduledDate(jobs: Array<{ schedule_date: string | null }>): string | null {
  const dates = jobs
    .map((job) => job.schedule_date)
    .filter((date): date is string => Boolean(date))
    .sort()
  return dates[0] ?? null
}

/** Desktop Time grid: hour rows 07:00–23:00 (11 PM is the last row). */
export const DAY_GRID_START_MIN = 7 * 60
export const DAY_GRID_END_MIN = 24 * 60
export const DAY_GRID_PX_PER_HOUR = 52
export const DAY_GRID_SNAP_MIN = 15
export const DAY_GRID_WORK_START_MIN = 8 * 60
export const DAY_GRID_WORK_END_MIN = 17 * 60

export function parseTimeMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const part = value.length >= 5 ? value.slice(0, 5) : value
  const [hStr, mStr] = part.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export function minutesToDbTime(min: number): string {
  const rounded = Math.round(min)
  if (rounded >= 24 * 60) return '23:59:00'
  const clamped = Math.max(0, rounded)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

export function snapMinutes(min: number, snap: number = DAY_GRID_SNAP_MIN): number {
  if (snap <= 0) return min
  return Math.round(min / snap) * snap
}

export function formatClock(value: string | null | undefined): string | null {
  if (!value) return null
  const part = value.length >= 5 ? value.slice(0, 5) : value
  const [hStr, mStr] = part.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return part
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatTimeWindow(begin: string | null | undefined, end: string | null | undefined): string {
  const a = formatClock(begin)
  const b = formatClock(end)
  if (a && b) return `${a}–${b}`
  return a ?? b ?? ''
}

export function jobTimeBounds(job: {
  begin_time?: string | null
  end_time?: string | null
}): { startMin: number; endMin: number } {
  const startMin = parseTimeMinutes(job.begin_time) ?? 8 * 60
  let endMin = parseTimeMinutes(job.end_time)
  if (endMin == null || endMin <= startMin) endMin = startMin + 60
  return { startMin, endMin }
}

export function dayGridHours(): number[] {
  const hours: number[] = []
  for (let m = DAY_GRID_START_MIN; m < DAY_GRID_END_MIN; m += 60) hours.push(m)
  return hours
}

export function dayGridHeightPx(): number {
  return ((DAY_GRID_END_MIN - DAY_GRID_START_MIN) / 60) * DAY_GRID_PX_PER_HOUR
}

export function jobBlockOffset(startMin: number, endMin: number): { top: number; height: number } {
  const clampedStart = Math.min(Math.max(startMin, DAY_GRID_START_MIN), DAY_GRID_END_MIN)
  const clampedEnd = Math.min(Math.max(endMin, clampedStart + 15), DAY_GRID_END_MIN)
  const top = ((clampedStart - DAY_GRID_START_MIN) / 60) * DAY_GRID_PX_PER_HOUR
  const height = Math.max(((clampedEnd - clampedStart) / 60) * DAY_GRID_PX_PER_HOUR, 22)
  return { top, height }
}

export function yOffsetToMinutes(offsetY: number): number {
  const raw = DAY_GRID_START_MIN + (offsetY / DAY_GRID_PX_PER_HOUR) * 60
  return snapMinutes(Math.min(Math.max(raw, DAY_GRID_START_MIN), DAY_GRID_END_MIN - DAY_GRID_SNAP_MIN))
}

export function dropToSchedulePatch(
  job: { begin_time?: string | null; end_time?: string | null },
  date: string,
  tech: string,
  dropMin: number,
): {
  schedule_date: string
  technician_name: string | null
  begin_time: string
  end_time: string
} {
  const { startMin, endMin } = jobTimeBounds(job)
  const duration = Math.max(endMin - startMin, DAY_GRID_SNAP_MIN)
  const maxStart = DAY_GRID_END_MIN - duration
  const nextStart = Math.min(Math.max(snapMinutes(dropMin), DAY_GRID_START_MIN), Math.max(DAY_GRID_START_MIN, maxStart))
  return {
    schedule_date: date,
    technician_name: tech === UNASSIGNED_TECH ? null : tech,
    begin_time: minutesToDbTime(nextStart),
    end_time: minutesToDbTime(nextStart + duration),
  }
}

export function assignOverlapLanes<
  T extends { id: number | string; begin_time?: string | null; end_time?: string | null },
>(jobs: T[]): Map<string, { lane: number; laneCount: number }> {
  const items = jobs
    .map((job) => ({ job, ...jobTimeBounds(job) }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || String(a.job.id).localeCompare(String(b.job.id)))

  const laneEnd: number[] = []
  const laneOf = new Map<string, number>()
  for (const item of items) {
    const id = String(item.job.id)
    let lane = laneEnd.findIndex((end) => end <= item.startMin)
    if (lane < 0) {
      lane = laneEnd.length
      laneEnd.push(item.endMin)
    } else {
      laneEnd[lane] = item.endMin
    }
    laneOf.set(id, lane)
  }

  const result = new Map<string, { lane: number; laneCount: number }>()
  for (const item of items) {
    const overlapping = items.filter((other) => other.startMin < item.endMin && item.startMin < other.endMin)
    const used = new Set(overlapping.map((other) => laneOf.get(String(other.job.id))).filter((n): n is number => n != null))
    result.set(String(item.job.id), {
      lane: laneOf.get(String(item.job.id)) ?? 0,
      laneCount: Math.max(used.size, 1),
    })
  }
  return result
}
