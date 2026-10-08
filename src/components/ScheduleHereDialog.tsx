import { useState } from 'react'
import {
  alreadyOnTarget,
  formatBestDay,
  scheduleHereKind,
  technicianForPersist,
  type ScheduleHereTarget,
} from '../lib/schedule-here.ts'
import type { JobRow } from '../lib/store.ts'

function kindCopy(kind: ReturnType<typeof scheduleHereKind>): string {
  if (kind === 'tentative-move') {
    return 'Moves this tentative job the same way a calendar drag does. Undo stays available for about 10 seconds.'
  }
  if (kind === 'office-edit') {
    return 'This work order is not dragged. The date and technician save the same way as the job drawer.'
  }
  return 'Capacity blocks are not scheduled from Best days. Edit them in the drawer or on the Sheet.'
}

export function ScheduleHereDialog({
  job,
  target,
  onClose,
  onConfirm,
}: {
  job: JobRow
  target: ScheduleHereTarget
  onClose: () => void
  onConfirm: (next: { schedule_date: string; technician_name: string | null }) => Promise<void>
}) {
  const kind = scheduleHereKind(job)
  const already = alreadyOnTarget(job, target)
  const blocked = kind === 'blocked' || already
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (blocked) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm({
        schedule_date: target.date,
        technician_name: technicianForPersist(target.tech),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-here-title"
        data-testid="schedule-here-sheet"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-card"
      >
        <p className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">Best days</p>
        <h2 id="schedule-here-title" className="text-lg font-semibold">
          Schedule here
        </h2>
        <p className="mt-1 text-sm text-ink-body">{job.customer_name}</p>
        <p className="mt-3 text-sm text-ink">
          Put this job on <span className="font-semibold">{formatBestDay(target.date)}</span> with{' '}
          <span className="font-semibold">{target.tech}</span>?
        </p>
        <p className="mt-2 text-xs text-ink-label">{kindCopy(kind)}</p>
        {already ? (
          <p className="mt-2 text-xs text-ink-body" data-testid="schedule-here-already">
            Already on this day with this technician.
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={blocked || busy}
            data-testid="schedule-here-confirm"
            onClick={() => void confirm()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
