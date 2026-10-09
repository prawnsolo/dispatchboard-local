/**
 * Bulk edit on the Sheet: pick rows, pick one field, give one value. Reuses the
 * single-cell parser so a bulk edit accepts exactly what a typed cell accepts.
 */

import { isSheetCellEditable, parseSheetCell, SHEET_COLUMNS, type SheetColumn, type SheetColumnKey, type SheetPatch } from './sheet.ts'

export const BULK_FIELDS: readonly SheetColumnKey[] = ['technician_name', 'schedule_date', 'zone_code', 'begin_time', 'end_time', 'activity_note']

export function bulkColumn(key: SheetColumnKey): SheetColumn {
  const column = SHEET_COLUMNS.find((c) => c.key === key)
  if (!column) throw new Error(`Unknown column ${key}`)
  return column
}

export type BulkPlan =
  | { ok: true; patch: SheetPatch; ids: number[]; skipped: number }
  | { ok: false; error: string }

export function planBulk(
  rows: ReadonlyArray<{ id: number; is_capacity_block: number | boolean }>,
  selected: ReadonlySet<number>,
  key: SheetColumnKey,
  raw: string,
): BulkPlan {
  const column = bulkColumn(key)
  const parsed = parseSheetCell(column, raw)
  if (!parsed.ok) return parsed
  const chosen = rows.filter((r) => selected.has(r.id))
  if (chosen.length === 0) return { ok: false, error: 'Pick at least one row.' }
  const ids = chosen.filter((r) => isSheetCellEditable(r, column)).map((r) => r.id)
  if (ids.length === 0) return { ok: false, error: `None of the picked rows can change ${column.label}.` }
  return { ok: true, patch: parsed.patch, ids, skipped: chosen.length - ids.length }
}
