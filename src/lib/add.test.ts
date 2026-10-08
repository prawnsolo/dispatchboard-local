import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import * as XLSXMod from 'xlsx'
import { PDR_HEADERS, recordsFromBytes, recordsFromMatrix, summarize } from './add.ts'
import { parseLastApply } from './last-apply.ts'
import {
  applyImport,
  blankJobDraft,
  CAPACITY_KEY_CONFLICT,
  countRows,
  draftFromJob,
  listJobs,
  saveJob,
  type SqlDb,
} from './store.ts'

const XLSX = (XLSXMod as { default?: typeof XLSXMod }).default ?? XLSXMod
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

const fixture = path.resolve(import.meta.dirname, '../../fixtures/add-export-sample.csv')
const sampleRows = recordsFromBytes(fs.readFileSync(fixture))
const sampleSummary = summarize(sampleRows)

assert.equal(sampleSummary.rows, 61, 'sample data rows')
assert.equal(sampleSummary.jobs, 47, 'sample work orders')
assert.equal(sampleSummary.capacity, 14, 'sample capacity blocks')

const first = sampleRows[0]
assert.ok(first)
assert.equal(first.technicianName, 'CHAD TAYLOR')
assert.equal(first.customerNumber, '900001')
assert.equal(first.customerName, 'SAMPLE CUSTOMER 01')
assert.equal(first.accountNum, '90000')
assert.equal(first.zoneCode, 'FP-712')
assert.equal(first.city, 'FREDERICKSBURG')
assert.equal(first.serviceLocationNumber, 1)
assert.equal(first.woNumber, '90001')
assert.equal(first.isCapacity, false)
assert.equal(first.scheduleDate, '2026-09-02')
assert.equal(first.beginTime, '15:00:00')
assert.equal(first.endTime, '16:30:00')
assert.equal(first.activity1, 'APPLIANCE (CONVERT)')
assert.equal(first.address.street, '100 SAMPLE HOLLOW TR')
assert.equal(first.address.descriptor, 'LANDLORD')
assert.equal(first.address.cityStateZip, 'FREDERICKSBURG VA 22408')

const capacity = sampleRows.find((row) => row.isCapacity)
assert.ok(capacity)
assert.equal(capacity.woNumber, null)
assert.ok(capacity.capacityKey?.includes(capacity.technicianName ?? ''))

assert.throws(() => recordsFromMatrix([['Technician'], ['ADA']]), /Missing columns/)

const workbookRow = [
  'ADA LOVELACE',
  100,
  'SAMPLE CUSTOMER',
  'FP-1 - TEST',
  'FREDERICKSBURG',
  2,
  4242,
  46267,
  0.5,
  0.55,
  'GAS CHECK',
  '',
  '',
  'SAMPLE CUSTOMER/1 MAIN ST/./FREDERICKSBURG VA 22401',
  'leave note',
  'tank',
  'stage 1',
  100,
]
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[...PDR_HEADERS], workbookRow]), 'Sheet1')
const xlsxBytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
const fromXlsx = recordsFromBytes(xlsxBytes)
assert.equal(fromXlsx.length, 1)
assert.equal(fromXlsx[0]?.woNumber, '4242')
assert.equal(fromXlsx[0]?.scheduleDate, '2026-09-02')
assert.equal(fromXlsx[0]?.beginTime, '12:00:00')
assert.equal(fromXlsx[0]?.address.street, '1 MAIN ST')

const db = await memoryDb()
const firstApply = await applyImport(db, sampleRows, { updateMatched: true })
assert.equal(firstApply.inserted, 61)
assert.equal(firstApply.updated, 0)
assert.equal(firstApply.skipped, 0)
const afterFirst = await countRows(db)
assert.equal(afterFirst.jobs, 61)
assert.ok(afterFirst.sites > 0)
assert.ok(afterFirst.sites <= 47)

const secondApply = await applyImport(db, sampleRows, { updateMatched: true })
assert.equal(secondApply.inserted, 0)
assert.equal(secondApply.updated, 61)
assert.equal((await countRows(db)).jobs, 61)
assert.equal((await countRows(db)).sites, afterFirst.sites)

const fresh = await memoryDb()
await applyImport(fresh, sampleRows, { updateMatched: false })
const skipped = await applyImport(fresh, sampleRows, { updateMatched: false })
assert.equal(skipped.inserted, 0)
assert.equal(skipped.skipped, 61)
assert.equal((await countRows(fresh)).jobs, 61)

const found = await listJobs(db, { date: '2026-09-02', query: 'sample customer 01' })
assert.ok(found.length >= 1)
assert.ok(found.every((row) => row.customer_name.toLowerCase().includes('sample customer 01')))
const dayCount = sampleRows.filter((row) => row.scheduleDate === '2026-09-02').length
const dayRows = await listJobs(db, { date: '2026-09-02', query: '' })
assert.equal(dayRows.length, dayCount)

const literalPercent = await listJobs(db, { date: '', query: '%' })
assert.equal(literalPercent.length, 0)

const editable = (await listJobs(db, { date: '2026-09-02', query: 'sample customer 01' })).find((row) => row.wo_number === '90001')
assert.ok(editable)
const edited = await saveJob(db, {
  ...draftFromJob(editable),
  customer_name: 'EDITED SAMPLE',
  city: 'STAFFORD',
  service_zone: 'FP-1 - TEST',
  activity_note: 'gate code 1234',
  begin_time: '15:15',
})
assert.equal(edited.id, editable.id)
const persisted = await db.select<{
  customer_name: string
  city: string
  zone_code: string
  wo_number: string
  begin_time: string
  activity_note: string
  is_capacity_block: number
}>('SELECT customer_name, city, zone_code, wo_number, begin_time, activity_note, is_capacity_block FROM jobs WHERE id = ?', [
  editable.id,
])
assert.equal(persisted[0]?.customer_name, 'EDITED SAMPLE')
assert.equal(persisted[0]?.city, 'STAFFORD')
assert.equal(persisted[0]?.zone_code, 'FP-1')
assert.equal(persisted[0]?.wo_number, '90001')
assert.equal(persisted[0]?.begin_time, '15:15:00')
assert.equal(persisted[0]?.activity_note, 'gate code 1234')
assert.equal(persisted[0]?.is_capacity_block, 0)
const foundEdited = await listJobs(db, { date: '2026-09-02', query: 'edited sample' })
assert.equal(foundEdited.length, 1)

const site = await db.select<{ customer_name: string; city: string; zone_code: string }>(
  'SELECT customer_name, city, zone_code FROM sites WHERE customer_number = ? AND service_location_number = ?',
  [editable.customer_number, editable.service_location_number ?? 0],
)
assert.equal(site[0]?.customer_name, 'EDITED SAMPLE')
assert.equal(site[0]?.city, 'STAFFORD')
assert.equal(site[0]?.zone_code, 'FP-1')

const created = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'TENTATIVE CO',
  customer_number: '9001',
  account_num: '900',
  technician_name: 'ADA LOVELACE',
  schedule_date: '2026-09-10',
  begin_time: '09:00',
  end_time: '10:30',
  activity_1: 'SURVEY',
  city: 'FREDERICKSBURG',
  address_street: '9 OAK ST',
  address_raw: 'TENTATIVE CO/9 OAK ST//FREDERICKSBURG VA 22401',
  service_instructions: 'call ahead',
})
const tentative = await db.select<{
  id: number
  wo_number: string | null
  is_capacity_block: number
  capacity_key: string | null
  customer_name: string
}>('SELECT id, wo_number, is_capacity_block, capacity_key, customer_name FROM jobs WHERE id = ?', [created.id])
assert.equal(tentative[0]?.wo_number, null)
assert.equal(tentative[0]?.is_capacity_block, 0)
assert.equal(tentative[0]?.capacity_key, null)
assert.equal(tentative[0]?.customer_name, 'TENTATIVE CO')
const foundTentative = await listJobs(db, { date: '2026-09-10', query: 'tentative' })
assert.equal(foundTentative.length, 1)
assert.equal(foundTentative[0]?.id, created.id)
const afterCreate = await countRows(db)
assert.equal(afterCreate.jobs, 62)

const caps = (await listJobs(db, { date: '', query: '' })).filter((row) => row.is_capacity_block)
const capA = caps[0]
const capB = caps[1]
assert.ok(capA && capB)
const capCustomer = capA.customer_number
await saveJob(db, {
  ...draftFromJob(capA),
  customer_name: 'BLOCK LABEL',
  customer_number: 'should-not-write',
  technician_name: 'NEW TECH',
  activity_1: capA.activity_1 ?? '',
})
const capSaved = await db.select<{
  customer_name: string
  customer_number: string | null
  technician_name: string
  capacity_key: string
  wo_number: string | null
  is_capacity_block: number
}>('SELECT customer_name, customer_number, technician_name, capacity_key, wo_number, is_capacity_block FROM jobs WHERE id = ?', [
  capA.id,
])
assert.equal(capSaved[0]?.customer_name, 'BLOCK LABEL')
assert.equal(capSaved[0]?.customer_number, capCustomer)
assert.equal(capSaved[0]?.technician_name, 'NEW TECH')
assert.equal(capSaved[0]?.wo_number, null)
assert.equal(capSaved[0]?.is_capacity_block, 1)
assert.equal(
  capSaved[0]?.capacity_key,
  ['NEW TECH', capA.schedule_date ?? '', capA.begin_time ?? '', capA.activity_1 ?? ''].join('|'),
)
await assert.rejects(
  saveJob(db, {
    ...draftFromJob(capA),
    customer_name: 'BLOCK LABEL',
    technician_name: capB.technician_name ?? '',
    schedule_date: capB.schedule_date ?? '',
    begin_time: capB.begin_time ?? '',
    activity_1: capB.activity_1 ?? '',
  }),
  new RegExp(CAPACITY_KEY_CONFLICT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
)
const capUntouched = await db.select<{ technician_name: string }>('SELECT technician_name FROM jobs WHERE id = ?', [capA.id])
assert.equal(capUntouched[0]?.technician_name, 'NEW TECH')

await assert.rejects(saveJob(db, { ...blankJobDraft(), customer_name: '  ', schedule_date: '2026-09-10' }), /Customer name is required/)
await assert.rejects(
  saveJob(db, { ...blankJobDraft(), customer_name: 'BAD DATE', schedule_date: '09/10/2026' }),
  /Schedule date must be YYYY-MM-DD/,
)
assert.equal((await countRows(db)).jobs, 62)

const parsedApply = parseLastApply(
  JSON.stringify({ at: '2026-09-24T15:04:00.000Z', inserted: 2, updated: 3, skipped: 1, sitesWritten: 2 }),
)
assert.equal(parsedApply?.inserted, 2)
assert.equal(parsedApply?.updated, 3)
assert.equal(parseLastApply('{"at":"nope"}'), null)

console.log(
  `add import ok: ${sampleSummary.rows} rows, ${sampleSummary.jobs} jobs, ${sampleSummary.capacity} capacity, ${afterFirst.sites} sites`,
)
