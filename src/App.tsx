import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DateChip } from './components/DateChip.tsx'
import { MapChromeProvider, MapChromeSlot } from './components/MapChromeSlot.tsx'
import { ProblemsStrip } from './components/ProblemsStrip.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { UndoToast } from './components/UndoToast.tsx'
import { autoGeocodeUpcoming, backupIfDue, moveLocalJob, queryCounts, queryJobs, saveLocalJob, takeRestoreResult } from './lib/db.ts'
import { formatDate, todayInNewYork } from './lib/format.ts'
import { problemPredicate, summarizeProblems, type ProblemSelection, type ProblemSummary } from './lib/problems.ts'
import { scheduleHereKind } from './lib/schedule-here.ts'
import { uniqueTechs } from './lib/schedule.ts'
import {
  makeEditUndoEntry,
  makeUndoEntry,
  onJobEdited,
  newestLive,
  popUndo,
  pruneExpired,
  pushUndo,
  snapshotFromJob,
  type ScheduleSnapshot,
  type ScheduleUndoEntry,
} from './lib/undo.ts'
import { BacklogScreen } from './screens/BacklogScreen.tsx'
import { CalendarScreen } from './screens/CalendarScreen.tsx'
import { ImportScreen } from './screens/ImportScreen.tsx'
import { JobsScreen } from './screens/JobsScreen.tsx'
import { MapScreen } from './screens/MapScreen.tsx'
import { PlanningScreen } from './screens/PlanningScreen.tsx'
import { SheetScreen } from './screens/SheetScreen.tsx'
import { blankJobDraft, draftFromJob, type JobDraft, type JobRow } from './lib/store.ts'
import { FirstRun } from './components/FirstRun.tsx'
import { readFirstRunDone } from './lib/prefs.ts'
import { TodayScreen } from './screens/TodayScreen.tsx'
import { ENABLE_JOB_CREATE } from './lib/features.ts'
import { CommandPalette, ShortcutHelp, type PaletteCommand } from './components/CommandPalette.tsx'
import { isEditableTarget, shortcutFor } from './lib/shortcuts.ts'
import { addDaysYmd } from './lib/schedule.ts'

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'map', label: 'Map' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'sheet', label: 'Sheet' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'planning', label: 'Planning' },
  { id: 'import', label: 'Import' },
] as const

/** Primary pills match the office row. Planning (templates + mismatch rules) stays in the hamburger. */
const PRIMARY_TABS = TABS.filter((tab) => tab.id !== 'planning')

type TabId = (typeof TABS)[number]['id']

/** Job views that the problems strip can filter. */
/** Import has no day and no search, so its toolbar row is hidden. */
const NO_TOOLBAR_TABS: ReadonlySet<string> = new Set(['import'])
const PROBLEM_TABS: ReadonlySet<TabId> = new Set<TabId>(['map', 'calendar', 'jobs', 'sheet'])

function tabFromHash(): TabId {
  const name = location.hash.replace(/^#\/?/, '')
  return TABS.some((tab) => tab.id === name) ? (name as TabId) : 'today'
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [revision, setRevision] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [date, setDate] = useState(() => todayInNewYork())
  const [undoStack, setUndoStack] = useState<ScheduleUndoEntry[]>([])
  const [undoError, setUndoError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const [query, setQuery] = useState('')
  const [seedDraft, setSeedDraft] = useState<JobDraft | null>(null)
  const [problems, setProblems] = useState<ProblemSummary | null>(null)
  const [problemJobs, setProblemJobs] = useState<JobRow[]>([])
  const [problem, setProblem] = useState<ProblemSelection | null>(null)
  const [problemDate, setProblemDate] = useState(date)
  const [mapTechOptions, setMapTechOptions] = useState<string[]>([])
  const undoRef = useRef(undoStack)
  undoRef.current = undoStack
  if (problemDate !== date) {
    setProblemDate(date)
    setProblem(null)
  }

  useEffect(() => {
    let cancelled = false
    void queryJobs({ date, query: '' })
      .then((rows) => {
        if (!cancelled) {
          setProblemJobs(rows)
          setProblems(summarizeProblems(rows, date))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProblemJobs([])
          setProblems(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [date, revision])

  useEffect(() => {
    let cancelled = false
    void queryJobs({ date: '', query: '' })
      .then((rows) => {
        if (!cancelled) setMapTechOptions(uniqueTechs(rows))
      })
      .catch(() => {
        if (!cancelled) setMapTechOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const problemFilter = useMemo(() => (problem ? problemPredicate(problem, date, problemJobs) : null), [problem, date, problemJobs])
  const showProblems = PROBLEM_TABS.has(tab)
  const activeFilter = showProblems ? problemFilter : null

  useEffect(() => {
    // Census, then Google, then OpenStreetMap for unmapped upcoming jobs, with no click.
    // Runs at launch and after any change (import, address edit). Pins placed trigger one refresh.
    let cancelled = false
    const id = window.setTimeout(() => {
      void autoGeocodeUpcoming().then((placed) => {
        if (placed > 0 && !cancelled) setRevision((n) => n + 1)
      })
    }, 3000)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [revision])

  useEffect(() => {
    // Welcome screen: only on a truly empty database, only once.
    if (readFirstRunDone()) return
    let cancelled = false
    void queryCounts()
      .then((c) => {
        if (!cancelled && c.jobs === 0 && c.backlog === 0) setFirstRun(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // A restore runs at launch, before the UI exists. Say what happened, once.
    void takeRestoreResult().then((message) => {
      if (message) {
        setNotice(message)
        setRevision((n) => n + 1)
      }
    })
  }, [])

  useEffect(() => {
    // Daily safety copy of the local database, after the first screen has loaded.
    const id = window.setTimeout(() => void backupIfDue(), 5000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!location.hash) location.replace('#/jobs')
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (undoStack.length === 0) return
    const id = window.setInterval(() => {
      setUndoStack((current) => {
        const next = pruneExpired(current)
        return next.length === current.length ? current : next
      })
    }, 500)
    return () => window.clearInterval(id)
  }, [undoStack.length])

  function onMoved(previous: ScheduleSnapshot) {
    setUndoError(null)
    setUndoStack((current) => pushUndo(current, makeUndoEntry(previous)))
  }

  useEffect(() => {
    onJobEdited((before) => {
      setUndoError(null)
      setUndoStack((current) => pushUndo(current, makeEditUndoEntry(before)))
    })
    return () => onJobEdited(null)
  }, [])

  async function onUndo() {
    const { stack, entry } = popUndo(pruneExpired(undoRef.current))
    setUndoStack(stack)
    if (!entry) return
    setUndoError(null)
    try {
      if (entry.restoreDraft) {
        await saveLocalJob(entry.restoreDraft)
        setRevision((n) => n + 1)
        return
      }
      await moveLocalJob(entry.previous.jobId, {
        technician_name: entry.previous.technician_name,
        schedule_date: entry.previous.schedule_date,
        begin_time: entry.previous.begin_time,
        end_time: entry.previous.end_time,
      })
      if (entry.previous.schedule_date) setDate(entry.previous.schedule_date)
      setRevision((n) => n + 1)
    } catch (error) {
      setUndoStack((current) => pushUndo(current, entry))
      setUndoError(error instanceof Error ? error.message : String(error))
    }
  }

  const goTab = useCallback((id: TabId) => {
    if (location.hash !== `#/${id}`) location.hash = `#/${id}`
  }, [])
  const onUndoRef = useRef(onUndo)
  onUndoRef.current = onUndo

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = isEditableTarget(e.target)
      // Ctrl+Z undoes the last move, but never steals it from a text field.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !inField) {
        if (pruneExpired(undoRef.current).length) {
          e.preventDefault()
          void onUndoRef.current()
        }
        return
      }
      const action = shortcutFor({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        inField,
      })
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'palette':
          setPaletteOpen((open) => !open)
          break
        case 'help':
          setHelpOpen(true)
          break
        case 'today':
          setDate(todayInNewYork())
          break
        case 'day':
          setDate((d) => addDaysYmd(d, action.delta))
          break
        case 'focus-search':
          document.getElementById('header-search')?.focus()
          break
        case 'tab': {
          const target = PRIMARY_TABS[action.index]
          if (target) goTab(target.id)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTab])

  const paletteCommands: PaletteCommand[] = [
    ...PRIMARY_TABS.map((t, i) => ({ id: `tab-${t.id}`, label: `Go to ${t.label}`, hint: `Alt ${i + 1}`, run: () => goTab(t.id) })),
    { id: 'today', label: 'Go to today', hint: 'T', run: () => setDate(todayInNewYork()) },
    { id: 'prev-day', label: 'Previous day', hint: '[', run: () => setDate((d) => addDaysYmd(d, -1)) },
    { id: 'next-day', label: 'Next day', hint: ']', run: () => setDate((d) => addDaysYmd(d, 1)) },
    { id: 'settings', label: 'Open settings', run: () => setSettingsOpen(true) },
    { id: 'help', label: 'Keyboard shortcuts', hint: '?', run: () => setHelpOpen(true) },
  ]

  const liveUndo = newestLive(undoStack)
  const liveCount = pruneExpired(undoStack).length
  const consumeSeed = useCallback(() => setSeedDraft(null), [])

  async function onScheduleHere(job: JobRow, next: { schedule_date: string; technician_name: string | null }) {
    const kind = scheduleHereKind(job)
    if (kind === 'blocked') throw new Error('This job cannot be scheduled from Best days.')
    if (kind === 'tentative-move') {
      const previous = snapshotFromJob(job)
      await moveLocalJob(job.id, {
        technician_name: next.technician_name,
        schedule_date: next.schedule_date,
      })
      onMoved(previous)
    } else {
      const draft = draftFromJob(job)
      draft.schedule_date = next.schedule_date
      draft.technician_name = next.technician_name ?? ''
      await saveLocalJob(draft)
    }
    setDate(next.schedule_date)
    setRevision((n) => n + 1)
  }

  function onNewJob() {
    if (!ENABLE_JOB_CREATE) return
    setSeedDraft(blankJobDraft())
    if (location.hash !== '#/jobs') location.hash = '#/jobs'
  }

  return (
    <MapChromeProvider>
    <div className="flex min-h-full flex-1 flex-col bg-app text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to board
      </a>
      <header className="relative z-30 border-b border-slate-200 bg-white/95 px-chrome py-2 backdrop-blur">
        <p className="sr-only">Times use America/New_York.</p>
        <div className="flex items-center gap-2" data-testid="chrome-row-1">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              data-testid="settings-menu"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-slate-800 hover:bg-slate-50"
            >
              <MenuIcon />
            </button>
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-900">DispatchBoard</h1>
            <span className="shrink-0 rounded bg-chrome px-1.5 py-px text-xs font-semibold uppercase leading-4 tracking-wide text-white">
              Local
            </span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <nav
              aria-label="Sections"
              className="flex min-w-0 overflow-x-auto rounded-lg bg-slate-100 p-0.5"
            >
              {PRIMARY_TABS.map((item) => {
                const active = tab === item.id
                return (
                  <a
                    key={item.id}
                    href={`#/${item.id}`}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-sm font-medium ${
                      active ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    {item.label}
                  </a>
                )
              })}
            </nav>
            {ENABLE_JOB_CREATE ? (
              <button
                type="button"
                data-testid="new-job-button"
                onClick={onNewJob}
                className="inline-flex h-8 shrink-0 items-center rounded-lg bg-brand-600 px-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                New job
              </button>
            ) : null}
          </div>
        </div>
        {NO_TOOLBAR_TABS.has(tab) ? null : (
        <div
          className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2"
          data-testid="chrome-row-2"
        >
          <DateChip date={date} onChange={setDate} />
          <label className="flex min-w-[10rem] flex-1 basis-40 items-center">
            <span className="sr-only">Search jobs and backlog</span>
            <input
              id="header-search"
              type="search"
              value={query}
              placeholder="Search WO, customer, backlog"
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500"
            />
          </label>
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="h-8 shrink-0 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Clear
            </button>
          ) : null}
          {tab === 'map' ? <MapChromeSlot /> : null}
        </div>
        )}
      </header>
      {notice ? (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100 px-chrome py-2 text-sm text-slate-800" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-meta font-medium underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}
      {showProblems ? (
        <ProblemsStrip
          summary={problems}
          isToday={date === todayInNewYork()}
          dayLabel={formatDate(date)}
          selected={problem}
          onSelect={setProblem}
        />
      ) : null}
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <div className={tab === 'today' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <TodayScreen
            revision={revision}
            date={date}
            summary={problems}
            onPickProblem={(selection) => {
              setProblem(selection)
              goTab('jobs')
            }}
            onGo={goTab}
          />
        </div>
        <div className={tab === 'import' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <ImportScreen revision={revision} onApplied={() => setRevision((n) => n + 1)} />
        </div>
        <div className={tab === 'jobs' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <JobsScreen
            revision={revision}
            date={date}
            query={query}
            seedDraft={seedDraft}
            problemFilter={activeFilter}
            onSeedConsumed={consumeSeed}
            onDateChange={setDate}
            onChanged={() => setRevision((n) => n + 1)}
          />
        </div>
        <div className={tab === 'calendar' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <CalendarScreen
            revision={revision}
            date={date}
            problemFilter={activeFilter}
            onDateChange={setDate}
            onMoved={onMoved}
            onChanged={() => setRevision((n) => n + 1)}
          />
        </div>
        <div className={tab === 'map' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <MapScreen
            revision={revision}
            date={date}
            query={query}
            active={tab === 'map'}
            problemFilter={activeFilter}
            onChanged={() => setRevision((n) => n + 1)}
            onDateChange={setDate}
            onScheduleHere={onScheduleHere}
            onNewJobHere={(draft) => {
              setSeedDraft(draft)
              location.hash = '#/jobs'
            }}
          />
        </div>
        <div className={tab === 'sheet' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <SheetScreen
            revision={revision}
            date={date}
            query={query}
            problemFilter={activeFilter}
            onChanged={() => setRevision((n) => n + 1)}
          />
        </div>
        <div className={tab === 'backlog' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <BacklogScreen revision={revision} date={date} query={query} onChanged={() => setRevision((n) => n + 1)} />
        </div>
        <div className={tab === 'planning' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <PlanningScreen revision={revision} />
        </div>
      </main>
      {settingsOpen ? (
        <SettingsPanel
          planningActive={tab === 'planning'}
          techOptions={mapTechOptions}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => setRevision((n) => n + 1)}
        />
      ) : null}
      {firstRun ? <FirstRun onImport={() => goTab('import')} onDone={() => setFirstRun(false)} /> : null}
      {paletteOpen ? (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
          onPickJob={(job) => {
            if (job.schedule_date) setDate(job.schedule_date)
            setQuery(job.wo_number ?? job.customer_name)
            goTab('jobs')
          }}
        />
      ) : null}
      {helpOpen ? <ShortcutHelp onClose={() => setHelpOpen(false)} /> : null}
      {liveUndo || undoError ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-30 flex flex-col items-end gap-2">
          {undoError ? <p className="pointer-events-auto rounded-md bg-white px-3 py-2 text-sm text-error shadow-card">{undoError}</p> : null}
          <UndoToast entry={liveUndo ?? null} pendingCount={liveCount} onUndo={() => void onUndo()} />
        </div>
      ) : null}
    </div>
    </MapChromeProvider>
  )
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
      <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}
