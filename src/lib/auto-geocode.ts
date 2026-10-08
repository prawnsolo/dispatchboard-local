/**
 * Which jobs the app geocodes on its own, with no click.
 *
 * Runs only after the person has allowed network geocoding once. Each job
 * goes Census → site pin → Google (key saved) → OpenStreetMap, the same chain
 * as the buttons. Known misses are cached, so a repeat run makes no calls.
 */

import { jobNeedsApplyGeocode } from './geocode.ts'

export const AUTO_GEOCODE_LIMIT = 40
/** Minimum gap between automatic runs, so a Census outage is not hammered. */
export const AUTO_GEOCODE_MIN_GAP_MS = 60_000

export type AutoGeocodeCandidate = {
  id: number
  is_capacity_block: number
  schedule_date: string | null
  address_street: string | null
  address_city_state_zip: string | null
  lat: number | null
  lng: number | null
  geocode_source: string | null
  geocode_address_key: string | null
}

/**
 * Soonest dated-today-or-later jobs that have an address and either no pin or
 * a pin for an older version of the address. Hand-placed pins are left alone.
 */
export function pickAutoGeocodeIds(
  rows: readonly AutoGeocodeCandidate[],
  today: string,
  limit = AUTO_GEOCODE_LIMIT,
): number[] {
  return rows
    .filter(
      (row) =>
        !row.is_capacity_block &&
        row.schedule_date != null &&
        row.schedule_date >= today &&
        Boolean(row.address_street?.trim() || row.address_city_state_zip?.trim()) &&
        row.geocode_source !== 'manual' &&
        jobNeedsApplyGeocode(row),
    )
    .sort((a, b) => (a.schedule_date! < b.schedule_date! ? -1 : a.schedule_date! > b.schedule_date! ? 1 : a.id - b.id))
    .slice(0, limit)
    .map((row) => row.id)
}

export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
