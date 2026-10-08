/**
 * What is allowed to leave this PC for an address lookup.
 *
 * Only street + city/state/zip may go to Census, Google, or OpenStreetMap. The
 * Pegasus street field sometimes carries extra text: place tags
 * (`**NOAH'S HOUSE**`), "c/o" names, gate codes, phone numbers. None of that
 * is needed to find a building, and all of it identifies someone. It is cut
 * here, in one place, before any request is built.
 */

const PHONE = /\+?1?[\s.-]?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const TAGS = /\*\*[^*]*\*\*|\([^)]*\)|\[[^\]]*\]/g
/** Free-text notes that follow the real street. Matched narrowly so "GATE RD" survives. */
const NOTE_TAIL = /\b(?:C\/O|ATTN|GATE\s+CODE|CODE\s*[:#]?\s*\d|CALL\s+\d|LOCK\s*BOX|KEY\s+(?:IN|UNDER|AT))\b.*$/i

export function cleanStreetForLookup(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(TAGS, ' ')
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .replace(NOTE_TAIL, ' ')
    .replace(/[;|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s,]+$/, '')
    .trim()
}

const UNIT_TAIL =
  /(?:[\s,]+(?:APT|APARTMENT|UNIT|STE|SUITE|LOT|TRLR|TRAILER|BLDG|BUILDING|SPC|SPACE|RM|ROOM|FL|FLOOR)\.?\s*#?\s*[\w-]+|[\s,]*#\s*[\w-]+)\s*$/i

/**
 * Same street with a trailing unit/apartment/lot removed. Returns null when
 * there is nothing to strip, so callers only spend a second lookup when it can
 * change the answer.
 */
export function streetWithoutUnit(street: string | null | undefined): string | null {
  const cleaned = cleanStreetForLookup(street)
  if (!cleaned) return null
  const stripped = cleaned.replace(UNIT_TAIL, '').trim()
  if (!stripped || stripped === cleaned || !/^\d/.test(stripped)) return null
  return stripped
}
