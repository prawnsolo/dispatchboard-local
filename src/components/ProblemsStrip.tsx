import { formatHours } from '../lib/jobDurations.ts'
import {
  problemTotal,
  sameSelection,
  selectionLabel,
  type ProblemSelection,
  type ProblemSummary,
} from '../lib/problems.ts'

type Tone = 'slate' | 'rose' | 'amber' | 'orange' | 'red'

/** Status swatch + text label. Color is never the only signal. */
const TONE: Record<Tone, { swatch: string; idle: string }> = {
  slate: { swatch: 'bg-slate-500', idle: 'border-slate-300 text-slate-800' },
  rose: { swatch: 'bg-rose-600', idle: 'border-rose-300 text-rose-800' },
  amber: { swatch: 'bg-amber-400', idle: 'border-amber-300 text-amber-900' },
  orange: { swatch: 'bg-[var(--db-status-tentative)]', idle: 'border-amber-300 text-amber-900' },
  red: { swatch: 'bg-rose-700', idle: 'border-rose-300 text-rose-800' },
}

type Item = { key: string; selection: ProblemSelection; tone: Tone; count: number; label: string; mark?: string; title: string }

export function ProblemsStrip({
  summary,
  isToday,
  dayLabel,
  selected,
  onSelect,
}: {
  summary: ProblemSummary | null
  isToday: boolean
  dayLabel: string
  selected: ProblemSelection | null
  onSelect: (next: ProblemSelection | null) => void
}) {
  if (!summary) return null
  const base: Item[] = [
    { key: 'unmapped', selection: { kind: 'unmapped' }, tone: 'slate', count: summary.unmapped, label: 'Unmapped', title: 'Jobs with no map pin' },
    { key: 'mismatch', selection: { kind: 'mismatch' }, tone: 'rose', count: summary.mismatch, label: 'Mismatch', mark: '≠', title: 'Call reason / note mismatch' },
    { key: 'flags', selection: { kind: 'flags' }, tone: 'amber', count: summary.flags, label: 'Open flags', mark: '⚑', title: 'Required checklist item unchecked' },
    { key: 'tentative', selection: { kind: 'tentative' }, tone: 'orange', count: summary.tentative, label: 'Tentative', title: 'No work order yet' },
    { key: 'boots', selection: { kind: 'boots' }, tone: 'amber', count: summary.boots, label: 'Boots', title: 'Inside job after UG/piping the same day' },
  ]
  const items: Item[] = [
    ...base,
    ...summary.overCapacity.map<Item>((row) => ({
      key: `over-${row.tech}`,
      selection: { kind: 'over_capacity', tech: row.tech },
      tone: 'red',
      count: row.jobs,
      label: `Over · ${row.tech} ${formatHours(row.totalHours)}h / ${formatHours(row.shiftHours)}h`,
      title: `${row.tech}: ${formatHours(row.bookedHours)}h work + ${formatHours(row.driveHours)}h drive = ${formatHours(row.totalHours)}h on a ${formatHours(row.shiftHours)}h shift (duration table + crow-flies drive)`,
    })),
  ].filter((item) => item.count > 0)

  const prefix = isToday ? 'Today' : dayLabel

  return (
    <div
      className="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-chrome py-1"
      data-testid="problems-strip"
      role="group"
      aria-label={`${prefix} problems`}
    >
      {problemTotal(summary) === 0 && isToday ? null : (
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{prefix}</span>
      )}
      {problemTotal(summary) === 0 ? (
        <span className="text-xs text-slate-700" data-testid="problems-none">
          {isToday ? 'No problems today' : 'No problems'}
        </span>
      ) : (
        items.map((item) => {
          const active = sameSelection(selected, item.selection)
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              title={`${item.title}. Click to ${active ? 'show all' : 'filter this view'}.`}
              data-testid={`problem-${item.key}`}
              onClick={() => onSelect(active ? null : item.selection)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold tabular-nums ${
                active ? 'border-slate-900 bg-slate-900 text-slate-50' : `bg-white hover:bg-slate-50 ${TONE[item.tone].idle}`
              }`}
            >
              <span className={`size-2.5 shrink-0 rounded-sm ${TONE[item.tone].swatch}`} aria-hidden="true" />
              {item.tone === 'red' ? null : <span>{item.count}</span>}
              {item.mark ? <span aria-hidden="true">{item.mark}</span> : null}
              <span>{item.label}</span>
            </button>
          )
        })
      )}
      {selected ? (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="ml-auto inline-flex h-8 items-center rounded-md px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          data-testid="problems-clear"
        >
          Showing {selectionLabel(selected)} · Show all
        </button>
      ) : null}
    </div>
  )
}
