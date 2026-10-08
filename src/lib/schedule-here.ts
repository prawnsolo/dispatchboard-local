/**
 * Best-days scheduling. Tentative rows use the calendar move path.
 * Work-order rows use the same planning save as the job drawer.
 * Capacity blocks stay blocked.
 */

import { canDragJob, isCapacityBlock, techKey, UNASSIGNED_TECH } from './schedule.ts'

export type ScheduleHereTarget = {
  date: string
  tech: string
}

export type ScheduleHereKind = 'tentative-move' | 'office-edit' | 'blocked'

export function scheduleHereKind(job: {
  wo_number: string | null
  is_capacity_block: number | boolean
}): ScheduleHereKind {
  if (isCapacityBlock(job)) return 'blocked'
  if (canDragJob(job)) return 'tentative-move'
  return 'office-edit'
}

export function technicianForPersist(tech: string): string | null {
  const trimmed = tech.trim()
  if (!trimmed || trimmed === UNASSIGNED_TECH) return null
  return trimmed
}

export function alreadyOnTarget(
  job: { schedule_date: string | null; technician_name: string | null },
  target: ScheduleHereTarget,
): boolean {
  return (job.schedule_date ?? '') === target.date && techKey(job.technician_name) === target.tech
}

export function formatBestDay(dateYmd: string): string {
  const [y, m, d] = dateYmd.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Split a nearby-search pin label into New-job address fields.
 * Does not geocode — the label is already what Nearby found.
 */
export function addressPrefillFromNearbyLabel(label: string): {
  address_street: string
  address_city_state_zip: string
  address_raw: string
} {
  const clean = label.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return { address_street: '', address_city_state_zip: '', address_raw: '' }
  }
  const parts = clean.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return {
      address_street: parts[0]!,
      address_city_state_zip: parts.slice(1).join(', '),
      address_raw: clean,
    }
  }
  return {
    address_street: clean,
    address_city_state_zip: '',
    address_raw: clean,
  }
}
