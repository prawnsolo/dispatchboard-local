import { useEffect, useMemo, useRef, useState } from 'react'
import { queryJobs } from '../lib/db.ts'
import { SHORTCUT_HELP } from '../lib/shortcuts.ts'
import type { JobRow } from '../lib/store.ts'
import { Icon } from './Icon.tsx'
import { JobIcon } from './JobIcon.tsx'

export type PaletteCommand = { id: string; label: string; hint?: string; run: () => void }

/** Ctrl+K: type to filter commands or find a job by customer, WO or address. */
export function CommandPalette({
  commands,
  onPickJob,
  onClose,
}: {
  commands: PaletteCommand[]
  onPickJob: (job: JobRow) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands
  }, [commands, text])

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) {
      setJobs([])
      return
    }
    let cancelled = false
    const id = window.setTimeout(() => {
      void queryJobs({ date: '', query: q })
        .then((rows) => {
          if (!cancelled) setJobs(rows.filter((r) => !r.is_capacity_block).slice(0, 6))
        })
        .catch(() => {
          if (!cancelled) setJobs([])
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [text])

  const rows: Array<{ key: string; node: 'cmd' | 'job'; cmd?: PaletteCommand; job?: JobRow }> = [
    ...matches.map((cmd) => ({ key: cmd.id, node: 'cmd' as const, cmd })),
    ...jobs.map((job) => ({ key: `job-${job.id}`, node: 'job' as const, job })),
  ]
  const active = Math.min(index, Math.max(0, rows.length - 1))

  function choose(i: number) {
    const row = rows[i]
    if (!row) return
    onClose()
    if (row.node === 'cmd') row.cmd?.run()
    else if (row.job) onPickJob(row.job)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 px-4 pt-[14vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        data-testid="command-palette"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <Icon name="search" size={16} className="text-slate-500" />
          <input
            ref={inputRef}
            value={text}
            placeholder="Go to a screen, or find a job"
            aria-label="Command or job"
            onChange={(e) => {
              setText(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex(Math.min(active + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex(Math.max(active - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(active)
              }
            }}
            style={{ outline: 'none' }}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-500"
          />
        </div>
        <ul className="max-h-[50vh] overflow-auto py-1" role="listbox">
          {rows.length === 0 ? <li className="px-3 py-3 text-sm text-slate-600">Nothing matches.</li> : null}
          {rows.map((row, i) => (
            <li key={row.key} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === active ? 'bg-slate-100' : ''}`}
              >
                {row.node === 'job' && row.job ? (
                  <>
                    <JobIcon job={row.job} size={22} />
                    <span className="min-w-0 flex-1 truncate text-slate-900">
                      {row.job.customer_name}
                      <span className="ml-2 text-slate-600">{row.job.address_street ?? ''}</span>
                    </span>
                    <span className="shrink-0 text-meta tabular-nums text-slate-600">
                      {row.job.schedule_date ?? 'No date'} {row.job.wo_number ? `· WO ${row.job.wo_number}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-slate-900">{row.cmd?.label}</span>
                    {row.cmd?.hint ? <kbd className="shrink-0 rounded-sm bg-slate-100 px-1.5 py-0.5 text-meta text-slate-600">{row.cmd.hint}</kbd> : null}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 px-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        data-testid="shortcut-help"
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink">Keyboard shortcuts</h2>
        <dl className="mt-3 divide-y divide-slate-200 text-sm">
          {SHORTCUT_HELP.map(([keys, what]) => (
            <div key={keys} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="shrink-0 font-medium text-slate-900">{keys}</dt>
              <dd className="text-right text-slate-600">{what}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onClose} className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink">
          Close
        </button>
      </div>
    </div>
  )
}
