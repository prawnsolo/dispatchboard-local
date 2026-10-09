import { ErrorNote } from './ErrorNote.tsx'
import { GoogleFixDialog } from './GoogleFixDialog.tsx'
import { RestorePanel } from './RestorePanel.tsx'
import { useEffect, useId, useState } from 'react'
import {
  CLEAR_SCHEDULED_CONFIRM,
  clearScheduledLocalJobs,
  databasePath,
  queryCounts,
  queryUnmappedFixableIds,
  WIPE_LOCAL_CONFIRM,
  backupLocalDatabase,
  wipeLocalDatabase,
} from '../lib/db.ts'
import { desktopShellAvailable, readGoogleMapsApiKey, testGoogleMapsApiKey, writeGoogleMapsApiKey } from '../lib/google-key.ts'
import { isMapTechVisible, useAllowNetworkGeocoding, useMapHiddenTechs } from '../lib/prefs.ts'
import { UNASSIGNED_TECH } from '../lib/schedule.ts'
import { useTheme, type ThemePref } from '../lib/theme.tsx'
import { DEFAULT_THRESHOLDS, type WeatherThresholds } from '../lib/weather.ts'
import { refreshWeather, setWeatherEnabled, setWeatherThresholds, useWeatherState } from '../lib/weather-store.ts'
import { YARD } from '../lib/yard.ts'

const THEMES: ReadonlyArray<{ id: ThemePref; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function Details({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-2 text-sm text-ink-label">
      <summary className="cursor-pointer select-none font-medium text-ink-body hover:text-ink">{label}</summary>
      <div className="mt-1 space-y-1.5">{children}</div>
    </details>
  )
}

type MenuView = 'home' | 'display' | 'lookup' | 'weather' | 'data'

function MenuRow({ title, hint, onClick }: { title: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-1 py-3 text-left hover:bg-surface"
    >
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="flex items-center gap-2 text-sm text-ink-label">
        {hint}
        <span aria-hidden="true">›</span>
      </span>
    </button>
  )
}

function NetworkGeocodeSetting() {
  const [allowed, setAllowed] = useAllowNetworkGeocoding()
  return (
    <section>
      <label className="flex items-start gap-3 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={allowed} onChange={(event) => setAllowed(event.target.checked)} />
        <span>
          <span className="font-semibold">Look up addresses automatically</span>
          <span className="mt-0.5 block text-ink-body">US Census first, then Google if Census misses.</span>
        </span>
      </label>
      <Details label="What gets sent">
        <p>Only street, city, state and zip. Never names, phones or work order numbers.</p>
        <p>Last resort is OpenStreetMap. Map tiles load from OpenFreeMap whatever this is set to.</p>
        <p>Job rows stay in SQLite on this PC.</p>
      </Details>
    </section>
  )
}

const THRESHOLD_FIELDS: ReadonlyArray<{ key: keyof WeatherThresholds; label: string; unit: string; step: number; hint?: string }> = [
  { key: 'heavyRainIn', label: 'Heavy rain', unit: 'inches in one day', step: 0.25 },
  { key: 'multiDayRainIn', label: 'Extreme rain', unit: 'inches over 3 days', step: 0.25 },
  { key: 'gustMph', label: 'Strong wind', unit: 'mph gusts', step: 5 },
  { key: 'hotF', label: 'Very hot', unit: '°F high', step: 1 },
  { key: 'coldF', label: 'Very cold', unit: '°F low', step: 1 },
]

function WeatherSetting() {
  const weather = useWeatherState()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const point = `${YARD.lat.toFixed(2)}, ${YARD.lng.toFixed(2)}`

  function commit(key: keyof WeatherThresholds) {
    const raw = draft[key]
    if (raw === undefined) return
    const value = Number(raw)
    const next = { ...weather.thresholds, [key]: raw.trim() === '' || !Number.isFinite(value) ? DEFAULT_THRESHOLDS[key] : value }
    setWeatherThresholds(next)
    setDraft((d) => {
      const { [key]: _gone, ...rest } = d
      return rest
    })
  }

  const when = weather.snapshot ? new Date(weather.snapshot.fetchedAt).toLocaleString() : null

  return (
    <section data-testid="weather-setting">
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          data-testid="weather-toggle"
          checked={weather.enabled}
          onChange={(event) => setWeatherEnabled(event.target.checked)}
        />
        <span>
          <span className="font-semibold">Show the five-day forecast</span>
          <span className="mt-0.5 block text-ink-body">
            Rain, wind and temperature from the National Weather Service. Warns when heavy rain could float an underground
            tank before it is covered.
          </span>
        </span>
      </label>
      <Details label="What gets sent">
        <p>Only the yard's location, rounded to about a mile ({point}). Nothing about a customer, address or job.</p>
        <p>Free, no account or key. Looked up every couple of hours while the app is open, and only when this is on.</p>
      </Details>

      {weather.enabled ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="weather-refresh"
              onClick={() => void refreshWeather(true)}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
            >
              Refresh now
            </button>
            <p className="text-sm text-ink-body" role="status">
              {weather.status === 'loading' && !weather.snapshot ? 'Loading…' : null}
              {weather.status === 'ok' && when ? `Updated ${when}` : null}
            </p>
          </div>
          {weather.status === 'error' ? <p className="mt-2 text-sm text-error" role="alert">{weather.error}</p> : null}

          <h3 className="mt-5 text-base font-semibold text-ink">When to warn</h3>
          <p className="mt-1 text-sm text-ink-body">Change these to match what actually causes trouble.</p>
          <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
            {THRESHOLD_FIELDS.map((f) => (
              <label key={f.key} className="contents text-sm text-ink">
                <span>
                  {f.label}
                  <span className="block text-meta text-ink-label">{f.unit}</span>
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={f.step}
                  data-testid={`weather-th-${f.key}`}
                  value={draft[f.key] ?? String(weather.thresholds[f.key])}
                  onChange={(event) => setDraft((d) => ({ ...d, [f.key]: event.target.value }))}
                  onBlur={() => commit(f.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(f.key)
                  }}
                  className="w-24 rounded-md border border-line bg-white px-2 py-1.5 text-right text-sm tabular-nums text-ink outline-none focus:border-brand"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setWeatherThresholds(DEFAULT_THRESHOLDS)}
            className="mt-3 text-sm font-medium text-ink underline underline-offset-2"
          >
            Reset to the standard numbers
          </button>
        </>
      ) : null}
    </section>
  )
}

function GoogleKeySetting({ onChanged }: { onChanged: () => void }) {
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
  const [fixIds, setFixIds] = useState<number[] | null>(null)
  const [fixNote, setFixNote] = useState<string | null>(null)

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

  async function onSave(): Promise<boolean> {
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
      setNote('Saved.')
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onFix() {
    setFixNote(null)
    try {
      if (draft.trim() !== '' && !(await onSave())) return
      const ids = await queryUnmappedFixableIds()
      if (ids.length === 0) {
        setFixNote('Every address with a street already has a pin.')
        return
      }
      setFixIds(ids)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
      setNote('Key removed.')
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
      <p className="text-sm text-ink-body">Optional. Used when Census misses, and for drive times.</p>
      <Details label="Setup">
        <p>In Google Cloud Console, create a key and enable only the Geocoding API and the Routes API.</p>
        <p>The key is kept in Windows Credential Manager for your Windows user. It is not in a file or the installer.</p>
      </Details>
      {hasKey ? (
        <p className="mt-2 text-sm font-semibold text-ink" data-testid="google-api-key-saved">
          Key saved.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-label">No key saved.</p>
      )}
      <label className="mt-3 block text-sm font-medium text-slate-600">
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
          {busy ? 'Saving…' : 'Save key'}
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
        <button
          type="button"
          data-testid="google-api-key-fix"
          disabled={unavailable || busy}
          onClick={() => void onFix()}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
        >
          Use Google to fix addresses not found
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
          Saving a key needs the desktop app (<code>npm run desktop</code>).
        </p>
      ) : null}
      {error && !unavailable ? <ErrorNote className="mt-2 text-sm" error={error} /> : null}
      {note ? <p className="mt-2 text-sm text-ink-body">{note}</p> : null}
      {fixNote ? <p className="mt-2 text-sm text-ink-body" data-testid="google-api-key-fix-note">{fixNote}</p> : null}
      {fixIds ? <GoogleFixDialog ids={fixIds} onClose={() => setFixIds(null)} onChanged={onChanged} /> : null}
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
      <p className="text-sm text-ink-body">Who shows on the Map.</p>
      {roster.length === 0 ? (
        <p className="mt-2 text-sm text-ink-label">No technicians yet. Import an ADD first.</p>
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
  initialView = 'home',
}: {
  onClose: () => void
  onChanged: () => void
  planningActive?: boolean
  /** Technician names for Map visibility checkboxes (Specialists included when present). */
  techOptions?: string[]
  /** Open straight to one page, e.g. from the forecast's "Set up weather" button. */
  initialView?: 'home' | 'weather'
}) {
  const titleId = useId()
  const { pref, setPref } = useTheme()
  const [dbPath, setDbPath] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ jobs: number; sites: number; backlog: number } | null>(null)
  const [wipeError, setWipeError] = useState<string | null>(null)
  const [view, setView] = useState<MenuView>(initialView)
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
      if (view !== 'home') setView('home')
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, view])

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

  const TITLES: Record<MenuView, string> = {
    home: 'Menu',
    display: 'Display',
    lookup: 'Address lookup',
    weather: 'Weather',
    data: 'Data',
  }
  const [lookupAllowed] = useAllowNetworkGeocoding()
  const weatherOn = useWeatherState().enabled
  const buttonClass =
    'rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full w-full max-w-[420px] flex-col border-r border-slate-200 bg-white shadow-sm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            {view !== 'home' ? (
              <button
                type="button"
                aria-label="Back to menu"
                data-testid="settings-back"
                onClick={() => setView('home')}
                className="rounded-md px-2 py-1 text-lg leading-none text-ink-body hover:bg-surface hover:text-ink"
              >
                ‹
              </button>
            ) : null}
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {TITLES[view]}
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
          {view === 'home' ? (
            <nav aria-label="Menu">
              <MenuRow title="Display" hint={THEMES.find((t) => t.id === pref)?.label} onClick={() => setView('display')} />
              <MenuRow
                title="Address lookup"
                hint={lookupAllowed ? 'On' : 'Off'}
                onClick={() => setView('lookup')}
              />
              <MenuRow title="Weather" hint={weatherOn ? 'On' : 'Off'} onClick={() => setView('weather')} />
              <a
                href="#/planning"
                aria-current={planningActive ? 'page' : undefined}
                onClick={onClose}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-1 py-3 hover:bg-surface"
              >
                <span className="text-sm font-semibold text-ink">Planning</span>
                <span className="flex items-center gap-2 text-sm text-ink-label">
                  Templates, rules
                  <span aria-hidden="true">›</span>
                </span>
              </a>
              <MenuRow
                title="Data"
                hint={counts ? `${counts.jobs} jobs` : undefined}
                onClick={() => setView('data')}
              />
            </nav>
          ) : null}

          {view === 'display' ? (
            <>
              <section data-testid="appearance-setting">
                <h3 className="text-base font-semibold text-ink">Appearance</h3>
                <div className="mt-2 flex rounded-md border border-slate-300 p-0.5" role="radiogroup" aria-label="Appearance">
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
              <div>
                <h3 className="text-base font-semibold text-ink">Map technicians</h3>
                <div className="mt-2">
                  <MapTechVisibilitySetting techOptions={techOptions} />
                </div>
              </div>
            </>
          ) : null}

          {view === 'lookup' ? (
            <>
              <NetworkGeocodeSetting />
              <div>
                <h3 className="text-base font-semibold text-ink">Google Maps API key</h3>
                <div className="mt-2">
                  <GoogleKeySetting onChanged={onChanged} />
                </div>
              </div>
            </>
          ) : null}

          {view === 'weather' ? <WeatherSetting /> : null}

          {view === 'data' ? (
            <>
              <section>
                {counts ? (
                  <p className="text-sm text-ink-body">
                    {counts.jobs} jobs · {counts.sites} sites · {counts.backlog} backlog
                  </p>
                ) : null}
                {pathError ? (
                  <p className="mt-2 text-sm text-error">Database unavailable. Run the desktop app.</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={backingUp || Boolean(pathError)} onClick={() => void onBackup()} className={buttonClass}>
                    {backingUp ? 'Backing up…' : 'Back up now'}
                  </button>
                </div>
                {backupMessage ? <p className="mt-2 break-all text-sm text-ink-body">{backupMessage}</p> : null}
                <div className="mt-3">
                  <RestorePanel disabled={Boolean(pathError)} />
                </div>
                <Details label="Backups and file location">
                  <p>A backup runs about once a day. The newest 14 are kept next to the database and stay on this PC.</p>
                  {dbPath ? <p className="break-all font-mono text-ink">{dbPath}</p> : null}
                </Details>
              </section>

              <section data-testid="clear-scheduled">
                <h3 className="text-base font-semibold text-ink">Clear scheduled jobs</h3>
                <p className="mt-2 text-sm text-ink-body">Deletes every dated job. Undated jobs, sites and rules stay.</p>
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
                    className={`mt-3 ${buttonClass}`}
                  >
                    Clear scheduled jobs
                  </button>
                ) : (
                  <div className="mt-3 space-y-2 rounded-md border border-line bg-surface p-3">
                    <label className="block text-sm font-medium text-slate-600">
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
                {clearError ? <ErrorNote className="mt-2 text-sm" error={clearError} /> : null}
                {clearMessage ? (
                  <p className="mt-2 text-sm text-ink-body" data-testid="clear-scheduled-result">
                    {clearMessage}
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="text-base font-semibold text-ink">Wipe local database</h3>
                <p className="mt-2 text-sm text-ink-body">Deletes all jobs, sites, backlog and caches. Rules and templates stay.</p>
                <button type="button" disabled={wiping || Boolean(pathError)} onClick={() => void onWipe()} className={`mt-3 ${buttonClass}`}>
                  {wiping ? 'Wiping…' : 'Wipe local database'}
                </button>
                {wipeError ? <ErrorNote className="mt-2 text-sm" error={wipeError} /> : null}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
