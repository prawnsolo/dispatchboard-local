import { Icon } from './Icon.tsx'
import { JobIcon } from './JobIcon.tsx'
import { isFireplaceAppliance, locationAppliances } from '../lib/job-icons.ts'
import type { JobRow } from '../lib/store.ts'

/** Job-type icon, the activity text, and what is at the house as small chips. */
export function ActivityCell({ job }: { job: JobRow }) {
  const appliances = locationAppliances(job.location_definition)
  return (
    <div className="flex items-start gap-2">
      <JobIcon job={job} size={22} />
      <div className="min-w-0">
        <div className="leading-tight">{job.activity_1 ?? '—'}</div>
        {appliances.length ? (
          <div className="mt-1 flex flex-wrap gap-1" data-testid="appliance-chips">
            {appliances.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] leading-none text-slate-600"
              >
                {isFireplaceAppliance(name) ? <Icon name="gas-logs" size={12} /> : null}
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
