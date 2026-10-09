/**
 * Browser-only stand-in for @tauri-apps/plugin-sql. Used when the dev server runs
 * with VITE_PREVIEW=1 (see vite.config.ts). Backs the app with an in-memory
 * sql.js database seeded from the synthetic fixture, so every screen renders
 * with data and nothing touches a real customer file. Never part of the shipped build.
 */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import csv from '../../fixtures/add-export-sample.csv?raw'
import { recordsFromBytes } from '../../src/lib/add.ts'
import { applyImport, type SqlDb } from '../../src/lib/store.ts'

type Stmt = {
  bind(p?: readonly unknown[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
}
type SqlJs = { run(sql: string, p?: readonly unknown[]): void; prepare(sql: string): Stmt }

// Fredericksburg, VA area. Spread is deterministic so screenshots are repeatable.
const CENTER = { lat: 38.3032, lng: -77.4605 }

function spread(n: number): { lat: number; lng: number } {
  const a = (n * 2.399963) % (Math.PI * 2)
  const r = 0.01 + ((n * 37) % 100) / 100 * 0.14
  return { lat: CENTER.lat + Math.sin(a) * r, lng: CENTER.lng + Math.cos(a) * r * 1.25 }
}

const FIXTURE_FIRST_DAY = '2026-09-02'

/** Move the fixture so its first day is today. Screens open on today. */
async function shiftDatesToToday(db: SqlDb): Promise<void> {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const days = Math.round((Date.parse(today) - Date.parse(FIXTURE_FIRST_DAY)) / 86_400_000)
  const mod = `${days >= 0 ? '+' : ''}${days} days`
  await db.execute('UPDATE jobs SET schedule_date = date(schedule_date, ?) WHERE schedule_date IS NOT NULL', [mod])
}

let ready: Promise<SqlJs> | null = null

function boot(): Promise<SqlJs> {
  ready ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl })
    const raw = new SQL.Database() as unknown as SqlJs
    const adapter = wrap(raw)
    // `?empty=1` skips the sample jobs so empty states and the first-run screen can be seen.
    if (new URLSearchParams(location.search).get('empty') === '1') {
      await applyImport(adapter, [], { updateMatched: true })
      return raw
    }
    const rows = recordsFromBytes(new TextEncoder().encode(csv))
    await applyImport(adapter, rows, { updateMatched: true })
    const jobs = await adapter.select<{ id: number }>('SELECT id FROM jobs WHERE is_capacity_block = 0 ORDER BY id')
    for (const { id } of jobs) {
      const p = spread(id)
      await adapter.execute(
        "UPDATE jobs SET lat = ?, lng = ?, geocode_source = 'census', geocode_address_key = 'preview-' || id WHERE id = ?",
        [p.lat, p.lng, id],
      )
    }
    // `?unmapped=N` strips the pin from the first N jobs so the "addresses not found" flow can be seen.
    const unmapped = Number(new URLSearchParams(location.search).get('unmapped') ?? 0)
    if (unmapped > 0) {
      for (const { id } of jobs.slice(0, unmapped)) {
        await adapter.execute("UPDATE jobs SET lat = NULL, lng = NULL, geocode_source = 'none', geocode_address_key = NULL WHERE id = ?", [id])
      }
    }
    // `?backlog=1` adds synthetic open backlog (lock tanks, monitor swaps, tank pickups). Most sit a short
    // hop from a sample job so "what is near this tech" can be seen; the last two are far away on purpose.
    if (new URLSearchParams(location.search).get('backlog') === '1') {
      const pins = await adapter.select<{ lat: number; lng: number }>('SELECT lat, lng FROM jobs WHERE lat IS NOT NULL ORDER BY id LIMIT 6')
      const kinds: [string, string][] = [
        ['lockout', 'SAMPLE BACKLOG 01'],
        ['monitor_swap', 'SAMPLE BACKLOG 02'],
        ['tank_pickup', 'SAMPLE BACKLOG 03'],
        ['lockout', 'SAMPLE BACKLOG 04'],
        ['monitor_swap', 'SAMPLE BACKLOG 05'],
        ['tank_pickup', 'SAMPLE BACKLOG 06'],
        ['lockout', 'SAMPLE BACKLOG 07'],
        ['monitor_swap', 'SAMPLE BACKLOG 08'],
      ]
      for (let i = 0; i < kinds.length; i++) {
        const base = pins[i % pins.length]
        const far = i >= 6
        const lat = base.lat + (far ? 0.16 : 0.012 * (i % 2 ? 1 : -1))
        const lng = base.lng + (far ? -0.14 : 0.014 * (i % 3 ? -1 : 1))
        await adapter.execute(
          "INSERT INTO backlog_items (backlog_type, customer_number, customer_name, address_raw, address_street, address_city_state_zip, lat, lng, geocode_source, priority, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'census', 'normal', 'open', 'Sample backlog item, not a real customer.')",
          [kinds[i][0], `9${i}00`, kinds[i][1], `${100 + i} SAMPLE BACKLOG RD STAFFORD VA 22556`, `${100 + i} SAMPLE BACKLOG RD`, 'STAFFORD VA 22556', lat, lng],
        )
      }
    }
    // The sample export has no fireplace cleaning call. Give the maintenance job one
    // so the gas-log icon shows up in screenshots.
    await adapter.execute(
      "UPDATE jobs SET location_definition = 'GAS LOGS, FIREPLACE' WHERE activity_1 LIKE 'PREV MAINT%'",
    )
    await shiftDatesToToday(adapter)
    return raw
  })()
  return ready
}

function wrap(db: SqlJs): SqlDb {
  return {
    async execute(sql, params) {
      if (/^\s*VACUUM INTO/i.test(sql)) return { lastInsertId: null }
      if (params?.length) db.run(sql, params)
      else db.run(sql)
      const s = db.prepare('SELECT last_insert_rowid() AS id')
      const id = s.step() ? s.getAsObject().id : null
      s.free()
      return { lastInsertId: typeof id === 'number' && id > 0 ? id : null }
    },
    async select(sql, params) {
      const s = db.prepare(sql)
      if (params?.length) s.bind(params)
      const out: Record<string, unknown>[] = []
      while (s.step()) out.push(s.getAsObject())
      s.free()
      return out as never
    },
  }
}

export default class Database {
  static async load(_url: string): Promise<Database> {
    await boot()
    return new Database()
  }
  async execute(sql: string, params?: unknown[]) {
    const db = wrap(await boot())
    return db.execute(sql, params)
  }
  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    const db = wrap(await boot())
    return db.select(sql, params) as unknown as T
  }
}
