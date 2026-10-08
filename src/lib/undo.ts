/** In-memory schedule undo. Same shape as the office stack: ~10s, max 3. */

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
