import { useRef, useState } from 'react'
import { JobBlock } from './JobBlock.tsx'
import { TechLoad } from './TechLoad.tsx'
import { loadKey, type TechDayLoad } from '../lib/techLoad.ts'
import { displayName, todayInNewYork } from '../lib/format.ts'
import {
  DAY_GRID_END_MIN,
  DAY_GRID_PX_PER_HOUR,
  DAY_GRID_START_MIN,
  DAY_GRID_WORK_END_MIN,
  DAY_GRID_WORK_START_MIN,
  assignOverlapLanes,
  canDragJob,
  dayGridHeightPx,
  dayGridHours,
  dropToSchedulePatch,
  formatClock,
  getDraggingJobId,
  jobBlockOffset,
  jobTimeBounds,
  minutesToDbTime,
  setDraggingJobId,
  techKey,
  yOffsetToMinutes,
} from '../lib/schedule.ts'
import type { JobRow, ScheduleMove } from '../lib/store.ts'

function hourLabel(min: number): string {
  return formatClock(minutesToDbTime(min)) ?? ''
}

function isOffHour(min: number): boolean {
  return min < DAY_GRID_WORK_START_MIN || min >= DAY_GRID_WORK_END_MIN
}

function nowMinutesOnDate(date: string, now: Date = new Date()): number | null {
  if (date !== todayInNewYork(now)) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const h = Number(parts.find((part) => part.type === 'hour')?.value)
  const m = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const min = h * 60 + m
  if (min < DAY_GRID_START_MIN || min > DAY_GRID_END_MIN) return null
  return min
}

export function ResourceDayGrid({
  jobs,
  techs,
  loads,
  bootsFlags,
  ptoKeys,
  date,
  selectedId,
  onSelectJob,
  onMove,
}: {
  jobs: JobRow[]
  techs: string[]
  /** Booked vs shift per tech/day (techDayLoads). */
  loads?: ReadonlyMap<string, TechDayLoad>
  bootsFlags?: ReadonlyMap<string, { jobId: string }>
  ptoKeys?: ReadonlySet<string>
  date: string
  selectedId: number | null
  onSelectJob: (job: JobRow) => void
  onMove: (job: JobRow, next: ScheduleMove) => void
}) {
  const hours = dayGridHours()
  const gridHeight = dayGridHeightPx()
  const [overKey, setOverKey] = useState<string | null>(null)
  const nowMin = nowMinutesOnDate(date)
  const skipClick = useRef(false)

  const byTech = new Map<string, JobRow[]>()
  for (const tech of techs) byTech.set(tech, [])
  for (const job of jobs) {
    const key = techKey(job.technician_name)
    const list = byTech.get(key)
    if (list) list.push(job)
    else byTech.set(key, [job])
  }

  function dropOnColumn(tech: string, clientY: number, columnEl: HTMLElement) {
    const id = getDraggingJobId() || ''
    setDraggingJobId(null)
    if (!id) return
    const job = jobs.find((row) => String(row.id) === id)
    if (!job || !canDragJob(job)) return
    const rect = columnEl.getBoundingClientRect()
    const dropMin = yOffsetToMinutes(clientY - rect.top)
    const next = dropToSchedulePatch(job, date, tech, dropMin)
    const sameTech = techKey(job.technician_name) === tech
    const sameTime = job.begin_time === next.begin_time && (job.end_time ?? null) === next.end_time
    if (sameTech && sameTime && job.schedule_date === date) return
    onMove(job, next)
  }

  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="resource-day-grid">
      <div className="flex min-w-[720px]">
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-slate-200 bg-white">
          <div className="sticky top-0 z-30 min-h-14 border-b border-slate-200 bg-slate-50" />
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((min) => (
              <div
                key={min}
                className="absolute right-1.5 pt-0.5 text-right text-xs font-medium tabular-nums text-slate-500"
                style={{ top: ((min - DAY_GRID_START_MIN) / 60) * DAY_GRID_PX_PER_HOUR }}
              >
                {hourLabel(min)}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-1">
          {techs.map((tech) => {
            const columnJobs = byTech.get(tech) ?? []
            const lanes = assignOverlapLanes(columnJobs)
            return (
              <div key={tech} className={`relative min-w-[9.5rem] flex-1 border-r border-slate-200 last:border-r-0 ${ptoKeys?.has(`${tech}|${date}`) ? 'bg-slate-100/80' : ''}`} data-testid={`day-col-${tech}`} data-pto={ptoKeys?.has(`${tech}|${date}`) ? '1' : undefined}>
                <div className={`sticky top-0 z-20 flex min-h-14 flex-col items-center justify-center gap-0.5 border-b border-slate-200 px-1.5 py-1 text-center ${ptoKeys?.has(`${tech}|${date}`) ? 'bg-slate-200/90' : 'bg-slate-50'}`}>
                  <p className="max-w-full truncate text-sm font-semibold text-slate-900">{displayName(tech)}</p>
                  {ptoKeys?.has(`${tech}|${date}`) ? (
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-600" data-testid="pto-label">PTO</p>
                  ) : null}
                  {ptoKeys?.has(`${tech}|${date}`) ? null : (() => {
                    const load = loads?.get(loadKey(tech, date))
                    return load ? <TechLoad load={load} /> : null
                  })()}
                </div>
                <div
                  className={`relative ${overKey === tech ? 'bg-amber-50/80' : ptoKeys?.has(`${tech}|${date}`) ? 'bg-slate-100/70' : 'bg-white'}`}
                  style={{ height: gridHeight }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setOverKey(tech)
                  }}
                  onDragLeave={() => setOverKey((current) => (current === tech ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault()
                    setOverKey(null)
                    const col = event.currentTarget
                    const id = getDraggingJobId() || event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text')
                    if (id) setDraggingJobId(id)
                    dropOnColumn(tech, event.clientY, col)
                  }}
                >
                  {hours.map((min) => (
                    <div
                      key={min}
                      className={`pointer-events-none absolute inset-x-0 border-t border-slate-100 ${isOffHour(min) ? 'bg-amber-50/70' : 'bg-white'}`}
                      style={{
                        top: ((min - DAY_GRID_START_MIN) / 60) * DAY_GRID_PX_PER_HOUR,
                        height: DAY_GRID_PX_PER_HOUR,
                      }}
                    />
                  ))}
                  {nowMin != null ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 h-px bg-brand"
                      style={{ top: ((nowMin - DAY_GRID_START_MIN) / 60) * DAY_GRID_PX_PER_HOUR }}
                      aria-hidden
                    />
                  ) : null}
                  {columnJobs.map((job) => {
                    const { startMin, endMin } = jobTimeBounds(job)
                    const { top, height } = jobBlockOffset(startMin, endMin)
                    const { lane, laneCount } = lanes.get(String(job.id)) ?? { lane: 0, laneCount: 1 }
                    const widthPct = 100 / laneCount
                    const draggable = canDragJob(job)
                    return (
                      <div
                        key={job.id}
                        className={`absolute z-10 px-px ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${
                          selectedId === job.id ? 'ring-2 ring-brand-500 ring-offset-1' : ''
                        }`}
                        style={{ top, height, left: `${lane * widthPct}%`, width: `${widthPct}%` }}
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
                        <JobBlock job={job} compact hideTime dragCursor={canDragJob(job)} boots={bootsFlags?.has(String(job.id))} className="h-full" />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {techs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-6 py-12">
              <div>
                <h3 className="text-lg font-semibold">No technicians with jobs</h3>
                <p className="mt-1 text-sm text-ink-body">Nothing is scheduled this week. Pick another day.</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
