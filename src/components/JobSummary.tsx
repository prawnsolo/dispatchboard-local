import { Icon } from './Icon.tsx'
import { JobIcon, type IconJob } from './JobIcon.tsx'
import { formatDate, formatTimeRange } from '../lib/format.ts'
import { isFireplaceAppliance, locationAppliances } from '../lib/job-icons.ts'

type Text = string | null | undefined

export type SummaryJob = IconJob & {
  customer_name: Text
  address_street?: Text
  address_descriptor?: Text
  address_city_state_zip?: Text
  address_raw?: Text
  service_instructions?: Text
  technician_name?: Text
  schedule_date?: Text
  begin_time?: Text
  end_time?: Text
  wo_number?: Text
}

export function summaryAddress(job: SummaryJob): string {
  const street = [job.address_street, job.address_descriptor]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(', ')
  const csz = job.address_city_state_zip?.trim() ?? ''
  return [street, csz].filter(Boolean).join(', ') || job.address_raw?.trim() || ''
}

/**
 * The four things a dispatcher needs first, in the same order everywhere:
 * who, where, what job, what the call said. Read-only; editing happens below it.
 */
export function JobSummary({
  job,
  titleId,
  compact = false,
}: {
  job: SummaryJob
  titleId?: string
  /** Smaller text and a shorter notes box, for map cards and lists. */
  compact?: boolean
}) {
  const address = summaryAddress(job)
  const activities = [job.activity_1, job.activity_2, job.activity_3].map((a) => a?.trim()).filter(Boolean)
  const appliances = locationAppliances(job.location_definition)
  const notes = [job.service_instructions, job.activity_note].map((n) => n?.trim()).filter((n): n is string => Boolean(n))
  const when = [
    job.technician_name?.trim(),
    job.schedule_date ? formatDate(job.schedule_date) : '',
    job.begin_time || job.end_time ? formatTimeRange(job.begin_time, job.end_time) : '',
    job.wo_number?.trim() ? `WO ${job.wo_number.trim()}` : '',
  ].filter(Boolean)

  return (
    <section data-testid="job-summary" className="space-y-1.5">
      <div className="flex items-start gap-2">
        <JobIcon job={job} size={compact ? 22 : 28} />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={`font-semibold leading-snug text-slate-900 ${compact ? 'text-sm' : 'text-lg'}`}>
            {job.customer_name?.trim() || 'No customer name'}
          </h2>
          <p className={`flex items-start gap-1 text-slate-800 ${compact ? 'text-xs' : 'text-sm'}`} data-testid="summary-address">
            <Icon name="map-pin" size={compact ? 12 : 14} className="mt-0.5 shrink-0 text-slate-500" />
            <span>{address || 'No address'}</span>
          </p>
        </div>
      </div>

      {activities.length ? (
        <p className={`font-medium text-slate-900 ${compact ? 'text-xs' : 'text-sm'}`} data-testid="summary-job">
          {activities.join(' / ')}
        </p>
      ) : null}
      {appliances.length ? (
        <div className="flex flex-wrap gap-1" data-testid="appliance-chips">
          {appliances.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] leading-none text-slate-700">
              {isFireplaceAppliance(name) ? <Icon name="gas-logs" size={12} /> : null}
              {name}
            </span>
          ))}
        </div>
      ) : null}

      {notes.length ? (
        <div
          className={`overflow-auto rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-slate-900 ${
            compact ? 'max-h-24 text-xs' : 'max-h-40 text-sm'
          }`}
          data-testid="summary-notes"
        >
          <p className="text-xs font-semibold text-amber-900">Call notes</p>
          {notes.map((n, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      {when.length ? <p className="text-xs text-slate-600">{when.join(' · ')}</p> : null}
    </section>
  )
}
