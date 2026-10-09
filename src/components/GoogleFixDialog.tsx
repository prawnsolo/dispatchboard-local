import { useEffect, useId, useRef, useState } from 'react'
import { geocodeLocalJobs } from '../lib/db.ts'
import {
  GOOGLE_PRIVACY_LINE,
  googleErrorLine,
  googleFixState,
  notFoundLine,
  type GoogleFixState,
} from '../lib/google-fix.ts'
import {
  desktopShellAvailable,
  normalizePastedGoogleKey,
  readGoogleMapsApiKey,
  testGoogleMapsApiKey,
  writeGoogleMapsApiKey,
} from '../lib/google-key.ts'
import { useAllowNetworkGeocoding } from '../lib/prefs.ts'
import { ErrorNote } from './ErrorNote.tsx'

/**
 * "Addresses not found" pop-up. Opens after an import that left jobs without a
 * pin, and from Settings. Walks the user through the one thing that can still
 * help (a Google key, or allowing lookups), runs Google for just those jobs,
 * and says plainly what is left. Only street, city, state and zip leave the PC.
 */
export function GoogleFixDialog({
  ids,
  googleErrors = 0,
  alreadyTried = false,
  onClose,
  onChanged,
}: {
  /** Jobs with a street address and no pin. */
  ids: number[]
  /** Google errors in the run that opened this, if any. */
  googleErrors?: number
  /** True after an import that already ran Google. False from Settings, where nothing has run yet. */
  alreadyTried?: boolean
  onClose: () => void
  /** Pins were added. The caller refreshes its lists. */
  onChanged: (remainingIds: number[]) => void
}) {
  const titleId = useId()
  const [allowed, setAllowed] = useAllowNetworkGeocoding()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [remaining, setRemaining] = useState<number[]>(ids)
  const [errors, setErrors] = useState(googleErrors)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [found, setFound] = useState<number | null>(null)
  const [ran, setRan] = useState(false)
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    void readGoogleMapsApiKey()
      .then(async (key) => {
        if (cancelled) return
        setHasKey(Boolean(key))
        if (key && googleErrors > 0) {
          const test = await testGoogleMapsApiKey(key).catch(() => null)
          if (!cancelled && test) {
            setErrorReason(test.ok ? 'Google had a problem partway through. Try again in a minute.' : test.message)
          }
        }
      })
      .catch(() => {
        if (!cancelled) setHasKey(false)
      })
    return () => {
      cancelled = true
    }
    // Runs once, with the errors the dialog opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    if (hasKey !== null) primary.current?.focus()
  }, [hasKey])

  const state: GoogleFixState = googleFixState({
    unmapped: remaining.length,
    networkAllowed: allowed,
    hasKey: Boolean(hasKey),
    googleErrors: errors,
  })
  // From Settings with a key saved, nothing has been tried yet, so ask first.
  const asking = state.kind === 'google-missed' && !alreadyTried && !ran
  const needsKeyField = hasKey === false
  const draftKey = normalizePastedGoogleKey(draft)
  const canRun = !busy && hasKey !== null && (!needsKeyField || draftKey !== null)

  async function run() {
    setBusy(true)
    setFailure(null)
    setFound(null)
    try {
      if (needsKeyField) {
        if (!draftKey) throw new Error('Paste the API key only, with no spaces or line breaks.')
        if (!desktopShellAvailable()) throw new Error('Saving a key needs the desktop app.')
        await writeGoogleMapsApiKey(draftKey)
        setHasKey(true)
        setDraft('')
      }
      if (!allowed) setAllowed(true)
      const summary = await geocodeLocalJobs(remaining, { allowNetwork: true, retryGoogle: true })
      const left = summary.unmapped_ids
      const placed = remaining.length - left.length
      setRemaining(left)
      setErrors(summary.google_errors)
      setFound(placed)
      setRan(true)
      if (placed > 0) onChanged(left)
      if (summary.google_errors > 0 && left.length > 0) {
        const key = needsKeyField ? draftKey : await readGoogleMapsApiKey()
        const test = await testGoogleMapsApiKey(key).catch(() => null)
        setErrorReason(
          test ? (test.ok ? 'Google had a problem partway through. Try again in a minute.' : test.message) : googleErrorLine(null),
        )
      } else {
        setErrorReason(null)
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  function openMap() {
    onClose()
    if (location.hash !== '#/map') location.hash = '#/map'
  }

  const count = remaining.length
  const allDone = state.kind === 'none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="google-fix-dialog"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-card"
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {allDone ? 'All addresses found' : 'Addresses not found'}
        </h2>

        {allDone ? (
          <p className="mt-2 text-sm text-ink-body" data-testid="google-fix-done">
            {found != null && found > 0 ? `Google found ${found}. ` : ''}Every address now has a pin.
          </p>
        ) : null}

        {state.kind === 'need-key' || state.kind === 'allow-network' || asking ? (
          <p className="mt-2 text-sm text-ink-body" data-testid="google-fix-intro">
            {notFoundLine(count, false)} Google finds more of them than the free lookup.
            {state.kind === 'allow-network' ? ' Address lookups are off right now, so nothing has been sent yet.' : ''}
          </p>
        ) : null}

        {state.kind === 'google-error' ? (
          <div className="mt-2 text-sm text-ink-body" data-testid="google-fix-error">
            <p>{notFoundLine(count, false)}</p>
            <p className="mt-1 text-error">{errorReason ?? googleErrorLine(null)}</p>
          </div>
        ) : null}

        {state.kind === 'google-missed' && !asking ? (
          <div className="mt-2 text-sm text-ink-body" data-testid="google-fix-missed">
            {found != null && found > 0 ? <p>Google found {found}.</p> : null}
            <p className={found ? 'mt-1' : ''}>{notFoundLine(count, true)}</p>
            <p className="mt-1">On the Map you can fix the address or drop a pin by hand.</p>
          </div>
        ) : null}

        {needsKeyField && !allDone ? (
          <label className="mt-3 block text-sm font-medium text-slate-600">
            Google Maps API key
            <input
              type="password"
              value={draft}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              data-testid="google-fix-key"
              placeholder="Paste your Google Maps API key"
              onChange={(event) => setDraft(event.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />
            <span className="mt-1 block text-meta font-normal text-ink-label">
              Saved on this PC in Windows Credential Manager. Setup steps are in Settings, under Address lookup.
            </span>
          </label>
        ) : null}

        {failure ? <ErrorNote className="mt-2 text-sm" error={failure} /> : null}

        {!allDone && (state.kind !== 'google-missed' || asking) ? (
          <p className="mt-3 text-meta text-ink-label">{GOOGLE_PRIVACY_LINE}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {state.kind === 'google-missed' && !asking ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink"
              >
                Close
              </button>
              <button
                ref={primary}
                type="button"
                data-testid="google-fix-map"
                onClick={openMap}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
              >
                Fix on the Map
              </button>
            </>
          ) : allDone ? (
            <button
              ref={primary}
              type="button"
              onClick={onClose}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onClose}
                className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:opacity-50"
              >
                Not now
              </button>
              <button
                ref={primary}
                type="button"
                data-testid="google-fix-run"
                disabled={!canRun}
                onClick={() => void run()}
                className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {busy
                  ? 'Asking Google…'
                  : state.kind === 'google-error'
                    ? 'Try again'
                    : state.kind === 'allow-network'
                      ? 'Allow and try with Google'
                      : 'Try again with Google'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
