import * as XLSXMod from 'xlsx'

/**
 * Stage-1 ADD column mapping.
 *
 * Same 18 PDR headers and cell rules as `src/lib/import/parse.ts`:
 * Excel serial dates, day-fraction times, WO 0 = capacity, address split on `/`.
 * Geocoding runs after Apply in the desktop app. This parser does not call Census.
 */

const XLSX = (XLSXMod as { default?: typeof XLSXMod }).default ?? XLSXMod

export const PDR_HEADERS = [
  'Technician',
  'Customer #',
  'Customer Name',
  'Service Zone',
  'Service City/Town',
  'Service Location #',
  'WO Number',
  'Schedule Date',
  'Scheduled Begin Time',
  'Scheduled Completion Time',
  'Call Reason 1/ Activity',
  'Call Reason 2',
  'Call Reason 3',
  'Service Address',
  'Service Instructions',
  'Service Location Definition',
  'Call/Activity Note',
  'ACCOUNT_NUM',
] as const

export type PdrHeader = (typeof PDR_HEADERS)[number]

/** Where each ADD column lands. The import screen and README both use this list. */
export const SUPPORTED_COLUMNS: ReadonlyArray<{ column: PdrHeader; storedAs: string }> = [
  { column: 'Technician', storedAs: 'jobs.technician_name (capacity match key)' },
  { column: 'Customer #', storedAs: 'jobs.customer_number, sites.customer_number' },
  { column: 'Customer Name', storedAs: 'jobs.customer_name, sites.customer_name' },
  { column: 'Service Zone', storedAs: 'jobs.service_zone; code before " - " → zone_code' },
  { column: 'Service City/Town', storedAs: 'jobs.city, sites.city' },
  { column: 'Service Location #', storedAs: 'jobs.service_location_number, sites.service_location_number' },
  { column: 'WO Number', storedAs: 'jobs.wo_number; 0 → capacity block (null WO)' },
  { column: 'Schedule Date', storedAs: 'jobs.schedule_date (YYYY-MM-DD)' },
  { column: 'Scheduled Begin Time', storedAs: 'jobs.begin_time (HH:MM:SS; capacity match key)' },
  { column: 'Scheduled Completion Time', storedAs: 'jobs.end_time (HH:MM:SS)' },
  { column: 'Call Reason 1/ Activity', storedAs: 'jobs.activity_1 (capacity match key)' },
  { column: 'Call Reason 2', storedAs: 'jobs.activity_2' },
  { column: 'Call Reason 3', storedAs: 'jobs.activity_3' },
  {
    column: 'Service Address',
    storedAs: 'split on / → address_name, address_street, address_descriptor, address_city_state_zip; full text in address_raw',
  },
  { column: 'Service Instructions', storedAs: 'jobs.service_instructions' },
  { column: 'Service Location Definition', storedAs: 'jobs.location_definition' },
  { column: 'Call/Activity Note', storedAs: 'jobs.activity_note' },
  { column: 'ACCOUNT_NUM', storedAs: 'jobs.account_num, sites.account_num' },
]

export type ParsedAddress = {
  raw: string
  name: string | null
  street: string | null
  descriptor: string | null
  cityStateZip: string | null
}

export type ParsedRow = {
  technicianName: string | null
  customerNumber: string | null
  customerName: string
  accountNum: string | null
  serviceZone: string | null
  zoneCode: string | null
  city: string | null
  serviceLocationNumber: number | null
  woNumber: string | null
  isCapacity: boolean
  capacityKey: string | null
  scheduleDate: string | null
  beginTime: string | null
  endTime: string | null
  activity1: string | null
  activity2: string | null
  activity3: string | null
  address: ParsedAddress
  serviceInstructions: string | null
  locationDefinition: string | null
  activityNote: string | null
}

export type HeaderMismatch = { index: number; expected: string; got: string }

export type HeaderCheck =
  | { ok: true; headers: string[] }
  | {
      ok: false
      message: string
      missing: string[]
      extra: string[]
      mismatches: HeaderMismatch[]
    }

export function cellStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) {
      return String(Math.round(v))
    }
    return String(v)
  }
  if (typeof v === 'string') {
    const trimmed = v.trim()
    // CSV often keeps Excel integers as "90000.0". Real .xls cells arrive as numbers.
    if (/^-?\d+\.0+$/.test(trimmed)) return String(Math.round(Number(trimmed)))
    return v
  }
  return String(v)
}

function nullIfEmpty(s: string): string | null {
  const t = s.trim()
  return t.length ? t : null
}

/** Split on `/` into ≤4 parts; extras join into the last part. */
export function parseAddress(raw: string): ParsedAddress {
  const trimmed = raw ?? ''
  const parts = trimmed.split('/')
  const capped = parts.length <= 4 ? parts : [...parts.slice(0, 3), parts.slice(3).join('/')]
  while (capped.length < 4) capped.push('')
  return {
    raw: trimmed,
    name: nullIfEmpty(capped[0] ?? ''),
    street: nullIfEmpty(capped[1] ?? ''),
    descriptor: nullIfEmpty(capped[2] ?? ''),
    cityStateZip: nullIfEmpty(capped[3] ?? ''),
  }
}

function parseZoneCode(serviceZone: string): string | null {
  const m = serviceZone.trim().match(/^([A-Za-z0-9-]+)\s*-/)
  return m ? m[1]! : nullIfEmpty(serviceZone)
}

/** Code before ` - `, or the whole zone string when there is no separator. */
export function zoneCodeFromServiceZone(serviceZone: string | null | undefined): string | null {
  if (serviceZone == null || serviceZone.trim() === '') return null
  return parseZoneCode(serviceZone)
}

/** Excel 1900-date-system serial → YYYY-MM-DD (UTC calendar day). */
export function excelSerialToDate(serial: number): string {
  const whole = Math.floor(serial)
  const ms = Date.UTC(1899, 11, 30) + whole * 86400000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Day fraction → HH:MM:SS */
export function excelFractionToTime(frac: number): string {
  let total = Math.round(frac * 86400)
  if (total < 0) total = 0
  if (total >= 86400) total = 86399
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function parseWo(raw: unknown): { woNumber: string | null; isCapacity: boolean } {
  if (raw == null || raw === '') return { woNumber: null, isCapacity: false }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) {
    const s = cellStr(raw).trim()
    if (s === '0') return { woNumber: null, isCapacity: true }
    return { woNumber: s || null, isCapacity: false }
  }
  if (Math.abs(n) < 1e-9) return { woNumber: null, isCapacity: true }
  return { woNumber: String(Math.round(n)), isCapacity: false }
}

function parseOptionalNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

function parseDateCell(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof raw === 'number') return excelSerialToDate(raw)
  const s = String(raw).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s))
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function parseTimeCell(raw: unknown): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const h = String(raw.getHours()).padStart(2, '0')
    const m = String(raw.getMinutes()).padStart(2, '0')
    const s = String(raw.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  }
  if (typeof raw === 'number') return excelFractionToTime(raw)
  const s = String(raw).trim()
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n >= 0 && n < 1.5) return excelFractionToTime(n)
  }
  if (/^\d{1,2}:\d{2}/.test(s)) {
    const parts = s.split(':')
    const h = parts[0]!.padStart(2, '0')
    const m = (parts[1] ?? '00').padStart(2, '0')
    const sec = (parts[2] ?? '00').padStart(2, '0')
    return `${h}:${m}:${sec.slice(0, 2)}`
  }
  return null
}

export function capacityKeyFor(parts: {
  isCapacity: boolean
  technicianName: string | null
  scheduleDate: string | null
  beginTime: string | null
  activity1: string | null
}): string | null {
  if (!parts.isCapacity) return null
  return [parts.technicianName ?? '', parts.scheduleDate ?? '', parts.beginTime ?? '', parts.activity1 ?? ''].join('|')
}

export function rowFromRecord(rec: Record<string, unknown>): ParsedRow {
  const { woNumber, isCapacity } = parseWo(rec['WO Number'])
  const serviceZone = cellStr(rec['Service Zone'])
  const address = parseAddress(cellStr(rec['Service Address']))
  const activity1 = nullIfEmpty(cellStr(rec['Call Reason 1/ Activity']))
  const activity2 = nullIfEmpty(cellStr(rec['Call Reason 2']))
  const activity3 = nullIfEmpty(cellStr(rec['Call Reason 3']))
  const technicianName = nullIfEmpty(cellStr(rec['Technician']))
  const scheduleDate = parseDateCell(rec['Schedule Date'])
  const beginTime = parseTimeCell(rec['Scheduled Begin Time'])
  const customerName =
    nullIfEmpty(cellStr(rec['Customer Name'])) ?? (isCapacity ? (activity1 ?? 'Capacity') : 'UNKNOWN')

  return {
    technicianName,
    customerNumber: nullIfEmpty(cellStr(rec['Customer #'])),
    customerName,
    accountNum: nullIfEmpty(cellStr(rec['ACCOUNT_NUM'])),
    serviceZone: nullIfEmpty(serviceZone),
    zoneCode: parseZoneCode(serviceZone),
    city: nullIfEmpty(cellStr(rec['Service City/Town'])),
    serviceLocationNumber: parseOptionalNumber(rec['Service Location #']),
    woNumber,
    isCapacity,
    capacityKey: capacityKeyFor({ isCapacity, technicianName, scheduleDate, beginTime, activity1 }),
    scheduleDate,
    beginTime,
    endTime: parseTimeCell(rec['Scheduled Completion Time']),
    activity1,
    activity2,
    activity3,
    address,
    serviceInstructions: nullIfEmpty(cellStr(rec['Service Instructions'])),
    locationDefinition: nullIfEmpty(cellStr(rec['Service Location Definition'])),
    activityNote: nullIfEmpty(cellStr(rec['Call/Activity Note'])),
  }
}

/** Trim trailing empty header cells (CSV/Excel often pads). */
export function normalizeHeaderRow(headers: unknown[]): string[] {
  const raw = headers.map((h) => cellStr(h).trim())
  let end = raw.length
  while (end > 0 && raw[end - 1] === '') end--
  return raw.slice(0, end)
}

export function checkHeaders(headers: string[]): HeaderCheck {
  const file = normalizeHeaderRow(headers)
  const expected = [...PDR_HEADERS]
  const missing = expected.filter((h) => !file.includes(h))
  const extra = file.filter((h) => !expected.includes(h as PdrHeader))
  const mismatches: HeaderMismatch[] = []
  const n = Math.max(file.length, expected.length)
  for (let i = 0; i < n; i++) {
    const exp = expected[i]
    const got = file[i]
    if (exp !== got) mismatches.push({ index: i, expected: exp ?? '(none)', got: got ?? '(none)' })
  }

  if (missing.length === 0 && extra.length === 0 && file.length === expected.length) {
    if (expected.every((h, i) => file[i] === h)) return { ok: true, headers: file }
  }

  const parts: string[] = ['ADD header check failed — file must match the PDR 18 columns exactly.']
  if (missing.length) parts.push(`Missing columns: ${missing.join(', ')}`)
  if (extra.length) parts.push(`Extra columns: ${extra.join(', ')}`)
  if (mismatches.length) {
    const sample = mismatches
      .slice(0, 6)
      .map((m) => `col ${m.index} expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.got)}`)
      .join('; ')
    parts.push(missing.length || extra.length || file.length !== expected.length ? sample : `Column order is wrong: ${sample}`)
  }
  return { ok: false, message: parts.join(' '), missing, extra, mismatches }
}

export function recordsFromMatrix(matrix: Array<Array<string | number | boolean | Date | null | undefined>>): ParsedRow[] {
  if (!matrix.length) throw new Error('Sheet is empty')
  const headerRow = normalizeHeaderRow(matrix[0] ?? [])
  const check = checkHeaders(headerRow)
  if (!check.ok) throw new Error(check.message)
  const rows: ParsedRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? []
    const empty = PDR_HEADERS.every((_, i) => cellStr(row[i] ?? '').trim() === '')
    if (empty) continue
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < PDR_HEADERS.length; i++) rec[PDR_HEADERS[i]!] = row[i] ?? ''
    rows.push(rowFromRecord(rec))
  }
  return rows
}

export function recordsFromBytes(data: ArrayBuffer | Uint8Array): ParsedRow[] {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  const wb = XLSX.read(u8, { type: 'array', cellDates: false, raw: true })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Workbook has no sheets')
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error('Workbook has no sheets')
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(ws, {
    header: 1,
    defval: '',
    raw: true,
  })
  return recordsFromMatrix(matrix)
}

export function summarize(rows: ParsedRow[]): {
  rows: number
  jobs: number
  capacity: number
  dates: string[]
} {
  let jobs = 0
  let capacity = 0
  const dates = new Set<string>()
  for (const row of rows) {
    if (row.isCapacity) capacity++
    else jobs++
    if (row.scheduleDate) dates.add(row.scheduleDate)
  }
  return { rows: rows.length, jobs, capacity, dates: [...dates].sort() }
}
