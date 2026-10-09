import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { BestDays } from '../components/BestDays.tsx'
import { DriveTimesControl } from '../components/DriveTimesControl.tsx'
import { JobMarks } from '../components/JobMarks.tsx'
import { LocalMap, type MapPinBacklog, type MapPinJob } from '../components/LocalMap.tsx'
import { MapChromePortal } from '../components/MapChromeSlot.tsx'
import { NearbyResult, NearbySearch } from '../components/NearbySearch.tsx'
import { ScheduleHereDialog } from '../components/ScheduleHereDialog.tsx'
import { JobIcon } from '../components/JobIcon.tsx'
import { JobSummary } from '../components/JobSummary.tsx'
import { UnmappedFix } from '../components/UnmappedFix.tsx'
import { BACKLOG_TYPE_LABELS } from '../lib/backlog.ts'
import { checkLocalDriveTimes, geocodeLocalJobs, queryBacklog, queryJobs } from '../lib/db.ts'
import { driveTimeEligibility, type DriveLeg } from '../lib/drive-times.ts'
import { todayInNewYork } from '../lib/format.ts'
import { jobPinColor, mapScheduleSignal, mapScheduleStroke } from '../lib/colors.ts'
import { JobTypeChips, countJobTypes, jobTypeKey, type JobTypeCount } from '../components/JobTypeChips.tsx'
import { glyphToneFor, jobIcon } from '../lib/job-icons.ts'
import { glyphId } from '../lib/pin-glyphs.ts'
import { readHiddenTypes, writeHiddenTypes } from '../lib/saved-views.ts'
import { asCoord, jobHasMappedPin, pinConfidence } from '../lib/geocode.ts'
import { readGoogleMapsApiKey, useHasGoogleMapsApiKey } from '../lib/google-key.ts'
import { ALLOW_NETWORK_GEOCODING_CONFIRM, isMapTechVisible, useAllowNetworkGeocoding, useMapHiddenTechs } from '../lib/prefs.ts'
import { BOOTS_CHIP_LABEL, bootsFlagsForJobs } from '../lib/boots.ts'
import { durationHoursForJob } from '../lib/jobDurations.ts'
import { minutesToMiles, nearbyJobDistances, summarizeNearby, type ProximityCenter } from '../lib/proximity.ts'
import { addressPrefillFromNearbyLabel, technicianForPersist, type ScheduleHereTarget } from '../lib/schedule-here.ts'
import { ENABLE_JOB_CREATE } from '../lib/features.ts'
import { isCapacityBlock, techKey, uniqueTechs } from '../lib/schedule.ts'
import { blankJobDraft, type JobRow } from '../lib/store.ts'
import type { BacklogItem } from '../lib/backlog.ts'
import { YARD } from '../lib/yard.ts'
import { ErrorNote } from '../components/ErrorNote.tsx'

function addressLine(job: JobRow): string {
  return [job.address_street, job.address_city_state_zip].filter(Boolean).join(', ') || job.address_raw || 'No address'
}

export function MapScreen({
  revision,
  date,
  query,
  active,
  problemFilter = null,
  onChanged,
  onDateChange,
  onScheduleHere,
  onNewJobHere,
}: {
  revision: number
  date: string
  query: string
  active: boolean
  /** Today's problems strip selection. Null = show everything. */
  problemFilter?: ((job: JobRow) => boolean) | null
  onChanged: () => void
  onDateChange: (ymd: string) => void
  onScheduleHere: (job: JobRow, next: { schedule_date: string; technician_name: string | null }) => Promise<void>
  onNewJobHere: (draft: ReturnType<typeof blankJobDraft>) => void
}) {
  const [allowed, setAllowed] = useAllowNetworkGeocoding()
  const [hiddenTechs] = useMapHiddenTechs()
  const [allDates, setAllDates] = useState(false)
  const [trackedDate, setTrackedDate] = useState(date)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [allJobs, setAllJobs] = useState<JobRow[]>([])
  const [backlogItems, setBacklogItems] = useState<BacklogItem[]>([])
  const [showBacklog, setShowBacklog] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedBacklogId, setSelectedBacklogId] = useState<number | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleHereTarget | null>(null)
  const [fixId, setFixId] = useState<number | null>(null)
  const [pinDrop, setPinDrop] = useState(false)
  const [dropped, setDropped] = useState<{ lat: number; lng: number } | null>(null)
  const [radiusMinutes, setRadiusMinutes] = useState(30)
  const [center, setCenter] = useState<ProximityCenter | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geoNote, setGeoNote] = useState<string | null>(null)
  const [techFilter, setTechFilter] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<ReadonlySet<string>>(() => readHiddenTypes())
  const [driveLegs, setDriveLegs] = useState<DriveLeg[]>([])
  const [driveError, setDriveError] = useState<string | null>(null)
  const [driveFromCache, setDriveFromCache] = useState(false)
  const [driveChecking, setDriveChecking] = useState(false)
  const googleKey = useHasGoogleMapsApiKey()

  useEffect(() => {
    if (!pinDrop) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPinDrop(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pinDrop])

  if (date !== trackedDate) {
    setTrackedDate(date)
    setAllDates(false)
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const spanAll = allDates || Boolean(query.trim())
        const rows = await queryJobs({ date: spanAll ? '' : date, query })
        if (cancelled) return
        setJobs(rows)
        setError(null)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(
          /invoke/.test(message)
            ? 'This window cannot open SQLite. Start the desktop app with npm run desktop.'
            : message,
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, allDates, date, query, revision])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void (async () => {
      try {
        const [rows, backlog] = await Promise.all([queryJobs({ date: '', query: '' }), queryBacklog('')])
        if (cancelled) return
        setAllJobs(rows)
        setBacklogItems(backlog)
      } catch {
        if (!cancelled) {
          setAllJobs([])
          setBacklogItems([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active, revision])

  const dayJobs = useMemo(
    () => jobs.filter((job) => !isCapacityBlock(job) && (!problemFilter || problemFilter(job))),
    [jobs, problemFilter],
  )
  const techOptions = useMemo(() => uniqueTechs(dayJobs), [dayJobs])
  const visible = useMemo(() => {
    const byVis = dayJobs.filter((job) => isMapTechVisible(techKey(job.technician_name), hiddenTechs))
    return techFilter ? byVis.filter((job) => techKey(job.technician_name) === techFilter) : byVis
  }, [dayJobs, techFilter, hiddenTechs])
  const typeCounts = useMemo(() => countJobTypes(visible), [visible])
  const shown = useMemo(
    () => (hiddenTypes.size ? visible.filter((job) => !hiddenTypes.has(jobTypeKey(job))) : visible),
    [visible, hiddenTypes],
  )
  const unmapped = useMemo(() => shown.filter((job) => !jobHasMappedPin(job)), [shown])
  // Pins from the loosest source (street level only). Worth a look before sending a tech.
  const toCheck = useMemo(() => shown.filter((job) => jobHasMappedPin(job) && pinConfidence(job.geocode_source).level === 'check'), [shown])
  const radiusMiles = minutesToMiles(radiusMinutes)
  const distances = useMemo(
    () => (center ? nearbyJobDistances(visible, center, radiusMiles) : null),
    [center, radiusMiles, visible],
  )

  const pins: MapPinJob[] = useMemo(() => {
    const out: MapPinJob[] = []
    for (const job of shown) {
      const lat = asCoord(job.lat)
      const lng = asCoord(job.lng)
      if (lat == null || lng == null || !jobHasMappedPin(job)) continue
      const schedule = mapScheduleSignal(job)
      out.push({
        id: job.id,
        customer_name: job.customer_name,
        lat,
        lng,
        nearby: distances ? distances.has(String(job.id)) : false,
        color: jobPinColor(job),
        glyph: glyphId(jobIcon(job).icon, glyphToneFor(jobPinColor(job))),
        stroke: mapScheduleStroke(job),
        schedule,
        flag: Number(job.checklist_open) > 0,
        customer_number: job.customer_number,
        address_street: job.address_street,
        address_descriptor: job.address_descriptor,
        address_city_state_zip: job.address_city_state_zip,
        address_raw: job.address_raw,
        city: job.city,
        activity_1: job.activity_1,
        activity_2: job.activity_2,
        activity_3: job.activity_3,
        activity_note: job.activity_note,
      })
    }
    return out
  }, [distances, shown])

  const bootsFlags = useMemo(() => bootsFlagsForJobs(allJobs), [allJobs])

  const nearbySummary = useMemo(() => {
    if (!center) return null
    const selectedJob = selectedId != null ? allJobs.find((job) => job.id === selectedId) : null
    let candidate: {
      id?: number | string
      lat: number
      lng: number
      workHours?: number
      activity_1?: string | null
      activity_2?: string | null
      activity_3?: string | null
      begin_time?: string | null
    } | null = null
    if (selectedJob && !selectedJob.is_capacity_block) {
      const lat = asCoord(selectedJob.lat)
      const lng = asCoord(selectedJob.lng)
      if (lat != null && lng != null) {
        candidate = {
          id: selectedJob.id,
          lat,
          lng,
          workHours: durationHoursForJob(selectedJob),
          activity_1: selectedJob.activity_1,
          activity_2: selectedJob.activity_2,
          activity_3: selectedJob.activity_3,
          begin_time: selectedJob.begin_time,
        }
      }
    }
    // Nearby center is the candidate pin when no mapped selection (Schedule / New job here).
    if (!candidate) candidate = { lat: center.lat, lng: center.lng, workHours: durationHoursForJob({}) }
    const jobsForNearby = allJobs.filter((job) => isMapTechVisible(techKey(job.technician_name), hiddenTechs))
    return summarizeNearby(jobsForNearby, backlogItems, center, radiusMiles, todayInNewYork(), { candidate })
  }, [allJobs, backlogItems, center, radiusMiles, selectedId, hiddenTechs])
  const backlogPins: MapPinBacklog[] = useMemo(() => {
    if (!showBacklog) return []
    const open = backlogItems.filter((item) => item.status === 'open')
    const near = center ? nearbyJobDistances(open, center, radiusMiles) : null
    const out: MapPinBacklog[] = []
    for (const item of open) {
      const lat = asCoord(item.lat)
      const lng = asCoord(item.lng)
      if (lat == null || lng == null) continue
      out.push({
        id: item.id,
        label: item.customer_name?.trim() || BACKLOG_TYPE_LABELS[item.backlog_type],
        lat,
        lng,
        nearby: near ? near.has(String(item.id)) : false,
      })
    }
    return out
  }, [backlogItems, center, radiusMiles, showBacklog])

  const selected = allJobs.find((job) => job.id === selectedId) ?? visible.find((job) => job.id === selectedId) ?? null
  const selectedBacklog = backlogItems.find((item) => item.id === selectedBacklogId) ?? null
  const fixJob = visible.find((job) => job.id === fixId) ?? null

  const eligibility = driveTimeEligibility({
    techFilter,
    scheduleDate: date,
    allDates,
  })
  const driveDisabledReason = !googleKey.ready
    ? 'Looking for a saved Google key on this PC.'
    : !googleKey.hasKey
      ? 'Save a Google Maps API key in Settings. Enable the Routes API on that key. With no key, drive times stay off.'
      : !allowed
        ? 'Turn on Allow network geocoding in Settings. Check drive times sends stop coordinates to Google Routes.'
        : !eligibility.ok && eligibility.reason === 'multi_tech'
          ? 'Choose one technician. Drive times are one person and one day.'
          : !eligibility.ok
            ? 'Turn off All dates. Drive times use the shared date chip, one day only.'
            : null

  useEffect(() => {
    setDriveLegs([])
    setDriveError(null)
    setDriveFromCache(false)
  }, [techFilter, date, allDates, revision, hiddenTechs])

  async function onDriveTimes(refresh: boolean) {
    if (driveDisabledReason || !eligibility.ok) return
    setDriveChecking(true)
    setDriveError(null)
    try {
      const outcome = await checkLocalDriveTimes({
        technicianName: eligibility.technicianName,
        scheduleDate: eligibility.scheduleDate,
        allDates: false,
        jobs: visible,
        refresh,
        allowNetwork: allowed,
        apiKey: await readGoogleMapsApiKey(),
      })
      if (outcome.skipped) {
        setDriveLegs([])
        setDriveError(outcome.skipReason || 'Drive times were not checked.')
        return
      }
      if (outcome.error) {
        setDriveLegs([])
        setDriveError(outcome.error)
        return
      }
      if (outcome.reason === 'too_few_stops') {
        setDriveLegs([])
        setDriveError('Need at least one mapped job for this technician and day. The yard is included in the route.')
        return
      }
      if (outcome.legs.length === 0) {
        setDriveLegs([])
        setDriveError(driveDisabledReason || 'Drive times were not checked.')
        return
      }
      setDriveLegs(outcome.legs)
      setDriveFromCache(outcome.fromCache)
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : String(err))
    } finally {
      setDriveChecking(false)
    }
  }

  function allow() {
    setAllowed(true)
  }

  function confirmAllow(): boolean {
    if (allowed) return true
    if (!window.confirm(ALLOW_NETWORK_GEOCODING_CONFIRM)) return false
    allow()
    return true
  }

  async function geocodeVisible() {
    if (!confirmAllow()) return
    const ids = unmapped.map((job) => job.id)
    if (!ids.length) return
    setGeocoding(true)
    setGeoNote(null)
    try {
      const summary = await geocodeLocalJobs(ids, { allowNetwork: true })
      setGeoNote(
        `${summary.geocoded} geocoded · ${summary.still_unmapped} still unmapped · ${summary.census_calls} Census · ${summary.google_calls} Google · ${summary.nominatim_calls ?? 0} OSM.`,
      )
      onChanged()
    } catch (err) {
      setGeoNote(err instanceof Error ? err.message : String(err))
    } finally {
      setGeocoding(false)
    }
  }

  function openNewHere(target: ScheduleHereTarget) {
    if (!ENABLE_JOB_CREATE) return
    const draft = blankJobDraft()
    draft.schedule_date = target.date
    draft.technician_name = technicianForPersist(target.tech) ?? ''
    if (center) {
      const address = addressPrefillFromNearbyLabel(center.label)
      draft.address_street = address.address_street
      draft.address_city_state_zip = address.address_city_state_zip
      draft.address_raw = address.address_raw
    }
    onNewJobHere(draft)
  }

  const scheduleJob = scheduleTarget ? selected : null
  const mapCount =
    (loading ? 'Loading…' : `${pins.length} on map`) +
    (unmapped.length ? ` · ${unmapped.length} unmapped` : '') +
    (showBacklog ? ` · ${backlogPins.length} backlog` : '') +
    (allDates || query.trim() ? ' · all dates' : '') +
    (query.trim() ? ' · header search' : '')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MapChromePortal>
        <MapFilters
          techFilter={techFilter}
          techOptions={techOptions}
          allDates={allDates}
          showBacklog={showBacklog}
          onTech={setTechFilter}
          onAllDates={setAllDates}
          onBacklog={setShowBacklog}
          types={typeCounts}
          hiddenTypes={hiddenTypes}
          onToggleType={(key) =>
            setHiddenTypes((prev) => {
              const next = new Set(prev)
              if (next.has(key)) next.delete(key)
              else next.add(key)
              writeHiddenTypes(next)
              return next
            })
          }
          onResetTypes={() => {
            writeHiddenTypes(new Set())
            setHiddenTypes(new Set())
          }}
        />
        <NearbySearch
          allowed={allowed}
          center={center}
          radiusMinutes={radiusMinutes}
          onFound={setCenter}
          onRadiusChange={setRadiusMinutes}
          onClear={() => setCenter(null)}
          onAllow={() => {
            confirmAllow()
          }}
        />
        {nearbySummary ? (
          <BestDays
            summary={nearbySummary}
            selectedJobId={selected && !selected.is_capacity_block ? selected.id : null}
            selectedName={selected && !selected.is_capacity_block ? selected.customer_name : null}
            onPickDate={(ymd) => {
              setAllDates(false)
              onDateChange(ymd)
            }}
            onSelectJob={(id) => {
              setSelectedId(id)
              setSelectedBacklogId(null)
              setPinDrop(false)
            }}
            onSelectBacklog={(id) => {
              setSelectedBacklogId(id)
              setSelectedId(null)
              setPinDrop(false)
            }}
            onScheduleHere={setScheduleTarget}
            onNewJobHere={openNewHere}
          />
        ) : null}
      </MapChromePortal>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {pinDrop && fixJob ? (
          <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-wash px-4 py-2 text-sm text-ink">
            <p>Click the map to set a pin for {fixJob.customer_name}. Nothing is saved until you confirm.</p>
            <button
              type="button"
              onClick={() => setPinDrop(false)}
              className="font-semibold text-slate-900 underline underline-offset-2"
            >
              Cancel drop
            </button>
          </div>
        ) : null}
        <div
          className={`pointer-events-none absolute right-3 z-10 flex top-3 max-w-[min(36rem,calc(100%-1.5rem))] flex-col items-end gap-2`}
          data-testid="map-overlay-tools"
        >
          <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-sm">
            <span className="text-xs text-slate-500" data-testid="map-job-count" title={`Yard stays at ${YARD.address}`}>
              {mapCount}
            </span>
            <DriveTimesControl
              compact
              disabled={driveDisabledReason != null}
              disabledReason={driveDisabledReason}
              checking={driveChecking}
              legs={driveLegs}
              error={driveError}
              fromCache={driveFromCache}
              onCheck={() => void onDriveTimes(false)}
              onRefresh={() => void onDriveTimes(true)}
            />
            <button
              type="button"
              disabled={geocoding || unmapped.length === 0}
              title={
                allowed
                  ? 'Census, then a saved site pin, then Google if a key is saved in Settings.'
                  : 'Needs Allow network geocoding in Settings. Census runs first.'
              }
              onClick={() => void geocodeVisible()}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              {geocoding ? 'Geocoding…' : `Geocode (${unmapped.length})`}
            </button>
          </div>
          {center ? (
            <NearbyResult center={center} radiusMinutes={radiusMinutes} matchCount={distances?.size ?? 0} />
          ) : null}
          {geoNote ? <p className="pointer-events-auto rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-xs text-slate-700 shadow-sm">{geoNote}</p> : null}
          {error ? <ErrorNote className="pointer-events-auto text-sm" error={error} /> : null}
        </div>

        <div className="absolute bottom-3 left-3 z-10 w-[min(20rem,calc(100%-1.5rem))] space-y-2">
          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white/95 shadow-sm">
            <p className="border-b border-slate-200 px-2 py-1 text-sm font-medium text-slate-600">
              Unmapped ({unmapped.length})
            </p>
            {unmapped.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-slate-500">Every job in this filter has a pin, or the list is empty.</p>
            ) : (
              <>
              {pins.length === 0 ? (
                <div className="space-y-1 border-b border-slate-100 px-2 py-1.5 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">No pins yet — {unmapped.length} need geocoding.</p>
                  <p>
                    Turn on Allow network geocoding in Settings (Hamburger), optionally paste a Google key, then click{' '}
                    <span className="font-semibold">Geocode ({unmapped.length})</span> above. Census runs first; Google
                    only with a saved key after a Census miss. Filters → All dates if jobs sit on other days.
                  </p>
                </div>
              ) : null}
              <ul>
                {unmapped.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-0.5 pl-2 pr-1 last:border-b-0">
                    <div className="flex min-w-0 items-start gap-1.5">
                      <JobIcon job={job} size={20} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-xs font-medium text-slate-900">
                          <span className="truncate">{job.customer_name}</span>
                          <JobMarks job={job} />
                        </p>
                        <p className="truncate text-xs text-slate-600">{addressLine(job)}</p>
                        <p className="truncate text-xs text-slate-500">{job.activity_1}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFixId(job.id)
                        setDropped(null)
                        setPinDrop(false)
                      }}
                      className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded px-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                    >
                      Fix
                    </button>
                  </li>
                ))}
              </ul>
              </>
            )}
            {toCheck.length ? (
              <div data-testid="pins-to-check">
                <p className="border-y border-slate-200 px-2 py-1 text-sm font-medium text-slate-600">
                  Check these pins ({toCheck.length})
                </p>
                <ul>
                  {toCheck.map((job) => (
                    <li key={job.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-0.5 pl-2 pr-1 last:border-b-0">
                      <div className="flex min-w-0 items-start gap-1.5">
                        <JobIcon job={job} size={20} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-900">{job.customer_name}</p>
                          <p className="truncate text-xs text-slate-600">{addressLine(job)}</p>
                          <p className="truncate text-xs text-slate-500">
                            {job.activity_1} · {pinConfidence(job.geocode_source).label}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setFixId(job.id)
                          setDropped(null)
                          setPinDrop(false)
                        }}
                        className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded px-2 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                      >
                        Review
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {selected ? (
            <div className="rounded-md border border-slate-200 bg-white/95 p-2 text-xs shadow-sm" data-testid="map-selected-card">
              <JobSummary job={selected} compact />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <JobMarks job={selected} />
                {bootsFlags.has(String(selected.id)) ? (
                  <span
                    className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[12px] font-semibold text-amber-900"
                    data-testid="boots-chip"
                  >
                    {BOOTS_CHIP_LABEL}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-slate-500">
                {pinConfidence(selected.geocode_source).label}
                {selected.lat != null && selected.lng != null ? ` · ${selected.lat}, ${selected.lng}` : ''}
              </p>
              {!jobHasMappedPin(selected) ? (
                <button
                  type="button"
                  onClick={() => {
                    setFixId(selected.id)
                    setDropped(null)
                  }}
                  className="mt-1 font-semibold text-slate-900 underline underline-offset-2"
                >
                  Fix unmapped
                </button>
              ) : null}
            </div>
          ) : null}
          {selectedBacklog ? (
            <div className="rounded-md border border-slate-200 bg-white/95 p-2 text-xs shadow-sm">
              <p className="text-sm font-medium text-slate-600">Backlog</p>
              <p className="mt-0.5 font-semibold text-slate-900">
                {selectedBacklog.customer_name?.trim() || BACKLOG_TYPE_LABELS[selectedBacklog.backlog_type]}
              </p>
              <p className="mt-0.5 text-slate-600">
                {BACKLOG_TYPE_LABELS[selectedBacklog.backlog_type]}
                {selectedBacklog.address_street || selectedBacklog.address_raw
                  ? ` · ${selectedBacklog.address_street || selectedBacklog.address_raw}`
                  : ''}
              </p>
              <a href="#/backlog" className="mt-1 inline-block font-semibold text-slate-900 underline underline-offset-2">
                Open backlog
              </a>
            </div>
          ) : null}
        </div>

        <LocalMap
          jobs={pins}
          backlog={backlogPins}
          selectedId={selectedId}
          selectedBacklogId={selectedBacklogId}
          proximity={center}
          proximityRadiusMiles={center ? radiusMiles : null}
          pinDrop={pinDrop}
          active={active}
          onSelectJob={(id) => {
            setSelectedId(id)
            setSelectedBacklogId(null)
            setPinDrop(false)
          }}
          onSelectBacklog={(id) => {
            setSelectedBacklogId(id)
            setSelectedId(null)
            setPinDrop(false)
          }}
          onMapClick={(lat, lng) => {
            if (!pinDrop || fixId == null) return
            setDropped({ lat, lng })
            setPinDrop(false)
          }}
        />
      </div>

      {fixJob && !pinDrop ? (
        <UnmappedFix
          key={`${fixJob.id}-${dropped?.lat ?? 'x'}-${dropped?.lng ?? 'y'}`}
          job={fixJob}
          allowed={allowed}
          dropped={dropped}
          onClose={() => {
            setFixId(null)
            setDropped(null)
          }}
          onChanged={onChanged}
          onAllow={() => {
            confirmAllow()
          }}
          onRequestDrop={() => setPinDrop(true)}
        />
      ) : null}
      {scheduleTarget && scheduleJob ? (
        <ScheduleHereDialog
          job={scheduleJob}
          target={scheduleTarget}
          onClose={() => setScheduleTarget(null)}
          onConfirm={async (next) => {
            await onScheduleHere(scheduleJob, next)
            setScheduleTarget(null)
          }}
        />
      ) : null}
    </div>
  )
}

function MapFilters({
  techFilter,
  techOptions,
  allDates,
  showBacklog,
  onTech,
  onAllDates,
  onBacklog,
  types,
  hiddenTypes,
  onToggleType,
  onResetTypes,
}: {
  types: JobTypeCount[]
  hiddenTypes: ReadonlySet<string>
  onToggleType: (key: string) => void
  onResetTypes: () => void
  techFilter: string
  techOptions: string[]
  allDates: boolean
  showBacklog: boolean
  onTech: (value: string) => void
  onAllDates: (value: boolean) => void
  onBacklog: (value: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const active = (techFilter ? 1 : 0) + (allDates ? 1 : 0) + (showBacklog ? 0 : 1) + (hiddenTypes.size ? 1 : 0)

  useEffect(() => {
    if (!open) return
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="map-filters"
        onClick={() => setOpen((value) => !value)}
        className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        Filters{active ? ` (${active})` : ''}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 top-full z-40 mt-1 max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] overflow-auto space-y-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
        >
          <p id={titleId} className="text-sm font-medium text-slate-600">
            Map filters
          </p>
          <label className="block text-xs text-slate-600">
            Technician
            <select
              value={techFilter}
              aria-label="Technician"
              onChange={(event) => onTech(event.target.value)}
              className="mt-1 h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              <option value="">All technicians</option>
              {techOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={allDates} onChange={(event) => onAllDates(event.target.checked)} />
            All dates
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={showBacklog} onChange={(event) => onBacklog(event.target.checked)} />
            Open backlog
          </label>
          {types.length > 1 ? (
            <div>
              <p className="mb-1 text-xs text-slate-600">Job types</p>
              <JobTypeChips types={types} hidden={hiddenTypes} onToggle={onToggleType} onReset={onResetTypes} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
