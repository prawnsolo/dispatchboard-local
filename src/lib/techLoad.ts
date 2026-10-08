/**
 * Booked wrench hours + Step 1 drive estimate per tech per day.
 * Durations from jobDurations.ts; drive from driveEstimate.ts (crow-flies ×
 * factor / speed). Capacity blocks (PTO, Training) = 0h work. Level uses the
 * full total (work + drive) vs shiftHoursForTech (8h default).
 *
 * Level: Over when total > shift; Near cap when total > shift − 1h
 * (8h shift: amber above 7h, red above 8h). Shown with a text label, never color alone.
 */

import {
  TECH_LOAD_LEVEL_TEXT,
  formatTechDayLoad,
  techLoadLevel,
  type JobDurationInput,
  type TechLoadLevel,
} from './jobDurations.ts'
import { estimateTechDayDrive, type MappedJobStop } from './driveEstimate.ts'
import { UNASSIGNED_TECH, isCapacityBlock, techKey } from './schedule.ts'

export type LoadLevel = TechLoadLevel

export type TechDayLoad = {
  tech: string
  date: string
  /** Wrench hours from the duration table. */
  bookedHours: number
  /** Step 1 estimated drive hours (yard→jobs→yard). */
  driveHours: number
  /** bookedHours + driveHours (used for amber/red). */
  totalHours: number
  shiftHours: number
  /** Non-capacity jobs counted. */
  jobs: number
  /** Non-capacity jobs skipped for missing map pins. */
  unmappedCount: number
  level: LoadLevel
}

export type LoadJob = JobDurationInput & {
  id?: number | string
  schedule_date: string | null
  technician_name: string | null
  is_capacity_block: number | boolean
  begin_time?: string | null
  lat?: number | string | null
  lng?: number | string | null
  customer_name?: string | null
}


/** Shared with Best days and web: jobDurations.techLoadLevel. */
export const loadLevel = techLoadLevel

export const loadKey = (tech: string, date: string) => `${tech}|${date}`

/**
 * Loads keyed by `${techKey}|${date}`. Unassigned jobs are not a tech and are
 * skipped. A tech/day with only capacity blocks is omitted (nothing booked).
 * Drive uses yard start/end; unmapped stops are skipped and flagged.
 */
export function techDayLoads(jobs: readonly LoadJob[]): Map<string, TechDayLoad> {
  const keys = new Set<string>()
  for (const job of jobs) {
    if (!job.schedule_date || isCapacityBlock(job)) continue
    const tech = techKey(job.technician_name)
    if (tech === UNASSIGNED_TECH) continue
    keys.add(loadKey(tech, job.schedule_date))
  }
  const mappedJobs: MappedJobStop[] = jobs.map((job, i) => ({
    ...job,
    id: job.id ?? `anon-${i}`,
  }))
  const out = new Map<string, TechDayLoad>()
  for (const key of keys) {
    const [tech, date] = key.split('|') as [string, string]
    const drive = estimateTechDayDrive(mappedJobs, tech, date)
    if (drive.jobs === 0) continue
    out.set(key, {
      tech,
      date,
      bookedHours: drive.workHours,
      driveHours: drive.driveHours,
      totalHours: drive.totalHours,
      shiftHours: drive.shiftHours,
      jobs: drive.jobs,
      unmappedCount: drive.unmappedCount,
      level: drive.level,
    })
  }
  return out
}

export const LOAD_LEVEL_TEXT = TECH_LOAD_LEVEL_TEXT

/** Shared formatTechDayLoad with drive included (Calendar / Best days). */
export function loadLabel(load: Pick<TechDayLoad, 'bookedHours' | 'driveHours' | 'shiftHours'>): string {
  return formatTechDayLoad(null, null, load.bookedHours, load.shiftHours, load.driveHours).label
}
