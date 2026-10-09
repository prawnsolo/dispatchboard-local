/** Browser-only stand-in for @tauri-apps/api/core (VITE_PREVIEW=1). */
;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ??= {}

try {
  // Skip the first-run network prompt; preview never makes network calls.
  if (localStorage.getItem('dispatchboard.local.allowNetworkGeocoding') === null) {
    localStorage.setItem('dispatchboard.local.allowNetworkGeocoding', '0')
  }
} catch {
  // storage blocked: the prompt just shows
}

const query = new URLSearchParams(location.search)
// `?key=1` pretends a Google key is saved. `?google=miss|deny|ok` scripts what Google answers.
let savedKey: string | null = query.get('key') === '1' ? 'PREVIEW-KEY-0000' : null

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  switch (cmd) {
    case 'db_path':
      return 'preview (in memory)' as T
    case 'google_api_key_get':
      return savedKey as T
    case 'google_api_key_set':
      savedKey = ((args as { key?: string } | undefined)?.key ?? '') || null
      return undefined as T
    case 'backup_target':
      return 'preview-backup.db' as T
    case 'list_backups':
      return [
        { name: 'dispatchboard-20261008-081500.db', size: 1_480_000, modified_ms: Date.now() - 9 * 3_600_000, before_restore: false },
        { name: 'dispatchboard-20261007-081500.db', size: 1_470_000, modified_ms: Date.now() - 33 * 3_600_000, before_restore: false },
        { name: 'before-restore-1760000000.db', size: 1_390_000, modified_ms: Date.now() - 96 * 3_600_000, before_restore: true },
      ] as T
    case 'restore_stage':
    case 'restart_app':
      return undefined as T
    case 'restore_result_take':
      return null as T
    case 'geo_http_get': {
      const { provider } = args as { provider: string }
      const script = query.get('google')
      if (!script) throw new Error('Network lookups are off in preview.')
      const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body) }) as T
      if (provider === 'census') return reply({ result: { addressMatches: [] } })
      if (provider === 'nominatim') return reply([])
      if (script === 'deny') return reply({ status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' })
      if (script === 'ok') {
        return reply({
          status: 'OK',
          results: [{ formatted_address: 'Preview', types: ['street_address'], geometry: { location: { lat: 38.31, lng: -77.46 }, location_type: 'ROOFTOP' } }],
        })
      }
      return reply({ status: 'ZERO_RESULTS', results: [] })
    }
    default:
      throw new Error(`Unknown command in preview: ${cmd}`)
  }
}
