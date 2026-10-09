import { Icon } from './Icon.tsx'
import { jobIcon, type JobIconInfo } from '../lib/job-icons.ts'
import type { JobRow } from '../lib/store.ts'

export type JobTypeCount = JobIconInfo & { key: string; count: number }

/** Distinct job types in a list, most common first. */
export function countJobTypes(jobs: readonly JobRow[]): JobTypeCount[] {
  const map = new Map<string, JobTypeCount>()
  for (const job of jobs) {
    const info = jobIcon(job)
    const key = `${info.icon}|${info.label}`
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { ...info, key, count: 1 })
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function jobTypeKey(job: JobRow): string {
  const info = jobIcon(job)
  return `${info.icon}|${info.label}`
}

/**
 * Legend and filter in one. With `onToggle`, each chip shows or hides that job
 * type; without it the row is a plain legend.
 */
export function JobTypeChips({
  types,
  hidden,
  onToggle,
  onReset,
}: {
  types: readonly JobTypeCount[]
  hidden?: ReadonlySet<string>
  onToggle?: (key: string) => void
  onReset?: () => void
}) {
  if (types.length === 0) return null
  const anyHidden = hidden ? hidden.size > 0 : false
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid="job-type-chips">
      {types.map((t) => {
        const off = hidden?.has(t.key) ?? false
        const body = (
          <>
            <Icon name={t.icon} size={14} />
            <span>{t.label}</span>
            <span className="tabular-nums text-slate-500">{t.count}</span>
          </>
        )
        const base = 'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-meta'
        return onToggle ? (
          <button
            key={t.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(t.key)}
            className={`${base} border ${
              off ? 'border-slate-200 bg-transparent text-slate-400 line-through' : 'border-slate-300 bg-white text-slate-800'
            } hover:bg-slate-100`}
          >
            {body}
          </button>
        ) : (
          <span key={t.key} className={`${base} bg-slate-100 text-slate-700`}>
            {body}
          </span>
        )
      })}
      {anyHidden && onReset ? (
        <button type="button" onClick={onReset} className="px-1 text-meta text-slate-600 underline underline-offset-2">
          Show all
        </button>
      ) : null}
    </div>
  )
}
