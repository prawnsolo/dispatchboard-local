import { capacityKeyFor, zoneCodeFromServiceZone, type ParsedRow } from './add.ts'
import type { CachedDriveTimes, DriveLeg, DriveTimeCacheStore } from './drive-times.ts'
import { asCoord, normalizeAddressKey, type GeocodeResult, type GeocodeSource } from './geocode.ts'
import {
  evaluateMismatch,
  findDuplicateMismatchRule,
  parseMismatchRuleDraft,
  sortMismatchRules,
  type MismatchRule,
  type MismatchRuleDraft,
} from './mismatch.ts'
import { canDragJob } from './schedule.ts'
import {
  canPromoteBacklog,
  isBacklogPriority,
  isBacklogStatus,
  isBacklogType,
  promoteActivityCode,
  type BacklogDraft,
  type BacklogItem,
  type BacklogType,
} from './backlog.ts'
import { SHEET_CAPACITY_KEYS, SHEET_DRAFT_KEYS, type SheetPatch } from './sheet.ts'
import { itemsToCopyFromTemplate, parseTemplateDraft, sortTemplateItems, suggestTemplateId, type TemplateDraft } from './templates.ts'
import { ENABLE_JOB_CREATE } from './features.ts'

/**
 * On-disk schema: jobs + sites, stage 3 geocode columns and geocode_cache,
 * stage 4 mismatch rules, templates, checklist items, and drive_time_cache,
 * stage 5 backlog_items. ADD import never writes backlog.
 * Older databases are migrated in place (ADD COLUMN / CREATE TABLE IF NOT
 * EXISTS). Apply inserts new work orders and, when updateMatched is on,
 * overwrites a row with the same WO number (or the same capacity key when
 * WO is 0). Import never deletes. Mismatch flags are advisory.
 *
 * Statements are not wrapped in BEGIN/COMMIT. The Tauri SQL plugin runs each
 * call on a pooled connection, so a SQL transaction would not stay on one
 * connection. A failed apply can be re-run; matched rows update in place.
 * Inserts read `lastInsertId` from that statement's own result.
 */

export type SqlExecResult = { lastInsertId: number | null }

export type SqlDb = {
  execute(sql: string, params?: readonly unknown[]): Promise<SqlExecResult>
  select<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
}

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wo_number TEXT,
    capacity_key TEXT,
    is_capacity_block INTEGER NOT NULL DEFAULT 0,
    technician_name TEXT,
    customer_number TEXT,
    customer_name TEXT NOT NULL,
    account_num TEXT,
    service_zone TEXT,
    zone_code TEXT,
    city TEXT,
    service_location_number INTEGER,
    schedule_date TEXT,
    begin_time TEXT,
    end_time TEXT,
    activity_1 TEXT,
    activity_2 TEXT,
    activity_3 TEXT,
    address_raw TEXT,
    address_name TEXT,
    address_street TEXT,
    address_descriptor TEXT,
    address_city_state_zip TEXT,
    service_instructions TEXT,
    location_definition TEXT,
    activity_note TEXT,
    mismatch_flag INTEGER NOT NULL DEFAULT 0,
    mismatch_note TEXT,
    template_id INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (wo_number),
    UNIQUE (capacity_key)
  )`,
  `CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_number TEXT NOT NULL,
    service_location_number INTEGER NOT NULL DEFAULT 0,
    customer_name TEXT,
    account_num TEXT,
    zone_code TEXT,
    city TEXT,
    address_raw TEXT,
    address_street TEXT,
    address_city_state_zip TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (customer_number, service_location_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_schedule_date ON jobs (schedule_date)`,
] as const

const GEOCODE_CACHE_SQL = `CREATE TABLE IF NOT EXISTS geocode_cache (
  address_key TEXT PRIMARY KEY,
  address_street TEXT,
  address_city_state_zip TEXT,
  lat REAL,
  lng REAL,
  geocode_source TEXT NOT NULL,
  matched_address TEXT,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

const JOB_GEO_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['lat', 'REAL'],
  ['lng', 'REAL'],
  ['geocode_source', "TEXT NOT NULL DEFAULT 'none'"],
  ['geocode_address_key', 'TEXT'],
]

const SITE_GEO_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['lat', 'REAL'],
  ['lng', 'REAL'],
  ['pin_source', 'TEXT'],
]

const JOB_STAGE4_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['mismatch_flag', 'INTEGER NOT NULL DEFAULT 0'],
  ['mismatch_note', 'TEXT'],
  ['template_id', 'INTEGER'],
]

const STAGE4_TABLES = [
  `CREATE TABLE IF NOT EXISTS mismatch_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_reason_pattern TEXT NOT NULL,
    conflicting_keyword TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (call_reason_pattern, conflicting_keyword)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mismatch_rules_active ON mismatch_rules (active)`,
  `CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    matches_activity_code TEXT,
    card_color TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS template_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 1,
    UNIQUE (template_id, sequence),
    UNIQUE (template_id, label)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_template_items_template ON template_checklist_items (template_id)`,
  `CREATE TABLE IF NOT EXISTS job_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    template_checklist_item_id INTEGER,
    label TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 1,
    is_checked INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_checklist_job ON job_checklist_items (job_id)`,
  `CREATE TABLE IF NOT EXISTS drive_time_cache (
    technician_name TEXT NOT NULL,
    schedule_date TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    include_yard INTEGER NOT NULL DEFAULT 1,
    legs_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (technician_name, schedule_date)
  )`,
] as const

const STAGE5_BACKLOG_SQL = [
  `CREATE TABLE IF NOT EXISTS backlog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backlog_type TEXT NOT NULL CHECK (backlog_type IN ('tank_pickup', 'lockout', 'monitor_swap', 'meter_site')),
    campaign TEXT,
    customer_number TEXT,
    customer_name TEXT,
    address_raw TEXT,
    address_street TEXT,
    address_city_state_zip TEXT,
    lat REAL,
    lng REAL,
    geocode_source TEXT NOT NULL DEFAULT 'none',
    zone_code TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'promoted', 'complete', 'cancelled')),
    promoted_job_id INTEGER,
    notes TEXT,
    source_list TEXT,
    last_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_type_status ON backlog_items (backlog_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_promoted_job ON backlog_items (promoted_job_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS backlog_open_lockout_customer_uidx
     ON backlog_items (customer_number)
     WHERE backlog_type = 'lockout' AND status = 'open' AND customer_number IS NOT NULL`,
] as const

const JOB_FIELDS = [
  'wo_number',
  'capacity_key',
  'is_capacity_block',
  'technician_name',
  'customer_number',
  'customer_name',
  'account_num',
  'service_zone',
  'zone_code',
  'city',
  'service_location_number',
  'schedule_date',
  'begin_time',
  'end_time',
  'activity_1',
  'activity_2',
  'activity_3',
  'address_raw',
  'address_name',
  'address_street',
  'address_descriptor',
  'address_city_state_zip',
  'service_instructions',
  'location_definition',
  'activity_note',
] as const

export type JobRow = {
  id: number
  wo_number: string | null
  capacity_key: string | null
  is_capacity_block: number
  technician_name: string | null
  customer_number: string | null
  customer_name: string
  account_num: string | null
  service_zone: string | null
  zone_code: string | null
  city: string | null
  service_location_number: number | null
  schedule_date: string | null
  begin_time: string | null
  end_time: string | null
  activity_1: string | null
  activity_2: string | null
  activity_3: string | null
  address_raw: string | null
  address_name: string | null
  address_street: string | null
  address_descriptor: string | null
  address_city_state_zip: string | null
  service_instructions: string | null
  location_definition: string | null
  activity_note: string | null
  lat: number | null
  lng: number | null
  geocode_source: string | null
  geocode_address_key: string | null
  mismatch_flag: number
  mismatch_note: string | null
  template_id: number | null
  /** Required checklist rows still unchecked. Computed, not a stored column. */
  checklist_open: number
}

export type DateCount = { schedule_date: string; n: number }

export type ApplyStats = {
  inserted: number
  updated: number
  skipped: number
  sitesWritten: number
  /** Written rows (insert or update) whose advisory mismatch flag is on. */
  mismatchCount: number
  /** Inserted and updated job ids. Skipped matches are not included. */
  writtenIds: number[]
}

export type ApplyOptions = { updateMatched: boolean }

let schemaReady: WeakSet<SqlDb> | null = null
/** One in-flight migration per database handle. Jobs opens two queries at once. */
const schemaInflight = new WeakMap<SqlDb, Promise<void>>()

async function columnNames(db: SqlDb, table: 'jobs' | 'sites'): Promise<Set<string>> {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`)
  return new Set(rows.map((row) => String(row.name)))
}

/**
 * Stage 3 columns on databases created before the map. CREATE TABLE IF NOT
 * EXISTS does not add columns to an existing file, so each boot checks
 * pragma and ALTERs what is missing. geocode_cache is created either way.
 */
export async function migrateGeoColumns(db: SqlDb): Promise<void> {
  const jobs = await columnNames(db, 'jobs')
  for (const [name, type] of JOB_GEO_COLUMNS) {
    if (!jobs.has(name)) await db.execute(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`)
  }
  const sites = await columnNames(db, 'sites')
  for (const [name, type] of SITE_GEO_COLUMNS) {
    if (!sites.has(name)) await db.execute(`ALTER TABLE sites ADD COLUMN ${name} ${type}`)
  }
  await db.execute(GEOCODE_CACHE_SQL)
  await db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_geocode_source ON jobs (geocode_source)')
}

/**
 * Stage 4 tables and job columns. Seed the GAS CHECK ↔ CLEANING rule and the
 * Tank Install templates only when those tables are empty, so a later edit or
 * delete is not put back on the next launch. The inserts are OR IGNORE: two
 * startup queries can both see an empty table before either commit lands, and
 * a second migrate on the same file must not throw UNIQUE on templates.name
 * or the mismatch-rule key. Existing rows are not updated.
 */
export async function migrateStage4(db: SqlDb): Promise<void> {
  const jobs = await columnNames(db, 'jobs')
  for (const [name, type] of JOB_STAGE4_COLUMNS) {
    if (!jobs.has(name)) await db.execute(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`)
  }
  for (const sql of STAGE4_TABLES) await db.execute(sql)
  await seedStage4(db)
}

/** Stage 5 standing work. Created on existing databases; ADD import does not write it. */
export async function migrateStage5(db: SqlDb): Promise<void> {
  for (const sql of STAGE5_BACKLOG_SQL) await db.execute(sql)
}

/** COUNT(*) may come back under `n` or as the raw expression, and as a number or bigint. */
function rowCount(rows: ReadonlyArray<Record<string, unknown>>): number {
  const row = rows[0]
  if (!row) return 0
  const raw = Object.prototype.hasOwnProperty.call(row, 'n') ? row.n : Object.values(row)[0]
  if (typeof raw === 'bigint') return Number(raw)
  const n = typeof raw === 'number' ? raw : Number(raw ?? 0)
  return Number.isFinite(n) ? n : 0
}

async function seedStage4(db: SqlDb): Promise<void> {
  const rules = await db.select<Record<string, unknown>>('SELECT COUNT(*) AS n FROM mismatch_rules')
  if (rowCount(rules) === 0) {
    await db.execute(
      `INSERT OR IGNORE INTO mismatch_rules (call_reason_pattern, conflicting_keyword, active, notes)
       VALUES (?, ?, 1, ?)`,
      [
        'GAS CHECK',
        'CLEANING',
        'Example: Call Reason GAS CHECK with an activity note that mentions CLEANING. Advisory only — import still applies.',
      ],
    )
  }
  const templates = await db.select<Record<string, unknown>>('SELECT COUNT(*) AS n FROM templates')
  if (rowCount(templates) === 0) {
    await seedTankTemplate(db, 'Tank Install Trip 1', 'TANK INSTALL (UG)', '#B45309')
    await seedTankTemplate(db, 'Tank Install Trip 2', 'REGULATOR (HOOK UP)', '#1D4ED8')
  }
}

async function seedTankTemplate(db: SqlDb, name: string, activity: string, color: string): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO templates (name, matches_activity_code, card_color) VALUES (?, ?, ?)`,
    [name, activity, color],
  )
  // Do not use lastInsertId: OR IGNORE leaves it unchanged, and the SQL plugin
  // may run the next statement on another pooled connection.
  const rows = await db.select<{ id: number }>('SELECT id FROM templates WHERE name = ?', [name])
  const id = Number(rows[0]?.id)
  if (!Number.isFinite(id) || id <= 0) return
  const items = await db.select<Record<string, unknown>>(
    'SELECT COUNT(*) AS n FROM template_checklist_items WHERE template_id = ?',
    [id],
  )
  if (rowCount(items) > 0) return
  await db.execute(
    `INSERT OR IGNORE INTO template_checklist_items (template_id, label, sequence, is_required) VALUES (?, ?, 1, 1)`,
    [id, 'Excavator (Dan) scheduled'],
  )
}

/**
 * Bump when a migration is added. Stored in `PRAGMA user_version` so an older
 * build never opens (and silently mangles) a database written by a newer one.
 */
export const SCHEMA_VERSION = 5

export async function checkSchemaVersion(db: SqlDb): Promise<void> {
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version')
  const found = Number(rows[0]?.user_version ?? 0)
  if (found > SCHEMA_VERSION) {
    throw new Error(
      `This database was written by a newer DispatchBoard (Local) (schema ${found}, this build knows ${SCHEMA_VERSION}). Install the newer version, or restore a backup.`,
    )
  }
}

export async function ensureSchema(db: SqlDb): Promise<void> {
  schemaReady ??= new WeakSet()
  if (schemaReady.has(db)) return
  const pending = schemaInflight.get(db)
  if (pending) return pending
  const run = (async () => {
    await checkSchemaVersion(db)
    for (const sql of SCHEMA_STATEMENTS) await db.execute(sql)
    await migrateGeoColumns(db)
    await migrateStage4(db)
    await migrateStage5(db)
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    schemaReady!.add(db)
  })()
  schemaInflight.set(db, run)
  try {
    await run
  } finally {
    schemaInflight.delete(db)
  }
}

function jobParams(row: ParsedRow): unknown[] {
  return [
    row.woNumber,
    row.capacityKey,
    row.isCapacity ? 1 : 0,
    row.technicianName,
    row.customerNumber,
    row.customerName,
    row.accountNum,
    row.serviceZone,
    row.zoneCode,
    row.city,
    row.serviceLocationNumber,
    row.scheduleDate,
    row.beginTime,
    row.endTime,
    row.activity1,
    row.activity2,
    row.activity3,
    row.address.raw || null,
    row.address.name,
    row.address.street,
    row.address.descriptor,
    row.address.cityStateZip,
    row.serviceInstructions,
    row.locationDefinition,
    row.activityNote,
  ]
}

const INSERT_JOB = `INSERT INTO jobs (${JOB_FIELDS.join(', ')}, updated_at) VALUES (${JOB_FIELDS.map(() => '?').join(', ')}, datetime('now'))`

const UPDATE_JOB = `UPDATE jobs SET ${JOB_FIELDS.map((field) => `${field} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`

const UPSERT_SITE = `INSERT INTO sites (
  customer_number, service_location_number, customer_name, account_num,
  zone_code, city, address_raw, address_street, address_city_state_zip, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
ON CONFLICT(customer_number, service_location_number) DO UPDATE SET
  customer_name = excluded.customer_name,
  account_num = excluded.account_num,
  zone_code = excluded.zone_code,
  city = excluded.city,
  address_raw = excluded.address_raw,
  address_street = excluded.address_street,
  address_city_state_zip = excluded.address_city_state_zip,
  updated_at = datetime('now')`

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

type MatchedJob = {
  id: number
  address_street: string | null
  address_city_state_zip: string | null
  geocode_address_key: string | null
}

async function writeJobMismatch(db: SqlDb, id: number, row: ParsedRow, rules: MismatchRule[]): Promise<boolean> {
  const result = row.isCapacity
    ? { mismatch_flag: false, mismatch_note: null as string | null }
    : evaluateMismatch([row.activity1, row.activity2, row.activity3], row.activityNote, rules)
  await db.execute(`UPDATE jobs SET mismatch_flag = ?, mismatch_note = ? WHERE id = ?`, [
    result.mismatch_flag ? 1 : 0,
    result.mismatch_note,
    id,
  ])
  return result.mismatch_flag
}

export async function applyImport(db: SqlDb, rows: ParsedRow[], options: ApplyOptions): Promise<ApplyStats> {
  await ensureSchema(db)
  const rules = await loadMismatchRules(db)
  const stats: ApplyStats = { inserted: 0, updated: 0, skipped: 0, sitesWritten: 0, mismatchCount: 0, writtenIds: [] }
  for (const row of rows) {
      const params = jobParams(row)
      const matchSql = row.isCapacity
        ? `SELECT id, address_street, address_city_state_zip, geocode_address_key FROM jobs WHERE capacity_key = ? LIMIT 1`
        : row.woNumber
          ? `SELECT id, address_street, address_city_state_zip, geocode_address_key FROM jobs WHERE wo_number = ? LIMIT 1`
          : null
      const matchParam = row.isCapacity ? row.capacityKey : row.woNumber
      const existing = matchSql && matchParam ? await db.select<MatchedJob>(matchSql, [matchParam]) : []
      const matched = existing[0]
      const id = matched?.id
      let writtenId: number | null = null
      if (id != null && !options.updateMatched) {
        stats.skipped++
      } else if (id != null && matched) {
        await db.execute(UPDATE_JOB, [...params, id])
        if (addressKeyChanged(matched, row.address.street, row.address.cityStateZip)) {
          await clearJobGeocode(db, id)
        }
        stats.updated++
        stats.writtenIds.push(id)
        writtenId = id
      } else {
        const inserted = await db.execute(INSERT_JOB, params)
        const newId = inserted.lastInsertId
        stats.inserted++
        if (newId != null) {
          stats.writtenIds.push(newId)
          writtenId = newId
        }
      }
      if (writtenId != null && (await writeJobMismatch(db, writtenId, row, rules))) {
        stats.mismatchCount++
      }

      if (!row.isCapacity && row.customerNumber) {
        await upsertSiteRecord(db, {
          customer_number: row.customerNumber,
          service_location_number: row.serviceLocationNumber ?? 0,
          customer_name: row.customerName,
          account_num: row.accountNum,
          zone_code: row.zoneCode,
          city: row.city,
          address_raw: row.address.raw || null,
          address_street: row.address.street,
          address_city_state_zip: row.address.cityStateZip,
        })
        stats.sitesWritten++
      }
  }
  return stats
}

function addressKeyChanged(
  previous: { address_street: string | null; address_city_state_zip: string | null; geocode_address_key: string | null },
  street: string | null,
  cityStateZip: string | null,
): boolean {
  const nextKey = normalizeAddressKey(street, cityStateZip)
  const prevKey = previous.geocode_address_key ?? normalizeAddressKey(previous.address_street, previous.address_city_state_zip)
  return prevKey !== nextKey
}

async function clearJobGeocode(db: SqlDb, id: number): Promise<void> {
  await db.execute(
    `UPDATE jobs SET lat = NULL, lng = NULL, geocode_source = 'none', geocode_address_key = NULL WHERE id = ?`,
    [id],
  )
}

const JOB_COLUMNS = `id, wo_number, capacity_key, is_capacity_block, technician_name,
  customer_number, customer_name, account_num, service_zone, zone_code, city,
  service_location_number, schedule_date, begin_time, end_time,
  activity_1, activity_2, activity_3, address_raw, address_name, address_street,
  address_descriptor, address_city_state_zip, service_instructions,
  location_definition, activity_note, lat, lng, geocode_source, geocode_address_key,
  mismatch_flag, mismatch_note, template_id,
  (SELECT COUNT(*) FROM job_checklist_items c
    WHERE c.job_id = jobs.id AND c.is_required != 0 AND ifnull(c.is_checked, 0) = 0) AS checklist_open`

const SEARCH_CLAUSE = `(
  customer_name LIKE ? ESCAPE '\\'
  OR ifnull(wo_number, '') LIKE ? ESCAPE '\\'
  OR ifnull(technician_name, '') LIKE ? ESCAPE '\\'
  OR ifnull(address_raw, '') LIKE ? ESCAPE '\\'
  OR ifnull(address_street, '') LIKE ? ESCAPE '\\'
  OR ifnull(city, '') LIKE ? ESCAPE '\\'
  OR ifnull(activity_1, '') LIKE ? ESCAPE '\\'
  OR ifnull(customer_number, '') LIKE ? ESCAPE '\\'
  OR ifnull(account_num, '') LIKE ? ESCAPE '\\'
  OR ifnull(zone_code, '') LIKE ? ESCAPE '\\'
)`

const ORDER_JOBS = `ORDER BY schedule_date, ifnull(begin_time, ''), ifnull(technician_name, ''), id`

export async function listJobs(db: SqlDb, filter: { date: string; query: string }): Promise<JobRow[]> {
  await ensureSchema(db)
  const date = filter.date.trim()
  const query = filter.query.trim()
  const like = query ? `%${escapeLike(query)}%` : ''
  const likes = query ? Array.from({ length: 10 }, () => like) : []
  if (date && query) {
    return db.select<JobRow>(
      `SELECT ${JOB_COLUMNS} FROM jobs WHERE schedule_date = ? AND ${SEARCH_CLAUSE} ${ORDER_JOBS}`,
      [date, ...likes],
    )
  }
  if (date) {
    return db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE schedule_date = ? ${ORDER_JOBS}`, [date])
  }
  if (query) {
    return db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE ${SEARCH_CLAUSE} ${ORDER_JOBS}`, likes)
  }
  return db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs ${ORDER_JOBS}`)
}

export async function listDates(db: SqlDb): Promise<DateCount[]> {
  await ensureSchema(db)
  const rows = await db.select<{ schedule_date: string; n: number }>(
    `SELECT schedule_date AS schedule_date, COUNT(*) AS n
     FROM jobs
     WHERE schedule_date IS NOT NULL AND schedule_date != ''
     GROUP BY schedule_date
     ORDER BY schedule_date`,
  )
  return rows.map((row) => ({ schedule_date: String(row.schedule_date), n: Number(row.n) }))
}

export async function countRows(db: SqlDb): Promise<{ jobs: number; sites: number; backlog: number }> {
  await ensureSchema(db)
  const rows = await db.select<{ jobs: number; sites: number; backlog: number }>(
    `SELECT
       (SELECT COUNT(*) FROM jobs) AS jobs,
       (SELECT COUNT(*) FROM sites) AS sites,
       (SELECT COUNT(*) FROM backlog_items) AS backlog`,
  )
  return {
    jobs: Number(rows[0]?.jobs ?? 0),
    sites: Number(rows[0]?.sites ?? 0),
    backlog: Number(rows[0]?.backlog ?? 0),
  }
}

export async function wipeDatabase(db: SqlDb): Promise<void> {
  await ensureSchema(db)
  await db.execute('DELETE FROM job_checklist_items')
  await db.execute('DELETE FROM drive_time_cache')
  await db.execute('DELETE FROM backlog_items')
  await db.execute('DELETE FROM jobs')
  await db.execute('DELETE FROM sites')
  await db.execute('DELETE FROM geocode_cache')
}

/** Shown when two capacity rows would share technician + date + begin + activity. */
export const CAPACITY_KEY_CONFLICT =
  'Another capacity block already uses this technician, date, begin time, and activity.'

/**
 * Editable planning fields. Strings are what the drawer types; `saveJob`
 * trims them. `wo_number` is display-only. New rows are tentative: null WO,
 * not a capacity block.
 */
export type JobDraft = {
  id: number | null
  is_capacity_block: boolean
  wo_number: string | null
  customer_name: string
  customer_number: string
  account_num: string
  service_zone: string
  city: string
  service_location_number: string
  technician_name: string
  schedule_date: string
  begin_time: string
  end_time: string
  activity_1: string
  activity_2: string
  activity_3: string
  address_raw: string
  address_name: string
  address_street: string
  address_descriptor: string
  address_city_state_zip: string
  service_instructions: string
  location_definition: string
  activity_note: string
}

type NormalizedJob = {
  customer_name: string
  customer_number: string | null
  account_num: string | null
  service_zone: string | null
  zone_code: string | null
  city: string | null
  service_location_number: number | null
  technician_name: string | null
  schedule_date: string | null
  begin_time: string | null
  end_time: string | null
  activity_1: string | null
  activity_2: string | null
  activity_3: string | null
  address_raw: string | null
  address_name: string | null
  address_street: string | null
  address_descriptor: string | null
  address_city_state_zip: string | null
  service_instructions: string | null
  location_definition: string | null
  activity_note: string | null
}

const UPDATE_PLANNING = `UPDATE jobs SET
  technician_name = ?,
  customer_number = ?,
  customer_name = ?,
  account_num = ?,
  service_zone = ?,
  zone_code = ?,
  city = ?,
  service_location_number = ?,
  schedule_date = ?,
  begin_time = ?,
  end_time = ?,
  activity_1 = ?,
  activity_2 = ?,
  activity_3 = ?,
  address_raw = ?,
  address_name = ?,
  address_street = ?,
  address_descriptor = ?,
  address_city_state_zip = ?,
  service_instructions = ?,
  location_definition = ?,
  activity_note = ?,
  updated_at = datetime('now')
  WHERE id = ?`

const UPDATE_CAPACITY = `UPDATE jobs SET
  technician_name = ?,
  customer_name = ?,
  schedule_date = ?,
  begin_time = ?,
  end_time = ?,
  activity_1 = ?,
  capacity_key = ?,
  updated_at = datetime('now')
  WHERE id = ?`

function blankToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function text(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
}

function normalizeDate(value: string, label: string): string | null {
  const trimmed = blankToNull(value)
  if (!trimmed) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) throw new Error(`${label} must be YYYY-MM-DD.`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error(`${label} must be YYYY-MM-DD.`)
  }
  return trimmed
}

function normalizeTime(value: string, label: string): string | null {
  const trimmed = blankToNull(value)
  if (!trimmed) return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed)
  if (!match) throw new Error(`${label} must be HH:MM.`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`${label} must be HH:MM.`)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

function normalizeLocation(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) throw new Error('Service location must be a whole number.')
  return Number(trimmed)
}

function normalizePlanning(draft: JobDraft): NormalizedJob {
  const customer_name = draft.customer_name.trim()
  if (!customer_name) throw new Error('Customer name is required.')
  const service_zone = blankToNull(draft.service_zone)
  return {
    customer_name,
    customer_number: blankToNull(draft.customer_number),
    account_num: blankToNull(draft.account_num),
    service_zone,
    zone_code: zoneCodeFromServiceZone(service_zone),
    city: blankToNull(draft.city),
    service_location_number: normalizeLocation(draft.service_location_number),
    technician_name: blankToNull(draft.technician_name),
    schedule_date: normalizeDate(draft.schedule_date, 'Schedule date'),
    begin_time: normalizeTime(draft.begin_time, 'Begin time'),
    end_time: normalizeTime(draft.end_time, 'End time'),
    activity_1: blankToNull(draft.activity_1),
    activity_2: blankToNull(draft.activity_2),
    activity_3: blankToNull(draft.activity_3),
    address_raw: blankToNull(draft.address_raw),
    address_name: blankToNull(draft.address_name),
    address_street: blankToNull(draft.address_street),
    address_descriptor: blankToNull(draft.address_descriptor),
    address_city_state_zip: blankToNull(draft.address_city_state_zip),
    service_instructions: blankToNull(draft.service_instructions),
    location_definition: blankToNull(draft.location_definition),
    activity_note: blankToNull(draft.activity_note),
  }
}

export function draftFromJob(job: JobRow): JobDraft {
  return {
    id: job.id,
    is_capacity_block: Boolean(job.is_capacity_block),
    wo_number: job.wo_number == null ? null : String(job.wo_number),
    customer_name: text(job.customer_name),
    customer_number: text(job.customer_number),
    account_num: text(job.account_num),
    service_zone: text(job.service_zone),
    city: text(job.city),
    service_location_number: job.service_location_number == null ? '' : String(job.service_location_number),
    technician_name: text(job.technician_name),
    schedule_date: text(job.schedule_date),
    begin_time: text(job.begin_time),
    end_time: text(job.end_time),
    activity_1: text(job.activity_1),
    activity_2: text(job.activity_2),
    activity_3: text(job.activity_3),
    address_raw: text(job.address_raw),
    address_name: text(job.address_name),
    address_street: text(job.address_street),
    address_descriptor: text(job.address_descriptor),
    address_city_state_zip: text(job.address_city_state_zip),
    service_instructions: text(job.service_instructions),
    location_definition: text(job.location_definition),
    activity_note: text(job.activity_note),
  }
}

export function blankJobDraft(): JobDraft {
  return {
    id: null,
    is_capacity_block: false,
    wo_number: null,
    customer_name: '',
    customer_number: '',
    account_num: '',
    service_zone: '',
    city: '',
    service_location_number: '',
    technician_name: '',
    schedule_date: '',
    begin_time: '',
    end_time: '',
    activity_1: '',
    activity_2: '',
    activity_3: '',
    address_raw: '',
    address_name: '',
    address_street: '',
    address_descriptor: '',
    address_city_state_zip: '',
    service_instructions: '',
    location_definition: '',
    activity_note: '',
  }
}

type SiteWrite = {
  customer_number: string
  service_location_number: number
  customer_name: string | null
  account_num: string | null
  zone_code: string | null
  city: string | null
  address_raw: string | null
  address_street: string | null
  address_city_state_zip: string | null
}

/**
 * Upsert site text. If the address key changes, drop a saved site pin so the
 * next Census → site pin chain does not reuse coordinates for a different address.
 */
async function upsertSiteRecord(db: SqlDb, site: SiteWrite): Promise<void> {
  const existing = await db.select<{
    address_street: string | null
    address_city_state_zip: string | null
  }>(
    `SELECT address_street, address_city_state_zip FROM sites
     WHERE customer_number = ? AND service_location_number = ? LIMIT 1`,
    [site.customer_number, site.service_location_number],
  )
  const prev = existing[0]
  const prevKey = prev ? normalizeAddressKey(prev.address_street, prev.address_city_state_zip) : null
  const nextKey = normalizeAddressKey(site.address_street, site.address_city_state_zip)
  await db.execute(UPSERT_SITE, [
    site.customer_number,
    site.service_location_number,
    site.customer_name,
    site.account_num,
    site.zone_code,
    site.city,
    site.address_raw,
    site.address_street,
    site.address_city_state_zip,
  ])
  if (prev && prevKey !== nextKey) {
    await db.execute(
      `UPDATE sites SET lat = NULL, lng = NULL, pin_source = NULL, updated_at = datetime('now')
       WHERE customer_number = ? AND service_location_number = ?`,
      [site.customer_number, site.service_location_number],
    )
  }
}

async function writeSite(db: SqlDb, row: NormalizedJob): Promise<void> {
  if (!row.customer_number) return
  await upsertSiteRecord(db, {
    customer_number: row.customer_number,
    service_location_number: row.service_location_number ?? 0,
    customer_name: row.customer_name,
    account_num: row.account_num,
    zone_code: row.zone_code,
    city: row.city,
    address_raw: row.address_raw,
    address_street: row.address_street,
    address_city_state_zip: row.address_city_state_zip,
  })
}

function requireInsertId(result: SqlExecResult): number {
  if (result.lastInsertId == null || result.lastInsertId <= 0) {
    throw new Error('Save did not return a row id.')
  }
  return result.lastInsertId
}

/**
 * Insert a tentative job or update an existing row.
 * Capacity rows only write schedule fields (technician, date, times, label,
 * activity 1) and refresh `capacity_key`. Work order number is never edited.
 */
export async function saveJob(db: SqlDb, draft: JobDraft): Promise<{ id: number }> {
  await ensureSchema(db)

  if (draft.id == null) {
    if (!ENABLE_JOB_CREATE) {
      throw new Error('Job creation is disabled (ENABLE_JOB_CREATE).')
    }
    if (draft.is_capacity_block) throw new Error('New jobs are tentative. They are not capacity blocks.')
    const row = normalizePlanning(draft)
    const result = await db.execute(INSERT_JOB, [
      null,
      null,
      0,
      row.technician_name,
      row.customer_number,
      row.customer_name,
      row.account_num,
      row.service_zone,
      row.zone_code,
      row.city,
      row.service_location_number,
      row.schedule_date,
      row.begin_time,
      row.end_time,
      row.activity_1,
      row.activity_2,
      row.activity_3,
      row.address_raw,
      row.address_name,
      row.address_street,
      row.address_descriptor,
      row.address_city_state_zip,
      row.service_instructions,
      row.location_definition,
      row.activity_note,
    ])
    const id = requireInsertId(result)
    await writeSite(db, row)
    return { id }
  }

  const existing = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [draft.id])
  const current = existing[0]
  if (!current) throw new Error('That job is no longer in the local database.')

  if (current.is_capacity_block) {
    const customer_name = draft.customer_name.trim()
    if (!customer_name) throw new Error('Label is required.')
    const technician_name = blankToNull(draft.technician_name)
    const schedule_date = normalizeDate(draft.schedule_date, 'Schedule date')
    const begin_time = normalizeTime(draft.begin_time, 'Begin time')
    const end_time = normalizeTime(draft.end_time, 'End time')
    const activity_1 = blankToNull(draft.activity_1)
    const capacity_key = capacityKeyFor({
      isCapacity: true,
      technicianName: technician_name,
      scheduleDate: schedule_date,
      beginTime: begin_time,
      activity1: activity_1,
    })
    const clash = await db.select<{ id: number }>(
      'SELECT id FROM jobs WHERE capacity_key = ? AND id != ? LIMIT 1',
      [capacity_key, current.id],
    )
    if (clash.length) throw new Error(CAPACITY_KEY_CONFLICT)
    try {
      await db.execute(UPDATE_CAPACITY, [
        technician_name,
        customer_name,
        schedule_date,
        begin_time,
        end_time,
        activity_1,
        capacity_key,
        current.id,
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/unique/i.test(message)) throw new Error(CAPACITY_KEY_CONFLICT)
      throw error
    }
    return { id: current.id }
  }

  const row = normalizePlanning(draft)
  await db.execute(UPDATE_PLANNING, [
    row.technician_name,
    row.customer_number,
    row.customer_name,
    row.account_num,
    row.service_zone,
    row.zone_code,
    row.city,
    row.service_location_number,
    row.schedule_date,
    row.begin_time,
    row.end_time,
    row.activity_1,
    row.activity_2,
    row.activity_3,
    row.address_raw,
    row.address_name,
    row.address_street,
    row.address_descriptor,
    row.address_city_state_zip,
    row.service_instructions,
    row.location_definition,
    row.activity_note,
    current.id,
  ])
  if (addressKeyChanged(current, row.address_street, row.address_city_state_zip)) {
    await clearJobGeocode(db, current.id)
  }
  await writeSite(db, row)
  return { id: current.id }
}

export const MOVE_WO_LOCKED = 'This job has a work order. Change the schedule in the job drawer.'
export const MOVE_CAPACITY_LOCKED = 'Capacity blocks are not dragged. Change them in the job drawer.'

/**
 * Drag / undo patch. Omit begin_time and end_time to keep the stored window
 * (week-grid drops change technician and date only). Pass null to clear a time.
 * `schedule_date` null clears the date (undo of a move onto the board).
 */
export type ScheduleMove = {
  technician_name: string | null
  schedule_date: string | null
  begin_time?: string | null
  end_time?: string | null
}

const UPDATE_SCHEDULE = `UPDATE jobs SET
  technician_name = ?,
  schedule_date = ?,
  begin_time = ?,
  end_time = ?,
  updated_at = datetime('now')
  WHERE id = ?`

/**
 * Persist a tentative / no-WO schedule change. Work orders and capacity blocks
 * throw so a drag cannot bypass the drawer rule.
 */
export async function moveJobSchedule(db: SqlDb, id: number, move: ScheduleMove): Promise<void> {
  await ensureSchema(db)
  const existing = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [id])
  const current = existing[0]
  if (!current) throw new Error('That job is no longer in the local database.')
  if (!canDragJob(current)) {
    throw new Error(current.is_capacity_block ? MOVE_CAPACITY_LOCKED : MOVE_WO_LOCKED)
  }

  const technician_name = blankToNull(move.technician_name ?? '')
  const schedule_date =
    move.schedule_date == null || move.schedule_date.trim() === ''
      ? null
      : normalizeDate(move.schedule_date, 'Schedule date')
  const begin_time =
    move.begin_time === undefined ? current.begin_time : normalizeTime(move.begin_time ?? '', 'Begin time')
  const end_time = move.end_time === undefined ? current.end_time : normalizeTime(move.end_time ?? '', 'End time')

  await db.execute(UPDATE_SCHEDULE, [technician_name, schedule_date, begin_time, end_time, current.id])
}

/**
 * Delete jobs that have a schedule date, including capacity blocks.
 * Jobs with no date stay. Sites stay. Backlog rows stay.
 * A promoted item whose job was dated keeps its status and loses the job link.
 */
export async function clearScheduledJobs(db: SqlDb): Promise<number> {
  await ensureSchema(db)
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM jobs WHERE schedule_date IS NOT NULL AND trim(schedule_date) != ''`,
  )
  const n = Number(rows[0]?.n ?? 0)
  if (n === 0) return 0
  await db.execute(
    `UPDATE backlog_items
     SET promoted_job_id = NULL, updated_at = datetime('now')
     WHERE promoted_job_id IN (
       SELECT id FROM jobs WHERE schedule_date IS NOT NULL AND trim(schedule_date) != ''
     )`,
  )
  await db.execute(
    `DELETE FROM job_checklist_items WHERE job_id IN (
       SELECT id FROM jobs WHERE schedule_date IS NOT NULL AND trim(schedule_date) != ''
     )`,
  )
  await db.execute(`DELETE FROM jobs WHERE schedule_date IS NOT NULL AND trim(schedule_date) != ''`)
  return n
}

const GEO_SOURCES = new Set<GeocodeSource>(['census', 'site_pin', 'manual', 'google', 'nominatim', 'none'])

function asGeocodeSource(value: string | null | undefined): GeocodeSource {
  if (value && GEO_SOURCES.has(value as GeocodeSource)) return value as GeocodeSource
  return 'none'
}

export type CacheRow = {
  address_key: string
  lat: number | null
  lng: number | null
  geocode_source: GeocodeSource
  matched_address: string | null
  address_street: string | null
  address_city_state_zip: string | null
}

export async function listGeocodeCache(db: SqlDb): Promise<CacheRow[]> {
  await ensureSchema(db)
  const rows = await db.select<{
    address_key: string
    lat: number | string | null
    lng: number | string | null
    geocode_source: string | null
    matched_address: string | null
    address_street: string | null
    address_city_state_zip: string | null
  }>(
    `SELECT address_key, lat, lng, geocode_source, matched_address, address_street, address_city_state_zip
     FROM geocode_cache`,
  )
  return rows.map((row) => ({
    address_key: String(row.address_key),
    lat: asCoord(row.lat),
    lng: asCoord(row.lng),
    geocode_source: asGeocodeSource(row.geocode_source),
    matched_address: row.matched_address ?? null,
    address_street: row.address_street ?? null,
    address_city_state_zip: row.address_city_state_zip ?? null,
  }))
}

export async function upsertGeocodeCache(db: SqlDb, entries: CacheRow[]): Promise<void> {
  if (!entries.length) return
  await ensureSchema(db)
  for (const entry of entries) {
    await db.execute(
      `INSERT INTO geocode_cache (
         address_key, address_street, address_city_state_zip, lat, lng, geocode_source, matched_address, attempted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(address_key) DO UPDATE SET
         address_street = excluded.address_street,
         address_city_state_zip = excluded.address_city_state_zip,
         lat = excluded.lat,
         lng = excluded.lng,
         geocode_source = excluded.geocode_source,
         matched_address = excluded.matched_address,
         attempted_at = datetime('now')`,
      [
        entry.address_key,
        entry.address_street ?? null,
        entry.address_city_state_zip ?? null,
        entry.lat,
        entry.lng,
        entry.geocode_source,
        entry.matched_address,
      ],
    )
  }
}

export type SitePinRow = {
  customer_number: string
  service_location_number: number
  lat: number
  lng: number
}

export async function listSitePins(db: SqlDb): Promise<SitePinRow[]> {
  await ensureSchema(db)
  const rows = await db.select<{
    customer_number: string
    service_location_number: number | null
    lat: number | string | null
    lng: number | string | null
  }>(
    `SELECT customer_number, service_location_number, lat, lng FROM sites
     WHERE lat IS NOT NULL AND lng IS NOT NULL`,
  )
  const out: SitePinRow[] = []
  for (const row of rows) {
    const lat = asCoord(row.lat)
    const lng = asCoord(row.lng)
    if (lat == null || lng == null) continue
    out.push({
      customer_number: String(row.customer_number),
      service_location_number: Number(row.service_location_number ?? 0),
      lat,
      lng,
    })
  }
  return out
}

export async function jobsByIds(db: SqlDb, ids: number[]): Promise<JobRow[]> {
  await ensureSchema(db)
  if (!ids.length) return []
  const out: JobRow[] = []
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80)
    const marks = chunk.map(() => '?').join(', ')
    const rows = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id IN (${marks})`, chunk)
    out.push(...rows)
  }
  return out
}

export async function persistJobGeocode(db: SqlDb, id: number, result: GeocodeResult): Promise<void> {
  await ensureSchema(db)
  await db.execute(
    `UPDATE jobs SET lat = ?, lng = ?, geocode_source = ?, geocode_address_key = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [result.lat, result.lng, result.geocode_source, result.address_key, id],
  )
}

export async function updateJobAddress(
  db: SqlDb,
  id: number,
  address: { address_street: string | null; address_city_state_zip: string | null },
): Promise<void> {
  await ensureSchema(db)
  const existing = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [id])
  const current = existing[0]
  if (!current) throw new Error('That job is no longer in the local database.')
  if (current.is_capacity_block) throw new Error('Capacity blocks do not have a service address to geocode.')
  const street = blankToNull(address.address_street ?? '')
  const cityStateZip = blankToNull(address.address_city_state_zip ?? '')
  await db.execute(
    `UPDATE jobs SET address_street = ?, address_city_state_zip = ?, updated_at = datetime('now') WHERE id = ?`,
    [street, cityStateZip, id],
  )
  if (addressKeyChanged(current, street, cityStateZip)) await clearJobGeocode(db, id)
}

export async function saveManualPin(
  db: SqlDb,
  input: { jobId: number; lat: number; lng: number; saveOnSite: boolean },
): Promise<void> {
  await ensureSchema(db)
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    throw new Error('Latitude must be a number from -90 to 90.')
  }
  if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
    throw new Error('Longitude must be a number from -180 to 180.')
  }
  const existing = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [input.jobId])
  const current = existing[0]
  if (!current) throw new Error('That job is no longer in the local database.')
  if (current.is_capacity_block) throw new Error('Capacity blocks are not pinned on the map.')
  const key = normalizeAddressKey(current.address_street, current.address_city_state_zip)
  await db.execute(
    `UPDATE jobs SET lat = ?, lng = ?, geocode_source = 'manual', geocode_address_key = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [input.lat, input.lng, key, input.jobId],
  )
  if (!input.saveOnSite || !current.customer_number) return
  await writeSite(db, {
    customer_name: current.customer_name,
    customer_number: current.customer_number,
    account_num: current.account_num,
    service_zone: current.service_zone,
    zone_code: current.zone_code,
    city: current.city,
    service_location_number: current.service_location_number,
    technician_name: current.technician_name,
    schedule_date: current.schedule_date,
    begin_time: current.begin_time,
    end_time: current.end_time,
    activity_1: current.activity_1,
    activity_2: current.activity_2,
    activity_3: current.activity_3,
    address_raw: current.address_raw,
    address_name: current.address_name,
    address_street: current.address_street,
    address_descriptor: current.address_descriptor,
    address_city_state_zip: current.address_city_state_zip,
    service_instructions: current.service_instructions,
    location_definition: current.location_definition,
    activity_note: current.activity_note,
  })
  await db.execute(
    `UPDATE sites SET lat = ?, lng = ?, pin_source = 'manual', updated_at = datetime('now')
     WHERE customer_number = ? AND service_location_number = ?`,
    [input.lat, input.lng, current.customer_number, current.service_location_number ?? 0],
  )
}

export type MismatchRuleRow = {
  id: number
  call_reason_pattern: string
  conflicting_keyword: string
  active: number
  notes: string | null
  updated_at: string
}

async function loadMismatchRules(db: SqlDb): Promise<MismatchRule[]> {
  const rows = await listMismatchRules(db)
  return rows.map((row) => ({
    call_reason_pattern: row.call_reason_pattern,
    conflicting_keyword: row.conflicting_keyword,
    active: Number(row.active) !== 0,
  }))
}

export async function listMismatchRules(db: SqlDb): Promise<MismatchRuleRow[]> {
  await ensureSchema(db)
  const rows = await db.select<MismatchRuleRow>(
    `SELECT id, call_reason_pattern, conflicting_keyword, active, notes, updated_at
     FROM mismatch_rules`,
  )
  return sortMismatchRules(
    rows.map((row) => ({
      ...row,
      id: Number(row.id),
      active: Number(row.active) ? 1 : 0,
      call_reason_pattern: String(row.call_reason_pattern),
      conflicting_keyword: String(row.conflicting_keyword),
      notes: row.notes == null ? null : String(row.notes),
      updated_at: String(row.updated_at ?? ''),
    })),
  )
}

export async function saveMismatchRule(
  db: SqlDb,
  input: { id: number | null; draft: MismatchRuleDraft },
): Promise<MismatchRuleRow> {
  await ensureSchema(db)
  const parsed = parseMismatchRuleDraft(input.draft)
  if (!parsed.ok) throw new Error(parsed.error)
  const existing = await listMismatchRules(db)
  if (findDuplicateMismatchRule(existing, parsed.value, input.id ?? undefined)) {
    throw new Error('A rule with this call reason and keyword already exists. Edit that row instead.')
  }
  const active = parsed.value.active ? 1 : 0
  if (input.id == null) {
    const inserted = await db.execute(
      `INSERT INTO mismatch_rules (call_reason_pattern, conflicting_keyword, active, notes)
       VALUES (?, ?, ?, ?)`,
      [parsed.value.call_reason_pattern, parsed.value.conflicting_keyword, active, parsed.value.notes],
    )
    const id = inserted.lastInsertId
    if (id == null) throw new Error('Save did not return a rule id.')
    const saved = (await listMismatchRules(db)).find((row) => row.id === id)
    if (!saved) throw new Error('Saved rule could not be read back.')
    return saved
  }
  const current = existing.find((row) => row.id === input.id)
  if (!current) throw new Error('That rule is no longer in the local database.')
  await db.execute(
    `UPDATE mismatch_rules
     SET call_reason_pattern = ?, conflicting_keyword = ?, active = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [parsed.value.call_reason_pattern, parsed.value.conflicting_keyword, active, parsed.value.notes, input.id],
  )
  const saved = (await listMismatchRules(db)).find((row) => row.id === input.id)
  if (!saved) throw new Error('Saved rule could not be read back.')
  return saved
}

export async function deleteMismatchRule(db: SqlDb, id: number): Promise<void> {
  await ensureSchema(db)
  await db.execute('DELETE FROM mismatch_rules WHERE id = ?', [id])
}

export type TemplateItemRow = {
  id: number
  template_id: number
  label: string
  sequence: number
  is_required: number
}

export type TemplateRow = {
  id: number
  name: string
  matches_activity_code: string | null
  card_color: string | null
  items: TemplateItemRow[]
}

export async function listTemplates(db: SqlDb): Promise<TemplateRow[]> {
  await ensureSchema(db)
  const templates = await db.select<{
    id: number
    name: string
    matches_activity_code: string | null
    card_color: string | null
  }>(`SELECT id, name, matches_activity_code, card_color FROM templates ORDER BY name`)
  const items = await db.select<TemplateItemRow>(
    `SELECT id, template_id, label, sequence, is_required FROM template_checklist_items`,
  )
  return templates.map((template) => ({
    id: Number(template.id),
    name: String(template.name),
    matches_activity_code: template.matches_activity_code == null ? null : String(template.matches_activity_code),
    card_color: template.card_color == null ? null : String(template.card_color),
    items: sortTemplateItems(
      items
        .filter((item) => Number(item.template_id) === Number(template.id))
        .map((item) => ({
          id: Number(item.id),
          template_id: Number(item.template_id),
          label: String(item.label),
          sequence: Number(item.sequence),
          is_required: Number(item.is_required) ? 1 : 0,
        })),
    ),
  }))
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase()
}

export async function saveTemplate(db: SqlDb, input: { id: number | null; draft: TemplateDraft }): Promise<TemplateRow> {
  await ensureSchema(db)
  const parsed = parseTemplateDraft(input.draft)
  if (!parsed.ok) throw new Error(parsed.error)
  const templates = await listTemplates(db)
  if (templates.some((template) => template.id !== input.id && namesMatch(template.name, parsed.value.name))) {
    throw new Error('A template with this name already exists.')
  }
  let templateId = input.id
  if (templateId == null) {
    const inserted = await db.execute(
      `INSERT INTO templates (name, matches_activity_code, card_color) VALUES (?, ?, ?)`,
      [parsed.value.name, parsed.value.matches_activity_code, parsed.value.card_color],
    )
    templateId = inserted.lastInsertId
    if (templateId == null) throw new Error('Save did not return a template id.')
  } else {
    const current = templates.find((template) => template.id === templateId)
    if (!current) throw new Error('That template is no longer in the local database.')
    await db.execute(
      `UPDATE templates
       SET name = ?, matches_activity_code = ?, card_color = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [parsed.value.name, parsed.value.matches_activity_code, parsed.value.card_color, templateId],
    )
  }

  const existingItems = templates.find((template) => template.id === input.id)?.items ?? []
  // Park labels and sequences so a rename cannot trip the unique keys mid-update.
  for (const previous of existingItems) {
    await db.execute(
      `UPDATE template_checklist_items SET label = ?, sequence = ? WHERE id = ? AND template_id = ?`,
      [`__tmp_${previous.id}`, 1000 + previous.id, previous.id, templateId],
    )
  }
  const kept = new Set<number>()
  for (let index = 0; index < parsed.value.items.length; index++) {
    const item = parsed.value.items[index]!
    const sequence = index + 1
    const previous = existingItems[index]
    if (previous) {
      kept.add(previous.id)
      await db.execute(
        `UPDATE template_checklist_items SET label = ?, sequence = ?, is_required = ? WHERE id = ? AND template_id = ?`,
        [item.label, sequence, item.is_required ? 1 : 0, previous.id, templateId],
      )
    } else {
      await db.execute(
        `INSERT INTO template_checklist_items (template_id, label, sequence, is_required) VALUES (?, ?, ?, ?)`,
        [templateId, item.label, sequence, item.is_required ? 1 : 0],
      )
    }
  }
  for (const previous of existingItems) {
    if (kept.has(previous.id)) continue
    await db.execute(
      `UPDATE job_checklist_items SET template_checklist_item_id = NULL WHERE template_checklist_item_id = ?`,
      [previous.id],
    )
    await db.execute('DELETE FROM template_checklist_items WHERE id = ?', [previous.id])
  }

  const saved = (await listTemplates(db)).find((template) => template.id === templateId)
  if (!saved) throw new Error('Saved template could not be read back.')
  return saved
}

export async function deleteTemplate(db: SqlDb, id: number): Promise<void> {
  await ensureSchema(db)
  await db.execute(
    `UPDATE job_checklist_items SET template_checklist_item_id = NULL
     WHERE template_checklist_item_id IN (SELECT id FROM template_checklist_items WHERE template_id = ?)`,
    [id],
  )
  await db.execute('DELETE FROM template_checklist_items WHERE template_id = ?', [id])
  await db.execute('UPDATE jobs SET template_id = NULL WHERE template_id = ?', [id])
  await db.execute('DELETE FROM templates WHERE id = ?', [id])
}

export type ChecklistItemRow = {
  id: number
  job_id: number
  template_checklist_item_id: number | null
  label: string
  is_required: number
  is_checked: number
  checked_at: string | null
  sequence: number
}

export async function listJobChecklist(db: SqlDb, jobId: number): Promise<ChecklistItemRow[]> {
  await ensureSchema(db)
  const rows = await db.select<{
    id: number
    job_id: number
    template_checklist_item_id: number | null
    label: string
    is_required: number
    is_checked: number
    checked_at: string | null
    sequence: number | null
  }>(
    `SELECT c.id, c.job_id, c.template_checklist_item_id, c.label, c.is_required, c.is_checked, c.checked_at,
            ifnull(t.sequence, 1000) AS sequence
     FROM job_checklist_items c
     LEFT JOIN template_checklist_items t ON t.id = c.template_checklist_item_id
     WHERE c.job_id = ?
     ORDER BY sequence, c.label, c.id`,
    [jobId],
  )
  return rows.map((row) => ({
    id: Number(row.id),
    job_id: Number(row.job_id),
    template_checklist_item_id: row.template_checklist_item_id == null ? null : Number(row.template_checklist_item_id),
    label: String(row.label),
    is_required: Number(row.is_required) ? 1 : 0,
    is_checked: Number(row.is_checked) ? 1 : 0,
    checked_at: row.checked_at == null ? null : String(row.checked_at),
    sequence: Number(row.sequence ?? 1000),
  }))
}

export async function setChecklistChecked(db: SqlDb, itemId: number, checked: boolean): Promise<void> {
  await ensureSchema(db)
  await db.execute(
    `UPDATE job_checklist_items
     SET is_checked = ?, checked_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
     WHERE id = ?`,
    [checked ? 1 : 0, checked ? 1 : 0, itemId],
  )
}

/** Copy missing template items onto the job and remember which template was applied. */
export async function applyTemplateToJob(db: SqlDb, jobId: number, templateId: number): Promise<{ added: number }> {
  await ensureSchema(db)
  const job = await db.select<{ id: number }>(`SELECT id FROM jobs WHERE id = ? LIMIT 1`, [jobId])
  if (!job[0]) throw new Error('That job is no longer in the local database.')
  const template = (await listTemplates(db)).find((row) => row.id === templateId)
  if (!template) throw new Error('That template is no longer in the local database.')
  const existing = await listJobChecklist(db, jobId)
  const copies = itemsToCopyFromTemplate(template.items, existing)
  await db.execute(`UPDATE jobs SET template_id = ?, updated_at = datetime('now') WHERE id = ?`, [templateId, jobId])
  for (const copy of copies) {
    await db.execute(
      `INSERT INTO job_checklist_items (job_id, template_checklist_item_id, label, is_required, is_checked)
       VALUES (?, ?, ?, ?, 0)`,
      [jobId, copy.template_checklist_item_id, copy.label, copy.is_required ? 1 : 0],
    )
  }
  return { added: copies.length }
}

function parseCachedLegs(raw: string): DriveLeg[] | null {
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return null
    return value as DriveLeg[]
  } catch {
    return null
  }
}

export function sqliteDriveTimeCache(db: SqlDb): DriveTimeCacheStore {
  return {
    async get(technicianName, scheduleDate) {
      await ensureSchema(db)
      const rows = await db.select<{
        fingerprint: string
        include_yard: number
        legs_json: string
        provider: string
        computed_at: string
      }>(
        `SELECT fingerprint, include_yard, legs_json, provider, computed_at
         FROM drive_time_cache WHERE technician_name = ? AND schedule_date = ? LIMIT 1`,
        [technicianName, scheduleDate],
      )
      const row = rows[0]
      if (!row) return null
      const legs = parseCachedLegs(String(row.legs_json))
      if (!legs) return null
      return {
        technicianName,
        scheduleDate,
        fingerprint: String(row.fingerprint),
        includeYard: Number(row.include_yard) !== 0,
        legs,
        provider: String(row.provider),
        computedAt: String(row.computed_at),
      }
    },
    async set(row: CachedDriveTimes) {
      await ensureSchema(db)
      await db.execute(
        `INSERT INTO drive_time_cache (
           technician_name, schedule_date, fingerprint, include_yard, legs_json, provider, computed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(technician_name, schedule_date) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           include_yard = excluded.include_yard,
           legs_json = excluded.legs_json,
           provider = excluded.provider,
           computed_at = excluded.computed_at`,
        [
          row.technicianName,
          row.scheduleDate,
          row.fingerprint,
          row.includeYard ? 1 : 0,
          JSON.stringify(row.legs),
          row.provider,
          row.computedAt,
        ],
      )
    },
  }
}

const CAPACITY_SHEET_LOCKED =
  'Capacity blocks only edit the label, technician, date, begin, end, and activity.'

/**
 * One sheet cell. Planning strings go through `saveJob` (the drawer path).
 * Zone, mismatch, and coordinates are columns the drawer does not type, so
 * they are written after that save. A street change still clears a stale pin
 * unless this patch also sets latitude and longitude.
 */
export async function applySheetPatch(db: SqlDb, id: number, patch: SheetPatch): Promise<void> {
  await ensureSchema(db)
  const existing = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [id])
  const current = existing[0]
  if (!current) throw new Error('That job is no longer in the local database.')

  const keys = Object.keys(patch) as Array<keyof SheetPatch>
  if (keys.length === 0) return
  if (current.is_capacity_block) {
    for (const key of keys) {
      if (!SHEET_CAPACITY_KEYS.has(key)) throw new Error(CAPACITY_SHEET_LOCKED)
    }
  }

  const draft = draftFromJob(current)
  let planning = false
  for (const key of SHEET_DRAFT_KEYS) {
    const value = patch[key]
    if (value === undefined) continue
    draft[key] = value
    planning = true
  }
  if (planning) await saveJob(db, draft)

  if (patch.zone_code !== undefined && !current.is_capacity_block) {
    await db.execute(`UPDATE jobs SET zone_code = ?, updated_at = datetime('now') WHERE id = ?`, [
      blankToNull(patch.zone_code),
      id,
    ])
  }
  if (patch.mismatch_flag !== undefined && !current.is_capacity_block) {
    await db.execute(`UPDATE jobs SET mismatch_flag = ?, updated_at = datetime('now') WHERE id = ?`, [
      patch.mismatch_flag ? 1 : 0,
      id,
    ])
  }
  if ((patch.lat !== undefined || patch.lng !== undefined) && !current.is_capacity_block) {
    const fresh = await db.select<JobRow>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ? LIMIT 1`, [id])
    const row = fresh[0] ?? current
    const lat = patch.lat !== undefined ? patch.lat : asCoord(row.lat)
    const lng = patch.lng !== undefined ? patch.lng : asCoord(row.lng)
    const source = lat != null && lng != null ? 'manual' : 'none'
    await db.execute(
      `UPDATE jobs SET lat = ?, lng = ?, geocode_source = ?, updated_at = datetime('now') WHERE id = ?`,
      [lat, lng, source, id],
    )
  }
}

function backlogWriteError(error: unknown, type: BacklogType): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/unique/i.test(message) && type === 'lockout') {
    return new Error('An open lockout already exists for this customer number.')
  }
  return error instanceof Error ? error : new Error(message)
}

function backlogText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length ? trimmed : null
}

function parseCoord(value: string, label: string, min: number, max: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}.`)
  }
  return n
}

type BacklogSqlRow = {
  id: number
  backlog_type: string
  campaign: string | null
  customer_number: string | null
  customer_name: string | null
  address_raw: string | null
  address_street: string | null
  address_city_state_zip: string | null
  lat: number | string | null
  lng: number | string | null
  geocode_source: string | null
  zone_code: string | null
  priority: string
  status: string
  promoted_job_id: number | null
  notes: string | null
  source_list: string | null
  last_verified_at: string | null
}

function asBacklogItem(row: BacklogSqlRow): BacklogItem {
  const type = String(row.backlog_type)
  const status = String(row.status)
  const priority = String(row.priority)
  if (!isBacklogType(type) || !isBacklogStatus(status) || !isBacklogPriority(priority)) {
    throw new Error('A backlog row on this PC has a type or status this app does not use.')
  }
  return {
    id: Number(row.id),
    backlog_type: type,
    campaign: row.campaign,
    customer_number: row.customer_number,
    customer_name: row.customer_name,
    address_raw: row.address_raw,
    address_street: row.address_street,
    address_city_state_zip: row.address_city_state_zip,
    lat: asCoord(row.lat),
    lng: asCoord(row.lng),
    geocode_source: row.geocode_source ?? 'none',
    zone_code: row.zone_code,
    priority,
    status,
    promoted_job_id: row.promoted_job_id == null ? null : Number(row.promoted_job_id),
    notes: row.notes,
    source_list: row.source_list,
    last_verified_at: row.last_verified_at,
  }
}

const BACKLOG_COLUMNS = `id, backlog_type, campaign, customer_number, customer_name, address_raw,
  address_street, address_city_state_zip, lat, lng, geocode_source, zone_code, priority, status,
  promoted_job_id, notes, source_list, last_verified_at`

export async function listBacklog(db: SqlDb, query = ''): Promise<BacklogItem[]> {
  await ensureSchema(db)
  const trimmed = query.trim()
  const rows = trimmed
    ? await db.select<BacklogSqlRow>(
        `SELECT ${BACKLOG_COLUMNS} FROM backlog_items
         WHERE customer_name LIKE ? ESCAPE '\\'
            OR ifnull(customer_number, '') LIKE ? ESCAPE '\\'
            OR ifnull(address_raw, '') LIKE ? ESCAPE '\\'
            OR ifnull(address_street, '') LIKE ? ESCAPE '\\'
            OR ifnull(notes, '') LIKE ? ESCAPE '\\'
            OR ifnull(campaign, '') LIKE ? ESCAPE '\\'
            OR ifnull(zone_code, '') LIKE ? ESCAPE '\\'
            OR backlog_type LIKE ? ESCAPE '\\'
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'promoted' THEN 1 ELSE 2 END,
                  ifnull(customer_name, ''), id`,
        Array.from({ length: 8 }, () => `%${escapeLike(trimmed)}%`),
      )
    : await db.select<BacklogSqlRow>(
        `SELECT ${BACKLOG_COLUMNS} FROM backlog_items
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'promoted' THEN 1 ELSE 2 END,
                  ifnull(customer_name, ''), id`,
      )
  return rows.map(asBacklogItem)
}

export async function saveBacklog(db: SqlDb, draft: BacklogDraft): Promise<BacklogItem> {
  await ensureSchema(db)
  if (!isBacklogType(draft.backlog_type)) throw new Error('Choose a backlog type.')
  if (!isBacklogPriority(draft.priority)) throw new Error('Priority must be low, normal, or high.')
  if (!isBacklogStatus(draft.status)) throw new Error('Status must be open, promoted, complete, or cancelled.')
  const lat = parseCoord(draft.lat, 'Latitude', -90, 90)
  const lng = parseCoord(draft.lng, 'Longitude', -180, 180)
  const geocode_source = lat != null && lng != null ? 'manual' : 'none'
  const fields = [
    draft.backlog_type,
    backlogText(draft.campaign),
    backlogText(draft.customer_number),
    backlogText(draft.customer_name),
    backlogText(draft.address_raw),
    backlogText(draft.address_street),
    backlogText(draft.address_city_state_zip),
    lat,
    lng,
    geocode_source,
    backlogText(draft.zone_code),
    draft.priority,
    backlogText(draft.notes),
  ]

  if (draft.id == null) {
    if (draft.status === 'promoted') throw new Error('Use Promote to create the tentative job.')
    const inserted = await db.execute(
      `INSERT INTO backlog_items (
         backlog_type, campaign, customer_number, customer_name, address_raw, address_street,
         address_city_state_zip, lat, lng, geocode_source, zone_code, priority, status, notes, source_list, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', datetime('now'))`,
      [...fields.slice(0, 12), draft.status, fields[12]],
    ).catch((error: unknown) => {
      throw backlogWriteError(error, draft.backlog_type)
    })
    const id = requireInsertId(inserted)
    const saved = await listBacklog(db)
    const item = saved.find((row) => row.id === id)
    if (!item) throw new Error('The backlog item was not saved.')
    return item
  }

  const existing = await db.select<BacklogSqlRow>(
    `SELECT ${BACKLOG_COLUMNS} FROM backlog_items WHERE id = ? LIMIT 1`,
    [draft.id],
  )
  const current = existing[0] ? asBacklogItem(existing[0]) : null
  if (!current) throw new Error('That backlog item is no longer in the local database.')
  if (draft.status === 'promoted' && current.promoted_job_id == null) {
    throw new Error('Use Promote to create the tentative job.')
  }
  await db.execute(
    `UPDATE backlog_items SET
       backlog_type = ?, campaign = ?, customer_number = ?, customer_name = ?, address_raw = ?,
       address_street = ?, address_city_state_zip = ?, lat = ?, lng = ?, geocode_source = ?,
       zone_code = ?, priority = ?, status = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [...fields.slice(0, 12), draft.status, fields[12], current.id],
  ).catch((error: unknown) => {
    throw backlogWriteError(error, draft.backlog_type)
  })
  const saved = await listBacklog(db)
  const item = saved.find((row) => row.id === current.id)
  if (!item) throw new Error('The backlog item was not saved.')
  return item
}

export async function deleteBacklog(db: SqlDb, id: number): Promise<void> {
  await ensureSchema(db)
  await db.execute('DELETE FROM backlog_items WHERE id = ?', [id])
}

/**
 * Promote an open backlog item to a tentative job (no work order).
 * Sets status to promoted and stores promoted_job_id.
 * Copies a matching template checklist when one exists.
 */
export async function promoteBacklogItem(
  db: SqlDb,
  id: number,
  input: { schedule_date: string | null; technician_name: string | null },
): Promise<{ jobId: number; item: BacklogItem }> {
  await ensureSchema(db)
  const existing = await db.select<BacklogSqlRow>(
    `SELECT ${BACKLOG_COLUMNS} FROM backlog_items WHERE id = ? LIMIT 1`,
    [id],
  )
  const item = existing[0] ? asBacklogItem(existing[0]) : null
  if (!item) throw new Error('That backlog item is no longer in the local database.')
  if (!canPromoteBacklog(item)) {
    throw new Error('Only open backlog items that are not already linked can be promoted.')
  }

  const activity = promoteActivityCode(item.backlog_type)
  const draft = blankJobDraft()
  draft.customer_name = item.customer_name?.trim() || 'Backlog item'
  draft.customer_number = item.customer_number ?? ''
  draft.address_raw = item.address_raw ?? ''
  draft.address_street = item.address_street?.trim() || item.address_raw?.trim() || ''
  draft.address_city_state_zip = item.address_city_state_zip ?? ''
  draft.service_zone = item.zone_code ?? ''
  draft.technician_name = input.technician_name?.trim() ?? ''
  draft.schedule_date = input.schedule_date?.trim() ?? ''
  draft.activity_1 = activity
  draft.activity_note = `Promoted from ${item.backlog_type.replaceAll('_', ' ')} backlog`
  const created = await saveJob(db, draft)

  if (item.lat != null && item.lng != null) {
    await db.execute(
      `UPDATE jobs SET lat = ?, lng = ?, geocode_source = ?, updated_at = datetime('now') WHERE id = ?`,
      [item.lat, item.lng, item.geocode_source && item.geocode_source !== 'none' ? item.geocode_source : 'manual', created.id],
    )
  }
  if (item.zone_code) {
    await db.execute(`UPDATE jobs SET zone_code = ? WHERE id = ?`, [item.zone_code, created.id])
  }

  const templates = await listTemplates(db)
  const templateId = suggestTemplateId(activity, templates)
  if (templateId != null) await applyTemplateToJob(db, created.id, templateId)

  await db.execute(
    `UPDATE backlog_items
     SET status = 'promoted', promoted_job_id = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'open' AND promoted_job_id IS NULL`,
    [created.id, item.id],
  )
  const linkedRows = await db.select<BacklogSqlRow>(
    `SELECT ${BACKLOG_COLUMNS} FROM backlog_items WHERE id = ? LIMIT 1`,
    [item.id],
  )
  const linked = linkedRows[0] ? asBacklogItem(linkedRows[0]) : null
  if (!linked || linked.status !== 'promoted' || linked.promoted_job_id !== created.id) {
    throw new Error('The tentative job was created but the backlog link did not save.')
  }
  return { jobId: created.id, item: linked }
}
