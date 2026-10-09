import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { recordsFromBytes } from './add.ts'
import { listHistory } from './history.ts'
import { applyImport, applySheetPatch, clearScheduledJobs, draftFromJob, listJobs, saveJob, wipeDatabase, type SqlDb } from './store.ts'

const require = createRequire(import.meta.url)
const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
const raw = new SQL.Database()
const db: SqlDb = {
  async execute(sql, params) {
    if (params?.length) raw.run(sql, params as never)
    else raw.run(sql)
    const s = raw.prepare('SELECT last_insert_rowid() AS id')
    const id = s.step() ? (s.getAsObject().id as number) : null
    s.free()
    return { lastInsertId: id && id > 0 ? id : null }
  },
  async select(sql, params) {
    const s = raw.prepare(sql)
    if (params?.length) s.bind(params as never)
    const out: Record<string, unknown>[] = []
    while (s.step()) out.push(s.getAsObject())
    s.free()
    return out as never
  },
}

const fixture = path.resolve(import.meta.dirname, '../../fixtures/add-export-sample.csv')
const rows = recordsFromBytes(fs.readFileSync(fixture))
await applyImport(db, rows, { updateMatched: true })
const jobs = await listJobs(db, { date: '', query: '' })
const wo = jobs.find((j) => !j.is_capacity_block && j.wo_number)!

// Import itself writes no history.
assert.equal((await listHistory(db, wo.id)).length, 0)

// Drawer save logs the changed fields only.
const draft = draftFromJob(wo)
draft.activity_note = 'Call before arriving'
draft.technician_name = 'NEW TECH'
await saveJob(db, draft)
let h = await listHistory(db, wo.id)
assert.equal(h.length, 1)
assert.equal(h[0]!.source, 'edit')
assert.deepEqual(h[0]!.changes.map((c) => c.label).sort(), ['Note', 'Technician'])
assert.equal(h[0]!.changes.find((c) => c.label === 'Note')!.to, 'Call before arriving')

// Saving with no change logs nothing.
await saveJob(db, draftFromJob((await listJobs(db, { date: '', query: '' })).find((j) => j.id === wo.id)!))
assert.equal((await listHistory(db, wo.id)).length, 1)

// A Sheet cell edit logs once, even though it goes through the drawer save.
await applySheetPatch(db, wo.id, { activity_note: 'Gate code 1234' })
h = await listHistory(db, wo.id)
assert.equal(h.length, 2)
assert.equal(h[0]!.source, 'sheet')

// Zone is written outside the drawer save and is still logged.
await applySheetPatch(db, wo.id, { zone_code: 'Z9' })
h = await listHistory(db, wo.id)
assert.equal(h.length, 3)
assert.deepEqual(h[0]!.changes.map((c) => c.label), ['Zone'])

// Only the newest 50 are kept.
for (let i = 0; i < 55; i++) {
  await applySheetPatch(db, wo.id, { activity_note: `note ${i}` })
}
assert.equal((await listHistory(db, wo.id)).length, 50)

// Clearing dated jobs and wiping both remove history.
await clearScheduledJobs(db)
const left = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM job_history WHERE job_id = ?', [wo.id])
assert.equal(Number(left[0]!.n), 0)
await wipeDatabase(db)
assert.equal(Number((await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM job_history'))[0]!.n), 0)
console.log('history.test.ts: ok')
