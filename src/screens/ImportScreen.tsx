import { useEffect, useState } from 'react'
import { recordsFromBytes, summarize, SUPPORTED_COLUMNS, type ParsedRow } from '../lib/add.ts'
import { applyRows, databasePath, geocodeLocalJobs, queryCounts, WIPE_LOCAL_CONFIRM, wipeLocalDatabase } from '../lib/db.ts'
import { formatDate, formatLocalTimestamp, formatTimeRange } from '../lib/format.ts'
import { readLastApply, writeLastApply, type LastApplyRecord } from '../lib/last-apply.ts'
import { ALLOW_NETWORK_GEOCODING_CONFIRM, useAllowNetworkGeocoding } from '../lib/prefs.ts'
import type { LocalGeocodeSummary } from '../lib/geocode-db.ts'
import type { ApplyStats } from '../lib/store.ts'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

type Preview = {
  fileName: string
  rows: ParsedRow[]
  summary: ReturnType<typeof summarize>
}

function GeocodeCounts({ summary, skipped }: { summary: LocalGeocodeSummary | null; skipped: boolean }) {
  if (skipped || !summary) {
    return (
      <p className="mt-2 text-sm text-ink-body" data-testid="geocode-skipped">
        Geocoding was not run for this apply. No address was sent to Census. Rows without a pin stay unmapped until you
        allow network geocoding and retry from Map, or save a pin by hand.
      </p>
    )
  }
  return (
    <div className="mt-2 text-sm text-ink" data-testid="geocode-counts">
      <p>
        <span className="font-semibold text-success">{summary.geocoded}</span> geocoded
        {' · '}
        <span className="font-semibold text-ink">{summary.still_unmapped}</span> still unmapped
        {summary.geocode_errors > 0 ? (
          <>
            {' · '}
            <span className="font-semibold text-error">{summary.geocode_errors}</span> geocode error
            {summary.geocode_errors === 1 ? '' : 's'}
          </>
        ) : null}
      </p>
      <p className="mt-1 text-ink-body">
        Census calls: {summary.census_calls}. Google Geocoding calls: {summary.google_calls}. OSM calls:{' '}
        {summary.nominatim_calls ?? 0}. Order: Census (geocoding.geo.census.gov) → saved site pin → Google (only with a
        key saved on this PC) → OpenStreetMap Nominatim (street level or finer). All lookups run from the desktop app,
        not the window, and only when network geocoding is allowed. Transport errors are not cached, so Map can retry
        them.
      </p>
    </div>
  )
}

function ApplyCounts({ record }: { record: LastApplyRecord }) {
  return (
    <div className="mt-3 text-sm">
      <p className="text-ink">
        <span className="font-semibold text-success">{record.inserted}</span> new
        {' · '}
        <span className="font-semibold text-ink">{record.updated}</span> updated
        {' · '}
        <span className="font-semibold text-ink">{record.skipped}</span> unchanged
        {' · '}
        <span className="font-semibold text-ink">{record.sitesWritten}</span> site writes
      </p>
      {record.mismatchCount != null ? (
        <p className="mt-1 text-ink-body">
          <span className="font-semibold text-ink">{record.mismatchCount}</span> advisory mismatch flag
          {record.mismatchCount === 1 ? '' : 's'} (import still applied).
        </p>
      ) : null}
      <p className="mt-1 text-ink-body">Last apply {formatLocalTimestamp(record.at)} (this computer&apos;s clock).</p>
    </div>
  )
}

export function ImportScreen({ onApplied, revision }: { onApplied: () => void; revision: number }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [updateMatched, setUpdateMatched] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [stats, setStats] = useState<ApplyStats | null>(null)
  const [lastApply, setLastApply] = useState<LastApplyRecord | null>(() => readLastApply())
  const [dbPath, setDbPath] = useState<string | null>(null)
  const [pathError, setPathError] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ jobs: number; sites: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [allowed, setAllowed] = useAllowNetworkGeocoding()
  const [geocodeAfter, setGeocodeAfter] = useState(true)
  const [geoSummary, setGeoSummary] = useState<LocalGeocodeSummary | null>(null)
  const [geoSkipped, setGeoSkipped] = useState(false)

  async function refreshMeta() {
    try {
      const [path, stored] = await Promise.all([databasePath(), queryCounts()])
      setDbPath(path)
      setCounts(stored)
      setPathError(null)
    } catch (error) {
      setPathError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void refreshMeta()
  }, [revision])

  async function readFile(file: File) {
    setParseError(null)
    setApplyError(null)
    setStats(null)
    setGeoSummary(null)
    setGeoSkipped(false)
    if (!/\.(xls|xlsx|csv)$/i.test(file.name)) {
      setPreview(null)
      setParseError('Choose a .xls, .xlsx, or .csv ADD export.')
      return
    }
    // The spreadsheet parser has known ReDoS / prototype-pollution advisories. A real
    // ADD export is a few hundred KB, so refuse anything wildly bigger before parsing.
    if (file.size > MAX_IMPORT_BYTES) {
      setPreview(null)
      setParseError('That file is larger than 5 MB. An ADD export is much smaller. Import only files exported from Pegasus.')
      return
    }
    try {
      const bytes = await file.arrayBuffer()
      const rows = recordsFromBytes(bytes)
      setPreview({ fileName: file.name, rows, summary: summarize(rows) })
    } catch (error) {
      setPreview(null)
      setParseError(error instanceof Error ? error.message : String(error))
    }
  }

  async function onApply() {
    if (!preview || preview.rows.length === 0) return
    let runGeocode = geocodeAfter
    if (runGeocode && !allowed) {
      if (!window.confirm(ALLOW_NETWORK_GEOCODING_CONFIRM)) {
        runGeocode = false
      } else {
        setAllowed(true)
      }
    }
    setApplying(true)
    setApplyError(null)
    setGeoSummary(null)
    setGeoSkipped(false)
    try {
      const result = await applyRows(preview.rows, { updateMatched })
      setStats(result)
      setLastApply(writeLastApply(result))
      onApplied()
      if (runGeocode) {
        try {
          const summary = await geocodeLocalJobs(result.writtenIds, { allowNetwork: true })
          setGeoSummary(summary)
          setGeoSkipped(false)
        } catch (error) {
          setGeoSkipped(true)
          setApplyError(
            `Saved the rows. Geocoding failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      } else {
        setGeoSkipped(true)
      }
      await refreshMeta()
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error))
    } finally {
      setApplying(false)
    }
  }

  async function onWipe() {
    const ok = window.confirm(WIPE_LOCAL_CONFIRM)
    if (!ok) return
    setApplyError(null)
    try {
      await wipeLocalDatabase()
      setStats(null)
      onApplied()
      await refreshMeta()
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error))
    }
  }

  const sample = preview?.rows.slice(0, 8) ?? []

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-auto px-6 py-6">
      <section
        className={`rounded-lg border bg-white p-6 shadow-card ${dragging ? 'border-brand' : 'border-line'}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) void readFile(file)
        }}
      >
        <h2 className="text-[22px] font-semibold">Import an ADD file</h2>
        <p className="mt-2 max-w-3xl text-base text-ink-body">
          Pick a local Excel or CSV export. Preview stays in memory until you apply. Apply writes only to the SQLite
          file on this computer.
        </p>
        <label className="mt-5 inline-flex cursor-pointer items-center rounded-md bg-brand px-6 py-3 text-[15px] font-semibold text-white hover:bg-brand-hover">
          Choose file
          <input
            type="file"
            accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
              event.target.value = ''
            }}
          />
        </label>
        {preview ? <p className="mt-3 text-sm text-ink">{preview.fileName}</p> : null}
        {parseError ? <p className="mt-3 text-sm text-error">{parseError}</p> : null}
      </section>

      {preview ? (
        <section className="rounded-lg border border-line bg-white p-6 shadow-card">
          <h2 className="text-lg font-semibold">Preview</h2>
          <p className="mt-2 text-base text-ink">
            <span className="font-semibold">{preview.summary.rows}</span> data rows
            {' · '}
            <span className="font-semibold">{preview.summary.jobs}</span> work orders
            {' · '}
            <span className="font-semibold">{preview.summary.capacity}</span> capacity blocks
            {preview.summary.dates.length ? ` · ${preview.summary.dates.length} dates` : ''}
          </p>
          <label className="mt-4 flex items-start gap-3 text-sm text-ink-body">
            <input
              type="checkbox"
              className="mt-1"
              checked={updateMatched}
              onChange={(event) => setUpdateMatched(event.target.checked)}
            />
            <span>
              Update matched work orders. On: same WO number (or same capacity key) is overwritten. Off: matches are
              skipped and only new rows are added. Nothing is deleted.
            </span>
          </label>
          <label className="mt-3 flex items-start gap-3 text-sm text-ink-body">
            <input
              type="checkbox"
              className="mt-1"
              checked={geocodeAfter}
              onChange={(event) => setGeocodeAfter(event.target.checked)}
            />
            <span>
              Geocode after apply (on by default; the first time, Apply asks once before any address leaves). Only the street, city, state and zip are sent, never names or work order numbers. The street address goes to the US Census
              Bureau geocoder (geocoding.geo.census.gov), and the job row stays in SQLite on this PC. If Census misses
              and there is no saved site pin, and you have pasted a Google Maps API key in Settings, that address is
              also sent to Google. With no key, Google is not called. OpenStreetMap Nominatim is the last fallback. If this is the first time, Apply asks you to
              confirm before any network call.
            </span>
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={applying || preview.rows.length === 0}
              onClick={() => void onApply()}
              className="rounded-md bg-brand px-6 py-3 text-[15px] font-semibold text-white hover:bg-brand-hover disabled:bg-brand-tint"
            >
              {applying ? (geocodeAfter ? 'Writing and geocoding…' : 'Writing…') : 'Apply to local database'}
            </button>
            <a href="#/jobs" className="rounded-md border border-brand px-6 py-3 text-[15px] font-semibold text-brand hover:bg-brand-wash">
              Open jobs
            </a>
          </div>
          {applyError ? <p className="mt-3 text-sm text-error">{applyError}</p> : null}
          {stats && lastApply ? (
            <>
              <ApplyCounts record={{ ...lastApply, ...stats }} />
              <GeocodeCounts summary={geoSummary} skipped={geoSkipped} />
              <p className="mt-2 text-xs text-ink-label">
                New rows were inserted. Updated rows matched a work order or capacity key and were overwritten.
                Unchanged rows matched and were left as stored. A mismatch rule match sets ≠ on the job. It does not
                block the apply. Geocode counts are for this apply only.
              </p>
            </>
          ) : null}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Technician</th>
                  <th className="py-2 pr-3 font-medium">WO</th>
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((row, index) => (
                  <tr key={`${row.woNumber ?? row.capacityKey ?? index}`} className="border-b border-line">
                    <td className="py-2 pr-3">{formatDate(row.scheduleDate)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatTimeRange(row.beginTime, row.endTime)}</td>
                    <td className="py-2 pr-3">{row.technicianName ?? '—'}</td>
                    <td className="py-2 pr-3">{row.isCapacity ? 'Capacity' : (row.woNumber ?? '—')}</td>
                    <td className="py-2 pr-3">{row.customerName}</td>
                    <td className="py-2">{row.activity1 ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > sample.length ? (
              <p className="mt-2 text-xs text-ink-label">Showing {sample.length} of {preview.rows.length} rows.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <details className="rounded-lg border border-line bg-white p-6 shadow-card">
        <summary className="cursor-pointer text-lg font-semibold text-ink">Supported columns</summary>
        <p className="mt-3 text-sm text-ink-body">
          Headers must match these 18 names exactly, in this order. Other workbooks are refused before any write.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink-body">
          {SUPPORTED_COLUMNS.map((column) => (
            <li key={column.column}>
              <span className="font-medium text-ink">{column.column}</span>
              <span className="text-ink-label"> — {column.storedAs}</span>
            </li>
          ))}
        </ul>
      </details>

      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">Database file</h2>
        {dbPath ? <p className="mt-2 break-all font-mono text-sm text-ink">{dbPath}</p> : null}
        {pathError ? (
          <p className="mt-2 text-sm text-error">
            This window cannot open SQLite ({pathError}). Start the desktop app with <code>npm run desktop</code> from{' '}
            <code>dispatchboard-local</code>.
          </p>
        ) : null}
        {counts ? (
          <p className="mt-2 text-sm text-ink-body">
            {counts.jobs} jobs · {counts.sites} sites stored on this PC.
          </p>
        ) : null}
        {lastApply ? (
          <p className="mt-2 text-sm text-ink-body">
            Last apply {formatLocalTimestamp(lastApply.at)} — {lastApply.inserted} new, {lastApply.updated} updated,{' '}
            {lastApply.skipped} unchanged.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void onWipe()}
          className="mt-4 rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink"
        >
          Wipe local database
        </button>
      </section>
    </div>
  )
}
