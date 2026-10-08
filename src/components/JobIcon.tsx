import { Icon } from './Icon.tsx'
import { GLYPH_COLOR, glyphToneFor, jobIcon } from '../lib/job-icons.ts'
import { isCapacityBlock } from '../lib/schedule.ts'
import { jobPinColor } from '../lib/colors.ts'
import type { JobRow } from '../lib/store.ts'

/**
 * The job-type icon on its tinted chip. The chip color is the activity color;
 * the glyph flips between white and near-black so it always clears 3:1.
 */
export function JobIcon({ job, size = 20 }: { job: JobRow; size?: number }) {
  const info = jobIcon(job)
  const fill = isCapacityBlock(job) ? '#64748b' : jobPinColor(job)
  const glyph = GLYPH_COLOR[glyphToneFor(fill)]
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md"
      style={{ width: size, height: size, backgroundColor: fill, color: glyph }}
      title={info.label}
      data-testid="job-icon"
      data-icon={info.icon}
    >
      <Icon name={info.icon} size={Math.round(size * 0.7)} strokeWidth={2.1} label={info.label} />
    </span>
  )
}
