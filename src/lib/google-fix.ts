/**
 * What to tell the user about addresses that could not be found, and what the
 * "Use Google to fix addresses not found" step should offer. Pure: no network,
 * no storage. The dialog and the Settings button both read from here.
 */

import { jobHasMappedPin } from './geocode.ts'

export type GoogleFixState =
  | { kind: 'none' }
  /** Network lookups are off. Ask before anything is sent. */
  | { kind: 'allow-network'; count: number }
  /** No Google key on this PC. Offer a paste field. */
  | { kind: 'need-key'; count: number }
  /** A key is saved and Google answered with an error (bad key, quota, offline). */
  | { kind: 'google-error'; count: number }
  /** A key is saved and Google also found nothing for these. */
  | { kind: 'google-missed'; count: number }

export type GoogleFixInput = {
  /** Jobs with a street address and no pin. */
  unmapped: number
  networkAllowed: boolean
  hasKey: boolean
  /** Google calls that came back as errors in the run that just finished. */
  googleErrors: number
}

export function googleFixState(input: GoogleFixInput): GoogleFixState {
  const count = input.unmapped
  if (count <= 0) return { kind: 'none' }
  if (!input.networkAllowed) return { kind: 'allow-network', count }
  if (!input.hasKey) return { kind: 'need-key', count }
  if (input.googleErrors > 0) return { kind: 'google-error', count }
  return { kind: 'google-missed', count }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** "3 addresses couldn't be found." with the right verb for one. */
export function notFoundLine(count: number, withGoogle: boolean): string {
  const tail = withGoogle ? ', even with Google.' : '.'
  return `${count} ${plural(count, "address couldn't", "addresses couldn't")} be found${tail}`
}

/** Plain-language reason Google failed. Never includes the key. */
export function googleErrorLine(message: string | null | undefined): string {
  const text = (message ?? '').toLowerCase()
  if (/denied|invalid|not authorized|api key|403|request_denied/.test(text)) {
    return 'Google said no to this key. Check that the Geocoding API is turned on for it.'
  }
  if (/over_query_limit|quota|429|limit/.test(text)) {
    return 'Google says this key is over its limit for now. Try again later.'
  }
  return "Couldn't reach Google. Check the internet connection and try again."
}

export const GOOGLE_PRIVACY_LINE =
  'Only the street, city, state and zip of the addresses listed here go to Google. No names, phones or work order numbers.'

/** Ids of jobs a Google retry could help: street address, not a capacity block, no pin. */
export function unmappedFixableIds(
  jobs: ReadonlyArray<{
    id: number
    address_street: string | null
    lat: number | string | null
    lng: number | string | null
    geocode_source: string | null
    is_capacity_block?: boolean | number | null
  }>,
): number[] {
  return jobs
    .filter((job) => !job.is_capacity_block && !jobHasMappedPin(job) && Boolean(job.address_street?.trim()))
    .map((job) => job.id)
}
