import { useCallback, useEffect, useMemo, useState } from 'react'
import { CALENDAR_KIND_LEGEND_CLASS } from '../lib/colors.ts'
import { JobDrawer } from '../components/JobDrawer.tsx'
import { ResourceDayGrid } from '../components/ResourceDayGrid.tsx'
import { ResourceWeekGrid } from '../components/ResourceWeekGrid.tsx'
import { moveLocalJob, queryJobs } from '../lib/db.ts'
import { formatDate } from '../lib/format.ts'
import {
  addDaysYmd,
  firstScheduledDate,
  jobsInRange,
  jobsOnDate,
  uniqueTechs,
  weekStartOf,
} from '../lib/schedule.ts'
import { bootsFlagsForJobs } from '../lib/boots.ts'
import { ptoDayKeys } from '../lib/pto.ts'
import { techDayLoads } from '../lib/techLoad.ts'
import { draftFromJob, type JobDraft, type JobRow, type ScheduleMove } from '../lib/store.ts'
import { snapshotFromJob, type ScheduleSnapshot } from '../lib/undo.ts'

type CalView = 'timegrid' | 'week'

export function CalendarScreen({
  revision,
  date,
  problemFilter = null,
  onDateChange,
  onMoved,
  onChanged,
}: {
  revision: number
  date: string
  /** Today's problems strip selection. Null = show everything. */
  problemFilter?: ((job: JobRow) => boolean) | null
  onDateChange: (ymd: string) => void
  onMoved: (previous: ScheduleSnapshot) => void
  onChanged: () => void
}) {
  const [view, setView] = useState<CalView>('timegrid')
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [session, setSession] = useState(0)
  const [drawerDirty, setDrawerDirty] = useState(false)
  const onDirtyChange = useCallback((dirty: boolean) => setDrawerDirty(dirty), [])

  useEffect(() => {
    if (draft?.id == null) return
    if (error) return
    if (!jobs.some((job) => job.id === draft.id)) setDraft(null)
  }, [draft, error, jobs])

  useEffect(() => {
    let cancelled = false
    void queryJobs({ date: '', query: '' })
      .then((rows) => {
        if (cancelled) return
        setJobs(rows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const weekStart = weekStartOf(date)
  const weekEnd = addDaysYmd(weekStart, 6)
  const shown = useMemo(() => (problemFilter ? jobs.filter(problemFilter) : jobs), [jobs, problemFilter])
  const weekJobs = useMemo(() => jobsInRange(shown, weekStart, weekEnd), [shown, weekStart, weekEnd])
  const dayJobs = useMemo(() => jobsOnDate(shown, date), [shown, date])
  // Booked hours use every job in the week, not the problems filter: the load is real either way.
  const loads = useMemo(() => techDayLoads(jobsInRange(jobs, weekStart, weekEnd)), [jobs, weekStart, weekEnd])
  const bootsFlags = useMemo(() => bootsFlagsForJobs(jobsInRange(jobs, weekStart, weekEnd)), [jobs, weekStart, weekEnd])
  const ptoKeys = useMemo(() => ptoDayKeys(jobsInRange(jobs, weekStart, weekEnd)), [jobs, weekStart, weekEnd])
  const dayTechs = useMemo(() => {
    const roster = uniqueTechs(weekJobs.length ? weekJobs : shown.filter((job) => job.schedule_date))
    return roster
  }, [shown, weekJobs])
  const sampleDate = firstScheduledDate(jobs)
  const itemCount = view === 'timegrid' ? dayJobs.length : weekJobs.length
  const emptyHere = jobs.length > 0 && (view === 'timegrid' ? dayJobs.length === 0 : weekJobs.length === 0)

  function openJob(job: JobRow) {
    if (draft?.id === job.id) return
    if (draft && drawerDirty && !window.confirm('Discard unsaved changes?')) return
    setSession((n) => n + 1)
    setDraft(draftFromJob(job))
  }

  async function onMove(job: JobRow, next: ScheduleMove) {
    const previous = snapshotFromJob(job)
    setPersistError(null)
    try {
      await moveLocalJob(job.id, next)
    } catch (err) {
      setPersistError(err instanceof Error ? err.message : String(err))
      return
    }
    onMoved(previous)
    if (next.schedule_date && next.schedule_date !== date) onDateChange(next.schedule_date)
    onChanged()
  }

  const step = view === 'timegrid' ? 1 : 7

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-chrome py-1.5">
        <button
          type="button"
          aria-label={view === 'timegrid' ? 'Previous day' : 'Previous week'}
          onClick={() => onDateChange(addDaysYmd(date, -step))}
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-base font-medium leading-none text-slate-900 hover:bg-slate-50"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={view === 'timegrid' ? 'Next day' : 'Next week'}
          onClick={() => onDateChange(addDaysYmd(date, step))}
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-base font-medium leading-none text-slate-900 hover:bg-slate-50"
        >
          ›
        </button>
        <p className="text-xs text-slate-600">
          {itemCount} {itemCount === 1 ? 'item' : 'items'} {view === 'timegrid' ? 'this day' : 'this week'} · work orders stay locked
        </p>
        <div className="ml-auto inline-flex rounded-md border border-slate-300 p-0.5" role="group" aria-label="Calendar layout">
          <button
            type="button"
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
            className={`rounded px-2.5 py-1 text-xs font-medium ${view === 'week' ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            By technician
          </button>
          <button
            type="button"
            aria-pressed={view === 'timegrid'}
            data-testid="cal-view-timegrid"
            onClick={() => setView('timegrid')}
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              view === 'timegrid' ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            Time grid
          </button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-chrome py-1 text-meta text-slate-600">
        <span className={CALENDAR_KIND_LEGEND_CLASS.tentative}>Tentative · drag</span>
        <span className={CALENDAR_KIND_LEGEND_CLASS.in_pegasus}>In Pegasus · locked</span>
        <span className={CALENDAR_KIND_LEGEND_CLASS.capacity}>Capacity</span>
        <span className="text-slate-400">Left border = activity color</span>
        <span>{formatDate(date)}</span>
      </div>

      {error ? (
        <p className="px-4 py-2 text-sm text-error">
          {/invoke/.test(error)
            ? 'This window cannot open SQLite. Start the desktop app with npm run desktop.'
            : error}
        </p>
      ) : null}
      {persistError ? <p className="px-4 py-1 text-sm text-error">{persistError}</p> : null}

      {emptyHere && sampleDate ? (
        <div className="border-b border-line px-4 py-2">
          <button
            type="button"
            onClick={() => onDateChange(sampleDate)}
            className="text-sm font-semibold text-brand hover:underline"
          >
            {view === 'timegrid' ? 'Jump to a day with jobs' : 'Jump to a week with jobs'}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {view === 'week' ? (
          <ResourceWeekGrid
            jobs={weekJobs}
            weekStart={weekStart}
            loads={loads}
            bootsFlags={bootsFlags}
            ptoKeys={ptoKeys}
            selectedDate={date}
            selectedId={draft?.id ?? null}
            onSelectJob={openJob}
            onMove={(job, next) => void onMove(job, next)}
          />
        ) : (
          <ResourceDayGrid
            jobs={dayJobs}
            techs={dayTechs}
            loads={loads}
            bootsFlags={bootsFlags}
            ptoKeys={ptoKeys}
            date={date}
            selectedId={draft?.id ?? null}
            onSelectJob={openJob}
            onMove={(job, next) => void onMove(job, next)}
          />
        )}
      </div>

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
