import { useEffect, useId, useState } from 'react'
import {
  CLEAR_SCHEDULED_CONFIRM,
  clearScheduledLocalJobs,
  databasePath,
  queryCounts,
  WIPE_LOCAL_CONFIRM,
  backupLocalDatabase,
  wipeLocalDatabase,
} from '../lib/db.ts'
import { desktopShellAvailable, readGoogleMapsApiKey, testGoogleMapsApiKey, writeGoogleMapsApiKey } from '../lib/google-key.ts'
import { isMapTechVisible, useAllowNetworkGeocoding, useMapHiddenTechs } from '../lib/prefs.ts'
import { UNASSIGNED_TECH } from '../lib/schedule.ts'
import { useTheme, type ThemePref } from '../lib/theme.tsx'

const THEMES: ReadonlyArray<{ id: ThemePref; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function NetworkGeocodeSetting() {
  const [allowed, setAllowed] = useAllowNetworkGeocoding()
  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Network geocoding</h3>
      <label className="mt-2 flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={allowed}
          onChange={(event) => setAllowed(event.target.checked)}
        />
        <span className="font-semibold">Allow network geocoding</span>
      </label>
      <p className="mt-2 text-sm text-ink-body">
        Off by default. When on, Import and Map may send a street address to the public US Census Bureau geocoder
        (geocoding.geo.census.gov). If Census and Google (when a key is saved) have no match, Import, Map, and Nearby
        may also call OpenStreetMap Nominatim, and the map then shows an OpenStreetMap credit. These lookups run from the
        desktop app itself, not the window. Job rows stay in SQLite on this PC. Google Geocoding is separate:
        it runs only when a key is saved below, after Census has no match or fails to answer, and only when there is no saved site pin.
        Check drive times on the Map tab uses the same key, and only after you click it, to send stop coordinates to
        Google Routes. The choice is stored in this app&apos;s local settings on this computer.
      </p>
      <p className="mt-2 text-sm text-ink-label">
        Opening the Map tab loads tiles from OpenFreeMap so pins can be drawn. That tile request is separate from this
        toggle.
      </p>
    </section>
  )
}

function GoogleKeySetting() {
  const [hasKey, setHasKey] = useState(false)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [testOk, setTestOk] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!desktopShellAvailable()) {
      setUnavailable(true)
      setHasKey(false)
      setSavedKey(null)
      return
    }
    void (async () => {
      try {
        const key = await readGoogleMapsApiKey()
        if (cancelled) return
        setHasKey(Boolean(key))
        setSavedKey(key)
        setUnavailable(false)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setUnavailable(false)
        setHasKey(false)
        setSavedKey(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSave() {
    setBusy(true)
    setError(null)
    setNote(null)
    setTestNote(null)
    setTestOk(null)
    try {
      await writeGoogleMapsApiKey(draft)
      const key = await readGoogleMapsApiKey()
      setHasKey(Boolean(key))
      setSavedKey(key)
      setDraft('')
      setReveal(false)
      setNote('Saved on this PC. It is not part of the installer.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    if (!window.confirm('Remove the Google Maps API key from this PC?')) return
    setBusy(true)
    setError(null)
    setNote(null)
    setTestNote(null)
    setTestOk(null)
    try {
      await writeGoogleMapsApiKey(null)
      setHasKey(false)
      setSavedKey(null)
      setDraft('')
      setNote('Key removed from this PC. Geocoding stays Census-only; drive times stay off.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onTest() {
    setTesting(true)
    setTestNote(null)
    setTestOk(null)
    setError(null)
    try {
      const candidate = draft.trim() !== '' ? draft : savedKey
      const result = await testGoogleMapsApiKey(candidate)
      setTestOk(result.ok)
      setTestNote(result.message)
    } catch (err) {
      setTestOk(false)
      setTestNote(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  const canTest = !unavailable && !busy && !testing && (draft.trim() !== '' || Boolean(savedKey))

  return (
    <section data-testid="google-api-key">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Google Maps API key</h3>
      <p className="mt-2 text-sm text-ink-body">
        Optional. Paste a key from Google Cloud Console (APIs &amp; Services → Credentials). Enable only the APIs this
        app calls:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-body">
        <li>
          <span className="font-semibold">Geocoding API</span> — Map / Import address pins after Census (and site pin)
          miss
        </li>
        <li>
          <span className="font-semibold">Routes API</span> — Map → Check drive times (one technician, one day)
        </li>
      </ul>
      <p className="mt-2 text-sm text-ink-label">
        Do not enable Maps JavaScript API for this key unless you use it elsewhere. The basemap stays MapLibre +
        OpenFreeMap. Distance Matrix is not used.
      </p>
      <p className="mt-2 text-sm text-ink-body">
        The key is saved in Windows Credential Manager for your Windows user (entry{' '}
        <span className="font-mono">DispatchBoard Local</span>). It is not in a file, not in the installer, not kept
        in SQLite, and never sent to our backend or Supabase. Wiping the database does not delete it. For Vite / <span className="font-mono">npm run
        dev</span>, you can also set <span className="font-mono">VITE_GOOGLE_MAPS_API_KEY</span> in{' '}
        <span className="font-mono">.env.local</span> (gitignored). A saved Settings key on this PC wins over the env
        value.
      </p>
      <p className="mt-2 text-sm text-ink-body">
        With no key, geocoding stays Census → site pin → unmapped, and Check drive times stays off. With a key and
        Allow network geocoding on, Google Geocoding runs after Census has no match or fails to answer (and there is
        no site pin), and Routes runs when you click Check drive times.
      </p>
      {hasKey ? (
        <p className="mt-2 text-sm font-semibold text-ink" data-testid="google-api-key-saved">
          A key is saved on this PC.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-label">No key saved. Census-only until you paste one.</p>
      )}
      <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {hasKey ? 'Replace key' : 'API key'}
        <input
          type={reveal ? 'text' : 'password'}
          value={draft}
          autoComplete="off"
          spellCheck={false}
          disabled={unavailable || busy}
          data-testid="google-api-key-input"
          placeholder={hasKey ? 'Paste a new key to replace it' : 'Paste your Google Maps API key'}
          onChange={(event) => setDraft(event.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="google-api-key-save"
          disabled={unavailable || busy || draft.trim() === ''}
          onClick={() => void onSave()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save key on this PC'}
        </button>
        <button
          type="button"
          data-testid="google-api-key-test"
          disabled={!canTest}
          onClick={() => void onTest()}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          disabled={unavailable || busy || draft.trim() === ''}
          onClick={() => setReveal((value) => !value)}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
        >
          {reveal ? 'Hide' : 'Show'}
        </button>
        {hasKey ? (
          <button
            type="button"
            data-testid="google-api-key-clear"
            disabled={unavailable || busy}
            onClick={() => void onRemove()}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
          >
            Remove key
          </button>
        ) : null}
      </div>
      {unavailable ? (
        <p className="mt-2 text-sm text-ink-body">
          This window cannot write the app config folder. Start the desktop app with <code>npm run desktop</code> to
          save a key, or set <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>.env.local</code> for Vite-only
          geocoding.
        </p>
      ) : null}
      {error && !unavailable ? <p className="mt-2 text-sm text-error">{error}</p> : null}
      {note ? <p className="mt-2 text-sm text-ink-body">{note}</p> : null}
      {testNote ? (
        <p
          className={`mt-2 text-sm ${testOk ? 'text-success' : 'text-error'}`}
          data-testid="google-api-key-test-result"
          role="status"
        >
          {testOk ? 'Test passed: ' : 'Test failed: '}
          {testNote}
        </p>
      ) : null}
    </section>
  )
}


function MapTechVisibilitySetting({ techOptions }: { techOptions: string[] }) {
  const [hidden, setHidden] = useMapHiddenTechs()
  const roster = techOptions.filter((name) => name !== UNASSIGNED_TECH)
  const allOn = hidden.size === 0 || roster.every((name) => isMapTechVisible(name, hidden))

  function setTechOn(name: string, on: boolean) {
    const next = new Set(hidden)
    if (on) next.delete(name)
    else next.add(name)
    // If every known tech is visible, store empty (default all-on).
    if (roster.length > 0 && roster.every((n) => !next.has(n))) {
      setHidden(new Set())
      return
    }
    setHidden(next)
  }

  function setAll(on: boolean) {
    if (on) setHidden(new Set())
    else setHidden(new Set(roster))
  }

  return (
    <section data-testid="map-tech-visibility">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Map technicians</h3>
      <p className="mt-2 text-sm text-ink-body">
        Check who appears on the Map: pins, route lines when present, and that day&apos;s related job info.
        Default is all on (including Specialists when that name is on the board). Choice stays on this PC.
      </p>
      {roster.length === 0 ? (
        <p className="mt-2 text-sm text-ink-label">No technicians on the board yet. Import an ADD or open the Map.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setAll(true)}
              disabled={allOn}
            >
              All on
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              onClick={() => setAll(false)}
              disabled={roster.every((name) => !isMapTechVisible(name, hidden))}
            >
              All off
            </button>
          </div>
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2">
            {roster.map((name) => {
              const on = isMapTechVisible(name, hidden)
              return (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={on}
                      data-testid={`map-tech-vis-${name}`}
                      onChange={(event) => setTechOn(name, event.target.checked)}
                    />
                    <span className="font-medium">{name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

export function SettingsPanel({
  onClose,
  onChanged,
  planningActive = false,
  techOptions = [],
}: {
  onClose: () => void
  onChanged: () => void
  planningActive?: boolean
  /** Technician names for Map visibility checkboxes (Specialists included when present). */
  techOptions?: string[]
}) {
  const titleId = useId()
  const { pref, setPref } = useTheme()
  const [dbPath, setDbPath] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ jobs: number; sites: number; backlog: number } | null>(null)
  const [wipeError, setWipeError] = useState<string | null>(null)
  const [wiping, setWiping] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearTyped, setClearTyped] = useState('')
  const [clearError, setClearError] = useState<string | null>(null)
  const [clearMessage, setClearMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [path, stored] = await Promise.all([databasePath(), queryCounts()])
        if (cancelled) return
        setDbPath(path)
        setCounts(stored)
        setPathError(null)
      } catch (error) {
        if (cancelled) return
        setPathError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function onBackup() {
    setBackingUp(true)
    setBackupMessage(null)
    try {
      const path = await backupLocalDatabase()
      setBackupMessage(`Saved ${path}`)
    } catch (error) {
      setBackupMessage(`Backup failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBackingUp(false)
    }
  }

  async function onWipe() {
    if (!window.confirm(WIPE_LOCAL_CONFIRM)) return
    setWiping(true)
    setWipeError(null)
    try {
      await wipeLocalDatabase()
      const stored = await queryCounts()
      setCounts(stored)
      onChanged()
    } catch (error) {
      setWipeError(error instanceof Error ? error.message : String(error))
    } finally {
      setWiping(false)
    }
  }

  const clearReady = clearTyped.trim().toUpperCase() === CLEAR_SCHEDULED_CONFIRM

  async function onClearScheduled() {
    if (!clearReady) return
    setClearing(true)
    setClearError(null)
    setClearMessage(null)
    try {
      const n = await clearScheduledLocalJobs()
      const stored = await queryCounts()
      setCounts(stored)
      setClearMessage(
        n === 0
          ? 'No scheduled jobs to clear.'
          : `Cleared ${n} scheduled job${n === 1 ? '' : 's'}, including capacity. Jobs with no date stay.`,
      )
      setConfirmClear(false)
      setClearTyped('')
      onChanged()
    } catch (error) {
      setClearError(error instanceof Error ? error.message : String(error))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-[420px] flex-col border-r border-slate-200 bg-white shadow-sm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Local</p>
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto px-4 py-3">
          <section data-testid="appearance-setting">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Appearance</h3>
            <p className="mt-1 text-xs text-slate-500">Auto follows this computer. The choice stays on this PC.</p>
            <div
              className="mt-2 flex rounded-md border border-slate-300 p-0.5"
              role="radiogroup"
              aria-label="Appearance"
            >
              {THEMES.map((theme) => {
                const active = pref === theme.id
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPref(theme.id)}
                    className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
                      active ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {theme.label}
                  </button>
                )
              })}
            </div>
          </section>

          <MapTechVisibilitySetting techOptions={techOptions} />

          <NetworkGeocodeSetting />

          <GoogleKeySetting />

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Planning</h3>
            <p className="mt-2 text-sm text-ink-body">
              Templates and mismatch rules live here, the same place the office hamburger keeps them. Rules flag jobs
              on the next ADD apply. They do not stop import.
            </p>
            <a
              href="#/planning"
              aria-current={planningActive ? 'page' : undefined}
              onClick={onClose}
              className={`mt-3 inline-flex rounded-md border px-4 py-2 text-sm font-semibold ${
                planningActive
                  ? 'border-brand-600 bg-brand-50 text-slate-900'
                  : 'border-line bg-white text-ink-body hover:border-ink hover:text-ink'
              }`}
            >
              {planningActive ? 'Planning is open' : 'Open Planning'}
            </a>
          </section>

          <section data-testid="clear-scheduled">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Schedule</h3>
            <p className="mt-2 text-sm text-ink-body">
              Deletes jobs that have a schedule date, including capacity blocks, and the checklist items on those jobs.
              Jobs with no date stay. Sites, mismatch rules, templates, and backlog items stay. A promoted item whose
              job was dated keeps its status and drops the job link. This does not wipe the database.
            </p>
            {!confirmClear ? (
              <button
                type="button"
                data-testid="clear-scheduled-start"
                disabled={clearing || Boolean(pathError)}
                onClick={() => {
                  setConfirmClear(true)
                  setClearTyped('')
                  setClearError(null)
                }}
                className="mt-3 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
              >
                Clear scheduled jobs
              </button>
            ) : (
              <div className="mt-3 space-y-2 rounded-md border border-line bg-surface p-3">
                <p className="text-sm font-semibold text-ink">Confirm clear</p>
                <p className="text-sm text-ink-body">
                  Type <span className="font-mono font-semibold">{CLEAR_SCHEDULED_CONFIRM}</span> to delete every dated job.
                </p>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Type {CLEAR_SCHEDULED_CONFIRM} to confirm
                  <input
                    type="text"
                    value={clearTyped}
                    autoComplete="off"
                    spellCheck={false}
                    data-testid="clear-scheduled-confirm-input"
                    onChange={(event) => setClearTyped(event.target.value)}
                    className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={clearing}
                    onClick={() => {
                      setConfirmClear(false)
                      setClearTyped('')
                    }}
                    className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:bg-white hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="clear-scheduled-confirm"
                    disabled={clearing || !clearReady}
                    onClick={() => void onClearScheduled()}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    {clearing ? 'Clearing…' : 'Clear scheduled jobs'}
                  </button>
                </div>
              </div>
            )}
            {clearError ? <p className="mt-2 text-sm text-error">{clearError}</p> : null}
            {clearMessage ? (
              <p className="mt-2 text-sm text-ink-body" data-testid="clear-scheduled-result">
                {clearMessage}
              </p>
            ) : null}
          </section>

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Database file</h3>
            {dbPath ? <p className="mt-2 break-all font-mono text-sm text-ink">{dbPath}</p> : null}
            {pathError ? (
              <p className="mt-2 text-sm text-error">
                This window cannot open SQLite ({pathError}). Start the desktop app with <code>npm run desktop</code>.
              </p>
            ) : null}
            {counts ? (
              <p className="mt-2 text-sm text-ink-body">
                {counts.jobs} jobs · {counts.sites} sites · {counts.backlog} backlog stored on this PC.
              </p>
            ) : null}
            <button
              type="button"
              disabled={backingUp || Boolean(pathError)}
              onClick={() => void onBackup()}
              className="mt-4 mr-3 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {backingUp ? 'Backing up…' : 'Back up now'}
            </button>
            <button
              type="button"
              disabled={wiping || Boolean(pathError)}
              onClick={() => void onWipe()}
              className="mt-4 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {wiping ? 'Wiping…' : 'Wipe local database'}
            </button>
            {backupMessage ? <p className="mt-2 break-all text-sm text-ink-body">{backupMessage}</p> : null}
            {wipeError ? <p className="mt-2 text-sm text-error">{wipeError}</p> : null}
            <p className="mt-2 text-sm text-ink-label">
              A backup also runs about once a day while the app is open. The newest 14 are kept in the{' '}
              <span className="font-mono">backups</span> folder next to the database. They hold customer data, so they
              stay on this PC. Wipe does not delete them: remove that folder too if you are retiring this PC.
            </p>
            <p className="mt-2 text-sm text-ink-label">
              Deletes every job, checklist, site, backlog item, cached geocode, and cached drive time in this file.
              Mismatch rules and templates stay. Separate from Clear scheduled jobs. The office web app is not affected.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
