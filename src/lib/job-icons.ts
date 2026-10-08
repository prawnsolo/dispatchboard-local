/**
 * Job-type icons. One place decides which glyph a job gets, so the map, the
 * calendar, the Jobs list and the Sheet always agree. See docs/UI_UX_PLAN.md
 * section 2 for the reasoning.
 *
 * The main icon comes from the activity (call reason). The location definition
 * ("what is at the house") never picks the main icon, with one exception: a
 * maintenance or cleaning call at a house with a fireplace or gas logs.
 */

import type { IconName } from './icon-paths.ts'

export type JobIconInfo = {
  icon: IconName
  /** Short plain label for tooltips and screen readers. */
  label: string
  /** False when nothing matched and the wrench fallback was used. */
  known: boolean
}

type ActivityFields = {
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
  location_definition?: string | null
  activity_note?: string | null
}

const FIREPLACE = /fire\s?place|gas\s?logs?/i

const RULES: Array<[RegExp, IconName, string]> = [
  [/^PTO\b/i, 'tree-palm', 'Time off'],
  [/^HOLIDAY/i, 'calendar-off', 'Holiday'],
  [/^TRAINING/i, 'graduation-cap', 'Training'],
  [/TANK INSTALL\s*\(UG\)/i, 'tank-ug', 'Tank install, underground'],
  [/TANK INSTALL/i, 'tank', 'Tank install'],
  [/TANK SWAP/i, 'tank', 'Tank swap'],
  [/TANK PICK/i, 'truck', 'Tank pick up'],
  [/LOCK TANK/i, 'lock', 'Lock tank'],
  [/GAS\s+CHECK/i, 'flame-check', 'Gas check'],
  [/REGULATOR/i, 'gauge', 'Regulator'],
  [/MONITOR/i, 'radio', 'Tank monitor'],
  [/CATHODIC/i, 'zap', 'Cathodic test'],
  [/PIPE HOUSE/i, 'pipe', 'Pipe house'],
  [/APPLIANCE/i, 'cooking-pot', 'Appliance'],
  [/LAWN|GROUNDS/i, 'sprout', 'Grounds'],
  [/HELPER/i, 'users', 'Helper'],
  [/PREV MAINT|CLEAN/i, 'wrench', 'Maintenance'],
]

function firstActivity(job: ActivityFields): string {
  return (job.activity_1?.trim() || job.activity_2?.trim() || job.activity_3?.trim() || '').replace(/\s+/g, ' ')
}

export function isMaintenanceCall(activity: string): boolean {
  return /PREV MAINT|CLEAN/i.test(activity)
}

/** Gas logs: maintenance or cleaning at a house with a fireplace or gas logs. */
export function isFireplaceCleaning(job: ActivityFields): boolean {
  const activity = firstActivity(job)
  if (!isMaintenanceCall(activity)) return false
  return FIREPLACE.test(job.location_definition ?? '') || FIREPLACE.test(job.activity_note ?? '')
}

export function jobIcon(job: ActivityFields): JobIconInfo {
  if (isFireplaceCleaning(job)) return { icon: 'gas-logs', label: 'Fireplace or gas log cleaning', known: true }
  const activity = firstActivity(job)
  for (const [re, icon, label] of RULES) {
    if (re.test(activity)) return { icon, label, known: true }
  }
  return { icon: 'wrench', label: activity ? activity : 'Job', known: false }
}

/** Appliances listed for the house, as short title-case words. */
export function locationAppliances(definition: string | null | undefined): string[] {
  if (!definition) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of definition.split(',')) {
    const name = part.trim().toLowerCase()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name.replace(/\b\w/g, (c) => c.toUpperCase()))
  }
  return out
}

export function isFireplaceAppliance(name: string): boolean {
  return FIREPLACE.test(name)
}

/* Glyph color on a pin disc. White on dark fills, near-black on light fills,
   chosen by contrast so the glyph clears 3:1 against any pin color. */

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

export function parseCssColor(input: string): [number, number, number] | null {
  const s = input.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const hsl = /^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i.exec(s)
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100)
  return null
}

export function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/** 'light' = white glyph, 'dark' = near-black glyph. */
export function glyphToneFor(fill: string): 'light' | 'dark' {
  const rgb = parseCssColor(fill)
  if (!rgb) return 'light'
  const l = luminance(rgb)
  // White reads cleaner on mid tones, so prefer it whenever it clears 3:1.
  return contrastRatio(1, l) >= 3 ? 'light' : 'dark'
}

export const GLYPH_COLOR = { light: '#ffffff', dark: '#111827' } as const
