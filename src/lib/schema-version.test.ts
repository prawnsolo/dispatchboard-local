import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { checkSchemaVersion, ensureSchema, SCHEMA_VERSION, type SqlDb } from './store.ts'

const require = createRequire(import.meta.url)

type Stmt = {
  bind(p?: readonly unknown[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}
type Raw = { run(sql: string, p?: readonly unknown[]): void; prepare(sql: string): Stmt }

function wrap(db: Raw): SqlDb {
  return {
    async execute(sql, params) {
      if (params && params.length) db.run(sql, params)
      else db.run(sql)
      return { lastInsertId: null }
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

async function fresh(): Promise<{ raw: Raw; db: SqlDb }> {
  const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
  const raw = new SQL.Database() as unknown as Raw
  return { raw, db: wrap(raw) }
}

const version = async (db: SqlDb) => Number((await db.select<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version)

// A new database is stamped with the current version after migrations.
{
  const { db } = await fresh()
  assert.equal(await version(db), 0)
  await ensureSchema(db)
  assert.equal(await version(db), SCHEMA_VERSION)
}

// An older database (version 0 with existing tables) still opens and gets stamped.
{
  const { db } = await fresh()
  await ensureSchema(db)
  await db.execute('PRAGMA user_version = 0')
  await checkSchemaVersion(db)
}

// A database written by a newer build is refused, not migrated.
{
  const { db } = await fresh()
  await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
  await assert.rejects(() => ensureSchema(db), /newer DispatchBoard/)
}

console.log('schema-version tests passed')
