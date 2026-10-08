import { useEffect, useState } from 'react'

/**
 * Network geocoding opt-in. Default off.
 * Stored in localStorage on this PC (same place as the theme choice).
 * Census and Nominatim stay blocked until this is true.
 */

export const NETWORK_GEOCODE_KEY = 'dispatchboard.local.allowNetworkGeocoding'
export const NETWORK_GEOCODE_EVENT = 'dispatchboard-local-geocode-pref'

export const ALLOW_NETWORK_GEOCODING_CONFIRM =
  'Allow network geocoding?\n\n' +
  'Only the street, city, state and zip are sent, never names, phone numbers or work order numbers. ' +
  'Once allowed, new and edited jobs are looked up automatically: Census first, then Google if it misses.\n\n' +
  'Street addresses will be sent to the public US Census Bureau geocoder ' +
  '(geocoding.geo.census.gov). Job rows stay in SQLite on this PC.\n\n' +
  'If a Google Maps API key is saved in Settings, an address Census cannot match ' +
  'or cannot reach (and that has no saved site pin) is also sent to Google Geocoding. ' +
  'With no key, Google is not called. Check drive times, when you use it, sends ' +
  'stop coordinates for one technician and one day to Google Routes with that same key.\n\n' +
  'If Census and Google have no match, the address may also go to OpenStreetMap Nominatim.\n\n' +
  'OK allows it and continues. Cancel leaves network geocoding off.'

export function readAllowNetworkGeocoding(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(NETWORK_GEOCODE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAllowNetworkGeocoding(allowed: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NETWORK_GEOCODE_KEY, allowed ? '1' : '0')
    }
  } catch {
    // The in-memory listeners still apply for this session when the caller updates state.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NETWORK_GEOCODE_EVENT))
  }
}

export function useAllowNetworkGeocoding(): [boolean, (allowed: boolean) => void] {
  const [allowed, setAllowed] = useState(readAllowNetworkGeocoding)
  useEffect(() => {
    const sync = () => setAllowed(readAllowNetworkGeocoding())
    window.addEventListener(NETWORK_GEOCODE_EVENT, sync)
    return () => window.removeEventListener(NETWORK_GEOCODE_EVENT, sync)
  }, [])
  return [
    allowed,
    (next: boolean) => {
      writeAllowNetworkGeocoding(next)
      setAllowed(next)
    },
  ]
}

/**
 * Map technician visibility. Default: all techs on (empty hidden set).
 * Unchecked names in Settings hide that tech's pins, route lines, and day
 * info on the Map. Stored in localStorage on this PC.
 */
export const MAP_HIDDEN_TECHS_KEY = 'dispatchboard.local.mapHiddenTechs'
export const MAP_HIDDEN_TECHS_EVENT = 'dispatchboard-local-map-hidden-techs'

export function readMapHiddenTechs(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set()
    const raw = localStorage.getItem(MAP_HIDDEN_TECHS_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

export function writeMapHiddenTechs(hidden: ReadonlySet<string>): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MAP_HIDDEN_TECHS_KEY, JSON.stringify([...hidden].sort((a, b) => a.localeCompare(b))))
    }
  } catch {
    // Session listeners still apply when the caller updates state.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(MAP_HIDDEN_TECHS_EVENT))
  }
}

export function isMapTechVisible(tech: string | null | undefined, hidden: ReadonlySet<string>): boolean {
  if (hidden.size === 0) return true
  const key = (tech ?? '').trim()
  if (!key) return true
  return !hidden.has(key)
}

export function useMapHiddenTechs(): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const [hidden, setHidden] = useState(readMapHiddenTechs)
  useEffect(() => {
    const sync = () => setHidden(readMapHiddenTechs())
    window.addEventListener(MAP_HIDDEN_TECHS_EVENT, sync)
    return () => window.removeEventListener(MAP_HIDDEN_TECHS_EVENT, sync)
  }, [])
  return [
    hidden,
    (next: ReadonlySet<string>) => {
      writeMapHiddenTechs(next)
      setHidden(new Set(next))
    },
  ]
}
