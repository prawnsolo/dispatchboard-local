import type { JobDraft } from './store.ts'

/** In-memory undo for moves and drawer edits. Same shape as the office stack: ~10s, max 3. */

export const UNDO_TTL_MS = 10_000
export const UNDO_STACK_MAX = 3

export type ScheduleSnapshot = {
  jobId: number
  customerName: string
  schedule_date: string | null
  technician_name: string | null
  begin_time: string | null
  end_time: string | null
}

export type ScheduleUndoEntry = {
  id: string
  label: string
  previous: ScheduleSnapshot
  /** Set for a drawer edit: the whole job as it was before the save. */
  restoreDraft?: JobDraft
  createdAt: number
  expiresAt: number
}

export function snapshotFromJob(job: {
  id: number
  customer_name: string
  schedule_date: string | null
  technician_name: string | null
  begin_time?: string | null
  end_time?: string | null
}): ScheduleSnapshot {
  return {
    jobId: job.id,
    customerName: job.customer_name,
    schedule_date: job.schedule_date,
    technician_name: job.technician_name,
    begin_time: job.begin_time ?? null,
    end_time: job.end_time ?? null,
  }
}

export function makeUndoEntry(previous: ScheduleSnapshot, now: number = Date.now()): ScheduleUndoEntry {
  return {
    id: `${previous.jobId}:${now}`,
    label: `Moved ${previous.customerName}`,
    previous,
    createdAt: now,
    expiresAt: now + UNDO_TTL_MS,
  }
}

export function pruneExpired(stack: ScheduleUndoEntry[], now: number = Date.now()): ScheduleUndoEntry[] {
  return stack.filter((entry) => entry.expiresAt > now)
}

export function pushUndo(
  stack: ScheduleUndoEntry[],
  entry: ScheduleUndoEntry,
  now: number = Date.now(),
): ScheduleUndoEntry[] {
  return [...pruneExpired(stack, now), entry].slice(-UNDO_STACK_MAX)
}

export function popUndo(stack: ScheduleUndoEntry[]): {
  stack: ScheduleUndoEntry[]
  entry: ScheduleUndoEntry | undefined
} {
  if (stack.length === 0) return { stack, entry: undefined }
  return { stack: stack.slice(0, -1), entry: stack[stack.length - 1] }
}

export function newestLive(stack: ScheduleUndoEntry[], now: number = Date.now()): ScheduleUndoEntry | undefined {
  const live = pruneExpired(stack, now)
  return live[live.length - 1]
}

/** Undo entry for a drawer edit. `before` is the draft the drawer opened with. */
export function makeEditUndoEntry(before: JobDraft, now: number = Date.now()): ScheduleUndoEntry {
  const id = before.id ?? 0
  return {
    id: `edit:${id}:${now}`,
    label: `Saved ${before.customer_name || 'job'}`,
    previous: {
      jobId: id,
      customerName: before.customer_name,
      schedule_date: before.schedule_date || null,
      technician_name: before.technician_name || null,
      begin_time: before.begin_time || null,
      end_time: before.end_time || null,
    },
    restoreDraft: before,
    createdAt: now,
    expiresAt: now + UNDO_TTL_MS,
  }
}

/** Drawer to App without threading a prop through every screen. */
type EditListener = (before: JobDraft) => void
let editListener: EditListener | null = null

export function onJobEdited(listener: EditListener | null): void {
  editListener = listener
}

export function announceJobEdited(before: JobDraft): void {
  editListener?.(before)
}
