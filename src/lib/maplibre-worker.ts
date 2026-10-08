/**
 * MapLibre tile workers under Tauri WebView2 (https://tauri.localhost).
 *
 * The default build spins a blob: worker. That often fails in the desktop
 * shell, so the basemap mounts (yard pin + attribution) but never paints
 * tiles. Point the worker at the same-origin CSP worker asset instead.
 */
import { setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url'

let configured = false

export function ensureMapLibreWorker(): void {
  if (configured) return
  setWorkerUrl(maplibreWorkerUrl)
  configured = true
}
