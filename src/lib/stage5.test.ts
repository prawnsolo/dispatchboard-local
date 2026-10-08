import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { blankBacklogDraft } from './backlog.ts'
import { summarizeNearby } from './proximity.ts'
import { addressPrefillFromNearbyLabel, alreadyOnTarget, scheduleHereKind } from './schedule-here.ts'
import { parseSheetCell, SHEET_COLUMNS, sheetCsv, sheetDisplayValue } from './sheet.ts'
import {
  applySheetPatch,
  blankJobDraft,
  clearScheduledJobs,
  listBacklog,
  listJobChecklist,
  listJobs,
  promoteBacklogItem,
  saveBacklog,
  saveJob,
  saveTemplate,
  wipeDatabase,
  type SqlDb,
} from './store.ts'

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

const customer = SHEET_COLUMNS.find((column) => column.key === 'customer_name')
const lat = SHEET_COLUMNS.find((column) => column.key === 'lat')
assert.ok(customer && lat)
assert.equal(parseSheetCell(customer, '  ').ok, false)
assert.equal(parseSheetCell(lat, '91').ok, false)
const parsed = parseSheetCell(customer, ' After ')
assert.equal(parsed.ok, true)
if (parsed.ok) assert.equal(parsed.patch.customer_name, 'After')

assert.equal(scheduleHereKind({ wo_number: null, is_capacity_block: 0 }), 'tentative-move')
assert.equal(scheduleHereKind({ wo_number: '100', is_capacity_block: 0 }), 'office-edit')
assert.equal(scheduleHereKind({ wo_number: null, is_capacity_block: 1 }), 'blocked')
assert.equal(
  alreadyOnTarget({ schedule_date: '2026-09-28', technician_name: ' CHAD ' }, { date: '2026-09-28', tech: 'CHAD' }),
  true,
)
const prefill = addressPrefillFromNearbyLabel('1 Main St, Fredericksburg, VA 22401')
assert.equal(prefill.address_street, '1 Main St')
assert.match(prefill.address_city_state_zip, /Fredericksburg/)

const center = { lat: 38.3, lng: -77.45, label: 'yard', source: 'census' as const }
const summary = summarizeNearby(
  [
    {
      id: 1,
      customer_name: 'Far',
      technician_name: 'A',
      schedule_date: '2026-09-25',
      begin_time: '09:00:00',
      end_time: '10:00:00',
      activity_1: 'GAS CHECK',
      lat: 38.5,
      lng: -77.45,
      is_capacity_block: 0,
    },
    {
      id: 2,
      customer_name: 'Near',
      technician_name: 'B',
      schedule_date: '2026-10-02',
      begin_time: '11:00:00',
      end_time: null,
      activity_1: null,
      lat: 38.301,
      lng: -77.45,
      is_capacity_block: 0,
    },
    {
      id: 3,
      customer_name: 'Old',
      technician_name: 'A',
      schedule_date: '2026-09-01',
      begin_time: null,
      end_time: null,
      activity_1: null,
      lat: 38.3,
      lng: -77.45,
      is_capacity_block: 0,
    },
    {
      id: 4,
      customer_name: 'Open',
      technician_name: null,
      schedule_date: null,
      begin_time: null,
      end_time: null,
      activity_1: null,
      lat: 38.302,
      lng: -77.45,
      is_capacity_block: 0,
    },
  ],
  [
    {
      id: 9,
      customer_name: 'Pickup',
      backlog_type: 'tank_pickup',
      campaign: null,
      status: 'open',
      lat: 38.301,
      lng: -77.451,
    },
    {
      id: 10,
      customer_name: 'Done',
      backlog_type: 'lockout',
      campaign: null,
      status: 'promoted',
      lat: 38.301,
      lng: -77.451,
    },
  ],
  center,
  30,
  '2026-09-24',
)
assert.equal(summary.days[0]?.date, '2026-10-02')
assert.equal(summary.days.some((day) => day.date === '2026-09-01'), false)
assert.equal(summary.unscheduled.length, 1)
assert.equal(summary.unscheduled[0]?.job.customer_name, 'Open')
assert.equal(summary.backlog.length, 1)
assert.equal(summary.backlog[0]?.item.customer_name, 'Pickup')

const db = await memoryDb()
const created = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'Before',
  technician_name: 'A',
  schedule_date: '2026-09-20',
  begin_time: '09:00',
  activity_1: 'GAS CHECK',
})
await applySheetPatch(db, created.id, { customer_name: 'After', technician_name: 'B', city: 'Fredericksburg' })
await applySheetPatch(db, created.id, { lat: 38.28, lng: -77.45, mismatch_flag: true })
const edited = (await listJobs(db, { date: '', query: '' })).find((job) => job.id === created.id)
assert.ok(edited)
assert.equal(edited.customer_name, 'After')
assert.equal(edited.technician_name, 'B')
assert.equal(edited.city, 'Fredericksburg')
assert.equal(edited.mismatch_flag, 1)
assert.equal(Number(edited.lat).toFixed(2), '38.28')
const csv = sheetCsv([edited])
assert.match(csv, /^WO,Customer,/)
assert.match(csv, /After/)
assert.equal(sheetDisplayValue(edited, customer), 'After')

await db.execute(
  `INSERT INTO jobs (customer_name, is_capacity_block, technician_name, schedule_date, begin_time, activity_1, capacity_key)
   VALUES ('BLOCK', 1, 'TECH', '2026-09-20', '08:00:00', 'OFF', 'cap-sheet-1')`,
)
const capacity = (await listJobs(db, { date: '2026-09-20', query: '' })).find((job) => job.is_capacity_block)
assert.ok(capacity)
await assert.rejects(() => applySheetPatch(db, capacity.id, { customer_number: '999' }), /Capacity blocks/)
await applySheetPatch(db, capacity.id, { technician_name: 'OTHER' })
const movedCapacity = (await listJobs(db, { date: '', query: '' })).find((job) => job.id === capacity.id)
assert.equal(movedCapacity?.technician_name, 'OTHER')

const pickupTemplate = await saveTemplate(db, {
  id: null,
  draft: {
    name: 'Tank pickup',
    matches_activity_code: 'TANK PICK UP',
    card_color: '#333333',
    items: [{ label: 'Call customer', is_required: true }],
  },
})
assert.ok(pickupTemplate.id)
const backlog = await saveBacklog(db, {
  ...blankBacklogDraft(),
  backlog_type: 'tank_pickup',
  customer_name: 'Acme Tanks',
  customer_number: '440',
  address_street: '12 Tank Rd',
  address_city_state_zip: 'Fredericksburg VA 22401',
  lat: '38.30',
  lng: '-77.46',
  zone_code: 'FP-1',
  priority: 'high',
  notes: 'Behind the barn',
})
assert.equal(backlog.status, 'open')
assert.equal(backlog.promoted_job_id, null)
const promoted = await promoteBacklogItem(db, backlog.id, {
  schedule_date: '2026-09-28',
  technician_name: 'CHAD TAYLOR',
})
assert.equal(promoted.item.status, 'promoted')
assert.equal(promoted.item.promoted_job_id, promoted.jobId)
const job = (await listJobs(db, { date: '', query: '' })).find((row) => row.id === promoted.jobId)
assert.ok(job)
assert.equal(job.wo_number, null)
assert.equal(job.is_capacity_block, 0)
assert.equal(job.customer_name, 'Acme Tanks')
assert.equal(job.activity_1, 'TANK PICK UP')
assert.equal(job.schedule_date, '2026-09-28')
assert.equal(job.technician_name, 'CHAD TAYLOR')
assert.equal(job.zone_code, 'FP-1')
assert.ok(job.lat != null && job.lng != null)
const checklist = await listJobChecklist(db, promoted.jobId)
assert.equal(checklist.some((item) => item.label === 'Call customer'), true)
await assert.rejects(
  () => promoteBacklogItem(db, backlog.id, { schedule_date: '2026-09-29', technician_name: null }),
  /open backlog/,
)

const kept = await listBacklog(db)
assert.equal(kept.some((item) => item.id === backlog.id), true)
const cleared = await clearScheduledJobs(db)
assert.ok(cleared >= 1)
const afterClear = (await listBacklog(db)).find((item) => item.id === backlog.id)
assert.ok(afterClear)
assert.equal(afterClear.status, 'promoted')
assert.equal(afterClear.promoted_job_id, null)
assert.equal((await listJobs(db, { date: '2026-09-28', query: '' })).length, 0)

await wipeDatabase(db)
assert.equal((await listBacklog(db)).length, 0)
assert.equal((await listJobs(db, { date: '', query: '' })).length, 0)

console.log('stage5 sheet edit + backlog promote ok')
