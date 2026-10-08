const STORAGE_KEY = 'dispatchboard.local.lastApply'

export type LastApplyRecord = {
  at: string
  inserted: number
  updated: number
  skipped: number
  sitesWritten: number
  /** Advisory flags written on that apply. Missing on records from before stage 4. */
  mismatchCount?: number
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseLastApply(raw: string | null): LastApplyRecord | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<LastApplyRecord>
    if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null
    if (!isCount(value.inserted) || !isCount(value.updated) || !isCount(value.skipped) || !isCount(value.sitesWritten)) {
      return null
    }
    return {
      at: value.at,
      inserted: value.inserted,
      updated: value.updated,
      skipped: value.skipped,
      sitesWritten: value.sitesWritten,
      mismatchCount: isCount(value.mismatchCount) ? value.mismatchCount : undefined,
    }
  } catch {
    return null
  }
}

export function readLastApply(): LastApplyRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return parseLastApply(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeLastApply(
  stats: Pick<LastApplyRecord, 'inserted' | 'updated' | 'skipped' | 'sitesWritten' | 'mismatchCount'>,
  at = new Date(),
): LastApplyRecord {
  const record: LastApplyRecord = {
    at: at.toISOString(),
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    sitesWritten: stats.sitesWritten,
    mismatchCount: stats.mismatchCount,
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // The Import screen still shows this record for the current session.
  }
  return record
}
