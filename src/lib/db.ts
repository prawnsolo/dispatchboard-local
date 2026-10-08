import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'
import type { ParsedRow } from './add.ts'
import {
  callGoogleComputeRoutes,
  driveTimeEligibility,
  resolveDriveTimes,
  type DriveJob,
  type DriveTimesOutcome,
} from './drive-times.ts'
import { AUTO_GEOCODE_MIN_GAP_MS, localToday, pickAutoGeocodeIds } from './auto-geocode.ts'
import { geocodeStoredJobs, type LocalGeocodeSummary } from './geocode-db.ts'
import { geocodeWithNominatim, type CensusLookup } from './geocode.ts'
import { readGoogleMapsApiKey } from './google-key.ts'
import { readAllowNetworkGeocoding } from './prefs.ts'
import type { BacklogDraft, BacklogItem } from './backlog.ts'
import type { MismatchRuleDraft } from './mismatch.ts'
import type { SheetPatch } from './sheet.ts'
import type { TemplateDraft } from './templates.ts'
import { ENABLE_JOB_CREATE } from './features.ts'
import { diffImport, type ImportDiff } from './import-diff.ts'
import { listHistory, type HistoryEntry } from './history.ts'
import {
  applyImport,
  applySheetPatch,
  applyTemplateToJob,
  clearScheduledJobs,
  ensureSchema,
  countRows,
  deleteBacklog,
  deleteMismatchRule,
  deleteTemplate,
  listBacklog,
  listDates,
  listJobChecklist,
  listJobs,
  listMismatchRules,
  listTemplates,
  moveJobSchedule,
  promoteBacklogItem,
  saveBacklog,
  saveJob,
  saveManualPin,
  saveMismatchRule,
  saveTemplate,
  setChecklistChecked,
  sqliteDriveTimeCache,
  updateJobAddress,
  wipeDatabase,
  type ApplyOptions,
  type ApplyStats,
  type ChecklistItemRow,
  type DateCount,
  type JobDraft,
  type JobRow,
  type MismatchRuleRow,
  type ScheduleMove,
  type SqlDb,
  type TemplateRow,
} from './store.ts'

/** Must match the filename resolved by the `db_path` command. */
export const DB_URL = 'sqlite:dispatchboard.db'

let opening: Promise<SqlDb> | null = null

async function open(): Promise<SqlDb> {
  opening ??= (async () => {
    const db = await Database.load(DB_URL)
    const adapter: SqlDb = {
      execute(sql, params) {
        const bound = params ? [...params] : []
        const run = bound.length ? db.execute(sql, bound) : db.execute(sql)
        return run.then((result) => ({ lastInsertId: readLastInsertId(result) }))
      },
      select(sql, params) {
        const bound = params ? [...params] : []
        return bound.length ? db.select(sql, bound) : db.select(sql)
      },
    }
    return adapter
  })()
  return opening
}

export function resetDatabaseHandle(): void {
  opening = null
}

function readLastInsertId(result: { lastInsertId?: number | null }): number | null {
  const id = result.lastInsertId
  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) return null
  return id
}

export const WIPE_LOCAL_CONFIRM =
  'Delete every job, checklist, site, backlog item, cached geocode, and cached drive time in the local database on this PC? Mismatch rules and templates stay. The office web app is not affected.'

/** Typed into Settings before dated jobs are deleted. Same word as the office app. */
export const CLEAR_SCHEDULED_CONFIRM = 'CLEAR'

export async function databasePath(): Promise<string> {
  return invoke<string>('db_path')
}

export async function applyRows(rows: ParsedRow[], options: ApplyOptions): Promise<ApplyStats> {
  return applyImport(await open(), rows, options)
}

/** What applying these rows would change. Read-only. */
export async function previewImportDiff(rows: ParsedRow[]): Promise<ImportDiff> {
  return diffImport(await open(), rows)
}

export async function queryJobHistory(jobId: number): Promise<HistoryEntry[]> {
  const db = await open()
  await ensureSchema(db)
  return listHistory(db, jobId)
}

export async function queryJobs(filter: { date: string; query: string }): Promise<JobRow[]> {
  return listJobs(await open(), filter)
}

export async function queryDates(): Promise<DateCount[]> {
  return listDates(await open())
}

export async function queryCounts(): Promise<{ jobs: number; sites: number; backlog: number }> {
  return countRows(await open())
}

function backupStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Consistent snapshot of the database into `<app config>/backups/`. Keeps the
 * newest 14. The copy holds the same customer data as the live file and stays
 * on this PC. Returns the file path.
 */
export async function backupLocalDatabase(): Promise<string> {
  const db = await open()
  const target = await invoke<string>('backup_target', { stamp: backupStamp() })
  await db.execute('VACUUM INTO ?', [target])
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    // storage blocked: the next launch just backs up again
  }
  return target
}

const LAST_BACKUP_KEY = 'dispatchboard.local.lastBackupAt'

/** Backs up at most once per 24 hours. Call once at startup; failures are swallowed. */
export async function backupIfDue(): Promise<string | null> {
  try {
    const last = Number(localStorage.getItem(LAST_BACKUP_KEY) ?? 0)
    if (Date.now() - last < 24 * 60 * 60 * 1000) return null
  } catch {
    // fall through and back up
  }
  try {
    return await backupLocalDatabase()
  } catch {
    return null
  }
}

export type BackupEntry = {
  name: string
  size: number
  modified_ms: number
  before_restore: boolean
}

export async function listLocalBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>('list_backups')
}

/**
 * Schedule a restore and restart the app. The swap itself happens at the next
 * launch, before the database opens (see src-tauri/src/restore.rs). Folding the
 * write-ahead log into the main file first means the copy that gets set aside
 * holds everything saved so far.
 */
export async function restoreFromBackup(name: string): Promise<void> {
  const db = await open()
  try {
    await db.select('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // not in WAL mode or checkpoint refused: the restore still keeps the file as it is
  }
  await invoke('restore_stage', { name })
  await invoke('restart_app')
}

/** Message from a restore that ran at launch, once. */
export async function takeRestoreResult(): Promise<string | null> {
  try {
    return (await invoke<string | null>('restore_result_take')) ?? null
  } catch {
    return null
  }
}

export async function wipeLocalDatabase(): Promise<void> {
  await wipeDatabase(await open())
}

export async function saveLocalJob(draft: JobDraft): Promise<{ id: number }> {
  return saveJob(await open(), draft)
}

export async function moveLocalJob(id: number, move: ScheduleMove): Promise<void> {
  return moveJobSchedule(await open(), id, move)
}

export async function clearScheduledLocalJobs(): Promise<number> {
  return clearScheduledJobs(await open())
}

export async function geocodeLocalJobs(
  ids: number[],
  opts: { allowNetwork: boolean; census?: CensusLookup; delayMs?: number },
): Promise<LocalGeocodeSummary> {
  // Key stays in the OS app config. A missing command or an empty file means no Google step.
  // Order: Census → site pin → Google (key saved) → Nominatim. All GETs run in Rust.
  const googleApiKey = opts.allowNetwork ? await readGoogleMapsApiKey().catch(() => null) : null
  return geocodeStoredJobs(await open(), ids, {
    ...opts,
    googleApiKey,
    nominatim: opts.allowNetwork ? geocodeWithNominatim : undefined,
  })
}

let autoGeocodeRunning = false
let autoGeocodeLastAt = 0

/**
 * Geocode the soonest unmapped jobs without a click: Census, then Google when
 * a key is saved, then OpenStreetMap. Does nothing until network geocoding has
 * been allowed once. Returns how many pins it placed (0 when it did not run).
 */
export async function autoGeocodeUpcoming(): Promise<number> {
  if (!readAllowNetworkGeocoding() || autoGeocodeRunning) return 0
  if (Date.now() - autoGeocodeLastAt < AUTO_GEOCODE_MIN_GAP_MS) return 0
  autoGeocodeRunning = true
  try {
    const rows = await listJobs(await open(), { date: '', query: '' })
    const ids = pickAutoGeocodeIds(rows, localToday())
    if (!ids.length) return 0
    const summary = await geocodeLocalJobs(ids, { allowNetwork: true })
    return summary.geocoded
  } catch {
    return 0
  } finally {
    autoGeocodeLastAt = Date.now()
    autoGeocodeRunning = false
  }
}

export async function saveLocalJobAddress(
  id: number,
  address: { address_street: string | null; address_city_state_zip: string | null },
): Promise<void> {
  return updateJobAddress(await open(), id, address)
}

export async function saveLocalManualPin(input: {
  jobId: number
  lat: number
  lng: number
  saveOnSite: boolean
}): Promise<void> {
  return saveManualPin(await open(), input)
}

export async function queryMismatchRules(): Promise<MismatchRuleRow[]> {
  return listMismatchRules(await open())
}

export async function saveLocalMismatchRule(input: { id: number | null; draft: MismatchRuleDraft }): Promise<MismatchRuleRow> {
  return saveMismatchRule(await open(), input)
}

export async function deleteLocalMismatchRule(id: number): Promise<void> {
  return deleteMismatchRule(await open(), id)
}

export async function queryTemplates(): Promise<TemplateRow[]> {
  return listTemplates(await open())
}

export async function saveLocalTemplate(input: { id: number | null; draft: TemplateDraft }): Promise<TemplateRow> {
  return saveTemplate(await open(), input)
}

export async function deleteLocalTemplate(id: number): Promise<void> {
  return deleteTemplate(await open(), id)
}

export async function queryJobChecklist(jobId: number): Promise<ChecklistItemRow[]> {
  return listJobChecklist(await open(), jobId)
}

export async function setLocalChecklistChecked(itemId: number, checked: boolean): Promise<void> {
  return setChecklistChecked(await open(), itemId, checked)
}

export async function applyLocalTemplate(jobId: number, templateId: number): Promise<{ added: number }> {
  return applyTemplateToJob(await open(), jobId, templateId)
}

export async function checkLocalDriveTimes(input: {
  technicianName: string
  scheduleDate: string
  allDates: boolean
  jobs: JobRow[]
  refresh: boolean
  allowNetwork: boolean
  apiKey: string | null
}): Promise<DriveTimesOutcome> {
  const db = await open()
  const eligibility = driveTimeEligibility({
    techFilter: input.technicianName,
    scheduleDate: input.scheduleDate,
    allDates: input.allDates,
  })
  const jobs: DriveJob[] = input.jobs
    .filter((job) => !job.is_capacity_block)
    .map((job) => ({
      id: String(job.id),
      customer_name: job.customer_name,
      technician_name: job.technician_name,
      schedule_date: job.schedule_date,
      begin_time: job.begin_time,
      lat: job.lat,
      lng: job.lng,
    }))
  return resolveDriveTimes({
    eligibility,
    jobs,
    refresh: input.refresh,
    allowGoogle: input.allowNetwork && Boolean(input.apiKey),
    cache: sqliteDriveTimeCache(db),
    callRoutes: (stops) => callGoogleComputeRoutes(input.apiKey, stops),
  })
}

export async function patchLocalSheetCell(id: number, patch: SheetPatch): Promise<void> {
  return applySheetPatch(await open(), id, patch)
}

export async function queryBacklog(query = ''): Promise<BacklogItem[]> {
  return listBacklog(await open(), query)
}

export async function saveLocalBacklog(draft: BacklogDraft): Promise<BacklogItem> {
  return saveBacklog(await open(), draft)
}

export async function deleteLocalBacklog(id: number): Promise<void> {
  return deleteBacklog(await open(), id)
}

export async function promoteLocalBacklog(
  id: number,
  input: { schedule_date: string | null; technician_name: string | null },
): Promise<{ jobId: number; item: BacklogItem }> {
  if (!ENABLE_JOB_CREATE) {
    throw new Error('Job creation is disabled (ENABLE_JOB_CREATE).')
  }
  return promoteBacklogItem(await open(), id, input)
}
