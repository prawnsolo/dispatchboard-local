import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { recordsFromBytes } from './add.ts'
import { describeChange, diffImport } from './import-diff.ts'
import { applyImport, type SqlDb } from './store.ts'

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

// Empty board: everything is new.
const fresh = await diffImport(db, rows)
assert.equal(fresh.added.length, rows.length)
assert.equal(fresh.changed.length, 0)
assert.equal(fresh.missing.length, 0)

// After applying, the same file changes nothing.
await applyImport(db, rows, { updateMatched: true })
const same = await diffImport(db, rows)
assert.equal(same.added.length, 0)
assert.equal(same.changed.length, 0)
assert.equal(same.unchanged, rows.length)

// Edit one job in the file: technician and start time change.
const edited = rows.map((r) => ({ ...r, address: { ...r.address } }))
const target = edited.find((r) => !r.isCapacity && r.woNumber && r.technicianName)
assert.ok(target)
const oldTech = target.technicianName
target.technicianName = 'SOMEONE ELSE'
target.beginTime = '23:00'
const changed = await diffImport(db, edited)
assert.equal(changed.changed.length, 1)
assert.equal(changed.changed[0]?.ref, target.woNumber)
assert.deepEqual(changed.changed[0]?.changes.map((c) => c.label).sort(), ['Start', 'Technician'])
assert.equal(describeChange({ label: 'Technician', from: oldTech ?? '', to: 'SOMEONE ELSE' }), `Technician: ${oldTech} → SOMEONE ELSE`)

// Drop a job from the file: it shows up as missing, because its day is still in the file.
const dropped = edited.filter((r) => r !== target)
const gone = await diffImport(db, dropped)
assert.equal(gone.missing.length, 1)
assert.equal(gone.missing[0]?.ref, target.woNumber)

// Whitespace-only differences are not changes.
const spaced = rows.map((r) => ({ ...r, customerName: `${r.customerName}  ` }))
assert.equal((await diffImport(db, spaced)).changed.length, 0)

// A brand new work order is added.
const extra = [...rows, { ...rows[0]!, woNumber: '99999999', customerName: 'SAMPLE NEW' }]
assert.equal((await diffImport(db, extra)).added.length, 1)

console.log('import-diff.test.ts: ok')
