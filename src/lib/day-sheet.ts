/** Grouping for the printed day sheet: one page per technician, jobs in time order. */

import { isCapacityBlock, parseTimeMinutes, techKey, UNASSIGNED_TECH } from './schedule.ts'
import type { JobRow } from './store.ts'

export type DaySheetPage = { tech: string; jobs: JobRow[] }

export function daySheetPages(jobs: readonly JobRow[], date: string, only?: string | null): DaySheetPage[] {
  const byTech = new Map<string, JobRow[]>()
  for (const job of jobs) {
    if (job.schedule_date !== date || isCapacityBlock(job)) continue
    const tech = techKey(job.technician_name)
    if (only && tech !== only) continue
    const list = byTech.get(tech) ?? []
    list.push(job)
    byTech.set(tech, list)
  }
  const pages: DaySheetPage[] = []
  for (const [tech, list] of byTech) {
    list.sort(
      (a, b) =>
        (parseTimeMinutes(a.begin_time) ?? 24 * 60) - (parseTimeMinutes(b.begin_time) ?? 24 * 60) ||
        (a.wo_number ?? '').localeCompare(b.wo_number ?? '') ||
        a.id - b.id,
    )
    pages.push({ tech, jobs: list })
  }
  return pages.sort((a, b) => {
    if (a.tech === UNASSIGNED_TECH) return 1
    if (b.tech === UNASSIGNED_TECH) return -1
    return a.tech.localeCompare(b.tech)
  })
}
