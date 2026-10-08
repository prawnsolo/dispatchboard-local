/**
 * Google Maps API key for Local geocoding + Routes.
 *
 * Resolution order (never log the value):
 * 1. Desktop shell: Windows Credential Manager (Settings paste). Pre-0.3 builds used
 *    `google-maps-api-key.json`; the shell migrates and wipes it on first read.
 * 2. Vite env `VITE_GOOGLE_MAPS_API_KEY` from `.env.local` (dev / when no disk key)
 *
 * Geocoding still requires Allow network geocoding, and Google runs after a
 * Census miss or Census transport failure when there is no usable site pin. Check drive times uses the
 * same resolved key for Routes when network geocoding is allowed.
 */

import { useEffect, useState } from 'react'

/** Documented Vite / `.env.local` name for Pilot’s personal key in dev. */
export const VITE_GOOGLE_MAPS_API_KEY = 'VITE_GOOGLE_MAPS_API_KEY'

/** True inside the DispatchBoard (Local) window. Vite-only has no app config folder. */
export function desktopShellAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
export const GOOGLE_KEY_EVENT = 'dispatchboard-local-google-key'
/** Matches the Rust command. Longer pastes are rejected. */
export const GOOGLE_KEY_MAX_LEN = 256

export function normalizePastedGoogleKey(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > GOOGLE_KEY_MAX_LEN) return null
  if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

/** Read Vite-bundled env without logging. Empty / missing → null. */
export function readViteGoogleMapsApiKey(
  env: Record<string, unknown> | undefined = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: Record<string, unknown> }).env
    : undefined,
): string | null {
  const raw = env?.[VITE_GOOGLE_MAPS_API_KEY]
  return normalizePastedGoogleKey(typeof raw === 'string' ? raw : null)
}

function notifyGoogleKeyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(GOOGLE_KEY_EVENT))
  }
}

async function readDiskGoogleMapsApiKey(): Promise<string | null> {
  if (!desktopShellAvailable()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  const value = await invoke<string | null>('google_api_key_get')
  return normalizePastedGoogleKey(value)
}

/**
 * Disk key wins when set. Otherwise Vite `VITE_GOOGLE_MAPS_API_KEY`.
 * Never throws for a missing desktop command — falls through to env.
 */
export async function readGoogleMapsApiKey(): Promise<string | null> {
  try {
    const fromDisk = await readDiskGoogleMapsApiKey()
    if (fromDisk) return fromDisk
  } catch {
    // Vite-only or invoke failure → env fallback
  }
  return readViteGoogleMapsApiKey()
}

export async function writeGoogleMapsApiKey(key: string | null): Promise<void> {
  const trimmed = key?.trim() ?? ''
  const normalized = trimmed === '' ? '' : normalizePastedGoogleKey(key)
  if (trimmed !== '' && !normalized) {
    throw new Error('Paste the API key only, with no spaces or line breaks.')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('google_api_key_set', { key: normalized ?? '' })
  notifyGoogleKeyChanged()
}

/** `ready` is false until the first read finishes. */
export function useHasGoogleMapsApiKey(): { ready: boolean; hasKey: boolean } {
  const [state, setState] = useState<{ ready: boolean; hasKey: boolean }>({ ready: false, hasKey: false })
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const key = await readGoogleMapsApiKey()
        if (!cancelled) setState({ ready: true, hasKey: Boolean(key) })
      } catch {
        if (!cancelled) setState({ ready: true, hasKey: false })
      }
    }
    void load()
    const onChange = () => {
      void load()
    }
    window.addEventListener(GOOGLE_KEY_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(GOOGLE_KEY_EVENT, onChange)
    }
  }, [])
  return state
}

export type GoogleKeyTestResult = { ok: true; message: string } | { ok: false; message: string }

/**
 * Cheap Geocoding API ping for Settings → Test.
 * Uses a fixed US address. Never logs the key. Does not save anything.
 */
export async function testGoogleMapsApiKey(rawKey: string | null | undefined): Promise<GoogleKeyTestResult> {
  const key = normalizePastedGoogleKey(rawKey)
  if (!key) {
    return { ok: false, message: 'Paste an API key first, or save one on this PC.' }
  }
  const { geocodeWithGoogle, isGoogleGeocoderError } = await import('./geocode.ts')
  try {
    const match = await geocodeWithGoogle('1600 Pennsylvania Avenue NW', 'Washington, DC 20500', key)
    if (match === 'skip') {
      return { ok: false, message: 'Paste an API key first, or save one on this PC.' }
    }
    // ZERO_RESULTS still proves the key + Geocoding API are accepted.
    return {
      ok: true,
      message: match
        ? 'Valid. Geocoding API accepted this key.'
        : 'Valid. Geocoding API accepted this key (no match for the test address).',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const denied = /REQUEST_DENIED|OVER_DAILY_LIMIT|OVER_QUERY_LIMIT|API[_ ]?key/i.test(message)
    if (isGoogleGeocoderError(err) || denied) {
      return {
        ok: false,
        message: denied
          ? 'Invalid or blocked. Enable the Geocoding API on this key in Google Cloud Console, and check key restrictions.'
          : `Invalid or unreachable: ${message}`,
      }
    }
    return { ok: false, message: `Could not reach Google: ${message}` }
  }
}
