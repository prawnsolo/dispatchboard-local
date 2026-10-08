import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import {
  DAY_GRID_PX_PER_HOUR,
  UNASSIGNED_TECH,
  addDaysYmd,
  assignOverlapLanes,
  calendarKind,
  canDragJob,
  dropToSchedulePatch,
  glanceLocation,
  weekStartOf,
  yOffsetToMinutes,
} from './schedule.ts'
import {
  blankJobDraft,
  clearScheduledJobs,
  countRows,
  listJobs,
  MOVE_CAPACITY_LOCKED,
  MOVE_WO_LOCKED,
  moveJobSchedule,
  saveJob,
  type SqlDb,
} from './store.ts'
import { makeUndoEntry, popUndo, pruneExpired, pushUndo, snapshotFromJob, UNDO_STACK_MAX, UNDO_TTL_MS } from './undo.ts'

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

assert.equal(canDragJob({ wo_number: null, is_capacity_block: 0 }), true)
assert.equal(canDragJob({ wo_number: '  ', is_capacity_block: 0 }), true)
assert.equal(canDragJob({ wo_number: '90001', is_capacity_block: 0 }), false)
assert.equal(canDragJob({ wo_number: null, is_capacity_block: 1 }), false)
assert.equal(canDragJob({ wo_number: null, is_capacity_block: '0' as unknown as number }), true)
assert.equal(canDragJob({ wo_number: null, is_capacity_block: '1' as unknown as number }), false)

assert.equal(calendarKind({ wo_number: null, is_capacity_block: 0 }), 'tentative')
assert.equal(calendarKind({ wo_number: '90001', is_capacity_block: 0 }), 'in_pegasus')
assert.equal(calendarKind({ wo_number: null, is_capacity_block: 1 }), 'capacity')
assert.equal(glanceLocation({ address_street: '1 Main', city: 'Fredericksburg' }), '1 Main · Fredericksburg')


assert.equal(weekStartOf('2026-09-02'), '2026-08-31')
assert.equal(addDaysYmd('2026-09-02', 7), '2026-09-09')
assert.equal(yOffsetToMinutes(0), 7 * 60)
assert.equal(yOffsetToMinutes(2 * DAY_GRID_PX_PER_HOUR), 9 * 60)

const dropped = dropToSchedulePatch(
  { begin_time: '15:00:00', end_time: '16:30:00' },
  '2026-09-11',
  UNASSIGNED_TECH,
  9 * 60,
)
assert.equal(dropped.schedule_date, '2026-09-11')
assert.equal(dropped.technician_name, null)
assert.equal(dropped.begin_time, '09:00:00')
assert.equal(dropped.end_time, '10:30:00')

const lanes = assignOverlapLanes([
  { id: 1, begin_time: '09:00:00', end_time: '10:00:00' },
  { id: 2, begin_time: '09:30:00', end_time: '11:00:00' },
])
assert.equal(lanes.get('1')?.laneCount, 2)
assert.equal(lanes.get('2')?.laneCount, 2)
assert.notEqual(lanes.get('1')?.lane, lanes.get('2')?.lane)

const now = 1_000_000
const older = makeUndoEntry(
  { jobId: 1, customerName: 'A', schedule_date: '2026-09-01', technician_name: 'A', begin_time: null, end_time: null },
  now,
)
const entries = [2, 3, 4].map((id) =>
  makeUndoEntry(
    {
      jobId: id,
      customerName: `C${id}`,
      schedule_date: '2026-09-02',
      technician_name: 'T',
      begin_time: '09:00:00',
      end_time: '10:00:00',
    },
    now + id,
  ),
)
let stack = pushUndo([], older, now)
for (const entry of entries) stack = pushUndo(stack, entry, now + 10)
assert.equal(stack.length, UNDO_STACK_MAX)
assert.equal(stack[0]?.previous.jobId, 2)
assert.equal(stack.at(-1)?.previous.jobId, 4)
assert.equal(pruneExpired(stack, now + 10 + UNDO_TTL_MS).length, 0)
const popped = popUndo(stack)
assert.equal(popped.entry?.previous.jobId, 4)
assert.equal(popped.stack.length, 2)

const db = await memoryDb()
const created = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'TENTATIVE CO',
  technician_name: 'ADA LOVELACE',
  schedule_date: '2026-09-10',
  begin_time: '09:00',
  end_time: '10:30',
  activity_1: 'SURVEY',
})
const before = (await listJobs(db, { date: '2026-09-10', query: '' })).find((row) => row.id === created.id)
assert.ok(before)
const previous = snapshotFromJob(before)

await moveJobSchedule(db, created.id, {
  technician_name: 'CHAD TAYLOR',
  schedule_date: '2026-09-11',
  begin_time: '11:00',
  end_time: '12:30',
})
const moved = (await listJobs(db, { date: '2026-09-11', query: 'tentative' }))[0]
assert.ok(moved)
assert.equal(moved.technician_name, 'CHAD TAYLOR')
assert.equal(moved.begin_time, '11:00:00')
assert.equal(moved.end_time, '12:30:00')
assert.equal(moved.customer_name, 'TENTATIVE CO')
assert.equal(moved.wo_number, null)

await moveJobSchedule(db, created.id, {
  technician_name: 'WEEK TECH',
  schedule_date: '2026-09-12',
})
const weekMoved = (await listJobs(db, { date: '2026-09-12', query: '' }))[0]
assert.equal(weekMoved?.technician_name, 'WEEK TECH')
assert.equal(weekMoved?.begin_time, '11:00:00')
assert.equal(weekMoved?.end_time, '12:30:00')

await moveJobSchedule(db, created.id, {
  technician_name: previous.technician_name,
  schedule_date: previous.schedule_date,
  begin_time: previous.begin_time,
  end_time: previous.end_time,
})
const restored = (await listJobs(db, { date: '2026-09-10', query: 'tentative' }))[0]
assert.equal(restored?.technician_name, 'ADA LOVELACE')
assert.equal(restored?.begin_time, '09:00:00')
assert.equal(restored?.end_time, '10:30:00')

await db.execute('UPDATE jobs SET wo_number = ? WHERE id = ?', ['90001', created.id])
const woRow = (await listJobs(db, { date: '2026-09-10', query: '' })).find((row) => row.id === created.id)
assert.equal(woRow?.wo_number, '90001')
await assert.rejects(
  moveJobSchedule(db, created.id, { technician_name: 'NOPE', schedule_date: '2026-09-15' }),
  new RegExp(MOVE_WO_LOCKED),
)
const woUntouched = (await listJobs(db, { date: '2026-09-10', query: '' })).find((row) => row.id === created.id)
assert.equal(woUntouched?.technician_name, 'ADA LOVELACE')
assert.equal(woUntouched?.schedule_date, '2026-09-10')

await db.execute(
  'UPDATE jobs SET wo_number = NULL, is_capacity_block = 1, capacity_key = ? WHERE id = ?',
  ['ADA|2026-09-10|09:00:00|SURVEY', created.id],
)
await assert.rejects(
  moveJobSchedule(db, created.id, { technician_name: 'NOPE', schedule_date: '2026-09-15' }),
  new RegExp(MOVE_CAPACITY_LOCKED),
)

const undated = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'NO DATE CO',
  customer_number: '9001',
  schedule_date: '',
})
const beforeClear = await countRows(db)
assert.equal(beforeClear.jobs, 2)
assert.equal(beforeClear.sites, 1)

const cleared = await clearScheduledJobs(db)
assert.equal(cleared, 1)
const afterClear = await countRows(db)
assert.equal(afterClear.jobs, 1)
assert.equal(afterClear.sites, 1)
const left = await listJobs(db, { date: '', query: '' })
assert.equal(left.length, 1)
assert.equal(left[0]?.id, undated.id)
assert.equal(left[0]?.schedule_date, null)
assert.equal(await clearScheduledJobs(db), 0)

console.log('schedule move + undo + clear scheduled ok')
