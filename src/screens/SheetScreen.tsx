import { useEffect, useMemo, useState } from 'react'
import { patchLocalSheetCell, queryJobs } from '../lib/db.ts'
import { formatDate } from '../lib/format.ts'
import {
  SHEET_COLUMNS,
  filterSheetJobs,
  isSheetCellEditable,
  nextSheetSort,
  parseSheetCell,
  sheetCsv,
  sheetDisplayValue,
  sortSheetJobs,
  uniqueSheetValues,
  type SheetColumn,
  type SheetSort,
} from '../lib/sheet.ts'
import type { JobRow } from '../lib/store.ts'
import { ErrorNote } from '../components/ErrorNote.tsx'
import { downloadText } from '../lib/csv.ts'
import { BULK_FIELDS, bulkColumn, planBulk } from '../lib/bulk-edit.ts'
import { readSheetViews, removeView, upsertView, writeSheetViews, type SheetView } from '../lib/saved-views.ts'

const cellInput =
  'h-8 w-full min-w-0 border-0 bg-transparent px-1.5 text-cell text-slate-900 outline-none focus:bg-white focus:ring-1 focus:ring-slate-400 disabled:text-slate-500'

function downloadCsv(csv: string) {
  downloadText('dispatchboard-local-sheet.csv', csv)
}

function SheetCell({
  job,
  column,
  techs,
  disabled,
  onCommit,
}: {
  job: JobRow
  column: SheetColumn
  techs: string[]
  disabled: boolean
  onCommit: (raw: string) => void
}) {
  const display = sheetDisplayValue(job, column)
  const [draft, setDraft] = useState(display)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(display)
  }, [display, focused])

  if (column.kind === 'checkbox') {
    return (
      <label className="flex h-8 items-center justify-center">
        <input
          type="checkbox"
          className="size-4"
          checked={Boolean(job.mismatch_flag)}
          disabled={disabled}
          aria-label="Mismatch"
          onChange={(event) => onCommit(event.target.checked ? 'Y' : 'N')}
        />
      </label>
    )
  }

  const listId = column.key === 'technician_name' ? `sheet-techs-${job.id}` : undefined

  return (
    <>
      <input
        className={cellInput}
        value={focused ? draft : display}
        disabled={disabled}
        type={column.kind === 'date' ? 'date' : column.kind === 'time' ? 'time' : 'text'}
        aria-label={column.label}
        list={listId}
        onFocus={() => {
          setDraft(display)
          setFocused(true)
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false)
          if (draft !== display) onCommit(draft)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') {
            setDraft(display)
            setFocused(false)
            ;(event.target as HTMLInputElement).blur()
          }
        }}
      />
      {listId ? (
        <datalist id={listId}>
          {techs.map((tech) => (
            <option key={tech} value={tech} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}

export function SheetScreen({
  revision,
  date,
  query,
  problemFilter = null,
  onChanged,
}: {
  revision: number
  date: string
  query: string
  /** Today's problems strip selection. Null = show everything. */
  problemFilter?: ((job: JobRow) => boolean) | null
  onChanged: () => void
}) {
  const [limitToDate, setLimitToDate] = useState(true)
  const [trackedDate, setTrackedDate] = useState(date)
  const [includeCapacity, setIncludeCapacity] = useState(false)
  const [technician, setTechnician] = useState('')
  const [zone, setZone] = useState('')
  const [views, setViews] = useState<SheetView[]>(() => readSheetViews())
  const [viewName, setViewName] = useState<string | null>(null)
  const [activeView, setActiveView] = useState('')
  const [picked, setPicked] = useState<Set<number>>(() => new Set())
  const [bulkKey, setBulkKey] = useState<(typeof BULK_FIELDS)[number]>('technician_name')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [sort, setSort] = useState<SheetSort | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  if (date !== trackedDate) {
    setTrackedDate(date)
    setLimitToDate(true)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const spanAll = !limitToDate || Boolean(query.trim())
    void queryJobs({ date: spanAll ? '' : date, query })
      .then((rows) => {
        if (cancelled) return
        setJobs(rows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date, limitToDate, query, revision])

  const baseRows = useMemo(() => filterSheetJobs(jobs, { includeCapacity }), [includeCapacity, jobs])
  const techs = useMemo(() => uniqueSheetValues(baseRows.map((job) => job.technician_name)), [baseRows])
  const zones = useMemo(() => uniqueSheetValues(baseRows.map((job) => job.zone_code)), [baseRows])
  const rows = useMemo(
    () =>
      sortSheetJobs(
        filterSheetJobs(problemFilter ? jobs.filter(problemFilter) : jobs, { includeCapacity, technician, zone }),
        sort,
      ),
    [includeCapacity, jobs, problemFilter, sort, technician, zone],
  )

  // Only rows still on screen stay picked.
  const pickedShown = useMemo(() => new Set(rows.filter((r) => picked.has(r.id)).map((r) => r.id)), [picked, rows])

  function togglePick(id: number) {
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function applyBulk() {
    const plan = planBulk(rows, pickedShown, bulkKey, bulkValue)
    if (!plan.ok) {
      setError(plan.error)
      setBulkNote(null)
      return
    }
    setBulkBusy(true)
    setError(null)
    setBulkNote(null)
    let done = 0
    const failed: string[] = []
    for (const id of plan.ids) {
      try {
        await patchLocalSheetCell(id, plan.patch)
        done++
      } catch (err) {
        failed.push(err instanceof Error ? err.message : String(err))
      }
    }
    setBulkBusy(false)
    setBulkNote(
      `Changed ${done} ${done === 1 ? 'row' : 'rows'}.` +
        (plan.skipped ? ` ${plan.skipped} skipped (field not editable there).` : '') +
        (failed.length ? ` ${failed.length} failed: ${failed[0]}` : ''),
    )
    if (!failed.length) {
      setPicked(new Set())
      setBulkValue('')
    }
    onChanged()
  }

  async function commit(job: JobRow, column: SheetColumn, raw: string) {
    const parsed = parseSheetCell(column, raw)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setBusyId(job.id)
    setError(null)
    try {
      await patchLocalSheetCell(job.id, parsed.patch)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-300 bg-slate-50 px-chrome py-2">
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Sheet</span>
          {' · '}
          {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          {limitToDate && !query.trim() ? ` · ${formatDate(date)}` : ' · all dates'}
          {query.trim() ? ' · header search' : ''}
        </p>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={limitToDate} onChange={(event) => setLimitToDate(event.target.checked)} />
          This date
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={includeCapacity}
            onChange={(event) => setIncludeCapacity(event.target.checked)}
          />
          Include capacity
        </label>
        <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
          Tech
          <select
            value={technician}
            onChange={(event) => setTechnician(event.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900"
          >
            <option value="">All</option>
            {techs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
          Zone
          <select
            value={zone}
            onChange={(event) => setZone(event.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900"
          >
            <option value="">All</option>
            {zones.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
          View
          <select
            value={activeView}
            data-testid="sheet-views"
            onChange={(event) => {
              const name = event.target.value
              setActiveView(name)
              const v = views.find((x) => x.name === name)
              if (!v) return
              setLimitToDate(v.limitToDate)
              setIncludeCapacity(v.includeCapacity)
              setTechnician(v.technician)
              setZone(v.zone)
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900"
          >
            <option value="">Saved views</option>
            {views.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {viewName == null ? (
          <>
            <button
              type="button"
              onClick={() => setViewName(activeView)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Save view
            </button>
            {activeView ? (
              <button
                type="button"
                onClick={() => {
                  const next = removeView(views, activeView)
                  setViews(next)
                  writeSheetViews(next)
                  setActiveView('')
                }}
                className="px-1.5 py-1 text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
              >
                Delete view
              </button>
            ) : null}
          </>
        ) : (
          <form
            className="flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              const name = viewName.trim()
              if (!name) return
              const next = upsertView(views, { name, limitToDate, includeCapacity, technician, zone })
              setViews(next)
              writeSheetViews(next)
              setActiveView(name)
              setViewName(null)
            }}
          >
            <input
              autoFocus
              value={viewName}
              maxLength={40}
              placeholder="Name this view"
              onChange={(event) => setViewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setViewName(null)
              }}
              className="h-8 w-36 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900"
            />
            <button type="submit" disabled={!viewName.trim()} className="rounded-lg bg-brand-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500">
              Save
            </button>
            <button type="button" onClick={() => setViewName(null)} className="px-1.5 py-1 text-sm font-medium text-slate-600 hover:text-slate-900">
              Cancel
            </button>
          </form>
        )}
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(sheetCsv(rows))}
          className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>
      <div className="border-b border-slate-200 px-chrome py-1">
        <p className="max-w-prose text-meta text-slate-600">
          Edit a cell and leave it to save. Jobs, Calendar, and Map use the same rows. Capacity blocks edit the label,
          technician, date, times, and activity. Work order numbers stay as imported.
        </p>
      </div>
      {pickedShown.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-chrome py-1.5" data-testid="bulk-bar">
          <span className="text-sm font-semibold text-slate-900">{pickedShown.size} picked</span>
          <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
            Set
            <select
              value={bulkKey}
              onChange={(event) => setBulkKey(event.target.value as (typeof BULK_FIELDS)[number])}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900"
            >
              {BULK_FIELDS.map((key) => (
                <option key={key} value={key}>
                  {bulkColumn(key).label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
            to
            <input
              value={bulkValue}
              list="bulk-techs"
              onChange={(event) => setBulkValue(event.target.value)}
              placeholder={bulkKey === 'schedule_date' ? 'YYYY-MM-DD' : bulkKey.endsWith('_time') ? 'HH:MM' : 'value'}
              className="h-8 w-40 rounded border border-slate-300 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          {bulkKey === 'technician_name' ? (
            <datalist id="bulk-techs">
              {techs.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => void applyBulk()}
            className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-500"
          >
            {bulkBusy ? 'Applying…' : `Apply to ${pickedShown.size}`}
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="px-1.5 py-1 text-sm font-medium text-slate-600 hover:text-slate-900">
            Clear
          </button>
          <p className="basis-full text-meta text-slate-600">Leaving the value empty clears the field. Each change is saved in the job&apos;s History.</p>
        </div>
      ) : null}
      {bulkNote ? <p className="px-chrome py-1 text-sm text-slate-800" data-testid="bulk-note">{bulkNote}</p> : null}
      {error ? (
        <ErrorNote className="mt-2 text-sm" error={error} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-collapse text-left text-cell">
          <thead className="sticky top-0 z-10 bg-chrome text-white">
            <tr>
              <th className="w-9 border-b border-slate-700 px-2 py-0 text-left">
                <input
                  type="checkbox"
                  aria-label="Pick all rows"
                  checked={rows.length > 0 && pickedShown.size === rows.length}
                  onChange={(event) => setPicked(event.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              {SHEET_COLUMNS.map((column) => {
                const active = sort?.key === column.key
                return (
                  <th
                    key={column.key}
                    style={{ minWidth: column.minWidth }}
                    className="border-b border-slate-700 px-1 py-0 text-left"
                  >
                    <button
                      type="button"
                      className="flex h-8 w-full items-center px-1 text-left text-meta font-semibold uppercase tracking-wide text-white hover:bg-white/10"
                      onClick={() => setSort((current) => nextSheetSort(current, column.key))}
                    >
                      {column.label}
                      {active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((job) => (
              <tr key={job.id} className="border-t border-slate-200 bg-white">
                <td className="border-r border-slate-200 px-2 align-middle">
                  <input
                    type="checkbox"
                    aria-label={`Pick ${job.customer_name}`}
                    checked={pickedShown.has(job.id)}
                    onChange={() => togglePick(job.id)}
                  />
                </td>
                {SHEET_COLUMNS.map((column) => {
                  const editable = isSheetCellEditable(job, column)
                  return (
                    <td key={column.key} className="border-r border-slate-200 p-0 align-middle" style={{ minWidth: column.minWidth }}>
                      {column.key === 'wo_number' && job.is_capacity_block ? (
                        <span className="block px-2 text-meta font-medium uppercase tracking-wide text-slate-500">Capacity</span>
                      ) : (
                        <SheetCell
                          job={job}
                          column={column}
                          techs={techs}
                          disabled={!editable || busyId === job.id}
                          onCommit={(raw) => void commit(job, column, raw)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? (
          <p className="px-chrome py-4 text-sm text-slate-600">No jobs match this sheet. Import, change the date, or turn on capacity.</p>
        ) : null}
      </div>
    </div>
  )
}
