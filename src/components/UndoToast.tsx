import type { ScheduleUndoEntry } from '../lib/undo.ts'

export function UndoToast({
  entry,
  pendingCount,
  onUndo,
}: {
  entry: ScheduleUndoEntry | null
  pendingCount: number
  onUndo: () => void
}) {
  if (!entry) return null

  return (
    <div
      role="status"
      data-testid="undo-toast"
      className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink shadow-card"
    >
      <p className="min-w-0 flex-1">
        {entry.label}
        {pendingCount > 1 ? <span className="ml-1 text-xs text-ink-label">· {pendingCount} undos</span> : null}
      </p>
      <button
        type="button"
        data-testid="undo-button"
        onClick={onUndo}
        className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:border-ink"
      >
        Undo
      </button>
    </div>
  )
}
