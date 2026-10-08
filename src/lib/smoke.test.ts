/**
 * Stage 6 smoke: one in-memory SQLite walk of the Stage 1–5 critical paths.
 * Census and Google are mocks. Nothing in this file opens a network socket.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import { PDR_HEADERS, recordsFromBytes, recordsFromMatrix, summarize } from './add.ts'
import { blankBacklogDraft } from './backlog.ts'
import type { CensusLookup } from './geocode.ts'
import { geocodeStoredJobs } from './geocode-db.ts'
import {
  applyImport,
  applySheetPatch,
  applyTemplateToJob,
  blankJobDraft,
  clearScheduledJobs,
  countRows,
  draftFromJob,
  listBacklog,
  listJobChecklist,
  listJobs,
  listMismatchRules,
  listTemplates,
  moveJobSchedule,
  promoteBacklogItem,
  saveBacklog,
  saveJob,
  wipeDatabase,
  type SqlDb,
} from './store.ts'
import { jobHasChecklistFlag, TANK_INSTALL_ITEM } from './templates.ts'
import { makeUndoEntry, popUndo, pushUndo, snapshotFromJob } from './undo.ts'

const require = createRequire(import.meta.url)

type SqlJsDatabase = {
  run(sql: string, params?: readonly unknown[]): void
  prepare(sql: string): {
    bind(params?: readonly unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, string | number | null | Uint8Array>
    free(): void
  }
}

function wrap(db: SqlJsDatabase): SqlDb {
  return {
    async execute(sql, params) {
      if (params && params.length) db.run(sql, params)
      else db.run(sql)
      const idStmt = db.prepare('SELECT last_insert_rowid() AS id')
      const stepped = idStmt.step()
      const row = stepped ? idStmt.getAsObject() : null
      idStmt.free()
      const id = row?.id
      return { lastInsertId: typeof id === 'number' && id > 0 ? id : null }
    },
    async select(sql, params) {
      const stmt = db.prepare(sql)
      if (params && params.length) stmt.bind(params)
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows as never
    },
  }
}

async function memoryDb(): Promise<SqlDb> {
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  return wrap(new SQL.Database() as unknown as SqlJsDatabase)
}

function oneRow(wo: number, activity: string, note: string) {
  const parsed = recordsFromMatrix([
    [...PDR_HEADERS],
    [
      'CHAD TAYLOR',
      '100',
      'SAMPLE CUSTOMER',
      'FP-1 - TEST',
      'FREDERICKSBURG',
      1,
      wo,
      '2026-09-20',
      '09:00',
      '10:00',
      activity,
      '',
      '',
      'SAMPLE CUSTOMER/1 MAIN ST/./FREDERICKSBURG VA 22401',
      '',
      '',
      note,
      '100',
    ],
  ])
  const row = parsed[0]
  assert.ok(row)
  return row
}

const fixture = path.resolve(import.meta.dirname, '../../fixtures/add-export-sample.csv')
const sampleRows = recordsFromBytes(fs.readFileSync(fixture))
const sampleSummary = summarize(sampleRows)
assert.equal(sampleSummary.rows, 61, 'sample data rows')
assert.equal(sampleSummary.jobs, 47, 'sample work orders')
assert.equal(sampleSummary.capacity, 14, 'sample capacity blocks')

const db = await memoryDb()

const applied = await applyImport(db, sampleRows, { updateMatched: true })
assert.equal(applied.inserted, 61)
assert.equal(applied.updated, 0)
assert.equal((await countRows(db)).jobs, 61)
const again = await applyImport(db, sampleRows, { updateMatched: true })
assert.equal(again.inserted, 0)
assert.equal(again.updated, 61)
assert.equal((await countRows(db)).jobs, 61)

const editable = (await listJobs(db, { date: '2026-09-02', query: 'sample customer 01' })).find((row) => row.wo_number === '90001')
assert.ok(editable)
const drawerSaved = await saveJob(db, {
  ...draftFromJob(editable),
  customer_name: 'DRAWER SAMPLE',
  activity_note: 'gate code from drawer',
  begin_time: '15:15',
})
assert.equal(drawerSaved.id, editable.id)
const drawerRow = (
  await db.select<{ customer_name: string; wo_number: string; begin_time: string; activity_note: string }>(
    'SELECT customer_name, wo_number, begin_time, activity_note FROM jobs WHERE id = ?',
    [editable.id],
  )
)[0]
assert.equal(drawerRow?.customer_name, 'DRAWER SAMPLE')
assert.equal(drawerRow?.wo_number, '90001')
assert.equal(drawerRow?.begin_time, '15:15:00')
assert.equal(drawerRow?.activity_note, 'gate code from drawer')

const tentative = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'SMOKE TENTATIVE',
  technician_name: 'ADA LOVELACE',
  schedule_date: '2026-09-10',
  begin_time: '09:00',
  end_time: '10:30',
  activity_1: 'SURVEY',
})
const beforeMove = (await listJobs(db, { date: '2026-09-10', query: 'smoke tentative' })).find((row) => row.id === tentative.id)
assert.ok(beforeMove)
assert.equal(beforeMove.wo_number, null)
const previous = snapshotFromJob(beforeMove)
await moveJobSchedule(db, tentative.id, {
  technician_name: 'CHAD TAYLOR',
  schedule_date: '2026-09-11',
  begin_time: '11:00',
  end_time: '12:30',
})
const moved = (await listJobs(db, { date: '2026-09-11', query: 'smoke tentative' })).find((row) => row.id === tentative.id)
assert.ok(moved)
assert.equal(moved.technician_name, 'CHAD TAYLOR')
assert.equal(moved.begin_time, '11:00:00')
const stack = pushUndo([], makeUndoEntry(previous, 1_000))
const undone = popUndo(stack)
assert.equal(undone.entry?.previous.jobId, tentative.id)
await moveJobSchedule(db, undone.entry!.previous.jobId, {
  technician_name: undone.entry!.previous.technician_name,
  schedule_date: undone.entry!.previous.schedule_date,
  begin_time: undone.entry!.previous.begin_time,
  end_time: undone.entry!.previous.end_time,
})
const restored = (await listJobs(db, { date: '2026-09-10', query: 'smoke tentative' })).find((row) => row.id === tentative.id)
assert.ok(restored)
assert.equal(restored.technician_name, 'ADA LOVELACE')
assert.equal(restored.begin_time, '09:00:00')
assert.equal(restored.end_time, '10:30:00')

let censusCalls = 0
const census: CensusLookup = async (street) => {
  censusCalls += 1
  assert.match(String(street), /SAMPLE HOLLOW/)
  return { lat: 38.301, lng: -77.47, matchedAddress: '100 SAMPLE HOLLOW TR, FREDERICKSBURG, VA, 22408' }
}
const geocoded = await geocodeStoredJobs(db, [editable.id], {
  allowNetwork: true,
  delayMs: 0,
  census,
  google: async () => {
    throw new Error('Google must not run after a mocked Census hit')
  },
})
assert.equal(censusCalls, 1)
assert.equal(geocoded.geocoded, 1)
assert.equal(geocoded.google_calls, 0)
const pin = (
  await db.select<{ geocode_source: string; lat: number }>('SELECT geocode_source, lat FROM jobs WHERE id = ?', [editable.id])
)[0]
assert.equal(pin?.geocode_source, 'census')
assert.equal(pin?.lat, 38.301)
const cache = await db.select<{ address_key: string; geocode_source: string; lat: number }>(
  'SELECT address_key, geocode_source, lat FROM geocode_cache',
)
assert.equal(cache.length, 1)
assert.equal(cache[0]?.geocode_source, 'census')
assert.equal(cache[0]?.address_key, '100 SAMPLE HOLLOW TR|FREDERICKSBURG VA 22408')
assert.equal(cache[0]?.lat, 38.301)

const flagged = await applyImport(db, [oneRow(9101, 'GAS CHECK', 'please do CLEANING')], { updateMatched: true })
assert.equal(flagged.mismatchCount, 1)
const flaggedJob = (await listJobs(db, { date: '2026-09-20', query: '9101' })).find((row) => row.wo_number === '9101')
assert.ok(flaggedJob)
assert.equal(Number(flaggedJob.mismatch_flag), 1)
assert.match(String(flaggedJob.mismatch_note), /GAS CHECK ↔ CLEANING/)

const templates = await listTemplates(db)
const trip1 = templates.find((template) => template.name === 'Tank Install Trip 1')
assert.ok(trip1)
const tank = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'SMOKE TANK',
  activity_1: 'TANK INSTALL (UG)',
  schedule_date: '2026-09-21',
  technician_name: 'CHAD TAYLOR',
})
const copied = await applyTemplateToJob(db, tank.id, trip1.id)
assert.equal(copied.added, 1)
const checklist = await listJobChecklist(db, tank.id)
assert.equal(checklist.some((item) => item.label === TANK_INSTALL_ITEM && item.is_required), true)
assert.equal(jobHasChecklistFlag(checklist), true)

await applySheetPatch(db, tank.id, { customer_name: 'SHEET TANK', city: 'STAFFORD' })
const sheetRow = (await listJobs(db, { date: '2026-09-21', query: 'sheet tank' })).find((row) => row.id === tank.id)
assert.ok(sheetRow)
assert.equal(sheetRow.customer_name, 'SHEET TANK')
assert.equal(sheetRow.city, 'STAFFORD')

const backlog = await saveBacklog(db, {
  ...blankBacklogDraft(),
  customer_name: 'Smoke Pickup',
  customer_number: '7700',
  address_street: '9 OAK ST',
  address_city_state_zip: 'FREDERICKSBURG VA 22401',
  zone_code: 'FP-1',
  notes: 'standing work',
})
assert.equal(backlog.status, 'open')
const promoted = await promoteBacklogItem(db, backlog.id, {
  schedule_date: '2026-09-28',
  technician_name: 'CHAD TAYLOR',
})
assert.equal(promoted.item.status, 'promoted')
assert.equal(promoted.item.promoted_job_id, promoted.jobId)
const promotedJob = (await listJobs(db, { date: '2026-09-28', query: 'smoke pickup' })).find((row) => row.id === promoted.jobId)
assert.ok(promotedJob)
assert.equal(promotedJob.wo_number, null)
assert.equal(promotedJob.is_capacity_block, 0)
assert.equal(promotedJob.activity_1, 'TANK PICK UP')

const undated = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'UNDATED KEEP',
  customer_number: '8800',
  schedule_date: '',
})
const cleared = await clearScheduledJobs(db)
assert.ok(cleared >= 1)
const afterClear = await listJobs(db, { date: '', query: '' })
assert.equal(afterClear.length, 1)
assert.equal(afterClear[0]?.id, undated.id)
const backlogAfterClear = await listBacklog(db)
assert.equal(backlogAfterClear.length, 1)
assert.equal(backlogAfterClear[0]?.status, 'promoted')
assert.equal(backlogAfterClear[0]?.promoted_job_id, null)
assert.equal((await listMismatchRules(db)).length, 1)

await wipeDatabase(db)
assert.equal((await countRows(db)).jobs, 0)
assert.equal((await countRows(db)).backlog, 0)
assert.equal((await listMismatchRules(db)).length, 1)
assert.ok((await listTemplates(db)).some((template) => template.name === 'Tank Install Trip 1'))

console.log('local stage 1–5 smoke ok: import, drawer, move/undo, geocode cache, mismatch, template, sheet, backlog')
