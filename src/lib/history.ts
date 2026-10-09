/**
 * Edit history for a job. Every change made in the app (drawer, drag, Sheet cell)
 * writes one row listing which fields changed, from what, to what. It lives in
 * the same local database as the job, so it never leaves this PC and is removed
 * when the job is deleted or the database is wiped. Imports are not logged here;
 * the Import preview already shows what a file will change.
 */

import type { SqlDb } from './store.ts'

export const HISTORY_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'technician_name', label: 'Technician' },
  { key: 'schedule_date', label: 'Date' },
  { key: 'begin_time', label: 'Start' },
  { key: 'end_time', label: 'End' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'activity_1', label: 'Activity' },
  { key: 'activity_2', label: 'Activity 2' },
  { key: 'activity_3', label: 'Activity 3' },
  { key: 'address_street', label: 'Street' },
  { key: 'address_city_state_zip', label: 'City, state, zip' },
  { key: 'service_instructions', label: 'Instructions' },
  { key: 'location_definition', label: 'At the house' },
  { key: 'activity_note', label: 'Note' },
  { key: 'zone_code', label: 'Zone' },
]

export const HISTORY_PER_JOB = 50

export type HistoryChange = { label: string; from: string; to: string }
export type HistoryEntry = { id: number; at: string; source: string; changes: HistoryChange[] }
export type HistorySource = 'edit' | 'move' | 'sheet'

function norm(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

export function changesBetween(before: Record<string, unknown>, after: Record<string, unknown>): HistoryChange[] {
  const out: HistoryChange[] = []
  for (const f of HISTORY_FIELDS) {
    const from = norm(before[f.key])
    const to = norm(after[f.key])
    if (from !== to) out.push({ label: f.label, from, to })
  }
  return out
}

const tracking = new WeakSet<object>()

/**
 * Run `work`, then log the difference between the job before and after. Nested
 * calls (a Sheet cell that goes through the drawer save) log once, at the outer level.
 */
export async function tracked<T>(db: SqlDb, jobId: number, source: HistorySource, work: () => Promise<T>): Promise<T> {
  if (tracking.has(db)) return work()
  tracking.add(db)
  try {
    const before = (await db.select<Record<string, unknown>>('SELECT * FROM jobs WHERE id = ? LIMIT 1', [jobId]))[0]
    const result = await work()
    const after = (await db.select<Record<string, unknown>>('SELECT * FROM jobs WHERE id = ? LIMIT 1', [jobId]))[0]
    if (before && after) {
      const changes = changesBetween(before, after)
      if (changes.length) await recordHistory(db, jobId, source, changes)
    }
    return result
  } finally {
    tracking.delete(db)
  }
}

export async function recordHistory(db: SqlDb, jobId: number, source: HistorySource, changes: HistoryChange[]): Promise<void> {
  await db.execute('INSERT INTO job_history (job_id, source, changes) VALUES (?, ?, ?)', [jobId, source, JSON.stringify(changes)])
  await db.execute(
    `DELETE FROM job_history WHERE job_id = ? AND id NOT IN (
       SELECT id FROM job_history WHERE job_id = ? ORDER BY id DESC LIMIT ${HISTORY_PER_JOB}
     )`,
    [jobId, jobId],
  )
}

export async function listHistory(db: SqlDb, jobId: number): Promise<HistoryEntry[]> {
  const rows = await db.select<{ id: number; at: string; source: string; changes: string }>(
    'SELECT id, at, source, changes FROM job_history WHERE job_id = ? ORDER BY id DESC',
    [jobId],
  )
  return rows.map((r) => {
    let changes: HistoryChange[] = []
    try {
      const parsed: unknown = JSON.parse(r.changes)
      if (Array.isArray(parsed)) changes = parsed.filter((c): c is HistoryChange => !!c && typeof c.label === 'string')
    } catch {
      changes = []
    }
    return { id: Number(r.id), at: String(r.at), source: String(r.source), changes }
  })
}

export const HISTORY_SQL = `CREATE TABLE IF NOT EXISTS job_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  changes TEXT NOT NULL
)`
export const HISTORY_INDEX_SQL = 'CREATE INDEX IF NOT EXISTS idx_job_history_job ON job_history (job_id, id)'
