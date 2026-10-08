import { useEffect, useId, useRef, useState } from 'react'
import { formatDateChip, todayInNewYork } from '../lib/format.ts'
import { addDaysYmd } from '../lib/schedule.ts'

export function DateChip({ date, onChange }: { date: string; onChange: (ymd: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const today = todayInNewYork()

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(next: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) onChange(next)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-label="Previous day"
        onClick={() => onChange(addDaysYmd(date, -1))}
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-base font-medium leading-none text-slate-900 hover:bg-slate-50"
      >
        ‹
      </button>
      <button
        type="button"
        data-testid="date-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-8 items-center rounded-lg border bg-white px-2.5 text-sm font-medium tabular-nums ${
          date === today ? 'border-brand-500 text-brand-600' : 'border-slate-300 text-slate-900 hover:bg-slate-50'
        }`}
      >
        {formatDateChip(date)}
      </button>
      <button
        type="button"
        aria-label="Next day"
        onClick={() => onChange(addDaysYmd(date, 1))}
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-base font-medium leading-none text-slate-900 hover:bg-slate-50"
      >
        ›
      </button>
      <button
        type="button"
        onClick={() => onChange(today)}
        className={`inline-flex h-8 items-center rounded-lg border px-2.5 text-sm font-medium ${
          date === today
            ? 'border-brand-600 bg-brand-600 text-white'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        Today
      </button>
      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
        >
          <p id={titleId} className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Date
          </p>
          <label className="mt-2 flex flex-col gap-1 text-sm text-ink">
            Jobs and Calendar use this day
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) pick(event.target.value)
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-900 outline-none focus:border-brand-500"
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}
