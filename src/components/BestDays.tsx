import { useEffect, useState } from 'react'
import { formatTimeRange } from '../lib/format.ts'
import { BACKLOG_TYPE_LABELS, isBacklogType } from '../lib/backlog.ts'
import { techCardTint } from '../lib/colors.ts'
import { formatTechDayLoad } from '../lib/jobDurations.ts'
import { LoadHours } from './TechLoad.tsx'
import type { NearbySummary } from '../lib/proximity.ts'
import { formatBestDay } from '../lib/schedule-here.ts'
import { ENABLE_JOB_CREATE } from '../lib/features.ts'

const DEFAULT_DAYS = 6

function miles(n: number): string {
  return `${n.toFixed(1)} mi`
}

function jobLine(job: { customer_name: string; activity_1: string | null; begin_time: string | null; end_time: string | null }): string {
  return [job.customer_name, job.activity_1, formatTimeRange(job.begin_time, job.end_time)].filter(Boolean).join(' · ')
}

export function BestDays({
  summary,
  selectedJobId,
  selectedName,
  onPickDate,
  onSelectJob,
  onSelectBacklog,
  onScheduleHere,
  onNewJobHere,
}: {
  summary: NearbySummary
  selectedJobId: number | null
  selectedName: string | null
  onPickDate: (date: string) => void
  onSelectJob: (id: number) => void
  onSelectBacklog: (id: number) => void
  onScheduleHere: (target: { date: string; tech: string }) => void
  onNewJobHere: (target: { date: string; tech: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const best = summary.days[0]
  const days = showAll ? summary.days : summary.days.slice(0, DEFAULT_DAYS)
  const empty = summary.days.length === 0 && summary.unscheduled.length === 0 && summary.backlog.length === 0

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        data-testid="best-days-toggle"
        onClick={() => setOpen((value) => !value)}
        className="h-8 shrink-0 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        Best days{best ? ` · ${formatBestDay(best.date)}` : ''}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-40 mt-1 max-h-[24rem] w-[min(40rem,calc(100vw-1.5rem))] overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          data-testid="best-days"
        >
          <p className="px-2 pb-2 text-xs text-ink-label">
            Nearby radius is crow-flies (~30 mph). Day totals add Step 1 drive (crow-flies × 1.3 at 35 mph, yard start/end).
          </p>
          {ENABLE_JOB_CREATE ? (
            <p className="px-2 pb-2 text-xs text-ink-body">
              {selectedName
                ? `Selected: ${selectedName}. Schedule here puts it on that day and technician.`
                : 'No job selected. New job here opens a tentative job with this day, technician, and the nearby address.'}
            </p>
          ) : null}
          {empty ? (
            <p className="px-2 py-3 text-sm text-ink-body">Nothing upcoming inside this radius.</p>
          ) : null}
          {summary.days.length > 0 ? (
            <ul className="space-y-2">
              {days.map((day, index) => (
                <li key={day.date} className="rounded border border-line">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 bg-surface px-2 py-1.5 text-left hover:bg-brand-wash"
                    onClick={() => onPickDate(day.date)}
                  >
                    <span className="text-sm font-semibold text-ink">
                      {formatBestDay(day.date)}
                      {index === 0 ? (
                        <span className="ml-2 rounded bg-brand px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                          Closest
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-ink-body">
                      {day.jobCount} job{day.jobCount === 1 ? '' : 's'} · nearest {miles(day.nearestMiles)}
                    </span>
                  </button>
                  <div className="space-y-1.5 px-1.5 py-1.5">
                    {day.techs.map((group) => {
                      const tint = techCardTint(group.tech)
                      return (
                        <div
                          key={group.tech}
                          className="rounded border py-1 pl-1.5 pr-1"
                          data-testid="nearby-tech-card"
                          style={{
                            background: tint.background,
                            borderColor: tint.border,
                            borderLeftWidth: 3,
                            borderLeftColor: tint.accent,
                          }}
                        >
                          <div className="flex items-start justify-between gap-2 px-1.5">
                            <p className="min-w-0 text-xs font-bold leading-snug text-ink">
                              <span>{formatTechDayLoad(group.tech, group.dayJobCount, group.bookedHours, group.shiftHours, group.driveHours).prefix} · </span>
                              <LoadHours
                                bookedHours={group.bookedHours}
                                driveHours={group.driveHours}
                                shiftHours={group.shiftHours}
                                className="align-baseline font-bold"
                                testId="nearby-tech-load"
                                title={formatTechDayLoad(group.tech, group.dayJobCount, group.bookedHours, group.shiftHours, group.driveHours).label}
                              />
                              {group.insertionLabel ? (
                                <span
                                  className={`ml-1.5 font-semibold ${group.insertionFits === false ? 'text-rose-700' : 'text-ink-label'}`}
                                  data-testid="nearby-drive-insert"
                                >
                                  {' '}
                                  · {group.insertionLabel}
                                </span>
                              ) : group.why ? (
                                <span className="ml-1.5 font-semibold text-ink-label"> · {group.why}</span>
                              ) : null}
                              {group.bootsRisk ? (
                                <span
                                  className="ml-1.5 rounded-sm border border-amber-300 bg-amber-50 px-1 py-0.5 text-[12px] font-semibold text-amber-900"
                                  data-testid="nearby-boots"
                                >
                                  boots
                                </span>
                              ) : null}
                            </p>
                            {ENABLE_JOB_CREATE ? (
                              <button
                                type="button"
                                className="rounded px-1.5 py-0.5 text-xs font-semibold text-slate-900 underline underline-offset-2 hover:bg-slate-100"
                                data-testid="schedule-here"
                                onClick={() => {
                                  const target = { date: day.date, tech: group.tech }
                                  if (selectedJobId != null) onScheduleHere(target)
                                  else onNewJobHere(target)
                                  setOpen(false)
                                }}
                              >
                                {selectedJobId != null ? 'Schedule here' : 'New job here'}
                              </button>
                            ) : null}
                          </div>
                          {group.hits.map(({ job, miles: distance }) => (
                            <button
                              key={job.id}
                              type="button"
                              className={`flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-white/70 ${
                                selectedJobId === job.id ? 'bg-brand-wash' : ''
                              }`}
                              onClick={() => onSelectJob(job.id)}
                            >
                              <span className="min-w-0 truncate text-ink">{jobLine(job)}</span>
                              <span className="shrink-0 tabular-nums text-ink-label">{miles(distance)}</span>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.days.length > DEFAULT_DAYS ? (
            <button type="button" className="mt-1 px-2 text-xs font-medium text-ink-body underline" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show fewer days' : `Show all ${summary.days.length} days`}
            </button>
          ) : null}
          {summary.unscheduled.length > 0 ? (
            <section className="mt-3">
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-ink-label">Nearby jobs with no date yet</h3>
              {summary.unscheduled.slice(0, showAll ? undefined : 8).map(({ job, miles: distance }) => (
                <button
                  key={job.id}
                  type="button"
                  className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface"
                  onClick={() => onSelectJob(job.id)}
                >
                  <span className="min-w-0 truncate text-ink">{jobLine(job)}</span>
                  <span className="shrink-0 tabular-nums text-ink-label">{miles(distance)}</span>
                </button>
              ))}
            </section>
          ) : null}
          {summary.backlog.length > 0 ? (
            <section className="mt-3">
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-ink-label">Open backlog nearby</h3>
              {summary.backlog.slice(0, showAll ? undefined : 8).map(({ item, miles: distance }) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface"
                  onClick={() => onSelectBacklog(item.id)}
                >
                  <span className="min-w-0 truncate text-ink">
                    {[
                      item.customer_name,
                      isBacklogType(item.backlog_type) ? BACKLOG_TYPE_LABELS[item.backlog_type] : item.backlog_type,
                      item.campaign,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-label">{miles(distance)}</span>
                </button>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
