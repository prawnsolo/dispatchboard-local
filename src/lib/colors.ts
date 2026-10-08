/**
 * Calendar / map schedule chrome for Local.
 * Duplicated from office `src/lib/colors.ts` so Local does not import Supabase types.
 * Local has no schedule `status` column: visual kind is capacity / WO / tentative only
 * (no sky “Scheduled / planned” without inventing cloud-only status).
 */

export type ScheduleVisualKind = 'tentative' | 'scheduled' | 'in_pegasus' | 'capacity'

/** Map ring: movable tentative vs WO / capacity locked. Local has no planned-without-WO. */
export type MapScheduleSignal = 'tentative' | 'scheduled' | 'locked'

export const CALENDAR_KIND_LABEL: Record<ScheduleVisualKind, string> = {
  tentative: 'Tentative',
  scheduled: 'Scheduled',
  in_pegasus: 'In Pegasus',
  capacity: 'Capacity',
}

export const CALENDAR_KIND_CARD_CLASS: Record<ScheduleVisualKind, string> = {
  tentative: 'border-dashed border-amber-400 bg-amber-50/80',
  scheduled: 'border-sky-300 bg-sky-50/70',
  in_pegasus: 'border-slate-300',
  capacity: 'db-capacity border-slate-400 text-slate-700',
}

export const CALENDAR_KIND_DOT_CLASS: Record<ScheduleVisualKind, string> = {
  tentative: 'bg-amber-500',
  scheduled: 'bg-sky-500',
  in_pegasus: 'bg-slate-500',
  capacity: 'bg-slate-700',
}

export const CALENDAR_KIND_LEGEND_CLASS: Record<ScheduleVisualKind, string> = {
  tentative: 'rounded border border-dashed border-amber-400 bg-amber-50 px-1.5 py-px',
  scheduled: 'rounded border border-sky-300 bg-sky-50 px-1.5 py-px',
  in_pegasus: 'rounded border border-slate-300 bg-white px-1.5 py-px',
  capacity: 'db-capacity rounded border border-slate-400 px-1.5 py-px',
}

export const MAP_SCHEDULE_STROKE: Record<MapScheduleSignal, string> = {
  tentative: '#d97706',
  scheduled: '#0284c7',
  locked: '#334155',
}

const ACTIVITY_COLORS: Array<[RegExp, string]> = [
  [/TANK INSTALL/i, '#B45309'],
  [/REGULATOR/i, '#1D4ED8'],
  [/GAS\s*CHECK/i, '#059669'],
  [/LOCK TANK/i, '#DC2626'],
  [/TANK PICK/i, '#EA580C'],
  [/TANK SWAP/i, '#C2410C'],
  [/MONITOR/i, '#7C3AED'],
  [/LAWN GROUNDS|METER/i, '#0F766E'],
  [/APPLIANCE/i, '#6D28D9'],
  [/CATHODIC/i, '#CA8A04'],
  [/PREV MAINT|CLEAN/i, '#0E7490'],
  [/PIPE HOUSE/i, '#0369A1'],
  [/HELPER/i, '#57534E'],
]

function hashColor(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return `hsl(${hue} 55% 38%)`
}

export function primaryActivity(job: {
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
}): string | null {
  const value = job.activity_1?.trim() || job.activity_2?.trim() || job.activity_3?.trim()
  return value || null
}

export function jobPinColor(job: {
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
  card_color?: string | null
}): string {
  const fromTemplate = job.card_color?.trim()
  if (fromTemplate) return fromTemplate
  const activity = primaryActivity(job)
  if (activity) {
    for (const [re, color] of ACTIVITY_COLORS) {
      if (re.test(activity)) return color
    }
    return hashColor(activity)
  }
  return '#334155'
}

export function mapScheduleSignal(job: {
  wo_number?: string | null
  is_capacity_block?: number | boolean | string | null
}): MapScheduleSignal {
  const capacity =
    job.is_capacity_block === true || job.is_capacity_block === 1 || job.is_capacity_block === '1'
  if (capacity) return 'locked'
  const wo = job.wo_number != null && String(job.wo_number).trim() !== ''
  if (!wo) return 'tentative'
  return 'locked'
}

export function mapScheduleStroke(job: {
  wo_number?: string | null
  is_capacity_block?: number | boolean | string | null
}): string {
  return MAP_SCHEDULE_STROKE[mapScheduleSignal(job)]
}

/** Default Field ops palette (same hexes as office TECH_PALETTES.ops). */
export const TECH_COLORS = [
  '#0f766e',
  '#1d4ed8',
  '#b45309',
  '#7c3aed',
  '#be123c',
  '#0e7490',
  '#ca8a04',
  '#4338ca',
] as const

function hashHue(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h
}

export function techAccentColor(techName: string): string {
  const key = techName.trim().toUpperCase()
  if (!key) return TECH_COLORS[0]
  return TECH_COLORS[hashHue(key) % TECH_COLORS.length]!
}

export function techCardTint(techName: string): {
  accent: string
  background: string
  border: string
} {
  const accent = techAccentColor(techName)
  return {
    accent,
    background: `color-mix(in srgb, ${accent} 12%, var(--surface, #fff))`,
    border: `color-mix(in srgb, ${accent} 32%, var(--color-slate-200, #e2e8f0))`,
  }
}

