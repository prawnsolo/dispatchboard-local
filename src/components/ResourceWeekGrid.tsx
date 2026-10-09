import { useRef, useState } from 'react'
import { JobBlock } from './JobBlock.tsx'
import { TechLoad } from './TechLoad.tsx'
import { loadKey, type TechDayLoad } from '../lib/techLoad.ts'
import { displayName, formatWeekdayHeading } from '../lib/format.ts'
import { WeatherBadge } from './Weather.tsx'
import {
  UNASSIGNED_TECH,
  canDragJob,
  getDraggingJobId,
  setDraggingJobId,
  techKey,
  uniqueTechs,
  weekDays,
  ymd,
} from '../lib/schedule.ts'
import type { JobRow, ScheduleMove } from '../lib/store.ts'

export function ResourceWeekGrid({
  jobs,
  weekStart,
  loads,
  bootsFlags,
  ptoKeys,
  selectedDate,
  selectedId,
  onSelectJob,
  onMove,
}: {
  jobs: JobRow[]
  weekStart: string
  /** Booked vs shift per tech/day (techDayLoads). */
  loads?: ReadonlyMap<string, TechDayLoad>
  bootsFlags?: ReadonlyMap<string, { jobId: string }>
  ptoKeys?: ReadonlySet<string>
  selectedDate: string
  selectedId: number | null
  onSelectJob: (job: JobRow) => void
  onMove: (job: JobRow, next: ScheduleMove) => void
}) {
  const days = weekDays(weekStart)
  const techs = uniqueTechs(jobs)
  const [overKey, setOverKey] = useState<string | null>(null)
  const skipClick = useRef(false)

  const byCell = new Map<string, JobRow[]>()
  for (const job of jobs) {
    if (!job.schedule_date) continue
    const key = `${techKey(job.technician_name)}|${job.schedule_date}`
    const list = byCell.get(key) ?? []
    list.push(job)
    byCell.set(key, list)
  }
  for (const list of byCell.values()) {
    list.sort((a, b) => (a.begin_time ?? '').localeCompare(b.begin_time ?? ''))
  }

  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="resource-week">
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-slate-50">
          <tr>
            <th className="sticky left-0 z-20 w-40 border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-meta font-semibold uppercase tracking-wide text-slate-500">
              Technician
            </th>
            {days.map((day) => {
              const date = ymd(day)
              const selected = date === selectedDate
              return (
                <th
                  key={date}
                  className={`border-b border-slate-200 px-1.5 py-1.5 text-center text-meta font-semibold uppercase tracking-wide ${
                    selected ? 'text-brand-700' : 'text-slate-900'
                  }`}
                >
                  {formatWeekdayHeading(date)}
                  <WeatherBadge date={date} className="ml-1.5 align-middle normal-case" />
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {techs.map((tech) => (
            <tr key={tech} className="align-top">
              <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-2 py-1.5 text-left text-xs font-semibold text-slate-800">
                {displayName(tech)}
              </th>
              {days.map((day) => {
                const date = ymd(day)
                const cellKey = `${tech}|${date}`
                const cellJobs = byCell.get(cellKey) ?? []
                const selected = date === selectedDate
                return (
                  <td
                    key={cellKey}
                    data-pto={ptoKeys?.has(cellKey) ? '1' : undefined}
                    className={`border-b p-1 align-top ${
                      overKey === cellKey
                        ? 'border-slate-200 bg-amber-50'
                        : ptoKeys?.has(cellKey)
                          ? 'border-slate-200 bg-slate-200/70'
                        : selected
                          ? 'border-slate-100 bg-white'
                          : 'border-slate-100 bg-slate-50/40'
                    }`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setOverKey(cellKey)
                    }}
                    onDragLeave={() => setOverKey((current) => (current === cellKey ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault()
                      setOverKey(null)
                      const id = getDraggingJobId() || event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text')
                      setDraggingJobId(null)
                      if (!id) return
                      const job = jobs.find((row) => String(row.id) === id)
                      if (!job || !canDragJob(job)) return
                      const nextTech = tech === UNASSIGNED_TECH ? null : tech
                      if (job.schedule_date === date && (job.technician_name ?? null) === nextTech) return
                      onMove(job, { schedule_date: date, technician_name: nextTech })
                    }}
                  >
                    <div className="flex min-h-16 flex-col gap-1">
                      {ptoKeys?.has(cellKey) ? (
                        <p className="px-0.5 text-xs font-bold uppercase tracking-wide text-slate-600" data-testid="pto-label">
                          PTO
                        </p>
                      ) : null}
                      {(() => {
                        const load = loads?.get(loadKey(tech, date))
                        // PTO day = 0h available (not booked hours)
                        return !ptoKeys?.has(cellKey) && load ? <TechLoad load={load} className="px-0.5" /> : null
                      })()}
                      {cellJobs.map((job) => {
                        const draggable = canDragJob(job)
                        return (
                          <div
                            key={job.id}
                            className={`${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${
                              selectedId === job.id ? 'ring-2 ring-brand-500 ring-offset-1' : ''
                            }`}
                            draggable={draggable}
                            role="button"
                            tabIndex={0}
                            aria-label={`${job.customer_name}${draggable ? ', drag to reschedule' : ', locked'}`}
                            onDragStart={(event) => {
                              if (!draggable) {
                                event.preventDefault()
                                return
                              }
                              skipClick.current = true
                              setDraggingJobId(String(job.id))
                              event.dataTransfer.setData('text/plain', String(job.id))
                              event.dataTransfer.setData('text', String(job.id))
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={() => {
                              window.setTimeout(() => {
                                setDraggingJobId(null)
                                window.setTimeout(() => {
                                  skipClick.current = false
                                }, 50)
                              }, 0)
                            }}
                            onClick={() => {
                              if (skipClick.current) return
                              onSelectJob(job)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              onSelectJob(job)
                            }}
                          >
                            <JobBlock job={job} dragCursor={canDragJob(job)} boots={bootsFlags?.has(String(job.id))} />
                          </div>
                        )
                      })}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
          {techs.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-10">
                <h3 className="text-lg font-semibold">No jobs this week</h3>
                <p className="mt-1 text-sm text-ink-body">Use the arrows or Today to move to another week.</p>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}
