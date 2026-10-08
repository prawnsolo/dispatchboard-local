/** Compact 16×16 flag / mismatch badges (office CalendarEventCard chrome). */

export function jobFlagLabel(job: {
  mismatch_flag?: number | boolean | null
  checklist_open?: number | null
}): string {
  const parts: string[] = []
  if (Number(job.checklist_open) > 0) parts.push('⚑')
  if (job.mismatch_flag) parts.push('≠')
  return parts.join(' ')
}

export function JobMarks({
  job,
}: {
  job: {
    mismatch_flag?: number | boolean | null
    mismatch_note?: string | null
    checklist_open?: number | null
  }
}) {
  const checklist = Number(job.checklist_open) > 0
  const mismatch = Boolean(job.mismatch_flag)
  if (!checklist && !mismatch) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {checklist ? (
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-amber-400 text-[#451a03]"
          title="Required checklist item unchecked"
          aria-label="Checklist flag"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 22V4M4 4h13l-2 4 2 4H4" />
          </svg>
        </span>
      ) : null}
      {mismatch ? (
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-rose-600 text-white"
          title={job.mismatch_note || 'Call reason / note mismatch'}
          aria-label="Call reason mismatch"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3ZM12 9v4M12 17h.01" />
          </svg>
        </span>
      ) : null}
    </span>
  )
}
