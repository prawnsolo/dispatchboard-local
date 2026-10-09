/**
 * What an ADD file would change, before it is applied.
 *
 * Compares each parsed row with the job already stored under the same work
 * order (or capacity key). Read-only: nothing is written. Also lists work
 * orders that are on the board for the file's dates but missing from the file,
 * since Apply never deletes and a vanished job is usually a cancellation.
 */

import type { ParsedRow } from './add.ts'
import { ensureSchema, type SqlDb } from './store.ts'

export const DIFF_FIELDS: ReadonlyArray<{ key: string; label: string; read: (row: ParsedRow) => string }> = [
  { key: 'technician_name', label: 'Technician', read: (r) => r.technicianName ?? '' },
  { key: 'schedule_date', label: 'Date', read: (r) => r.scheduleDate ?? '' },
  { key: 'begin_time', label: 'Start', read: (r) => r.beginTime ?? '' },
  { key: 'end_time', label: 'End', read: (r) => r.endTime ?? '' },
  { key: 'customer_name', label: 'Customer', read: (r) => r.customerName },
  { key: 'activity_1', label: 'Activity', read: (r) => r.activity1 ?? '' },
  { key: 'activity_2', label: 'Activity 2', read: (r) => r.activity2 ?? '' },
  { key: 'activity_3', label: 'Activity 3', read: (r) => r.activity3 ?? '' },
  { key: 'address_street', label: 'Street', read: (r) => r.address.street ?? '' },
  { key: 'address_city_state_zip', label: 'City, state, zip', read: (r) => r.address.cityStateZip ?? '' },
  { key: 'service_instructions', label: 'Instructions', read: (r) => r.serviceInstructions ?? '' },
  { key: 'location_definition', label: 'At the house', read: (r) => r.locationDefinition ?? '' },
  { key: 'activity_note', label: 'Note', read: (r) => r.activityNote ?? '' },
]

export type FieldChange = { label: string; from: string; to: string }

export type DiffEntry = {
  /** Work order, or the capacity label for PTO and training rows. */
  ref: string
  customer: string
  date: string | null
}

export type ImportDiff = {
  added: DiffEntry[]
  changed: Array<DiffEntry & { changes: FieldChange[] }>
  unchanged: number
  /** On the board for a date in the file, not in the file. */
  missing: DiffEntry[]
}

function norm(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

type StoredJob = Record<string, unknown> & {
  id: number
  wo_number: string | null
  capacity_key: string | null
  customer_name: string
  schedule_date: string | null
  is_capacity_block: number
}

export function refOf(row: ParsedRow): string {
  return row.isCapacity ? row.customerName || 'Capacity' : row.woNumber ?? ''
}

/** Pure part: compare parsed rows with stored ones. Exported for tests. */
export function compareRows(rows: readonly ParsedRow[], stored: readonly StoredJob[]): ImportDiff {
  const byWo = new Map<string, StoredJob>()
  const byCap = new Map<string, StoredJob>()
  for (const job of stored) {
    if (job.is_capacity_block) {
      if (job.capacity_key) byCap.set(job.capacity_key, job)
    } else if (job.wo_number) byWo.set(job.wo_number, job)
  }

  const diff: ImportDiff = { added: [], changed: [], unchanged: 0, missing: [] }
  const seenWo = new Set<string>()
  const dates = new Set<string>()

  for (const row of rows) {
    if (row.scheduleDate) dates.add(row.scheduleDate)
    if (row.woNumber && !row.isCapacity) seenWo.add(row.woNumber)
    const entry: DiffEntry = { ref: refOf(row), customer: row.customerName, date: row.scheduleDate }
    const match = row.isCapacity ? (row.capacityKey ? byCap.get(row.capacityKey) : undefined) : row.woNumber ? byWo.get(row.woNumber) : undefined
    if (!match) {
      diff.added.push(entry)
      continue
    }
    const changes: FieldChange[] = []
    for (const field of DIFF_FIELDS) {
      const to = norm(field.read(row))
      const from = norm(match[field.key])
      if (from !== to) changes.push({ label: field.label, from, to })
    }
    if (changes.length) diff.changed.push({ ...entry, changes })
    else diff.unchanged++
  }

  for (const job of stored) {
    if (job.is_capacity_block || !job.wo_number || !job.schedule_date) continue
    if (dates.has(job.schedule_date) && !seenWo.has(job.wo_number)) {
      diff.missing.push({ ref: job.wo_number, customer: job.customer_name, date: job.schedule_date })
    }
  }
  return diff
}

export async function diffImport(db: SqlDb, rows: readonly ParsedRow[]): Promise<ImportDiff> {
  await ensureSchema(db)
  const stored = await db.select<StoredJob>(
    `SELECT id, wo_number, capacity_key, is_capacity_block, customer_name, schedule_date,
            ${DIFF_FIELDS.map((f) => f.key).filter((k) => k !== 'customer_name' && k !== 'schedule_date').join(', ')}
       FROM jobs`,
  )
  return compareRows(rows, stored)
}

/** One line for a change, e.g. `Technician: CHAD TAYLOR → ELI MASTON`. */
export function describeChange(change: FieldChange): string {
  const show = (v: string) => (v ? (v.length > 60 ? `${v.slice(0, 57)}…` : v) : 'empty')
  return `${change.label}: ${show(change.from)} → ${show(change.to)}`
}
