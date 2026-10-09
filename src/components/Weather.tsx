import { useEffect, useMemo, useState } from 'react'
import { queryJobs } from '../lib/db.ts'
import { displayName } from '../lib/format.ts'
import { inches, assessDays, tankRisks, type DayAssessment, type DayWeather, type TankRisk, type WeatherAlert } from '../lib/weather.ts'
import { refreshWeather, useWeatherState, type WeatherState } from '../lib/weather-store.ts'
import type { JobRow } from '../lib/store.ts'
import { Icon } from './Icon.tsx'
import { JobIcon } from './JobIcon.tsx'

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function utc(ymd: string): Date {
  return new Date(`${ymd}T12:00:00Z`)
}

function dayWord(ymd: string, today: string): string {
  return ymd === today ? 'Today' : WEEKDAY.format(utc(ymd))
}

const ALERT_TIME = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  hour: 'numeric',
  timeZone: 'America/New_York',
})

function alertLine(alert: WeatherAlert): string {
  if (!alert.ends) return alert.event
  const t = new Date(alert.ends)
  return Number.isNaN(t.getTime()) ? alert.event : `${alert.event} until ${ALERT_TIME.format(t)}`
}

/** The forecast days from today on, with each day's warnings worked out. */
export function useForecast(): {
  state: WeatherState
  days: DayWeather[]
  assessed: Map<string, DayAssessment>
} {
  const state = useWeatherState()
  return useMemo(() => {
    const days = state.snapshot?.days ?? []
    const assessed = new Map(assessDays(days, state.thresholds, state.snapshot?.alerts ?? []).map((a) => [a.date, a]))
    return { state, days, assessed }
  }, [state])
}

function rainTone(a: DayAssessment | undefined): string {
  if (a?.rain === 'extreme') return 'text-error font-semibold'
  if (a?.rain === 'heavy') return 'text-warning font-semibold'
  return 'text-slate-600'
}

/**
 * Tiny forecast mark for a date: icon, and the rain amount when it is worth a
 * look. Renders nothing when weather is off or the date is outside the forecast.
 */
export function WeatherBadge({ date, className = '' }: { date: string; className?: string }) {
  const { days, assessed } = useForecast()
  const day = days.find((d) => d.date === date)
  if (!day) return null
  const a = assessed.get(date)
  const wet = day.rainIn >= 0.1
  const warn = a?.rain === 'heavy' || a?.rain === 'extreme' || a?.windy || a?.hot || a?.cold
  const label = [
    day.summary || null,
    wet ? `${inches(day.rainIn)} of rain` : null,
    ...(a?.reasons ?? []).filter((r) => !/of rain$/.test(r)),
  ]
    .filter(Boolean)
    .join('. ')
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${warn ? rainTone(a) : 'text-slate-600'} ${className}`}
      title={label || 'Forecast'}
      data-testid="weather-badge"
    >
      <Icon name={day.icon} size={14} label={day.summary || 'Forecast'} />
      {wet ? <span className="text-meta tabular-nums">{inches(day.rainIn)}</span> : null}
    </span>
  )
}

function DayCard({ day, a, today }: { day: DayWeather; a: DayAssessment | undefined; today: string }) {
  const wet = day.rainIn >= 0.1
  const heavy = a?.rain === 'heavy' || a?.rain === 'extreme'
  const flags = [a?.windy ? `Gusts ${day.gustMph} mph` : null, a?.hot ? 'Very hot' : null, a?.cold ? 'Very cold' : null].filter(Boolean)
  return (
    <li
      className={`min-w-0 rounded-lg border px-3 py-2.5 ${
        a?.rain === 'extreme' ? 'border-red-300 bg-red-50' : heavy ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
      data-testid="weather-day"
      data-date={day.date}
      data-level={a?.rain ?? 'none'}
    >
      <p className="text-sm font-semibold text-ink">
        {dayWord(day.date, today)} <span className="font-normal text-slate-600">{MONTH_DAY.format(utc(day.date))}</span>
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Icon name={day.icon} size={26} strokeWidth={1.75} className="text-slate-700" label={day.summary || 'Forecast'} />
        <p className="text-sm tabular-nums text-ink">
          <span className="font-semibold">{day.highF != null ? `${day.highF}°` : '—'}</span>
          <span className="text-slate-600"> / {day.lowF != null ? `${day.lowF}°` : '—'}</span>
        </p>
      </div>
      <p className={`mt-1.5 text-sm tabular-nums ${rainTone(a)}`}>
        {wet ? `${inches(day.rainIn)} rain` : 'Dry'}
        {day.popPct != null && day.popPct >= 20 ? <span className="font-normal text-slate-600"> · {day.popPct}%</span> : null}
      </p>
      {day.summary ? <p className="mt-0.5 truncate text-meta text-slate-600" title={day.summary}>{day.summary}</p> : null}
      {a && heavy ? (
        <p className={`mt-1 text-meta ${a.rain === 'extreme' ? 'text-error' : 'text-warning'}`}>
          {day.rainIn < 0.5 && a.flood ? a.flood : a.rain === 'extreme' ? 'Extreme rain' : 'Heavy rain'}
        </p>
      ) : null}
      {flags.length ? <p className="mt-0.5 text-meta text-warning">{flags.join(' · ')}</p> : null}
    </li>
  )
}

/** Five days at the top of Today. Off until the dispatcher turns it on in Settings. */
export function WeatherStrip({ today, onOpenSettings }: { today: string; onOpenSettings: () => void }) {
  const { state, days, assessed } = useForecast()
  const shown = days.filter((d) => d.date >= today).slice(0, 5)
  const alerts = state.snapshot?.alerts ?? []

  if (!state.enabled) {
    return (
      <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2" aria-label="Weather" data-testid="weather-off">
        <p className="text-sm text-slate-600">Five-day forecast is off. Turn it on for rain and storm warnings.</p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
        >
          Set up weather
        </button>
      </section>
    )
  }

  const age = state.snapshot ? Math.max(0, Math.round((Date.now() - state.snapshot.fetchedAt) / 60_000)) : null
  const ageText = age == null ? '' : age < 2 ? 'just now' : age < 90 ? `${age} min ago` : `${Math.round(age / 60)} h ago`

  return (
    <section className="mt-4" aria-label="Weather" data-testid="weather-strip">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Forecast</h3>
        <p className="text-meta text-slate-600">
          {state.status === 'loading' && !state.snapshot ? 'Loading…' : age != null ? `National Weather Service · updated ${ageText}` : ''}
        </p>
      </div>
      {shown.length ? (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {shown.map((day) => (
            <DayCard key={day.date} day={day} a={assessed.get(day.date)} today={today} />
          ))}
        </ul>
      ) : null}
      {alerts.length ? (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Weather alerts">
          {alerts.slice(0, 4).map((alert) => (
            <li
              key={`${alert.event}|${alert.ends}`}
              title={alert.headline}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                alert.severity === 'Severe' || alert.severity === 'Extreme'
                  ? 'border-red-300 bg-red-50 text-error'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <Icon name="triangle-alert" size={14} />
              {alertLine(alert)}
            </li>
          ))}
        </ul>
      ) : null}
      {state.status === 'error' ? (
        <p className="mt-2 text-sm text-error" role="alert" data-testid="weather-error">
          {state.error}{' '}
          {state.snapshot ? 'Showing the last forecast.' : null}{' '}
          <button type="button" onClick={() => void refreshWeather(true)} className="font-medium underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : null}
    </section>
  )
}

export type TankRiskRow = { risk: TankRisk; job: JobRow }

/** Underground tank installs the forecast puts at risk. Empty when weather is off. */
export function useTankRisks(revision: number): TankRiskRow[] {
  const { state, assessed, days } = useForecast()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const first = days[0]?.date
  const last = days[days.length - 1]?.date

  useEffect(() => {
    if (!state.enabled || !first || !last) {
      setJobs([])
      return
    }
    let cancelled = false
    void queryJobs({ date: '', query: '' })
      .then((rows) => {
        if (!cancelled) setJobs(rows.filter((j) => j.schedule_date && j.schedule_date >= first && j.schedule_date <= last))
      })
      .catch(() => {
        if (!cancelled) setJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [state.enabled, first, last, revision])

  return useMemo(() => {
    const byId = new Map(jobs.map((j) => [j.id, j]))
    return tankRisks(jobs, [...assessed.values()])
      .map((risk) => ({ risk, job: byId.get(risk.jobId)! }))
      .filter((row) => row.job)
  }, [jobs, assessed])
}

const RISK_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The chip for the "Needs a look" row, and the list it opens. */
export function TankRainWarning({ rows, onOpenJob }: { rows: TankRiskRow[]; onOpenJob: (job: JobRow) => void }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        data-testid="tank-rain-chip"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
      >
        <Icon name="cloud-rain" size={14} />
        <span className="font-semibold tabular-nums">{rows.length}</span>
        {rows.length === 1 ? 'underground tank install at risk from rain' : 'underground tank installs at risk from rain'}
      </button>
      {open ? (
        <div className="basis-full rounded-lg border border-amber-300 bg-amber-50 p-3" data-testid="tank-rain-list">
          <p className="text-sm text-amber-900">
            A tank in the ground can float if the hole fills with water before it is inspected and covered.
          </p>
          <ul className="mt-2 divide-y divide-amber-200">
            {rows.map(({ risk, job }) => (
              <li key={risk.jobId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <JobIcon job={job} size={16} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {displayName(job.customer_name)} <span className="font-normal text-slate-700">· {RISK_DAY.format(utc(risk.date))}</span>
                  </p>
                  <p className="truncate text-meta text-slate-700">
                    {[job.address_street, job.address_city_state_zip].filter(Boolean).join(', ') || 'No address'}
                    {' · '}
                    {risk.rainDate === risk.date ? 'Rain that day' : `Rain ${RISK_DAY.format(utc(risk.rainDate))}`}: {risk.reason}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenJob(job)}
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
                >
                  Open job
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
