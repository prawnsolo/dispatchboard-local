import { useId } from 'react'
import { writeAllowNetworkGeocoding, writeFirstRunDone } from '../lib/prefs.ts'

/**
 * Shown once, on an empty database. Explains where the data lives and asks the
 * one question that matters: may street addresses go out for lookup. Nothing
 * else about the app is gated on the answer, and Settings can change it later.
 */
export function FirstRun({ onImport, onDone }: { onImport: () => void; onDone: () => void }) {
  const titleId = useId()

  function finish(allow: boolean, thenImport: boolean) {
    writeAllowNetworkGeocoding(allow)
    window.dispatchEvent(new Event('dispatchboard-local-geocode-pref'))
    writeFirstRunDone()
    onDone()
    if (thenImport) onImport()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="first-run"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-card"
      >
        <h2 id={titleId} className="text-xl font-semibold text-ink">
          Welcome to DispatchBoard Local
        </h2>
        <p className="mt-2 text-sm text-ink-body">
          Jobs, customers and notes live in one file on this PC. Nothing is uploaded, and a backup copy is made each day.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-ink">One choice: address lookups</h3>
        <p className="mt-1 text-sm text-ink-body">
          To put jobs on the map, the street, city, state and zip are sent to the US Census geocoder. If Census cannot
          find one and you have saved a Google key, that address goes to Google. Names, phone numbers and work order
          numbers never leave this PC. You can change this any time in Settings.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="first-run-allow"
            onClick={() => finish(true, true)}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Allow lookups and import a file
          </button>
          <button
            type="button"
            data-testid="first-run-deny"
            onClick={() => finish(false, true)}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:border-ink"
          >
            Keep lookups off
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            writeFirstRunDone()
            onDone()
          }}
          className="mt-3 text-sm text-slate-600 underline underline-offset-2"
        >
          Decide later
        </button>
      </div>
    </div>
  )
}
