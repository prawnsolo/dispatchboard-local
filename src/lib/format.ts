/** Calendar date stored as YYYY-MM-DD. Format in UTC so the day does not shift. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{2}):(\d{2})/.exec(value)
  return match ? `${match[1]}:${match[2]}` : value
}

export function formatTimeRange(begin: string | null | undefined, end: string | null | undefined): string {
  if (!begin && !end) return '—'
  if (begin && end) return `${formatTime(begin)}–${formatTime(end)}`
  return formatTime(begin ?? end)
}

export function todayInNewYork(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

/** Short label for the shared date chip. UTC so the calendar day does not shift. */
export function formatDateChip(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

export function formatDayHeading(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

export function formatWeekdayHeading(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt)
}

/** Local clock for the Import “last apply” line. */
export function formatLocalTimestamp(iso: string): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(dt)
}

/** Compact account chip (`#10442`). Null when blank. */
export function formatCustomerAccount(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

/**
 * ADD stores technician names in capitals. Show them as names ("Chad Taylor",
 * "Pat McDonald", "Jo O'Brien"). Display only: stored values and matching keep the original.
 */
export function displayName(name: string | null | undefined): string {
  const raw = name?.trim()
  if (!raw) return ''
  // Leave mixed-case input alone: someone already typed it the way they want.
  if (raw !== raw.toUpperCase()) return raw
  return raw
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => 'Mc' + c.toUpperCase())
}
