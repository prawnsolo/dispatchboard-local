import { useId, useState } from 'react'
import {
  geocodeSearchCandidates,
  isNominatimCenter,
  minutesToMiles,
  OSM_COPYRIGHT,
  PROXIMITY_RADIUS_OPTIONS,
  type ProximityCenter,
} from '../lib/proximity.ts'

/**
 * Result line for the map overlay. Lives outside the header so a long place name
 * cannot push the header row wider than the window (0.2.3: logo clipped at 1024px).
 */
export function NearbyResult({
  center,
  radiusMinutes,
  matchCount,
}: {
  center: ProximityCenter
  radiusMinutes: number
  matchCount: number
}) {
  return (
    <div className="pointer-events-auto max-w-full rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-meta text-slate-600 shadow-sm">
      <p data-testid="nearby-summary">
        {matchCount} within ~{Math.round(minutesToMiles(radiusMinutes))} mi of{' '}
        <span className="font-medium text-slate-900">{center.label}</span>
      </p>
      {isNominatimCenter(center) ? (
        <p data-testid="osm-attribution">
          Street-level match ©{' '}
          <a href={OSM_COPYRIGHT} target="_blank" rel="noreferrer" className="underline">
            OpenStreetMap
          </a>{' '}
          contributors
        </p>
      ) : null}
    </div>
  )
}

export function NearbySearch({
  allowed,
  center,
  radiusMinutes,
  onFound,
  onRadiusChange,
  onClear,
  onAllow,
}: {
  allowed: boolean
  center: ProximityCenter | null
  radiusMinutes: number
  onFound: (center: ProximityCenter) => void
  onRadiusChange: (minutes: number) => void
  onClear: () => void
  onAllow: () => void
}) {
  const inputId = useId()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [choices, setChoices] = useState<ProximityCenter[] | null>(null)

  async function search() {
    const address = query.trim()
    if (!address || !allowed) return
    setSearching(true)
    setError(null)
    try {
      const found = await geocodeSearchCandidates(address)
      if (found.length === 0) {
        setError('No match for that address. Check the spelling, or add the house number and town.')
        return
      }
      if (found.length === 1 && found[0]) {
        onFound(found[0])
        setChoices(null)
        return
      }
      setChoices(found)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Address lookup failed.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1.5" data-testid="nearby-search">
      <label htmlFor={inputId} className="sr-only">
        Nearby search: find jobs near an address
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        placeholder="Nearby address"
        autoComplete="off"
        disabled={!allowed}
        title={
          allowed
            ? 'Census first, then Google (key saved), then OpenStreetMap Nominatim'
            : 'Nearby needs network geocoding. Census first, then Google (key saved), then OpenStreetMap Nominatim.'
        }
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void search()
          }
        }}
        className="h-8 w-36 rounded-lg border xl:w-44 border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500 disabled:bg-slate-100"
      />
      <label className="sr-only" htmlFor={`${inputId}-radius`}>
        Straight-line radius
      </label>
      <select
        id={`${inputId}-radius`}
        value={radiusMinutes}
        onChange={(event) => onRadiusChange(Number(event.target.value))}
        title="Approximate straight-line radius (~30 mph), not routed drive time"
        className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
      >
        {PROXIMITY_RADIUS_OPTIONS.map((opt) => (
          <option key={opt.minutes} value={opt.minutes}>
            ~{opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!allowed || searching || !query.trim()}
        onClick={() => void search()}
        className="h-8 rounded-lg bg-brand-600 px-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {searching ? 'Searching…' : 'Find'}
      </button>
      {!allowed ? (
        <button type="button" onClick={onAllow} className="h-8 text-meta font-medium text-brand-600 hover:underline">
          Allow geocoding
        </button>
      ) : null}
      {center ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear nearby search"
          title="Clear nearby search"
          className="h-8 rounded-lg px-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Clear
        </button>
      ) : null}
      {error ? (
        <p
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-meta text-error shadow-sm"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {choices ? (
        <div
          className="absolute right-0 top-full z-40 mt-1 w-72 space-y-1 rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          data-testid="nearby-choices"
        >
          <p className="text-xs font-medium text-ink">Pick a match</p>
          {choices.map((choice) => (
            <button
              key={`${choice.source}-${choice.label}-${choice.lat}`}
              type="button"
              onClick={() => {
                onFound(choice)
                setChoices(null)
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs text-ink hover:bg-slate-50"
            >
              {choice.label}
              {choice.source === 'nominatim' ? ' · OSM' : ''}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
