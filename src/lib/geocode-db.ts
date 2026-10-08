/**
 * Run the local Census → site pin → Google → Nominatim → Unmapped chain against SQLite.
 * `allowNetwork` false skips Census and Google (site pins already on disk still apply).
 * Google runs only when `allowNetwork` is true and a lookup or pasted key is passed.
 */

import {
  applyGeocodeCounts,
  geocodeAndPersistRows,
  geocodeWithGoogle,
  GoogleGeocoderError,
  memoryCache,
  siteKey,
  type CensusLookup,
  type GeocodePersistJob,
  type GoogleLookup,
  type NominatimLookup,
  type SitePin,
} from './geocode.ts'
import { normalizePastedGoogleKey } from './google-key.ts'
import {
  jobsByIds,
  listGeocodeCache,
  listSitePins,
  persistJobGeocode,
  upsertGeocodeCache,
  type SqlDb,
} from './store.ts'

export type LocalGeocodeSummary = {
  geocoded: number
  still_unmapped: number
  geocode_errors: number
  census_calls: number
  google_calls: number
  nominatim_calls: number
  /** True when Census was allowed to run for this batch. */
  network: boolean
}

function googleLookupFromKey(apiKey: string): GoogleLookup {
  return async (line) => {
    const match = await geocodeWithGoogle(line, null, apiKey)
    if (match === 'skip') throw new GoogleGeocoderError('Google key missing')
    return match
  }
}

export async function geocodeStoredJobs(
  db: SqlDb,
  ids: number[],
  opts: {
    allowNetwork: boolean
    census?: CensusLookup
    delayMs?: number
    /** Pasted key from this PC. Ignored when network geocoding is off. Tests pass `google` instead. */
    googleApiKey?: string | null
    google?: GoogleLookup
    /** Last fallback after Google. Ignored when network geocoding is off. */
    nominatim?: NominatimLookup
  } = { allowNetwork: false },
): Promise<LocalGeocodeSummary> {
  const unique = [...new Set(ids)]
  if (!unique.length) {
    return {
      geocoded: 0,
      still_unmapped: 0,
      geocode_errors: 0,
      census_calls: 0,
      google_calls: 0,
      nominatim_calls: 0,
      network: opts.allowNetwork,
    }
  }

  const loaded = await jobsByIds(db, unique)
  const rows: GeocodePersistJob[] = loaded.map((job) => ({
    id: job.id,
    address_street: job.address_street,
    address_city_state_zip: job.address_city_state_zip,
    lat: job.lat,
    lng: job.lng,
    geocode_source: job.geocode_source,
    geocode_address_key: job.geocode_address_key,
    is_capacity_block: job.is_capacity_block,
    customer_number: job.customer_number,
    service_location_number: job.service_location_number,
  }))

  const cacheRows = await listGeocodeCache(db)
  const cache = memoryCache(cacheRows)
  const siteByKey = new Map<string, SitePin>()
  for (const pin of await listSitePins(db)) {
    const key = siteKey(pin.customer_number, pin.service_location_number)
    if (key) siteByKey.set(key, { lat: pin.lat, lng: pin.lng })
  }

  const pasted = opts.allowNetwork ? normalizePastedGoogleKey(opts.googleApiKey) : null
  const google = opts.allowNetwork ? (opts.google ?? (pasted ? googleLookupFromKey(pasted) : undefined)) : undefined

  const batch = await geocodeAndPersistRows(rows, cache, siteByKey, (id, result) => persistJobGeocode(db, id, result), {
    delayMs: opts.delayMs,
    callCensus: opts.allowNetwork,
    census: opts.census,
    google,
    nominatim: opts.allowNetwork ? opts.nominatim : undefined,
  })

  try {
    const uniq = new Map(batch.cache_writes.map((entry) => [entry.address_key, entry]))
    await upsertGeocodeCache(
      db,
      [...uniq.values()].map((entry) => ({
        address_key: entry.address_key,
        lat: entry.lat,
        lng: entry.lng,
        geocode_source: entry.geocode_source,
        matched_address: entry.matched_address,
        address_street: entry.address_street ?? null,
        address_city_state_zip: entry.address_city_state_zip ?? null,
      })),
    )
  } catch (err) {
    console.warn('geocode_cache write skipped', err)
    batch.geocode_errors++
  }

  const counts = applyGeocodeCounts(rows, batch.geocode_errors)
  return {
    ...counts,
    census_calls: batch.census_calls,
    google_calls: batch.google_calls,
    nominatim_calls: batch.nominatim_calls,
    network: opts.allowNetwork,
  }
}
