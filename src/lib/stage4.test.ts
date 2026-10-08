import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { PDR_HEADERS, recordsFromMatrix } from './add.ts'
import {
  COMPUTE_ROUTES_URL,
  callGoogleComputeRoutes,
  driveTimeEligibility,
  resolveDriveTimes,
  type DriveJob,
  type RoutesFn,
} from './drive-times.ts'
import { evaluateMismatch } from './mismatch.ts'
import { blankJobDraft, type SqlDb } from './store.ts'
import {
  applyImport,
  applyTemplateToJob,
  ensureSchema,
  listJobChecklist,
  listJobs,
  listMismatchRules,
  listTemplates,
  migrateStage4,
  saveJob,
  saveMismatchRule,
  setChecklistChecked,
  sqliteDriveTimeCache,
} from './store.ts'
import { TANK_INSTALL_ITEM, jobHasChecklistFlag, suggestTemplateId } from './templates.ts'

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

function addRow(wo: number, activity: string, note: string) {
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

const hit = evaluateMismatch(['GAS CHECK'], 'please do CLEANING', [
  { call_reason_pattern: 'GAS CHECK', conflicting_keyword: 'CLEANING', active: true },
])
assert.equal(hit.mismatch_flag, true)
assert.match(hit.mismatch_note ?? '', /GAS CHECK ↔ CLEANING/)
assert.equal(
  evaluateMismatch(['GAS CHECK'], 'please do CLEANING', [
    { call_reason_pattern: 'GAS CHECK', conflicting_keyword: 'CLEANING', active: false },
  ]).mismatch_flag,
  false,
)

const db = await memoryDb()
const rules = await listMismatchRules(db)
assert.equal(rules.length, 1)
assert.equal(rules[0]?.call_reason_pattern, 'GAS CHECK')
assert.equal(rules[0]?.conflicting_keyword, 'CLEANING')
assert.equal(rules[0]?.active, 1)

const templates = await listTemplates(db)
const trip1 = templates.find((template) => template.name === 'Tank Install Trip 1')
const trip2 = templates.find((template) => template.name === 'Tank Install Trip 2')
assert.ok(trip1)
assert.ok(trip2)
assert.equal(trip1.items[0]?.label, TANK_INSTALL_ITEM)
assert.equal(trip1.items[0]?.is_required, 1)
assert.equal(suggestTemplateId('TANK INSTALL (UG)', templates), trip1.id)
assert.equal(suggestTemplateId('REGULATOR (HOOK UP)', templates), trip2.id)

const flagged = await applyImport(db, [addRow(9001, 'GAS CHECK', 'Unit needs CLEANING')], { updateMatched: true })
assert.equal(flagged.inserted, 1)
assert.equal(flagged.mismatchCount, 1)
const flaggedJob = (await listJobs(db, { date: '2026-09-20', query: '' })).find((job) => job.wo_number === '9001')
assert.ok(flaggedJob)
assert.equal(Number(flaggedJob.mismatch_flag), 1)
assert.match(String(flaggedJob.mismatch_note), /GAS CHECK ↔ CLEANING/)

const clean = await applyImport(db, [addRow(9002, 'APPLIANCE (CONVERT)', 'no conflict here')], { updateMatched: true })
assert.equal(clean.mismatchCount, 0)
const cleanJob = (await listJobs(db, { date: '', query: '9002' })).find((job) => job.wo_number === '9002')
assert.equal(Number(cleanJob?.mismatch_flag), 0)

const capacity = await applyImport(db, [addRow(0, 'GAS CHECK', 'CLEANING hold')], { updateMatched: true })
assert.equal(capacity.mismatchCount, 0)
const capacityJob = (await listJobs(db, { date: '2026-09-20', query: '' })).find((job) => job.is_capacity_block)
assert.ok(capacityJob)
assert.equal(Number(capacityJob.mismatch_flag), 0)

await saveMismatchRule(db, {
  id: rules[0]!.id,
  draft: {
    call_reason_pattern: 'GAS CHECK',
    conflicting_keyword: 'CLEANING',
    active: false,
    notes: 'paused',
  },
})
const paused = await applyImport(db, [addRow(9003, 'GAS CHECK', 'still CLEANING')], { updateMatched: true })
assert.equal(paused.inserted, 1)
assert.equal(paused.mismatchCount, 0)

await assert.rejects(
  () =>
    saveMismatchRule(db, {
      id: null,
      draft: { call_reason_pattern: 'gas check', conflicting_keyword: ' cleaning ', active: true, notes: '' },
    }),
  /already exists/,
)

const created = await saveJob(db, {
  ...blankJobDraft(),
  customer_name: 'TANK JOB',
  activity_1: 'TANK INSTALL (UG)',
  schedule_date: '2026-09-21',
  technician_name: 'CHAD TAYLOR',
})
const applied = await applyTemplateToJob(db, created.id, trip1.id)
assert.equal(applied.added, 1)
const checklist = await listJobChecklist(db, created.id)
assert.equal(checklist.length, 1)
assert.equal(checklist[0]?.label, TANK_INSTALL_ITEM)
assert.equal(jobHasChecklistFlag(checklist), true)
const listed = (await listJobs(db, { date: '2026-09-21', query: 'TANK' }))[0]
assert.ok(listed)
assert.ok(Number(listed.checklist_open) > 0)
assert.equal(listed.template_id, trip1.id)

await setChecklistChecked(db, checklist[0]!.id, true)
const afterCheck = await listJobChecklist(db, created.id)
assert.equal(jobHasChecklistFlag(afterCheck), false)
const clearedFlag = (await listJobs(db, { date: '2026-09-21', query: 'TANK' }))[0]
assert.equal(Number(clearedFlag?.checklist_open), 0)

const again = await applyTemplateToJob(db, created.id, trip1.id)
assert.equal(again.added, 0)

function driveJob(partial: Partial<DriveJob> & { id: string }): DriveJob {
  return {
    customer_name: partial.customer_name ?? partial.id,
    begin_time: partial.begin_time ?? '09:00:00',
    lat: partial.lat ?? 38.3,
    lng: partial.lng ?? -77.46,
    technician_name: 'CHAD TAYLOR',
    schedule_date: '2026-09-21',
    ...partial,
  }
}

const driveJobs = [
  driveJob({ id: 'a', begin_time: '09:00:00', lat: 38.29, lng: -77.45, customer_name: 'A' }),
  driveJob({ id: 'b', begin_time: '11:00:00', lat: 38.31, lng: -77.47, customer_name: 'B' }),
]
const eligible = driveTimeEligibility({
  techFilter: 'CHAD TAYLOR',
  scheduleDate: '2026-09-21',
  allDates: false,
})
assert.equal(eligible.ok, true)
assert.equal(
  driveTimeEligibility({ techFilter: '', scheduleDate: '2026-09-21', allDates: false }).ok,
  false,
)
assert.equal(
  driveTimeEligibility({ techFilter: 'CHAD TAYLOR', scheduleDate: '2026-09-21', allDates: true }).reason,
  'multi_day',
)

let routeCalls = 0
const mockRoutes: RoutesFn = async () => {
  routeCalls += 1
  return { ok: true, durationsSeconds: [600, 700, 2401] }
}
const cache = sqliteDriveTimeCache(db)
const firstDrive = await resolveDriveTimes({
  eligibility: eligible,
  jobs: driveJobs,
  cache,
  callRoutes: mockRoutes,
  now: new Date('2026-09-21T15:00:00.000Z'),
})
assert.equal(routeCalls, 1)
assert.equal(firstDrive.googleCalled, true)
assert.equal(firstDrive.legs.length, 3)
assert.equal(firstDrive.legs[2]?.warn, true)
assert.equal(firstDrive.legs[0]?.warn, false)

const secondDrive = await resolveDriveTimes({
  eligibility: eligible,
  jobs: driveJobs,
  cache,
  callRoutes: mockRoutes,
})
assert.equal(routeCalls, 1)
assert.equal(secondDrive.fromCache, true)
assert.equal(secondDrive.googleCalled, false)
assert.equal(secondDrive.legs[2]?.durationSeconds, 2401)

const blocked = await resolveDriveTimes({
  eligibility: eligible,
  jobs: driveJobs,
  allowGoogle: false,
  cache: sqliteDriveTimeCache(await memoryDb()),
  callRoutes: mockRoutes,
})
assert.equal(blocked.googleCalled, false)
assert.equal(routeCalls, 1)

let fetchCalls = 0
const fetched = await callGoogleComputeRoutes(
  'secret-key',
  [
    { lat: 38.284478, lng: -77.4529472 },
    { lat: 38.3, lng: -77.46 },
  ],
  (async (url, init) => {
    fetchCalls += 1
    assert.equal(String(url), COMPUTE_ROUTES_URL)
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('X-Goog-Api-Key'), 'secret-key')
    assert.equal(String(init?.body).includes('secret-key'), false)
    return new Response(JSON.stringify({ routes: [{ legs: [{ duration: '1900s' }] }] }), { status: 200 })
  }) as typeof fetch,
)
assert.equal(fetchCalls, 1)
assert.equal(fetched.ok, true)
if (fetched.ok) assert.deepEqual(fetched.durationsSeconds, [1900])

let skippedFetch = 0
const skipped = await callGoogleComputeRoutes(null, [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], (async () => {
  skippedFetch += 1
  return new Response('{}')
}) as typeof fetch)
assert.equal(skipped.ok, false)
if (!skipped.ok) assert.equal(skipped.skipped, true)
assert.equal(skippedFetch, 0)

// Re-running migrate/seed on a database that already has the built-in rows must
// not throw UNIQUE on templates.name or the mismatch rule, and must not rewrite
// a template or rule the user already changed. Jobs stay put.
const seeded = await memoryDb()
await ensureSchema(seeded)
await migrateStage4(seeded)
await migrateStage4(seeded)
assert.equal((await listTemplates(seeded)).length, 2)
assert.equal((await listMismatchRules(seeded)).length, 1)

await seeded.execute(
  `UPDATE templates SET card_color = '#111111', matches_activity_code = 'CUSTOM CODE' WHERE name = ?`,
  ['Tank Install Trip 1'],
)
await seeded.execute(
  `UPDATE template_checklist_items SET label = 'User kept this' WHERE template_id = (SELECT id FROM templates WHERE name = ?)`,
  ['Tank Install Trip 1'],
)
await seeded.execute(`UPDATE mismatch_rules SET notes = 'user note', active = 0 WHERE call_reason_pattern = 'GAS CHECK'`)
const keptJob = await applyImport(seeded, [addRow(9100, 'GAS CHECK', 'leave this job')], { updateMatched: true })
assert.equal(keptJob.inserted, 1)
await migrateStage4(seeded)
const edited = (await listTemplates(seeded)).find((template) => template.name === 'Tank Install Trip 1')
assert.equal(edited?.card_color, '#111111')
assert.equal(edited?.matches_activity_code, 'CUSTOM CODE')
assert.equal(edited?.items.length, 1)
assert.equal(edited?.items[0]?.label, 'User kept this')
const editedRule = (await listMismatchRules(seeded)).find((rule) => rule.call_reason_pattern === 'GAS CHECK')
assert.equal(editedRule?.notes, 'user note')
assert.equal(editedRule?.active, 0)
assert.equal((await listJobs(seeded, { date: '', query: '9100' })).length, 1)

// Two overlapping migrates both observe an empty table (the Jobs screen opens
// two queries together). The second insert must not throw.
const raced = await memoryDb()
await ensureSchema(raced)
await raced.execute('DELETE FROM template_checklist_items')
await raced.execute('DELETE FROM templates')
await raced.execute('DELETE FROM mismatch_rules')
await Promise.all([migrateStage4(raced), migrateStage4(raced)])
const racedNames = (await listTemplates(raced)).map((template) => template.name).sort()
assert.deepEqual(racedNames, ['Tank Install Trip 1', 'Tank Install Trip 2'])
for (const template of await listTemplates(raced)) {
  assert.equal(template.items.length, 1)
  assert.equal(template.items[0]?.label, TANK_INSTALL_ITEM)
}
assert.equal((await listMismatchRules(raced)).length, 1)

const freshOpen = await memoryDb()
await Promise.all([ensureSchema(freshOpen), ensureSchema(freshOpen)])
assert.equal((await listTemplates(freshOpen)).length, 2)
assert.equal((await listMismatchRules(freshOpen)).length, 1)

// A database that already has a template is not refilled with the built-ins.
const customDb = await memoryDb()
await ensureSchema(customDb)
await customDb.execute('DELETE FROM template_checklist_items')
await customDb.execute('DELETE FROM templates')
await customDb.execute(
  `INSERT INTO templates (name, matches_activity_code, card_color) VALUES ('My template', 'CUSTOM', '#ABCDEF')`,
)
await migrateStage4(customDb)
const customTemplates = await listTemplates(customDb)
assert.equal(customTemplates.length, 1)
assert.equal(customTemplates[0]?.name, 'My template')
assert.equal(customTemplates[0]?.card_color, '#ABCDEF')

console.log('stage4 tests ok')
