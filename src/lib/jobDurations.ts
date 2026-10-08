/**
 * Editable wrench-hour estimates for Best Days load scoring.
 *
 * Tweak JOB_DURATION_RULES / DEFAULT_DURATION_HOURS / DEFAULT_SHIFT_HOURS
 * (and TECH_SHIFT_OVERRIDES) here — UI and proximity scoring read through
 * durationHoursForJob / shiftHoursForTech only.
 */

/** Default when no rule matches. */
export const DEFAULT_DURATION_HOURS = 1.0

/** Default shift length when the tech has no override. */
export const DEFAULT_SHIFT_HOURS = 8.0

/**
 * Optional per-tech shift length (hours). Keys are matched case-insensitively
 * after trim; use the display name as shown on the board.
 */
export const TECH_SHIFT_OVERRIDES: Readonly<Record<string, number>> = {
  // Example: 'Chad Taylor': 9,
}

export type JobDurationRule = {
  /** Human label for this bucket (documentation / tests). */
  label: string
  hours: number
  /**
   * Case-insensitive substring needles. A job matches when any haystack
   * string contains any needle. More specific rules must come first.
   */
  contains: readonly string[]
}

/**
 * Locked duration table. Order matters: first match wins.
 * Needles are matched with case-insensitive `includes` on activity codes,
 * template hints, and activity notes.
 */
export const JOB_DURATION_RULES: readonly JobDurationRule[] = [
  {
    label: 'Smell of gas / leak emergency',
    hours: 2.0,
    contains: [
      'smell of gas',
      'gas smell',
      'leak emergency',
      'emergency leak',
      'odor of gas',
      'gas odor',
    ],
  },
  {
    label: 'Underground tank install',
    hours: 4.0,
    contains: [
      'tank install (ug)',
      'tank install ug',
      'underground tank',
      'ug tank install',
      'install ug',
    ],
  },
  {
    label: 'Generator / large appliance install',
    hours: 3.5,
    contains: [
      'generator',
      'large appliance',
      'appliance (install)',
      'appliance install',
    ],
  },
  {
    label: 'Regulator / leak check (non-emergency)',
    hours: 1.5,
    contains: [
      'regulator',
      'leak check',
      'reg hook',
      'reg change',
    ],
  },
  {
    label: 'Tank change-out',
    hours: 3.0,
    contains: [
      'tank change-out',
      'tank change out',
      'tank changeout',
      'tank change',
    ],
  },
  {
    label: 'Above-ground tank set',
    hours: 2.5,
    contains: [
      'tank install (ag)',
      'tank install ag',
      'above-ground tank',
      'above ground tank',
      'ag tank',
      'tank set',
      'tank install',
    ],
  },
  {
    label: 'Line / piping run',
    hours: 2.5,
    contains: [
      'pipe house',
      'piping',
      'line run',
      'gas line',
      'pipe run',
      'run line',
    ],
  },
  {
    label: 'Commercial meter work / inspection',
    hours: 1.5,
    contains: [
      'commercial meter',
      'meter work',
      'meter inspect',
      'meter site',
      'meter installation',
    ],
  },
  {
    label: 'Lock tank / fill / delivery assist',
    hours: 0.5,
    contains: [
      'lock tank',
      'lockout',
      'lock out',
      'fill assist',
      'delivery assist',
      'tank fill',
      'fill tank',
    ],
  },
  {
    label: 'Service call / appliance check',
    hours: 1.0,
    contains: [
      'gas check',
      'service call',
      'appliance check',
      'appliance (convert)',
      'appliance convert',
      'walk thru',
      'walk-thru',
      'walkthrough',
    ],
  },
]

/** Loose job shape accepted by durationHoursForJob (cloud MapJob or Local row). */
export type JobDurationInput = {
  job_activities?: ReadonlyArray<{ activity_code: string; sequence?: number }> | null
  /** Local ADD column / primary activity string. */
  activity_1?: string | null
  /** Local Call Reason 2 / 3 (web puts these in job_activities). */
  activity_2?: string | null
  activity_3?: string | null
  activity_note?: string | null
  job_templates?: {
    name?: string | null
    matches_activity_code?: string | null
  } | null
  is_capacity_block?: boolean | number | null
}

function isCapacity(job: JobDurationInput): boolean {
  const v = job.is_capacity_block
  return v === true || v === 1
}

/** Collect uppercase haystacks used for contains matching. */
export function jobTypeHaystacks(job: JobDurationInput): string[] {
  const out: string[] = []
  const push = (s: string | null | undefined) => {
    const t = s?.replace(/\s+/g, ' ').trim()
    if (t) out.push(t.toUpperCase())
  }
  const acts = [...(job.job_activities ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  )
  for (const a of acts) push(a.activity_code)
  push(job.activity_1)
  push(job.activity_2)
  push(job.activity_3)
  push(job.job_templates?.matches_activity_code)
  push(job.job_templates?.name)
  push(job.activity_note)
  return out
}

/**
 * First matching rule hours, or DEFAULT_DURATION_HOURS.
 * Capacity blocks are 0 (they are not wrench work).
 */
export function durationHoursForJob(job: JobDurationInput): number {
  if (isCapacity(job)) return 0
  const haystacks = jobTypeHaystacks(job)
  if (haystacks.length === 0) return DEFAULT_DURATION_HOURS
  for (const rule of JOB_DURATION_RULES) {
    for (const needle of rule.contains) {
      const n = needle.toUpperCase()
      if (haystacks.some((h) => h.includes(n))) return rule.hours
    }
  }
  return DEFAULT_DURATION_HOURS
}

/** Shift length for a tech (hours). Override map is case-insensitive. */
export function shiftHoursForTech(tech?: string | null): number {
  const key = tech?.trim()
  if (!key) return DEFAULT_SHIFT_HOURS
  const upper = key.toUpperCase()
  for (const [name, hours] of Object.entries(TECH_SHIFT_OVERRIDES)) {
    if (name.trim().toUpperCase() === upper) return hours
  }
  return DEFAULT_SHIFT_HOURS
}

/** Format hours for Best Days rows (trim trailing .0). */
export function formatHours(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Booked-vs-shift level. Near cap above shift − 1h (7h on 8h); Over above shift (8h). */
export type TechLoadLevel = 'ok' | 'near' | 'over'

export const NEAR_CAP_MARGIN_HOURS = 1

/** Text that always rides with the color (never color only). */
export const TECH_LOAD_LEVEL_TEXT: Readonly<Record<TechLoadLevel, string>> = {
  ok: '',
  near: 'Near cap',
  over: 'Over',
}

export function techLoadLevel(bookedHours: number, shiftHours: number): TechLoadLevel {
  if (bookedHours > shiftHours + 1e-9) return 'over'
  if (bookedHours > shiftHours - NEAR_CAP_MARGIN_HOURS + 1e-9) return 'near'
  return 'ok'
}

export type TechDayLoadText = {
  /** `TECH · 5 jobs` (parts left out when name / jobCount are null). */
  prefix: string
  /** `5.5h / 8h` or `5.5h work + 1.2h drive = 6.7h / 8h` when driveHours is set. */
  hours: string
  level: TechLoadLevel
  /** '' | 'Near cap' | 'Over' */
  levelText: string
  /** `TECH · 5 jobs · …hours…` */
  text: string
  /** `text` plus ` · Over` / ` · Near cap` when not ok (titles, aria, plain text). */
  label: string
  /** Total hours used for level (work, or work+drive when drive is included). */
  totalHours: number
}

/**
 * One formatter for tech day load in Calendar and Best days (Local and web),
 * so the two cannot drift: `NICHOLAS PENLEY · 5 jobs · 6.5h / 8h`.
 *
 * Pass `driveHours` (including 0) to include Step 1 drive estimate:
 * `5.5h work + 1.2h drive = 6.7h / 8h`. Amber/red use the full total.
 * Omit `driveHours` (undefined) for the legacy work-only `6.5h / 8h` string.
 */
export function formatTechDayLoad(
  name: string | null,
  jobCount: number | null,
  bookedHours: number,
  shiftHours: number,
  driveHours?: number | null,
): TechDayLoadText {
  const parts: string[] = []
  if (name) parts.push(name)
  if (jobCount != null) parts.push(`${jobCount} job${jobCount === 1 ? '' : 's'}`)
  const prefix = parts.join(' · ')
  const includeDrive = driveHours != null && Number.isFinite(driveHours)
  const drive = includeDrive ? Number(driveHours) : 0
  const totalHours = includeDrive
    ? Math.round((bookedHours + drive) * 10) / 10
    : bookedHours
  const hours = includeDrive
    ? `${formatHours(bookedHours)}h work + ${formatHours(drive)}h drive = ${formatHours(totalHours)}h / ${formatHours(shiftHours)}h`
    : `${formatHours(bookedHours)}h / ${formatHours(shiftHours)}h`
  const level = techLoadLevel(totalHours, shiftHours)
  const levelText = TECH_LOAD_LEVEL_TEXT[level]
  const text = prefix ? `${prefix} · ${hours}` : hours
  return {
    prefix,
    hours,
    level,
    levelText,
    text,
    label: levelText ? `${text} · ${levelText}` : text,
    totalHours,
  }
}
