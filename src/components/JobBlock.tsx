import { JobMarks } from './JobMarks.tsx'
import { JobIcon } from './JobIcon.tsx'
import {
  CALENDAR_KIND_CARD_CLASS,
  CALENDAR_KIND_DOT_CLASS,
  CALENDAR_KIND_LABEL,
  primaryActivity,
} from '../lib/colors.ts'
import { formatCustomerAccount } from '../lib/format.ts'
import { calendarKind, canDragJob, formatTimeWindow, glanceLocation, isCapacityBlock, workOrderNumber } from '../lib/schedule.ts'
import { BOOTS_CHIP_LABEL } from '../lib/boots.ts'
import type { JobRow } from '../lib/store.ts'

export function JobBlock({
  job,
  compact = false,
  hideTime = false,
  dragCursor = true,
  nearby = false,
  boots = false,
  className = '',
}: {
  job: JobRow
  compact?: boolean
  hideTime?: boolean
  /** Desktop week grid grab affordance. Day strip / locked rows pass false. */
  dragCursor?: boolean
  nearby?: boolean
  /** Inside job after UG/piping earlier the same tech-day. */
  boots?: boolean
  className?: string
}) {
  const kind = calendarKind(job)
  const capacity = isCapacityBlock(job)
  const windowLabel = formatTimeWindow(job.begin_time, job.end_time)
  const location = capacity ? '—' : glanceLocation(job)
  const activity = primaryActivity(job)
  const account = formatCustomerAccount(job.customer_number)
  const wo = workOrderNumber(job)
  const locked = !canDragJob(job)
  const showGrab = dragCursor && !locked

  const badges = (
    <>
      {nearby ? (
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-violet-600 text-white"
          title="Within the active proximity search radius"
          aria-label="Nearby the searched address"
        >
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </span>
      ) : null}
      {boots ? (
        <span
          className="inline-flex max-w-full items-center rounded-sm bg-amber-100 px-1 py-0.5 text-[12px] font-semibold leading-none text-amber-900"
          title={BOOTS_CHIP_LABEL}
          data-testid="boots-chip"
        >
          {BOOTS_CHIP_LABEL}
        </span>
      ) : null}
      <JobMarks job={job} />
    </>
  )

  return (
    <div
      className={`db-card relative h-full overflow-hidden rounded-md border bg-white text-left shadow-sm ${CALENDAR_KIND_CARD_CLASS[kind]} ${
        showGrab ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
      } ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} ${className}`}
    >
      {hideTime ? null : (
        <div className="flex items-center justify-between gap-1">
          <p className="truncate text-xs font-semibold tabular-nums text-slate-600">{windowLabel || 'No time window'}</p>
          <span className="flex shrink-0 items-center gap-1">{badges}</span>
        </div>
      )}
      <div className={`flex items-start gap-1 ${hideTime ? '' : 'mt-0.5'}`}>
        <JobIcon job={job} size={compact ? 18 : 20} />
        {hideTime ? badges : null}
        <p className={`min-w-0 flex-1 font-semibold text-slate-900 ${compact ? 'text-xs leading-tight' : 'text-xs'}`}>
          <span className="line-clamp-2">{job.customer_name}</span>
        </p>
        {account ? (
          <span
            className={`shrink-0 font-medium tabular-nums text-slate-500 ${compact ? 'text-xs leading-tight' : 'text-xs'}`}
            data-testid="customer-account"
          >
            {account}
          </span>
        ) : null}
      </div>
      {activity ? <p className="mt-0.5 truncate text-xs font-medium text-slate-700">{activity}</p> : null}
      {!capacity ? <p className="mt-0.5 truncate text-xs text-slate-500">{location}</p> : null}
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className={`size-1.5 rounded-full ${CALENDAR_KIND_DOT_CLASS[kind]}`} aria-hidden="true" />
          {kind === 'in_pegasus' && wo ? `WO ${wo}` : CALENDAR_KIND_LABEL[kind]}
        </span>
        {kind !== 'in_pegasus' && wo ? <span>WO {wo}</span> : null}
      </p>
    </div>
  )
}
