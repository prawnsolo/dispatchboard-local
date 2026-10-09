import { useEffect, useMemo, useState } from 'react'
import { ErrorNote } from '../components/ErrorNote.tsx'
import { PrintDaySheet } from '../components/PrintDaySheet.tsx'
import { JobIcon } from '../components/JobIcon.tsx'
import { Icon } from '../components/Icon.tsx'
import { TankRainWarning, WeatherStrip, useTankRisks } from '../components/Weather.tsx'
import { JobTypeChips, countJobTypes } from '../components/JobTypeChips.tsx'
import { queryJobs } from '../lib/db.ts'
import { displayName, formatDate, formatTimeRange, todayInNewYork } from '../lib/format.ts'
import { formatHours } from '../lib/jobDurations.ts'
import { problemTotal, selectionLabel, type ProblemSelection, type ProblemSummary } from '../lib/problems.ts'
import { ptoTechsOnDate } from '../lib/pto.ts'
import { isCapacityBlock, techKey, uniqueTechs } from '../lib/schedule.ts'
import { LOAD_LEVEL_TEXT, loadKey, loadLabel, techDayLoads } from '../lib/techLoad.ts'
import type { JobRow } from '../lib/store.ts'

/** One glance at a day: who is out, how full each tech is, what needs a look. */
export function TodayScreen({
  revision,
  date,
  summary,
  onPickProblem,
  onGo,
  onOpenWeatherSettings,
  onOpenJob,
}: {
  revision: number
  date: string
  summary: ProblemSummary | null
  onPickProblem: (selection: ProblemSelection) => void
  onGo: (tab: 'map' | 'calendar' | 'jobs' | 'import') => void
  onOpenWeatherSettings: () => void
  onOpenJob: (job: JobRow) => void
}) {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [printing, setPrinting] = useState<{ tech: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    void queryJobs({ date, query: '' })
      .then((rows) => {
        if (cancelled) return
        setJobs(rows)
        setError(null)
        setLoaded(true)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err)
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [date, revision])

  const work = useMemo(() => jobs.filter((j) => !isCapacityBlock(j)), [jobs])
  const out = useMemo(() => ptoTechsOnDate(jobs, date), [jobs, date])
  const loads = useMemo(() => techDayLoads(jobs), [jobs])
  const crew = useMemo(() => uniqueTechs(work).filter((t) => !out.includes(t)), [work, out])
  const types = useMemo(() => countJobTypes(work), [work])
  const tankRows = useTankRisks(revision)
  const label = date === todayInNewYork() ? 'Today' : formatDate(date)

  const attention: Array<{ selection: ProblemSelection; count: number }> = summary
    ? [
        { selection: { kind: 'unmapped' } as ProblemSelection, count: summary.unmapped },
        { selection: { kind: 'mismatch' } as ProblemSelection, count: summary.mismatch },
        { selection: { kind: 'flags' } as ProblemSelection, count: summary.flags },
        { selection: { kind: 'tentative' } as ProblemSelection, count: summary.tentative },
        { selection: { kind: 'overlap' } as ProblemSelection, count: summary.overlap },
        { selection: { kind: 'boots' } as ProblemSelection, count: summary.boots },
        ...summary.overCapacity.map((row) => ({ selection: { kind: 'over_capacity', tech: row.tech } as ProblemSelection, count: row.jobs })),
      ].filter((item) => item.count > 0)
    : []

  return (
    <div className="min-h-0 flex-1 overflow-auto px-chrome py-4" data-testid="today-screen">
      {printing ? <PrintDaySheet jobs={jobs} date={date} tech={printing.tech} onDone={() => setPrinting(null)} /> : null}
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-ink">{label}</h2>
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-600" data-testid="today-summary">
              {work.length} {work.length === 1 ? 'job' : 'jobs'} · {crew.length} working · {out.length} out
            </p>
            {work.length ? (
              <button
                type="button"
                data-testid="print-all"
                onClick={() => setPrinting({ tech: null })}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                <Icon name="printer" size={14} />
                Print day sheets
              </button>
            ) : null}
          </div>
        </div>

        <ErrorNote className="mt-3 text-sm" error={error} />

        <WeatherStrip today={todayInNewYork()} onOpenSettings={onOpenWeatherSettings} />

        {loaded && !error && jobs.length === 0 ? (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <h3 className="text-base font-semibold text-ink">Nothing on the board for this day</h3>
            <p className="mt-1 max-w-prose text-sm text-slate-600">Use the arrows to pick another day, or bring in a fresh ADD export.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => onGo('import')} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
                Go to import
              </button>
              <button type="button" onClick={() => onGo('jobs')} className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-ink">
                See all jobs
              </button>
            </div>
          </div>
        ) : null}

        {attention.length || tankRows.length ? (
          <section className="mt-5" aria-label="Needs attention">
            <h3 className="text-sm font-semibold text-slate-700">Needs a look ({(summary ? problemTotal(summary) : 0) + tankRows.length})</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <TankRainWarning rows={tankRows} onOpenJob={onOpenJob} />
              {attention.map((item) => (
                <button
                  key={selectionLabel(item.selection)}
                  type="button"
                  onClick={() => onPickProblem(item.selection)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 hover:bg-slate-50"
                >
                  <span className="font-semibold tabular-nums">{item.count}</span>
                  {selectionLabel(item.selection)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {crew.length || out.length ? (
          <section className="mt-6" aria-label="Crew">
            <h3 className="text-sm font-semibold text-slate-700">Crew</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {crew.map((tech) => {
                const load = loads.get(loadKey(tech, date))
                const theirs = work.filter((j) => techKey(j.technician_name) === tech)
                const pct = load && load.shiftHours > 0 ? Math.min(100, Math.round((load.totalHours / load.shiftHours) * 100)) : 0
                const levelText = load ? LOAD_LEVEL_TEXT[load.level] : ''
                return (
                  <article key={tech} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-testid="today-tech">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="truncate text-sm font-semibold text-ink">{displayName(tech)}</h4>
                      <span className="flex shrink-0 items-center gap-2 text-meta tabular-nums text-slate-600">
                        {theirs.length} {theirs.length === 1 ? 'job' : 'jobs'}
                        <button
                          type="button"
                          onClick={() => setPrinting({ tech })}
                          aria-label={`Print day sheet for ${displayName(tech)}`}
                          title={`Print day sheet for ${displayName(tech)}`}
                          className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Icon name="printer" size={14} />
                        </button>
                      </span>
                    </div>
                    {load ? (
                      <>
                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
                          role="img"
                          aria-label={`${formatHours(load.totalHours)} of ${formatHours(load.shiftHours)} hours`}
                        >
                          <div
                            className={`h-full rounded-full ${load.level === 'over' ? 'bg-rose-700' : load.level === 'near' ? 'bg-amber-500' : 'bg-slate-700'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="mt-1 text-meta tabular-nums text-slate-600">
                          {loadLabel(load)}
                          {levelText ? ` · ${levelText}` : ''}
                        </p>
                      </>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {theirs.map((job) => (
                        <li key={job.id} className="flex items-center gap-2 text-sm">
                          <JobIcon job={job} size={20} />
                          <span className="min-w-0 flex-1 truncate text-slate-900">{job.customer_name}</span>
                          <span className="shrink-0 text-meta tabular-nums text-slate-600">{formatTimeRange(job.begin_time, job.end_time)}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                )
              })}
            </div>
            {out.length ? (
              <p className="mt-3 text-sm text-slate-700" data-testid="today-out">
                <span className="font-semibold">Out:</span> {out.map((t) => displayName(t)).join(', ')}
              </p>
            ) : null}
          </section>
        ) : null}

        {types.length ? (
          <section className="mt-6" aria-label="Job types">
            <h3 className="text-sm font-semibold text-slate-700">What is on the board</h3>
            <div className="mt-2">
              <JobTypeChips types={types} />
            </div>
          </section>
        ) : null}

      </div>
    </div>
  )
}
