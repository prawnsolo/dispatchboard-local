/**
 * Double-booking: two jobs for one technician whose time windows overlap, or a
 * job on a day the technician is off (PTO or holiday). Jobs without both a start
 * and an end time are skipped: a missing time is not evidence of a clash.
 */

import { isPtoCapacity, type PtoJob } from './pto.ts'
import { isCapacityBlock, parseTimeMinutes, techKey, UNASSIGNED_TECH } from './schedule.ts'

export type OverlapJob = PtoJob & { id: number; begin_time?: string | null; end_time?: string | null }

function window(job: OverlapJob): [number, number] | null {
  const a = parseTimeMinutes(job.begin_time)
  const b = parseTimeMinutes(job.end_time)
  if (a == null || b == null || b <= a) return null
  return [a, b]
}

/** Ids of jobs involved in a clash on `date`. */
export function overlappingJobIds(jobs: readonly OverlapJob[], date: string): Set<number> {
  const out = new Set<number>()
  const byTech = new Map<string, OverlapJob[]>()
  const off = new Set<string>()
  for (const job of jobs) {
    if (job.schedule_date !== date) continue
    const tech = techKey(job.technician_name)
    if (tech === UNASSIGNED_TECH) continue
    if (isCapacityBlock(job)) {
      if (isPtoCapacity(job)) off.add(tech)
      continue
    }
    const list = byTech.get(tech) ?? []
    list.push(job)
    byTech.set(tech, list)
  }
  for (const [tech, list] of byTech) {
    if (off.has(tech)) for (const job of list) out.add(job.id)
    const timed = list
      .map((job) => ({ job, w: window(job) }))
      .filter((x): x is { job: OverlapJob; w: [number, number] } => x.w != null)
      .sort((a, b) => a.w[0] - b.w[0])
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (timed[j]!.w[0] >= timed[i]!.w[1]) break
        out.add(timed[i]!.job.id)
        out.add(timed[j]!.job.id)
      }
    }
  }
  return out
}
