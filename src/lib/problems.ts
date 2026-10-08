/**
 * Today's problems strip: counts for the header date, and the matching filter.
 *
 * Over capacity uses techDayLoads (techLoad.ts), the same numbers the Calendar
 * shows next to each tech: duration table + Step 1 drive vs shiftHoursForTech
 * (8h default).
 */

import { jobHasMappedPin } from './geocode.ts'
import type { JobDurationInput } from './jobDurations.ts'
import { bootsCountForDate, bootsFlagsForJobs, type BootsJob } from './boots.ts'
import { techDayLoads } from './techLoad.ts'
import { calendarKind, isCapacityBlock, techKey } from './schedule.ts'

export type ProblemJob = JobDurationInput & {
  id: number
  schedule_date: string | null
  technician_name: string | null
  wo_number: string | null
  is_capacity_block: number | boolean
  lat?: number | string | null
  lng?: number | string | null
  geocode_source?: string | null
  mismatch_flag?: number | boolean | null
  checklist_open?: number | null
}

export type ProblemKind = 'unmapped' | 'mismatch' | 'flags' | 'tentative' | 'over_capacity' | 'boots'

export type ProblemSelection = { kind: Exclude<ProblemKind, 'over_capacity'> } | { kind: 'over_capacity'; tech: string }

export type OverCapacityTech = {
  tech: string
  /** Wrench hours (duration table). */
  bookedHours: number
  /** Step 1 crow-flies drive (yard→jobs→yard). */
  driveHours: number
  /** work + drive — what made this tech Over. */
  totalHours: number
  shiftHours: number
  jobs: number
}

export type ProblemSummary = {
  date: string
  unmapped: number
  mismatch: number
  flags: number
  tentative: number
  overCapacity: OverCapacityTech[]
  boots: number
}


function isUnmapped(job: ProblemJob): boolean {
  return !isCapacityBlock(job) && !jobHasMappedPin(job)
}
function isMismatch(job: ProblemJob): boolean {
  return !isCapacityBlock(job) && Boolean(Number(job.mismatch_flag))
}
function hasOpenFlag(job: ProblemJob): boolean {
  return !isCapacityBlock(job) && Number(job.checklist_open) > 0
}
function isTentative(job: ProblemJob): boolean {
  return calendarKind(job) === 'tentative'
}

/** Techs whose booked wrench hours exceed their shift on `date` (same numbers as the Calendar label). */
export function overCapacityTechs(jobs: readonly ProblemJob[], date: string): OverCapacityTech[] {
  const out: OverCapacityTech[] = []
  for (const load of techDayLoads(jobs.filter((job) => job.schedule_date === date)).values()) {
    if (load.level === 'over') {
      out.push({
        tech: load.tech,
        bookedHours: load.bookedHours,
        driveHours: load.driveHours,
        totalHours: load.totalHours,
        shiftHours: load.shiftHours,
        jobs: load.jobs,
      })
    }
  }
  return out.sort(
    (a, b) => b.totalHours - b.shiftHours - (a.totalHours - a.shiftHours) || a.tech.localeCompare(b.tech),
  )
}

export function summarizeProblems(jobs: readonly ProblemJob[], date: string): ProblemSummary {
  const day = jobs.filter((job) => job.schedule_date === date)
  const bootsFlags = bootsFlagsForJobs(jobs as unknown as BootsJob[])
  return {
    date,
    unmapped: day.filter(isUnmapped).length,
    mismatch: day.filter(isMismatch).length,
    flags: day.filter(hasOpenFlag).length,
    tentative: day.filter(isTentative).length,
    overCapacity: overCapacityTechs(day, date),
    boots: bootsCountForDate(bootsFlags, date),
  }
}

export function problemTotal(summary: ProblemSummary): number {
  return summary.unmapped + summary.mismatch + summary.flags + summary.tentative + summary.overCapacity.length + summary.boots
}

/** Predicate for the clicked strip item. Limited to the strip's date. */
export function problemPredicate(
  selection: ProblemSelection,
  date: string,
  allJobs: readonly ProblemJob[] = [],
): (job: ProblemJob) => boolean {
  const onDay = (job: ProblemJob) => job.schedule_date === date
  switch (selection.kind) {
    case 'unmapped':
      return (job) => onDay(job) && isUnmapped(job)
    case 'mismatch':
      return (job) => onDay(job) && isMismatch(job)
    case 'flags':
      return (job) => onDay(job) && hasOpenFlag(job)
    case 'tentative':
      return (job) => onDay(job) && isTentative(job)
    case 'over_capacity': {
      const key = techKey(selection.tech)
      return (job) => onDay(job) && techKey(job.technician_name) === key
    }
    case 'boots': {
      const flags = bootsFlagsForJobs(allJobs as unknown as BootsJob[])
      return (job) => onDay(job) && flags.has(String(job.id))
    }
  }
}

export function sameSelection(a: ProblemSelection | null, b: ProblemSelection | null): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  return a.kind !== 'over_capacity' || (b.kind === 'over_capacity' && techKey(a.tech) === techKey(b.tech))
}

export function selectionLabel(selection: ProblemSelection): string {
  switch (selection.kind) {
    case 'unmapped':
      return 'Unmapped'
    case 'mismatch':
      return 'Mismatch'
    case 'flags':
      return 'Open flags'
    case 'tentative':
      return 'Tentative'
    case 'over_capacity':
      return `Over capacity · ${selection.tech}`
    case 'boots':
      return 'Boots'
  }
}
