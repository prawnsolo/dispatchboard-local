import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { darkenStyle } from '../lib/map-dark.ts'
import { JOB_QUICK_VIEW_DELAY_MS, jobQuickViewElement } from '../lib/job-quick-view.ts'
import { circlePolygon, type ProximityCenter } from '../lib/proximity.ts'
import { useTheme } from '../lib/theme.tsx'
import { ensureMapLibreWorker } from '../lib/maplibre-worker.ts'
import { YARD } from '../lib/yard.ts'
import { GLYPH_PIXEL_RATIO, loadPinGlyphs } from '../lib/pin-glyphs.ts'

const FREDERICKSBURG: [number, number] = [-77.4605, 38.3032]
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
/** Dark basemap swallows the slate locked ring. */
const DARK_LOCKED_STROKE = '#cbd5e1'

export type MapPinJob = {
  id: number
  customer_name: string
  lat: number
  lng: number
  nearby: boolean
  /** Activity / template fill (office jobPinColor). */
  color: string
  /** Schedule ring: tentative amber / locked slate (office mapScheduleStroke). */
  stroke: string
  schedule: 'tentative' | 'scheduled' | 'locked'
  /** Checklist flag only (office map ⚑ layer). */
  flag: boolean
  /** Map image id for the job-type glyph, e.g. `ji-tank-light`. */
  glyph: string
  /** Hover popup fields (web job-quick-view parity). */
  customer_number?: string | null
  address_street?: string | null
  address_descriptor?: string | null
  address_city_state_zip?: string | null
  address_raw?: string | null
  city?: string | null
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
  activity_note?: string | null
}

export type MapPinBacklog = {
  id: number
  label: string
  lat: number
  lng: number
  nearby: boolean
  color?: string
}

function yardMarkerEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'db-yard-marker'
  el.setAttribute('data-testid', 'yard-marker')
  el.title = `${YARD.name} · ${YARD.address}`
  el.innerHTML =
    '<span class="db-yard-marker-icon" aria-hidden="true">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 10.5 12 3l9 7.5V21H3ZM9 21v-6h6v6"/></svg></span>' +
    '<span class="db-yard-marker-label">Yard</span>'
  return el
}

function proximityMarkerEl(fill: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'db-proximity-marker'
  el.setAttribute('data-testid', 'proximity-marker')
  el.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">' +
    `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" fill="${fill}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>` +
    '<circle cx="12" cy="10" r="3" fill="#fff"/></svg>'
  return el
}

function ensureJobLayers(map: maplibregl.Map, dark: boolean): void {
  if (!map.getSource('jobs')) {
    map.addSource('jobs', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id',
    })
  }
  if (!map.getSource('proximity')) {
    map.addSource('proximity', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getSource('backlog')) {
    map.addSource('backlog', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      promoteId: 'id',
    })
  }
  if (!map.getLayer('proximity-fill')) {
    map.addLayer({
      id: 'proximity-fill',
      type: 'fill',
      source: 'proximity',
      paint: { 'fill-color': dark ? '#a78bfa' : '#7c3aed', 'fill-opacity': 0.08 },
    })
  }
  if (!map.getLayer('proximity-outline')) {
    map.addLayer({
      id: 'proximity-outline',
      type: 'line',
      source: 'proximity',
      paint: { 'line-color': dark ? '#a78bfa' : '#7c3aed', 'line-width': 2, 'line-dasharray': [2, 2] },
    })
  }
  if (!map.getLayer('jobs-halo')) {
    map.addLayer({
      id: 'jobs-halo',
      type: 'circle',
      source: 'jobs',
      paint: {
        'circle-color': 'transparent',
        'circle-radius': 11,
        'circle-stroke-width': 0,
        'circle-stroke-color': '#ffffff',
      },
    })
  }
  if (!map.getLayer('jobs-circles')) {
    map.addLayer({
      id: 'jobs-circles',
      type: 'circle',
      source: 'jobs',
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 10.5, 10, 12, 13],
        'circle-stroke-width': ['case', ['==', ['get', 'schedule'], 'locked'], 2.4, 2],
        'circle-stroke-color': ['get', 'stroke'],
        'circle-opacity': 0.95,
      },
    })
  }
  if (!map.getLayer('jobs-icons')) {
    map.addLayer({
      id: 'jobs-icons',
      type: 'symbol',
      source: 'jobs',
      minzoom: 10.5,
      layout: {
        'icon-image': ['get', 'glyph'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10.5, 0.62, 12, 0.82],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }
  void loadPinGlyphs().then((images) => {
    for (const [id, data] of images) {
      try {
        if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: GLYPH_PIXEL_RATIO })
      } catch {
        // map was removed while the glyphs were drawing
      }
    }
  })
  if (!map.getLayer('jobs-flags')) {
    map.addLayer({
      id: 'jobs-flags',
      type: 'symbol',
      source: 'jobs',
      filter: ['==', ['to-number', ['get', 'flag']], 1],
      layout: {
        'text-field': '⚑',
        'text-size': 12,
        'text-offset': [0.9, -0.85],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#92400e',
        'text-halo-color': '#fffbeb',
        'text-halo-width': 1.2,
      },
    })
  }
  if (!map.getLayer('backlog-circles')) {
    map.addLayer({
      id: 'backlog-circles',
      type: 'circle',
      source: 'backlog',
      paint: {
        'circle-color': ['coalesce', ['get', 'color'], dark ? '#a78bfa' : '#6d28d9'],
        'circle-radius': 6,
        'circle-stroke-width': 2,
        'circle-stroke-color': dark ? '#e2e8f0' : '#0f172a',
        'circle-opacity': 0.95,
      },
    })
  }
}

export function LocalMap({
  jobs,
  backlog,
  selectedId,
  selectedBacklogId,
  proximity,
  proximityRadiusMiles,
  pinDrop,
  active,
  onSelectJob,
  onSelectBacklog,
  onMapClick,
}: {
  jobs: MapPinJob[]
  backlog: MapPinBacklog[]
  selectedId: number | null
  selectedBacklogId: number | null
  proximity: ProximityCenter | null
  proximityRadiusMiles: number | null
  pinDrop: boolean
  active: boolean
  onSelectJob: (id: number) => void
  onSelectBacklog: (id: number) => void
  onMapClick: (lat: number, lng: number) => void
}) {
  const { resolved } = useTheme()
  const dark = resolved === 'dark'
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const yardRef = useRef<maplibregl.Marker | null>(null)
  const proximityRef = useRef<maplibregl.Marker | null>(null)
  const onSelectRef = useRef(onSelectJob)
  const onSelectBacklogRef = useRef(onSelectBacklog)
  const onClickRef = useRef(onMapClick)
  const pinDropRef = useRef(pinDrop)
  const fitKeyRef = useRef('')
  const jobsByIdRef = useRef(new Map<number, MapPinJob>())
  const hoverTimerRef = useRef(0)
  const [readyEpoch, setReadyEpoch] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  onSelectRef.current = onSelectJob
  onSelectBacklogRef.current = onSelectBacklog
  onClickRef.current = onMapClick
  pinDropRef.current = pinDrop
  jobsByIdRef.current = new Map(jobs.map((job) => [job.id, job]))

  useEffect(() => {
    if (!active || !containerRef.current || mapRef.current) return
    let alive = true
    let map: maplibregl.Map
    try {
      ensureMapLibreWorker()
      // Always pass a real style URL. `undefined` can miss the first load event
      // when dark mode immediately calls setStyle.
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        center: FREDERICKSBURG,
        zoom: 9.4,
        attributionControl: { compact: true },
      })
      if (dark) {
        map.setStyle(STYLE, { transformStyle: (_prev, next) => darkenStyle(next) })
      }
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'This window could not start the map.')
      return
    }
    map.on('error', (event) => {
      const message = event.error?.message ?? ''
      if (/webgl/i.test(message)) setMapError(message)
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), 'bottom-right')
    yardRef.current = new maplibregl.Marker({ element: yardMarkerEl(), anchor: 'bottom' })
      .setLngLat([YARD.lng, YARD.lat])
      .addTo(map)
    mapRef.current = map

    const onStyleReady = () => {
      if (!alive) return
      try {
        ensureJobLayers(map, dark)
      } catch (err) {
        setMapError(err instanceof Error ? err.message : 'Map layers could not start.')
        return
      }
      readyRef.current = true
      map.resize()
      setReadyEpoch((n) => n + 1)
      map.fire('local-ready')
    }

    // style.load fires on initial load and after setStyle (dark). Prefer it over
    // a single 'load' so layers are re-attached when the basemap swaps.
    map.on('style.load', onStyleReady)
    if (map.isStyleLoaded()) onStyleReady()

    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const unpointer = () => {
      map.getCanvas().style.cursor = pinDropRef.current ? 'crosshair' : ''
    }
    let hoverTimer = 0
    let jobPopup: maplibregl.Popup | null = null
    const hideJobPopup = () => {
      if (hoverTimer) {
        window.clearTimeout(hoverTimer)
        hoverTimer = 0
      }
      hoverTimerRef.current = 0
      jobPopup?.remove()
      jobPopup = null
    }
    const showJobPopup = (id: number, lngLat: maplibregl.LngLatLike) => {
      const job = jobsByIdRef.current.get(id)
      if (!job) return
      hideJobPopup()
      jobPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 12,
        className: 'db-job-popup',
        maxWidth: '18rem',
      })
        .setLngLat(lngLat)
        .setDOMContent(jobQuickViewElement(job))
        .addTo(map)
    }
    map.on('mouseenter', 'jobs-circles', pointer)
    map.on('mouseleave', 'jobs-circles', unpointer)
    map.on('mouseenter', 'backlog-circles', pointer)
    map.on('mouseleave', 'backlog-circles', unpointer)
    map.on('mouseenter', 'jobs-circles', (event) => {
      if (pinDropRef.current) return
      const raw = event.features?.[0]?.properties?.id
      const id = typeof raw === 'number' ? raw : Number(raw)
      const geom = event.features?.[0]?.geometry
      if (!Number.isFinite(id) || geom?.type !== 'Point') return
      const coords = geom.coordinates as [number, number]
      if (hoverTimer) window.clearTimeout(hoverTimer)
      hoverTimer = window.setTimeout(() => {
        hoverTimer = 0
        hoverTimerRef.current = 0
        showJobPopup(id, coords)
      }, JOB_QUICK_VIEW_DELAY_MS)
      hoverTimerRef.current = hoverTimer
    })
    map.on('mouseleave', 'jobs-circles', hideJobPopup)
    map.on('click', 'jobs-circles', (event) => {
      hideJobPopup()
      if (pinDropRef.current) return
      const raw = event.features?.[0]?.properties?.id
      const id = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(id)) onSelectRef.current(id)
    })
    map.on('click', 'backlog-circles', (event) => {
      if (pinDropRef.current) return
      const raw = event.features?.[0]?.properties?.id
      const id = typeof raw === 'number' ? raw : Number(raw)
      if (Number.isFinite(id)) onSelectBacklogRef.current(id)
    })
    map.on('click', (event) => {
      if (!pinDropRef.current) return
      if (!map.getLayer('jobs-circles')) return
      const hits = map.queryRenderedFeatures(event.point, { layers: ['jobs-circles'] })
      if (hits.length) return
      if (map.getLayer('backlog-circles')) {
        const backlogHits = map.queryRenderedFeatures(event.point, { layers: ['backlog-circles'] })
        if (backlogHits.length) return
      }
      onClickRef.current(event.lngLat.lat, event.lngLat.lng)
    })

    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)

    return () => {
      alive = false
      observer.disconnect()
      readyRef.current = false
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = 0
      }
      map.off('style.load', onStyleReady)
      yardRef.current?.remove()
      yardRef.current = null
      proximityRef.current?.remove()
      proximityRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [active, dark])

  useEffect(() => {
    if (!active) return
    mapRef.current?.resize()
  }, [active])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = pinDrop ? 'crosshair' : ''
  }, [pinDrop])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      if (!map.getSource('jobs')) {
        try {
          ensureJobLayers(map, dark)
        } catch {
          return
        }
      }
      const jobsSrc = map.getSource('jobs') as maplibregl.GeoJSONSource | undefined
      if (!jobsSrc) return
      const features = jobs.map((job) => ({
        type: 'Feature' as const,
        id: job.id,
        geometry: { type: 'Point' as const, coordinates: [job.lng, job.lat] as [number, number] },
        properties: {
          id: job.id,
          nearby: job.nearby ? 1 : 0,
          label: job.customer_name,
          color: job.color,
          stroke: dark && job.schedule === 'locked' ? DARK_LOCKED_STROKE : job.stroke,
          schedule: job.schedule,
          flag: job.flag ? 1 : 0,
          glyph: job.glyph,
        },
      }))
      jobsSrc.setData({ type: 'FeatureCollection', features })
      if (map.getLayer('jobs-circles')) {
        const picked = ['==', ['to-number', ['get', 'id']], selectedId ?? -1]
        map.setPaintProperty('jobs-circles', 'circle-radius', [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['case', picked, 9, 6],
          10.5,
          ['case', picked, 13, 10],
          12,
          ['case', picked, 16, 13],
        ])
        map.setPaintProperty('jobs-circles', 'circle-stroke-width', [
          'case',
          ['==', ['to-number', ['get', 'id']], selectedId ?? -1],
          3.2,
          ['==', ['get', 'schedule'], 'locked'],
          2.4,
          2,
        ])
        map.setPaintProperty(
          'jobs-circles',
          'circle-opacity',
          proximity ? ['case', ['==', ['to-number', ['get', 'nearby']], 1], 0.95, 0.18] : 0.95,
        )
      }
      if (map.getLayer('jobs-icons')) {
        map.setPaintProperty(
          'jobs-icons',
          'icon-opacity',
          proximity ? ['case', ['==', ['to-number', ['get', 'nearby']], 1], 1, 0.25] : 1,
        )
      }
      if (map.getLayer('jobs-halo')) {
        map.setPaintProperty('jobs-halo', 'circle-stroke-width', [
          'case',
          ['==', ['to-number', ['get', 'id']], selectedId ?? -1],
          2.5,
          0,
        ])
        map.setPaintProperty('jobs-halo', 'circle-radius', [
          'case',
          ['==', ['to-number', ['get', 'id']], selectedId ?? -1],
          17,
          14,
        ])
      }
      const backlogSrc = map.getSource('backlog') as maplibregl.GeoJSONSource | undefined
      const backlogFeatures = backlog.map((item) => ({
        type: 'Feature' as const,
        id: item.id,
        geometry: { type: 'Point' as const, coordinates: [item.lng, item.lat] as [number, number] },
        properties: {
          id: item.id,
          nearby: item.nearby ? 1 : 0,
          label: item.label,
          color: item.color ?? (dark ? '#a78bfa' : '#6d28d9'),
        },
      }))
      backlogSrc?.setData({ type: 'FeatureCollection', features: backlogFeatures })
      if (map.getLayer('backlog-circles')) {
        map.setPaintProperty('backlog-circles', 'circle-radius', [
          'case',
          ['==', ['to-number', ['get', 'id']], selectedBacklogId ?? -1],
          9,
          6,
        ])
        map.setPaintProperty(
          'backlog-circles',
          'circle-opacity',
          proximity ? ['case', ['==', ['to-number', ['get', 'nearby']], 1], 0.95, 0.22] : 0.95,
        )
      }
      const fitKey = [...features, ...backlogFeatures]
        .map((feature) => String(feature.id))
        .sort()
        .join(',')
      if (fitKey && fitKey !== fitKeyRef.current) {
        fitKeyRef.current = fitKey
        const coords: [number, number][] = [[YARD.lng, YARD.lat]]
        for (const feature of features) coords.push(feature.geometry.coordinates)
        for (const feature of backlogFeatures) coords.push(feature.geometry.coordinates)
        const bounds = coords.reduce(
          (box, coord) => box.extend(coord),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        )
        map.fitBounds(bounds, { padding: 72, maxZoom: 12, duration: 400 })
      }
      const proximitySrc = map.getSource('proximity') as maplibregl.GeoJSONSource | undefined
      if (proximitySrc) {
        proximitySrc.setData(
          proximity && proximityRadiusMiles
            ? { type: 'FeatureCollection', features: [circlePolygon(proximity, proximityRadiusMiles)] }
            : { type: 'FeatureCollection', features: [] },
        )
      }
    }

    if (readyRef.current && map.isStyleLoaded()) apply()
    else {
      map.once('local-ready', apply)
      map.once('style.load', apply)
    }
  }, [backlog, dark, jobs, proximity, proximityRadiusMiles, readyEpoch, selectedBacklogId, selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (proximity && proximityRadiusMiles) {
      proximityRef.current?.remove()
      proximityRef.current = new maplibregl.Marker({
        element: proximityMarkerEl(dark ? '#a78bfa' : '#7c3aed'),
        anchor: 'bottom',
      })
      proximityRef.current.setLngLat([proximity.lng, proximity.lat]).addTo(map)
    } else {
      proximityRef.current?.remove()
    }
  }, [dark, proximity, proximityRadiusMiles, readyEpoch])

  return (
    <div className="relative min-h-0 flex-1 bg-surface" data-testid="local-map">
      {/*
        Inline position on purpose. MapLibre adds .maplibregl-map to this node and
        maplibre-gl.css (unlayered) sets position: relative, which beats Tailwind v4's
        layered `absolute inset-0`. The container then collapsed to 0px tall and the
        map (tiles, pins, controls) was clipped away, leaving a blank panel.
      */}
      <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />
      {!active ? null : (
        <p className="pointer-events-none absolute left-3 top-3 z-10 max-w-[16rem] rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-meta text-slate-600 shadow-sm">
          OpenFreeMap · yard {YARD.address}
        </p>
      )}
      {mapError ? (
        <p className="absolute inset-x-4 bottom-4 z-10 rounded-md bg-white px-3 py-2 text-sm text-error shadow-card" role="alert">
          The map could not start in this window ({mapError}). Jobs, Import, and Settings still work. A normal desktop
          window with WebGL can draw the pins.
        </p>
      ) : null}
    </div>
  )
}
