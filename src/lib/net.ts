/**
 * Geocoder GETs go through the Rust side (`geo_http_get` in src-tauri/src/geo.rs).
 *
 * Why: geocoding.geo.census.gov sends no CORS headers, so a webview `fetch`
 * always failed. Three failures opened the Census circuit and every remaining
 * row went to Google (Pilot saw 3 Census then 9 Google calls). Rust is not a
 * browser, so CORS does not apply. Host and path are fixed per provider in Rust.
 *
 * Outside Tauri (tsx tests, scripts) this falls back to Node's global fetch,
 * which also has no CORS.
 */

import { invoke } from '@tauri-apps/api/core'

export type GeoProvider = 'census' | 'google' | 'nominatim'

export type GeoHttpResponse = {
  ok: boolean
  status: number
  /** Parse the body as JSON. Throws on HTML/WAF pages, like `Response.json()`. */
  json: () => Promise<unknown>
}

type NativeResponse = { status: number; body: string }

export type GeoTransport = (provider: GeoProvider, url: string) => Promise<GeoHttpResponse>

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function wrap(status: number, body: string): GeoHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body) as unknown,
  }
}

const nativeTransport: GeoTransport = async (provider, url) => {
  const res = await invoke<NativeResponse>('geo_http_get', { provider, url })
  return wrap(res.status, res.body)
}

const fetchTransport: GeoTransport = async (_provider, url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  return wrap(res.status, await res.text())
}

let override: GeoTransport | null = null

/** Tests swap the transport to assert routing without the network. Pass null to reset. */
export function setGeoTransport(next: GeoTransport | null): void {
  override = next
}

/** Which path a geocoder GET takes right now (for Settings/diagnostics). */
export function geoTransportKind(): 'native' | 'fetch' | 'test' {
  if (override) return 'test'
  return inTauri() ? 'native' : 'fetch'
}

export function geoGet(provider: GeoProvider, url: string): Promise<GeoHttpResponse> {
  if (override) return override(provider, url)
  return inTauri() ? nativeTransport(provider, url) : fetchTransport(provider, url)
}
