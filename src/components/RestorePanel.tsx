import { useState } from 'react'
import { listLocalBackups, restoreFromBackup, type BackupEntry } from '../lib/db.ts'
import { ErrorNote } from './ErrorNote.tsx'

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function backupLabel(entry: BackupEntry): string {
  const when = entry.modified_ms
    ? new Date(entry.modified_ms).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : entry.name
  return when
}

/** Pick a backup and restore it. The app restarts to finish the swap. */
export function RestorePanel({ disabled }: { disabled: boolean }) {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function open() {
    setError(null)
    try {
      setBackups(await listLocalBackups())
    } catch (err) {
      setError(err)
    }
  }

  async function restore(name: string) {
    setBusy(true)
    setError(null)
    try {
      await restoreFromBackup(name)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  if (backups == null) {
    return (
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void open()}
          data-testid="restore-open"
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink disabled:bg-slate-100 disabled:text-slate-500"
        >
          Restore from backup…
        </button>
        <ErrorNote className="mt-2 text-sm" error={error} />
      </div>
    )
  }

  return (
    <div data-testid="restore-panel">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink">Pick a backup</h4>
        <button type="button" onClick={() => { setBackups(null); setPicked(null) }} className="text-meta text-slate-600 underline underline-offset-2">
          Close
        </button>
      </div>
      {backups.length === 0 ? (
        <p className="mt-2 text-sm text-ink-body">No backups yet. Use Back up now, or leave the app open until the daily one runs.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200">
          {backups.map((b) => (
            <li key={b.name} className="px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{backupLabel(b)}</p>
                  <p className="text-meta text-slate-600">
                    {sizeLabel(b.size)}
                    {b.before_restore ? ' · saved before a restore' : ''}
                  </p>
                </div>
                {picked === b.name ? null : (
                  <button
                    type="button"
                    onClick={() => setPicked(b.name)}
                    className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink"
                  >
                    Restore
                  </button>
                )}
              </div>
              {picked === b.name ? (
                <div className="mt-2 rounded-md bg-slate-100 p-2.5 text-sm text-ink-body" data-testid="restore-confirm">
                  <p>
                    This replaces everything on this PC with this backup, then restarts the app. The database you have
                    now is saved first, so you can come back to it from this same list.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restore(b.name)}
                      className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-slate-300 disabled:text-slate-600"
                    >
                      {busy ? 'Restarting…' : 'Restore and restart'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setPicked(null)} className="px-2 text-sm text-slate-700 underline underline-offset-2">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote className="mt-2 text-sm" error={error} />
    </div>
  )
}
