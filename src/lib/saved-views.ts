/**
 * Named filter sets for the Sheet ("Tech A, zone 2, no capacity"). Stored in
 * localStorage on this PC. Holds filter choices only, never job data.
 */

export type SheetView = {
  name: string
  limitToDate: boolean
  includeCapacity: boolean
  technician: string
  zone: string
}

export const SHEET_VIEWS_KEY = 'dispatchboard.local.sheetViews'
export const MAX_VIEWS = 12

export function parseViews(raw: string | null): SheetView[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    const out: SheetView[] = []
    for (const v of data) {
      if (!v || typeof v !== 'object') continue
      const r = v as Record<string, unknown>
      if (typeof r.name !== 'string' || !r.name.trim()) continue
      out.push({
        name: r.name.trim().slice(0, 40),
        limitToDate: r.limitToDate !== false,
        includeCapacity: r.includeCapacity === true,
        technician: typeof r.technician === 'string' ? r.technician : '',
        zone: typeof r.zone === 'string' ? r.zone : '',
      })
    }
    return out.slice(0, MAX_VIEWS)
  } catch {
    return []
  }
}

/** Same name replaces the old view (case-insensitive). Oldest drops past the cap. */
export function upsertView(views: readonly SheetView[], view: SheetView): SheetView[] {
  const name = view.name.trim().slice(0, 40)
  if (!name) return [...views]
  const key = name.toLowerCase()
  const rest = views.filter((v) => v.name.toLowerCase() !== key)
  return [...rest, { ...view, name }].slice(-MAX_VIEWS)
}

export function removeView(views: readonly SheetView[], name: string): SheetView[] {
  return views.filter((v) => v.name !== name)
}

export function readSheetViews(): SheetView[] {
  try {
    return typeof localStorage === 'undefined' ? [] : parseViews(localStorage.getItem(SHEET_VIEWS_KEY))
  } catch {
    return []
  }
}

export function writeSheetViews(views: readonly SheetView[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SHEET_VIEWS_KEY, JSON.stringify(views))
  } catch {
    // storage blocked: views last for this session only
  }
}
