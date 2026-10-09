/**
 * CSV export helpers. Values that begin with a formula character get a leading
 * apostrophe so Excel shows them as text instead of running them.
 */

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (/^[=@\t\r]/.test(s) || /^[+-][^\d\s.]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

/** Save text as a file through the browser download path. Stays on this PC. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
