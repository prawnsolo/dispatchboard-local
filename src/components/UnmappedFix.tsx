import { useEffect, useId, useState } from 'react'
import { geocodeLocalJobs, saveLocalJobAddress, saveLocalManualPin } from '../lib/db.ts'
import { parsePin } from '../lib/geocode.ts'
import { GOOGLE_KEY_EVENT, readGoogleMapsApiKey } from '../lib/google-key.ts'
import type { JobRow } from '../lib/store.ts'

export function UnmappedFix({
  job,
  allowed,
  dropped,
  onClose,
  onChanged,
  onAllow,
  onRequestDrop,
}: {
  job: JobRow
  allowed: boolean
  dropped: { lat: number; lng: number } | null
  onClose: () => void
  onChanged: () => void
  onAllow: () => void
  onRequestDrop: () => void
}) {
  const titleId = useId()
  const [street, setStreet] = useState(job.address_street ?? '')
  const [csz, setCsz] = useState(job.address_city_state_zip ?? '')
  const [lat, setLat] = useState(job.lat == null ? '' : String(job.lat))
  const [lng, setLng] = useState(job.lng == null ? '' : String(job.lng))
  const [saveOnSite, setSaveOnSite] = useState(Boolean(job.customer_number))
  const [busy, setBusy] = useState<'census' | 'pin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [hasGoogleKey, setHasGoogleKey] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void readGoogleMapsApiKey()
        .then((key) => {
          if (!cancelled) setHasGoogleKey(Boolean(key))
        })
        .catch(() => {
          if (!cancelled) setHasGoogleKey(false)
        })
    }
    load()
    window.addEventListener(GOOGLE_KEY_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(GOOGLE_KEY_EVENT, load)
    }
  }, [])

  useEffect(() => {
    if (!dropped) return
    setLat(String(dropped.lat))
    setLng(String(dropped.lng))
    setNote('Map click captured. Save pin to keep it.')
  }, [dropped])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function persistAddress() {
    await saveLocalJobAddress(job.id, {
      address_street: street.trim() || null,
      address_city_state_zip: csz.trim() || null,
    })
  }

  async function onRetryCensus() {
    if (!allowed) return
    setBusy('census')
    setError(null)
    setNote(null)
    try {
      await persistAddress()
      const summary = await geocodeLocalJobs([job.id], { allowNetwork: true, delayMs: 0 })
      const calls = `Census calls: ${summary.census_calls}. Google calls: ${summary.google_calls}. OSM calls: ${summary.nominatim_calls ?? 0}.`
      setNote(
        summary.geocoded > 0
          ? `Pin placed. ${calls}`
          : `Still unmapped. ${calls} A saved site pin is used when Census misses. Then Google (only with a key saved on this PC), then OpenStreetMap at street level.`,
      )
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function onSavePin() {
    setBusy('pin')
    setError(null)
    setNote(null)
    try {
      const pin = parsePin(lat, lng)
      await persistAddress()
      await saveLocalManualPin({
        jobId: job.id,
        lat: pin.lat,
        lng: pin.lng,
        saveOnSite: saveOnSite && Boolean(job.customer_number),
      })
      setNote(saveOnSite && job.customer_number ? 'Pin saved on the job and the site.' : 'Pin saved on the job.')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="unmapped-fix"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">Unmapped</p>
        <h2 id={titleId} className="text-lg font-semibold">
          Fix {job.customer_name}
        </h2>
        <p className="mt-1 text-sm text-ink-body">
          {job.wo_number ? `WO ${job.wo_number}` : 'No work order'}
          {job.technician_name ? ` · ${job.technician_name}` : ''}
        </p>
        <p className="mt-3 text-sm text-ink-body">
          {hasGoogleKey
            ? 'Retry runs Census first. If Census has no match or fails to answer, and this job has no saved site pin, the address is sent to Google Geocoding with the key stored on this PC. That happens only because network geocoding is allowed. Pin save writes latitude and longitude on this PC and does not use the network.'
            : 'Retry sends this street address to the public US Census geocoder. That call runs only after network geocoding is allowed. Google is not called until you paste a key in Settings. Pin save writes latitude and longitude on this PC and does not use the network.'}
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
          Street
          <input
            value={street}
            onChange={(event) => setStreet(event.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
          />
        </label>
        <label className="mt-3 block text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
          City, state, ZIP
          <input
            value={csz}
            onChange={(event) => setCsz(event.target.value)}
            placeholder="FREDERICKSBURG VA 22401"
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!allowed || busy != null}
            onClick={() => void onRetryCensus()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-brand-tint"
          >
            {busy === 'census' ? 'Geocoding…' : 'Retry geocode'}
          </button>
          {!allowed ? (
            <button
              type="button"
              onClick={onAllow}
              className="rounded-md border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-wash"
            >
              Allow network geocoding
            </button>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Latitude
            <input
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Longitude
            <input
              value={lng}
              onChange={(event) => setLng(event.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand"
            />
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-ink-body">
          <input
            type="checkbox"
            className="mt-1"
            checked={saveOnSite}
            disabled={!job.customer_number}
            onChange={(event) => setSaveOnSite(event.target.checked)}
          />
          <span>
            Also save this pin on the site
            {job.customer_number
              ? ` (customer ${job.customer_number}, location ${job.service_location_number ?? 0}). Later jobs at that site can use it when Census misses.`
              : '. This job has no customer number, so only the job can be pinned.'}
          </span>
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => void onSavePin()}
            className="rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            {busy === 'pin' ? 'Saving…' : 'Save pin'}
          </button>
          <button
            type="button"
            onClick={onRequestDrop}
            className="rounded-md px-4 py-2 text-sm font-semibold text-ink-body hover:text-ink"
          >
            Drop pin on map
          </button>
          <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-semibold text-ink-body hover:text-ink">
            Close
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
        {note ? <p className="mt-3 text-sm text-ink">{note}</p> : null}
      </div>
    </div>
  )
}
