import { useEffect, useState } from 'react'
import { queryJobHistory } from '../lib/db.ts'
import { formatLocalTimestamp } from '../lib/format.ts'
import type { HistoryEntry } from '../lib/history.ts'

const SOURCE_LABEL: Record<string, string> = { edit: 'Edited', move: 'Moved', sheet: 'Sheet edit' }

function show(v: string): string {
  if (!v) return 'empty'
  return v.length > 60 ? `${v.slice(0, 57)}…` : v
}

/** Collapsed list of what changed on this job and when. Local only. */
export function JobHistory({ jobId }: { jobId: number }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void queryJobHistory(jobId)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [jobId, open])

  return (
    <details
      className="rounded-md border border-line bg-surface px-3 py-2"
      data-testid="job-history"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-medium text-ink">History</summary>
      {entries == null ? (
        <p className="mt-2 text-sm text-ink-body">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-body">No edits yet. Changes made here, in the Sheet, or by dragging show up in this list.</p>
      ) : (
        <ul className="mt-2 max-h-60 space-y-3 overflow-auto text-sm">
          {entries.map((e) => (
            <li key={e.id}>
              <p className="font-medium text-ink">
                {SOURCE_LABEL[e.source] ?? e.source}
                <span className="ml-2 font-normal text-ink-body">{formatLocalTimestamp(`${e.at.replace(' ', 'T')}Z`)}</span>
              </p>
              <ul className="ml-4 list-disc text-ink-body">
                {e.changes.map((c) => (
                  <li key={c.label}>
                    {c.label}: {show(c.from)} → {show(c.to)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
