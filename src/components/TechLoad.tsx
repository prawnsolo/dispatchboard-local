import { formatTechDayLoad, type TechLoadLevel } from '../lib/jobDurations.ts'
import type { TechDayLoad } from '../lib/techLoad.ts'

export const LOAD_LEVEL_CLASS: Readonly<Record<TechLoadLevel, string>> = {
  ok: 'text-slate-600',
  near: 'font-semibold text-amber-800',
  over: 'font-semibold text-rose-700',
}

const SWATCH: Readonly<Record<TechLoadLevel, string>> = { ok: '', near: 'bg-amber-500', over: 'bg-rose-600' }

/**
 * Booked vs shift with Step 1 drive: `5.5h work + 1.2h drive = 6.7h / 8h`.
 * Amber + "Near cap" / red + "Over" on the full total (work+drive).
 */
export function LoadHours({
  bookedHours,
  shiftHours,
  driveHours = 0,
  className = '',
  testId,
  title,
}: {
  bookedHours: number
  shiftHours: number
  driveHours?: number
  className?: string
  testId?: string
  title?: string
}) {
  const f = formatTechDayLoad(null, null, bookedHours, shiftHours, driveHours)
  return (
    <span
      className={`inline-flex max-w-full flex-wrap items-center gap-1 text-xs tabular-nums ${LOAD_LEVEL_CLASS[f.level]} ${className}`}
      data-testid={testId}
      data-level={f.level}
      title={title}
    >
      {f.level === 'ok' ? null : <span className={`size-2 shrink-0 rounded-sm ${SWATCH[f.level]}`} aria-hidden="true" />}
      <span className="min-w-0 leading-snug">{f.hours}</span>
      {f.levelText ? <span>· {f.levelText}</span> : null}
    </span>
  )
}

/** Calendar label for one tech/day (includes drive estimate). */
export function TechLoad({ load, className = '' }: { load: TechDayLoad; className?: string }) {
  const f = formatTechDayLoad(load.tech, load.jobs, load.bookedHours, load.shiftHours, load.driveHours)
  const unmapped =
    load.unmappedCount > 0 ? ` · ${load.unmappedCount} unmapped stop${load.unmappedCount === 1 ? '' : 's'}` : ''
  return (
    <LoadHours
      bookedHours={load.bookedHours}
      driveHours={load.driveHours}
      shiftHours={load.shiftHours}
      className={className}
      testId={`tech-load-${load.tech}-${load.date}`}
      title={`${f.label}${unmapped} (duration table + crow-flies drive)`}
    />
  )
}
