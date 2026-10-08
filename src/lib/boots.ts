/**
 * Dirty-boots sequence: flag INSIDE jobs that appear after a DIRTY job
 * on the same tech-day (ordered by start time).
 *
 * Local jobs carry activity_1/2/3; a UG install with GAS CHECK as activity 2
 * matches both lists. A job that is itself DIRTY is never flagged as the
 * inside stop (same rule as web boots.ts).
 */

import { DIRTY_BOOTS_RULES, INSIDE_BOOTS_RULES } from './bootsConfig.ts'
import { jobTypeHaystacks, type JobDurationInput } from './jobDurations.ts'
import { orderStopsBySchedule, scheduleSortMinutes } from './drive-times.ts'
import { isCapacityBlock, techKey, UNASSIGNED_TECH } from './schedule.ts'

function matchesRules(job: JobDurationInput, rules: readonly { contains: readonly string[] }[]): boolean {
  const haystacks = jobTypeHaystacks(job)
  if (haystacks.length === 0) return false
  for (const rule of rules) {
    for (const needle of rule.contains) {
      const n = needle.toUpperCase()
      if (haystacks.some((h) => h.includes(n))) return true
    }
  }
  return false
}

export function isDirtyJob(job: JobDurationInput): boolean {
  if (isCapacityBlock(job as { is_capacity_block: number | boolean })) return false
  return matchesRules(job, DIRTY_BOOTS_RULES)
}

export function isInsideJob(job: JobDurationInput): boolean {
  if (isCapacityBlock(job as { is_capacity_block: number | boolean })) return false
  return matchesRules(job, INSIDE_BOOTS_RULES)
}

export const BOOTS_CHIP_LABEL = 'Inside after UG/piping: boots'

export type BootsJob = JobDurationInput & {
  id: number | string
  schedule_date: string | null
  technician_name: string | null
  is_capacity_block: number | boolean
  begin_time?: string | null
  customer_name?: string | null
}

export type BootsFlag = {
  jobId: string
  tech: string
  date: string
}

/**
 * Per tech-day ordered by start time: if any INSIDE job appears after any
 * DIRTY job earlier that day, flag the inside job.
 */
export function bootsFlagsForJobs(jobs: readonly BootsJob[]): Map<string, BootsFlag> {
  const byKey = new Map<string, BootsJob[]>()
  for (const job of jobs) {
    if (!job.schedule_date || isCapacityBlock(job)) continue
    const tech = techKey(job.technician_name)
    if (tech === UNASSIGNED_TECH) continue
    const key = `${tech}|${job.schedule_date}`
    const list = byKey.get(key) ?? []
    list.push(job)
    byKey.set(key, list)
  }
  const out = new Map<string, BootsFlag>()
  for (const [key, list] of byKey) {
    const [tech, date] = key.split('|') as [string, string]
    const ordered = orderStopsBySchedule(
      list.map((j) => ({
        id: String(j.id),
        begin_time: j.begin_time ?? null,
        customer_name: j.customer_name ?? null,
        lat: 0,
        lng: 0,
      })),
    )
    // Re-attach original jobs in schedule order (orderStopsBySchedule sorts by begin_time).
    const byId = new Map(list.map((j) => [String(j.id), j]))
    const seq = ordered.map((o) => byId.get(o.id)!).filter(Boolean)
    let sawDirty = false
    for (const job of seq) {
      // A UG/piping job that also matches inside (e.g. activity_2 GAS CHECK)
      // is never flagged as the inside stop after itself.
      const dirty = isDirtyJob(job)
      if (sawDirty && !dirty && isInsideJob(job)) {
        out.set(String(job.id), { jobId: String(job.id), tech, date })
      }
      if (dirty) sawDirty = true
    }
  }
  return out
}

export function jobHasBootsFlag(flags: ReadonlyMap<string, BootsFlag>, jobId: number | string): boolean {
  return flags.has(String(jobId))
}

/** Count of boots-flagged jobs on a date (for problems strip). */
export function bootsCountForDate(flags: ReadonlyMap<string, BootsFlag>, date: string): number {
  let n = 0
  for (const flag of flags.values()) if (flag.date === date) n += 1
  return n
}

/**
 * Would placing an INSIDE candidate after existing dirty work on this tech/day
 * create a boots issue? (candidate appended by schedule order among existing.)
 */
export function wouldCreateBootsIssue(
  existingJobs: readonly BootsJob[],
  tech: string,
  date: string,
  candidate: JobDurationInput & { begin_time?: string | null },
): boolean {
  if (!isInsideJob(candidate) || isDirtyJob(candidate)) return false
  const day = existingJobs.filter(
    (j) => j.schedule_date === date && techKey(j.technician_name) === tech && !isCapacityBlock(j),
  )
  const candMin = scheduleSortMinutes(candidate.begin_time)
  let sawDirtyBefore = false
  for (const job of day) {
    const t = scheduleSortMinutes(job.begin_time)
    if (t <= candMin && isDirtyJob(job)) sawDirtyBefore = true
  }
  // If candidate has no time, treat as end-of-day (after all timed jobs).
  if (candidate.begin_time == null || String(candidate.begin_time).trim() === '') {
    return day.some(isDirtyJob)
  }
  return sawDirtyBefore
}
