import { formatDriveMinutes, warnLegCount, type DriveLeg } from '../lib/drive-times.ts'

export function DriveTimesControl({
  disabled,
  disabledReason,
  checking,
  legs,
  error,
  fromCache,
  onCheck,
  onRefresh,
  compact = false,
}: {
  disabled: boolean
  disabledReason: string | null
  checking: boolean
  legs: DriveLeg[]
  error: string | null
  fromCache: boolean
  onCheck: () => void
  onRefresh: () => void
  /** Header/map overlay: button and summary only. The long explanation stays on the button title. */
  compact?: boolean
}) {
  const hasResult = legs.length > 0
  const warns = warnLegCount(legs)
  const buttonClass = compact
    ? 'h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50'
    : 'rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-ink disabled:opacity-50'
  const button = (
    <button
      type="button"
      disabled={disabled || checking}
      data-testid={hasResult ? 'drive-times-refresh' : 'drive-times-check'}
      title={disabledReason ?? (hasResult ? 'Recompute this technician and day' : 'One technician, one day')}
      onClick={() => (hasResult ? onRefresh() : onCheck())}
      className={buttonClass}
    >
      {checking ? 'Checking…' : hasResult ? (compact ? 'Refresh' : 'Refresh drive times') : compact ? 'Drive times' : 'Check drive times'}
    </button>
  )
  const summary = hasResult ? (
    <span className={`text-xs ${warns > 0 ? 'font-semibold text-warning' : 'text-slate-500'}`} data-testid="drive-times-summary">
      {warns > 0
        ? `${warns} leg${warns === 1 ? '' : 's'} over 30 min`
        : `${legs.length} leg${legs.length === 1 ? '' : 's'} · all ≤ 30 min`}
      {fromCache ? ' · cached' : ''}
    </span>
  ) : null
  const legsList = hasResult ? (
    <ul className={compact ? 'max-h-40 w-72 space-y-1 overflow-auto text-xs' : 'mt-2 space-y-1 text-xs'} data-testid="drive-times-legs">
      {legs.map((leg, index) => (
        <li
          key={`${leg.fromId}-${leg.toId}-${index}`}
          className={`flex items-start justify-between gap-2 ${leg.warn ? 'font-semibold text-warning' : 'text-ink-body'}`}
        >
          <span>
            {leg.fromLabel} → {leg.toLabel}
          </span>
          <span className="shrink-0">
            {formatDriveMinutes(leg.durationSeconds)}
            {leg.warn ? ' · over 30 min' : ''}
          </span>
        </li>
      ))}
    </ul>
  ) : null

  if (compact) {
    return (
      <div className="relative flex items-center gap-2" data-testid="drive-times-control">
        {button}
        {summary}
        {disabled && disabledReason ? (
          <p className="sr-only" data-testid="drive-times-disabled">
            {disabledReason}
          </p>
        ) : null}
        {error || legsList ? (
          <div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-slate-200 bg-white/95 p-2 text-left shadow-sm">
            {error ? (
              <p className="text-xs text-error" role="alert">
                {error}
              </p>
            ) : null}
            {legsList}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section data-testid="drive-times-control">
      <h3 className="text-base font-semibold text-ink">Drive times</h3>
      <p className="mt-1 text-xs text-ink-body">
        One technician and one day. One Google Routes call, then the legs stay cached on this PC until the schedule
        changes.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {button}
        {summary}
      </div>
      {disabled && disabledReason ? (
        <p className="mt-2 text-xs text-ink-label" data-testid="drive-times-disabled">
          {disabledReason}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {legsList}
    </section>
  )
}
