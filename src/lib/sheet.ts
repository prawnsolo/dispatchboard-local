/**
 * Live sheet for Local jobs. Planning cells save through SQLite.
 * Capacity rows only edit the same fields the job drawer allows.
 * There is no status column on Local jobs.
 */

import { asCoord } from './geocode.ts'

export type SheetColumnKey =
  | 'wo_number'
  | 'customer_name'
  | 'customer_number'
  | 'account_num'
  | 'address_name'
  | 'address_street'
  | 'address_descriptor'
  | 'address_city_state_zip'
  | 'city'
  | 'schedule_date'
  | 'technician_name'
  | 'begin_time'
  | 'end_time'
  | 'activity_1'
  | 'zone_code'
  | 'lat'
  | 'lng'
  | 'mismatch_flag'
  | 'activity_note'
  | 'service_instructions'

export type SheetCellKind = 'text' | 'date' | 'time' | 'checkbox' | 'number'

export type SheetColumn = {
  key: SheetColumnKey
  label: string
  kind: SheetCellKind
  editable: boolean
  minWidth: number
}

export const SHEET_COLUMNS: SheetColumn[] = [
  { key: 'wo_number', label: 'WO', kind: 'text', editable: false, minWidth: 72 },
  { key: 'customer_name', label: 'Customer', kind: 'text', editable: true, minWidth: 140 },
  { key: 'customer_number', label: 'Cust #', kind: 'text', editable: true, minWidth: 80 },
  { key: 'account_num', label: 'Account', kind: 'text', editable: true, minWidth: 90 },
  { key: 'address_name', label: 'Addr name', kind: 'text', editable: true, minWidth: 110 },
  { key: 'address_street', label: 'Street', kind: 'text', editable: true, minWidth: 140 },
  { key: 'address_descriptor', label: 'Descriptor', kind: 'text', editable: true, minWidth: 110 },
  { key: 'address_city_state_zip', label: 'City ST ZIP', kind: 'text', editable: true, minWidth: 140 },
  { key: 'city', label: 'City', kind: 'text', editable: true, minWidth: 90 },
  { key: 'schedule_date', label: 'Date', kind: 'date', editable: true, minWidth: 118 },
  { key: 'technician_name', label: 'Tech', kind: 'text', editable: true, minWidth: 120 },
  { key: 'begin_time', label: 'Begin', kind: 'time', editable: true, minWidth: 92 },
  { key: 'end_time', label: 'End', kind: 'time', editable: true, minWidth: 92 },
  { key: 'activity_1', label: 'Activity', kind: 'text', editable: true, minWidth: 150 },
  { key: 'zone_code', label: 'Zone', kind: 'text', editable: true, minWidth: 80 },
  { key: 'lat', label: 'Lat', kind: 'number', editable: true, minWidth: 88 },
  { key: 'lng', label: 'Lng', kind: 'number', editable: true, minWidth: 88 },
  { key: 'mismatch_flag', label: '≠', kind: 'checkbox', editable: true, minWidth: 44 },
  { key: 'activity_note', label: 'Notes', kind: 'text', editable: true, minWidth: 180 },
  { key: 'service_instructions', label: 'Instructions', kind: 'text', editable: true, minWidth: 160 },
]

/** Fields the capacity drawer already edits, including activity 1 (part of the capacity key). */
export const SHEET_CAPACITY_KEYS = new Set<SheetColumnKey>([
  'customer_name',
  'technician_name',
  'schedule_date',
  'begin_time',
  'end_time',
  'activity_1',
])

/** Planning strings written through the existing job save. */
export const SHEET_DRAFT_KEYS = [
  'customer_name',
  'customer_number',
  'account_num',
  'address_name',
  'address_street',
  'address_descriptor',
  'address_city_state_zip',
  'city',
  'schedule_date',
  'technician_name',
  'begin_time',
  'end_time',
  'activity_1',
  'activity_note',
  'service_instructions',
] as const

export type SheetDraftKey = (typeof SHEET_DRAFT_KEYS)[number]

export type SheetPatch = {
  customer_name?: string
  customer_number?: string
  account_num?: string
  address_name?: string
  address_street?: string
  address_descriptor?: string
  address_city_state_zip?: string
  city?: string
  schedule_date?: string
  technician_name?: string
  begin_time?: string
  end_time?: string
  activity_1?: string
  activity_note?: string
  service_instructions?: string
  zone_code?: string
  lat?: number | null
  lng?: number | null
  mismatch_flag?: boolean
}

export type SheetJob = {
  id: number
  wo_number: string | null
  is_capacity_block: number | boolean
  technician_name: string | null
  customer_number: string | null
  customer_name: string
  account_num: string | null
  zone_code: string | null
  service_zone: string | null
  city: string | null
  schedule_date: string | null
  begin_time: string | null
  end_time: string | null
  activity_1: string | null
  address_name: string | null
  address_street: string | null
  address_descriptor: string | null
  address_city_state_zip: string | null
  activity_note: string | null
  service_instructions: string | null
  lat: number | string | null
  lng: number | string | null
  mismatch_flag: number | boolean
}

export type SheetSortDir = 'asc' | 'desc'

export type SheetSort = {
  key: SheetColumnKey
  dir: SheetSortDir
}

export type SheetFilterOpts = {
  includeCapacity: boolean
  technician?: string
  zone?: string
}

function isCapacity(job: { is_capacity_block: number | boolean }): boolean {
  return job.is_capacity_block === true || job.is_capacity_block === 1
}

export function isSheetCellEditable(job: { is_capacity_block: number | boolean }, column: SheetColumn): boolean {
  if (!column.editable) return false
  if (isCapacity(job)) return SHEET_CAPACITY_KEYS.has(column.key)
  return true
}

export function timeToInput(value: string | null | undefined): string {
  if (!value) return ''
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return value.trim()
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

export function sheetDisplayValue(job: SheetJob, column: SheetColumn): string {
  switch (column.key) {
    case 'wo_number':
      return isCapacity(job) ? '' : (job.wo_number ?? '')
    case 'customer_name':
      return job.customer_name ?? ''
    case 'customer_number':
      return job.customer_number ?? ''
    case 'account_num':
      return job.account_num ?? ''
    case 'address_name':
      return job.address_name ?? ''
    case 'address_street':
      return job.address_street ?? ''
    case 'address_descriptor':
      return job.address_descriptor ?? ''
    case 'address_city_state_zip':
      return job.address_city_state_zip ?? ''
    case 'city':
      return job.city ?? ''
    case 'schedule_date':
      return job.schedule_date ?? ''
    case 'technician_name':
      return job.technician_name ?? ''
    case 'begin_time':
      return timeToInput(job.begin_time)
    case 'end_time':
      return timeToInput(job.end_time)
    case 'activity_1':
      return job.activity_1 ?? ''
    case 'zone_code':
      return job.zone_code ?? ''
    case 'lat': {
      const n = asCoord(job.lat)
      return n == null ? '' : String(n)
    }
    case 'lng': {
      const n = asCoord(job.lng)
      return n == null ? '' : String(n)
    }
    case 'mismatch_flag':
      return job.mismatch_flag ? 'Y' : ''
    case 'activity_note':
      return job.activity_note ?? ''
    case 'service_instructions':
      return job.service_instructions ?? ''
    default:
      return ''
  }
}

export function parseSheetCell(
  column: SheetColumn,
  raw: string,
): { ok: true; patch: SheetPatch } | { ok: false; error: string } {
  const trimmed = raw.trim()
  switch (column.key) {
    case 'wo_number':
      return { ok: false, error: 'Work order number is not edited on the sheet.' }
    case 'mismatch_flag': {
      const on = trimmed === '1' || ['y', 'yes', 'true'].includes(trimmed.toLowerCase())
      const off = trimmed === '' || trimmed === '0' || ['n', 'no', 'false'].includes(trimmed.toLowerCase())
      if (!on && !off) return { ok: false, error: 'Mismatch must be Y or N.' }
      return { ok: true, patch: { mismatch_flag: on } }
    }
    case 'lat':
    case 'lng': {
      if (!trimmed) return { ok: true, patch: { [column.key]: null } }
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return { ok: false, error: `${column.label} must be a number.` }
      if (column.key === 'lat' && (n < -90 || n > 90)) return { ok: false, error: 'Latitude must be between −90 and 90.' }
      if (column.key === 'lng' && (n < -180 || n > 180)) return { ok: false, error: 'Longitude must be between −180 and 180.' }
      return { ok: true, patch: { [column.key]: n } }
    }
    case 'customer_name':
      if (!trimmed) return { ok: false, error: 'Customer name is required.' }
      return { ok: true, patch: { customer_name: trimmed } }
    case 'schedule_date':
      if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { ok: false, error: 'Date must be YYYY-MM-DD.' }
      }
      return { ok: true, patch: { schedule_date: trimmed } }
    case 'begin_time':
    case 'end_time':
      if (trimmed && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
        return { ok: false, error: `${column.label} must be HH:MM.` }
      }
      return { ok: true, patch: { [column.key]: trimmed } }
    case 'customer_number':
      return { ok: true, patch: { customer_number: trimmed } }
    case 'account_num':
      return { ok: true, patch: { account_num: trimmed } }
    case 'address_name':
      return { ok: true, patch: { address_name: trimmed } }
    case 'address_street':
      return { ok: true, patch: { address_street: trimmed } }
    case 'address_descriptor':
      return { ok: true, patch: { address_descriptor: trimmed } }
    case 'address_city_state_zip':
      return { ok: true, patch: { address_city_state_zip: trimmed } }
    case 'city':
      return { ok: true, patch: { city: trimmed } }
    case 'technician_name':
      return { ok: true, patch: { technician_name: trimmed } }
    case 'activity_1':
      return { ok: true, patch: { activity_1: trimmed } }
    case 'zone_code':
      return { ok: true, patch: { zone_code: trimmed } }
    case 'activity_note':
      return { ok: true, patch: { activity_note: trimmed } }
    case 'service_instructions':
      return { ok: true, patch: { service_instructions: trimmed } }
    default:
      return { ok: false, error: 'Unknown column.' }
  }
}

export function filterSheetJobs<T extends SheetJob>(jobs: T[], opts: SheetFilterOpts): T[] {
  const technician = opts.technician ?? ''
  const zone = opts.zone ?? ''
  return jobs.filter((job) => {
    if (!opts.includeCapacity && isCapacity(job)) return false
    if (technician && (job.technician_name ?? '') !== technician) return false
    if (zone && (job.zone_code ?? '') !== zone) return false
    return true
  })
}

export function compareSheetDefault(a: SheetJob, b: SheetJob): number {
  const date = (a.schedule_date ?? '').localeCompare(b.schedule_date ?? '')
  if (date) return date
  const tech = (a.technician_name ?? '').localeCompare(b.technician_name ?? '')
  if (tech) return tech
  const begin = (a.begin_time ?? '').localeCompare(b.begin_time ?? '')
  if (begin) return begin
  return a.customer_name.localeCompare(b.customer_name)
}

export function nextSheetSort(current: SheetSort | null, key: SheetColumnKey): SheetSort {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: 'asc' }
}

function columnByKey(key: SheetColumnKey): SheetColumn {
  return SHEET_COLUMNS.find((column) => column.key === key) ?? SHEET_COLUMNS[0]!
}

function compareDirected(aRaw: string, bRaw: string, dir: SheetSortDir, numeric: boolean): number {
  const aEmpty = aRaw.trim() === ''
  const bEmpty = bRaw.trim() === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  const cmp = aRaw.localeCompare(bRaw, undefined, { numeric, sensitivity: 'base' })
  return dir === 'desc' ? -cmp : cmp
}

export function sortSheetJobs<T extends SheetJob>(jobs: T[], sort: SheetSort | null): T[] {
  const rows = jobs.slice()
  if (!sort) return rows.sort(compareSheetDefault)
  const column = columnByKey(sort.key)
  return rows.sort((a, b) => {
    let cmp = 0
    if (sort.key === 'lat' || sort.key === 'lng') {
      const av = asCoord(a[sort.key])
      const bv = asCoord(b[sort.key])
      if (av == null && bv == null) cmp = 0
      else if (av == null) cmp = 1
      else if (bv == null) cmp = -1
      else cmp = sort.dir === 'desc' ? bv - av : av - bv
    } else if (sort.key === 'mismatch_flag') {
      cmp = Number(Boolean(a.mismatch_flag)) - Number(Boolean(b.mismatch_flag))
      if (sort.dir === 'desc') cmp = -cmp
    } else {
      const numeric = sort.key === 'wo_number' || column.kind === 'date' || column.kind === 'time'
      cmp = compareDirected(sheetDisplayValue(a, column), sheetDisplayValue(b, column), sort.dir, numeric)
    }
    if (cmp) return cmp
    return compareSheetDefault(a, b)
  })
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Snapshot of the rows currently on screen, using the visible column labels. */
export function sheetCsv(jobs: SheetJob[], columns: SheetColumn[] = SHEET_COLUMNS): string {
  const header = columns.map((column) => csvEscape(column.label)).join(',')
  const lines = jobs.map((job) => columns.map((column) => csvEscape(sheetDisplayValue(job, column))).join(','))
  return [header, ...lines].join('\n')
}

export function uniqueSheetValues(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}
