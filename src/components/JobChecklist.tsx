import { useEffect, useState } from 'react'
import { applyLocalTemplate, queryJobChecklist, queryTemplates, setLocalChecklistChecked } from '../lib/db.ts'
import { suggestTemplateId } from '../lib/templates.ts'
import type { ChecklistItemRow, TemplateRow } from '../lib/store.ts'
import { ErrorNote } from './ErrorNote.tsx'

const controlClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-500'

export function JobChecklist({
  jobId,
  activity,
  onTemplateId,
  onChanged,
}: {
  /** Null while the job has not been saved yet. */
  jobId: number | null
  activity: string
  onTemplateId?: (id: number | null) => void
  onChanged: () => void
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [items, setItems] = useState<ChecklistItemRow[]>([])
  const [picked, setPicked] = useState<number | 'none' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void queryTemplates()
      .then((rows) => {
        if (!cancelled) setTemplates(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (jobId == null) {
      setItems([])
      return
    }
    let cancelled = false
    void queryJobChecklist(jobId)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [jobId])

  const suggested = suggestTemplateId(activity, templates)
  const selected = picked === null ? (suggested ?? null) : picked === 'none' ? null : picked

  useEffect(() => {
    onTemplateId?.(selected)
  }, [onTemplateId, selected])

  async function onApply() {
    if (jobId == null || selected == null) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await applyLocalTemplate(jobId, selected)
      setItems(await queryJobChecklist(jobId))
      setNote(result.added === 0 ? 'Checklist already has these items.' : `Added ${result.added} checklist item${result.added === 1 ? '' : 's'}.`)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onToggle(item: ChecklistItemRow) {
    setError(null)
    const next = !item.is_checked
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, is_checked: next ? 1 : 0 } : row)))
    try {
      await setLocalChecklistChecked(item.id, next)
      onChanged()
    } catch (err) {
      setItems((current) => current.map((row) => (row.id === item.id ? item : row)))
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="space-y-2" data-testid="job-checklist">
      <h3 className="text-base font-semibold text-ink">Checklist</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1 text-sm font-medium text-ink-label">
          Template
          <select
            className={`${controlClass} mt-1 normal-case tracking-normal`}
            value={selected ?? ''}
            onChange={(event) => setPicked(event.target.value ? Number(event.target.value) : 'none')}
          >
            <option value="">No template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.id === suggested ? ' · suggested' : ''}
              </option>
            ))}
          </select>
        </label>
        {jobId != null ? (
          <button
            type="button"
            disabled={busy || selected == null}
            onClick={() => void onApply()}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-ink disabled:opacity-50"
          >
            {busy ? 'Applying…' : 'Apply template'}
          </button>
        ) : (
          <p className="pb-2 text-xs text-ink-body">Saved with this new job.</p>
        )}
      </div>
      {jobId == null ? (
        <p className="text-xs text-ink-label">
          {selected == null
            ? 'Pick a template to copy its checklist when you save.'
            : 'Required items stay unchecked until you check them. A required unchecked item shows ⚑.'}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-body">No checklist items. Apply a template to copy them.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(item.is_checked)}
                  onChange={() => void onToggle(item)}
                />
                <span>
                  {item.label}
                  {item.is_required && !item.is_checked ? (
                    <span className="ml-2 text-warning" title="Required and unchecked">
                      ⚑
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {note ? <p className="text-sm text-ink-body">{note}</p> : null}
      {error ? <ErrorNote className="text-sm" error={error} /> : null}
    </section>
  )
}
