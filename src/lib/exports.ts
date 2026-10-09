import { BACKLOG_STATUS_LABELS, BACKLOG_TYPE_LABELS, type BacklogItem } from './backlog.ts'
import { toCsv } from './csv.ts'
import type { JobRow } from './store.ts'

/** Jobs as shown on screen: one line per job. */
export function jobsCsv(jobs: readonly JobRow[]): string {
  return toCsv(
    ['Date', 'Start', 'End', 'Technician', 'WO', 'Customer', 'Activity', 'Street', 'City, state, zip', 'Zone', 'At the house', 'Note'],
    jobs.map((j) => [
      j.schedule_date,
      j.begin_time,
      j.end_time,
      j.technician_name,
      j.is_capacity_block ? '' : j.wo_number,
      j.customer_name,
      [j.activity_1, j.activity_2, j.activity_3].filter(Boolean).join(' / '),
      j.address_street,
      j.address_city_state_zip,
      j.zone_code,
      j.location_definition,
      j.activity_note,
    ]),
  )
}

export function backlogCsv(items: readonly BacklogItem[]): string {
  return toCsv(
    ['Type', 'Campaign', 'Customer #', 'Customer', 'Street', 'City, state, zip', 'Zone', 'Priority', 'Status', 'Notes'],
    items.map((i) => [
      BACKLOG_TYPE_LABELS[i.backlog_type],
      i.campaign,
      i.customer_number,
      i.customer_name,
      i.address_street,
      i.address_city_state_zip,
      i.zone_code,
      i.priority,
      BACKLOG_STATUS_LABELS[i.status],
      i.notes,
    ]),
  )
}
