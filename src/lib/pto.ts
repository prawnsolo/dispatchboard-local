/**
 * PTO / blocked-time from ADD capacity rows.
 *
 * Mapping (from fixtures/add-export-sample.csv — 14 capacity rows):
 * - Capacity = WO Number == 0 (is_capacity_block)
 * - Activity in Call Reason 1: "PTO" | "Training" | "Holiday" (and similar)
 * - Customer Name empty; we store activity as customer_name for capacity
 *
 * For scheduling: **PTO** (and Holiday treated as PTO-day) means the tech is
 * unavailable that date — 0h available, leave out of Best days candidates.
 * Training is capacity but not PTO (tech may still be on site); we only grey
 * / exclude strict PTO + Holiday.
 */

import { jobTypeHaystacks, type JobDurationInput } from './jobDurations.ts'
import { isCapacityBlock, techKey, UNASSIGNED_TECH } from './schedule.ts'

const PTO_NEEDLES = ['PTO', 'PAID TIME OFF', 'VACATION', 'HOLIDAY'] as const

export type PtoJob = JobDurationInput & {
  schedule_date: string | null
  technician_name: string | null
  is_capacity_block: number | boolean
  activity_1?: string | null
  customer_name?: string | null
}

/** True when a capacity row is PTO/Holiday (not Training). */
export function isPtoCapacity(job: PtoJob): boolean {
  if (!isCapacityBlock(job)) return false
  const haystacks = jobTypeHaystacks(job)
  // Capacity often stores the activity in customer_name when ADD Customer is blank.
  const extra = (job.customer_name ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  if (extra) haystacks.push(extra)
  if (haystacks.length === 0) return false
  for (const needle of PTO_NEEDLES) {
    if (haystacks.some((h) => h.includes(needle))) return true
  }
  return false
}

export type PtoDay = { tech: string; date: string }

/** Set of `${tech}|${date}` for PTO/Holiday capacity days. */
export function ptoDayKeys(jobs: readonly PtoJob[]): Set<string> {
  const out = new Set<string>()
  for (const job of jobs) {
    if (!job.schedule_date || !isPtoCapacity(job)) continue
    const tech = techKey(job.technician_name)
    if (tech === UNASSIGNED_TECH) continue
    out.add(`${tech}|${job.schedule_date}`)
  }
  return out
}

export function techHasPto(keys: ReadonlySet<string>, tech: string, date: string): boolean {
  return keys.has(`${techKey(tech)}|${date}`)
}

/** Techs on PTO for a date (sorted). */
export function ptoTechsOnDate(jobs: readonly PtoJob[], date: string): string[] {
  const names = new Set<string>()
  for (const job of jobs) {
    if (job.schedule_date !== date || !isPtoCapacity(job)) continue
    const tech = techKey(job.technician_name)
    if (tech !== UNASSIGNED_TECH) names.add(tech)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Copy HTML / plain day line: `PTO: CHAD TAYLOR` (multiple joined with commas). */
export function formatPtoDayLine(techs: readonly string[]): string | null {
  if (techs.length === 0) return null
  return `PTO: ${techs.join(', ')}`
}
