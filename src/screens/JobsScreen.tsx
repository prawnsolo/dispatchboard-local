import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JobDrawer } from '../components/JobDrawer.tsx'
import { ActivityCell } from '../components/ActivityCell.tsx'
import { JobMarks } from '../components/JobMarks.tsx'
import { queryDates, queryJobs } from '../lib/db.ts'
import { formatDate, formatTimeRange } from '../lib/format.ts'
import { blankJobDraft, draftFromJob, type DateCount, type JobDraft, type JobRow } from '../lib/store.ts'
import { ENABLE_JOB_CREATE } from '../lib/features.ts'

export function JobsScreen({
  revision,
  date,
  query,
  seedDraft,
  problemFilter = null,
  onSeedConsumed,
  onDateChange,
  onChanged,
}: {
  revision: number
  date: string
  query: string
  /** Today's problems strip selection. Null = show everything. */
  problemFilter?: ((job: JobRow) => boolean) | null
  seedDraft: JobDraft | null
  onSeedConsumed: () => void
  onDateChange: (ymd: string) => void
  onChanged: () => void
}) {
  const [allDates, setAllDates] = useState(false)
  const [trackedDate, setTrackedDate] = useState(date)
  const [dates, setDates] = useState<DateCount[]>([])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [session, setSession] = useState(0)
  const [drawerDirty, setDrawerDirty] = useState(false)
  const onDirtyChange = useCallback((dirty: boolean) => setDrawerDirty(dirty), [])
  if (date !== trackedDate) {
    setTrackedDate(date)
    setAllDates(false)
  }

  useEffect(() => {
    if (draft?.id == null) return
    if (error) return
    if (!jobs.some((job) => job.id === draft.id)) setDraft(null)
  }, [draft, error, jobs])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const spanAll = allDates || Boolean(query.trim())
        const [rows, dayCounts] = await Promise.all([queryJobs({ date: spanAll ? '' : date, query }), queryDates()])
        if (cancelled) return
        setJobs(rows)
        setDates(dayCounts)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [allDates, date, query, revision])

  const seedRef = useRef<JobDraft | null>(null)
  useEffect(() => {
    if (!seedDraft || seedRef.current === seedDraft) return
    seedRef.current = seedDraft
    if (drawerDirty && !window.confirm('Discard unsaved changes?')) {
      onSeedConsumed()
      return
    }
    setSession((n) => n + 1)
    setDraft(seedDraft)
    onSeedConsumed()
  }, [drawerDirty, onSeedConsumed, seedDraft])

  function openDraft(next: JobDraft, mode: 'row' | 'new') {
    const sameRow = draft != null && mode === 'row' && next.id != null && draft.id === next.id
    if (sameRow) return
    if (draft && drawerDirty && !window.confirm('Discard unsaved changes?')) return
    setSession((n) => n + 1)
    setDraft(next)
  }

  const shown = useMemo(() => (problemFilter ? jobs.filter(problemFilter) : jobs), [jobs, problemFilter])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-chrome py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-meta text-slate-500">
          {loading ? 'Loading…' : `${shown.length} shown`}
          {allDates || query.trim() ? ' · all dates' : ` · ${formatDate(date)}`}
          {query.trim() && !allDates ? ' · search spans all dates' : ''}
        </p>
        {ENABLE_JOB_CREATE ? (
          <button
            type="button"
            data-testid="new-job-button"
            onClick={() => openDraft(blankJobDraft(), 'new')}
            className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            New job
          </button>
        ) : null}
      </div>

      {dates.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setAllDates(true)}
            className={`inline-flex h-8 items-center rounded px-2 text-meta font-medium uppercase tracking-wide ${
              allDates ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'
            }`}
          >
            All dates
          </button>
          {dates.map((day) => (
            <button
              key={day.schedule_date}
              type="button"
              onClick={() => {
                setAllDates(false)
                onDateChange(day.schedule_date)
              }}
              className={`inline-flex h-8 items-center rounded px-2 text-meta font-medium ${
                !allDates && date === day.schedule_date ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {formatDate(day.schedule_date)} · {day.n}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-error">
          {/invoke/.test(error)
            ? 'This window cannot open SQLite. Start the desktop app with npm run desktop.'
            : error}
        </p>
      ) : null}

      {!error && !loading && shown.length === 0 ? (
        <div className="mt-4 max-w-xl">
          <h2 className="text-base font-semibold tracking-tight">
            {query.trim() ? 'No jobs match this search' : 'No jobs on this filter'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {query.trim()
              ? 'Header search covers every schedule date. Clear search or try another WO / customer.'
              : 'Import an ADD file or pick another day. The date chip is shared with Calendar. Use All dates to scan every day.'}
          </p>
          {!query.trim() ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllDates(true)}
                className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                All dates
              </button>
              <a
                href="#/import"
                className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Go to import
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div className="mt-2 min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-cell">
            <thead className="sticky top-0 bg-chrome text-white">
              <tr className="text-meta font-semibold uppercase tracking-wide">
                <th className="px-2 py-1 font-semibold">Date</th>
                <th className="px-2 py-1 font-semibold">Time</th>
                <th className="px-2 py-1 font-semibold">Technician</th>
                <th className="px-2 py-1 font-semibold">WO</th>
                <th className="px-2 py-1 font-semibold">Flags</th>
                <th className="px-2 py-1 font-semibold">Customer</th>
                <th className="px-2 py-1 font-semibold">Activity</th>
                <th className="px-2 py-1 font-semibold">City</th>
                <th className="px-2 py-1 font-semibold">Street</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((job) => (
                <tr
                  key={job.id}
                  tabIndex={0}
                  aria-label={`Edit ${job.customer_name}`}
                  onClick={() => openDraft(draftFromJob(job), 'row')}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    openDraft(draftFromJob(job), 'row')
                  }}
                  className={`cursor-pointer border-t border-slate-200 text-cell hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${
                    draft?.id === job.id ? 'bg-brand-50' : 'bg-white'
                  }`}
                >
                  <td className="whitespace-nowrap px-2 py-1">{formatDate(job.schedule_date)}</td>
                  <td className="whitespace-nowrap px-2 py-1">{formatTimeRange(job.begin_time, job.end_time)}</td>
                  <td className="px-2 py-1">{job.technician_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1">
                    {job.is_capacity_block ? (
                      <span className="rounded bg-slate-100 px-1.5 py-px text-meta font-medium uppercase tracking-wide text-slate-600">
                        Capacity
                      </span>
                    ) : (
                      (job.wo_number ?? '—')
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1">
                    <JobMarks job={job} />
                  </td>
                  <td className="px-2 py-1">
                    <div className="font-semibold leading-tight text-slate-900">{job.customer_name}</div>
                    <div className="mt-0.5 text-xs tabular-nums text-slate-500">
                      {[job.customer_number ? `#${job.customer_number}` : null, job.account_num ? `Acct ${job.account_num}` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="px-2 py-1" title={job.activity_note ?? undefined}>
                    <ActivityCell job={job} />
                  </td>
                  <td className="px-2 py-1">{job.city ?? '—'}</td>
                  <td className="px-2 py-1">{job.address_street ?? job.address_raw ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {draft ? (
        <JobDrawer
          key={session}
          initial={draft}
          mismatchFlag={Boolean(jobs.find((job) => job.id === draft.id)?.mismatch_flag)}
          mismatchNote={jobs.find((job) => job.id === draft.id)?.mismatch_note ?? null}
          onDirtyChange={onDirtyChange}
          onClose={() => setDraft(null)}
          onChanged={onChanged}
          onSaved={() => {
            setDraft(null)
            onChanged()
          }}
        />
      ) : null}
    </div>
  )
}
