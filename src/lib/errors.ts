/**
 * Turns raw error text into a sentence a dispatcher can act on, and keeps the
 * original for a Details toggle. Never invents a cause: when nothing matches,
 * the original message is the summary.
 */

export type PlainError = {
  /** One plain sentence. */
  summary: string
  /** The original text, shown behind Details. Empty when the summary already is the original. */
  detail: string
}

const RULES: Array<[RegExp, string]> = [
  [/invoke|__TAURI|cannot open sqlite/i, 'This window cannot reach the local database. Open the DispatchBoard desktop app.'],
  [/database is locked|SQLITE_BUSY/i, 'The database is busy. Wait a few seconds and try again.'],
  [/no such table|no such column|schema/i, 'The local database is out of date for this version. Restart the app; if it persists, restore a backup.'],
  [/disk (is )?full|no space left|SQLITE_FULL/i, 'The disk is full, so nothing could be saved. Free up space and try again.'],
  [/REQUEST_DENIED|API key|OVER_QUERY_LIMIT|OVER_DAILY_LIMIT/i, 'Google refused the request. Check the key and its limits in Google Cloud.'],
  [/failed to fetch|networkerror|network error|ERR_|timed? ?out|ECONN|ENOTFOUND|could not reach/i, 'Could not reach the lookup service. Check the internet connection and try again.'],
  [/permission|denied|not allowed/i, 'Windows would not allow that. Check that the file or folder is not open elsewhere.'],
]

export function explainError(input: unknown): PlainError {
  const raw = (input instanceof Error ? input.message : String(input ?? '')).trim()
  if (!raw) return { summary: 'Something went wrong.', detail: '' }
  for (const [re, plain] of RULES) {
    if (re.test(raw)) return { summary: plain, detail: raw }
  }
  // Long or code-laden text: keep the first sentence up front, the rest behind Details.
  const first = raw.split(/(?<=[.!?])\s+/)[0] ?? raw
  if (raw.length > 160 && first.length < raw.length) return { summary: first, detail: raw }
  return { summary: raw, detail: '' }
}
