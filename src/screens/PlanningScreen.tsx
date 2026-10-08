import { useEffect, useState, type FormEvent } from 'react'
import {
  deleteLocalMismatchRule,
  deleteLocalTemplate,
  queryMismatchRules,
  queryTemplates,
  saveLocalMismatchRule,
  saveLocalTemplate,
} from '../lib/db.ts'
import type { MismatchRuleDraft } from '../lib/mismatch.ts'
import type { TemplateDraft, TemplateDraftItem } from '../lib/templates.ts'
import type { MismatchRuleRow, TemplateRow } from '../lib/store.ts'
import { ErrorNote } from '../components/ErrorNote.tsx'

const controlClass =
  'mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink outline-none focus:border-brand'

const EMPTY_RULE: MismatchRuleDraft = {
  call_reason_pattern: '',
  conflicting_keyword: '',
  active: true,
  notes: '',
}

function draftFromRule(rule: MismatchRuleRow): MismatchRuleDraft {
  return {
    call_reason_pattern: rule.call_reason_pattern,
    conflicting_keyword: rule.conflicting_keyword,
    active: Boolean(rule.active),
    notes: rule.notes ?? '',
  }
}

function draftFromTemplate(template: TemplateRow): TemplateDraft {
  return {
    name: template.name,
    matches_activity_code: template.matches_activity_code ?? '',
    card_color: template.card_color ?? '',
    items: template.items.map((item) => ({ label: item.label, is_required: Boolean(item.is_required) })),
  }
}

const EMPTY_TEMPLATE: TemplateDraft = {
  name: '',
  matches_activity_code: '',
  card_color: '',
  items: [{ label: '', is_required: true }],
}

export function PlanningScreen({ revision }: { revision: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div>
          <h2 className="text-lg font-semibold">Planning</h2>
          <p className="mt-1 text-sm text-ink-body">
            Mismatch rules and checklist templates stay in SQLite on this PC. A mismatch is an advisory ≠ on the job.
            It does not stop import. A required checklist item that is still unchecked shows ⚑.
          </p>
        </div>
        <MismatchSection revision={revision} />
        <TemplateSection revision={revision} />
      </div>
    </div>
  )
}

function MismatchSection({ revision }: { revision: number }) {
  const [rules, setRules] = useState<MismatchRuleRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addDraft, setAddDraft] = useState<MismatchRuleDraft>(EMPTY_RULE)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<MismatchRuleDraft>(EMPTY_RULE)
  const [busy, setBusy] = useState(false)

  async function reload() {
    setRules(await queryMismatchRules())
  }

  useEffect(() => {
    let cancelled = false
    void queryMismatchRules()
      .then((rows) => {
        if (!cancelled) {
          setRules(rows)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveLocalMismatchRule({ id: null, draft: addDraft })
      setAddDraft(EMPTY_RULE)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveEdit(event: FormEvent) {
    event.preventDefault()
    if (editingId == null) return
    setBusy(true)
    setError(null)
    try {
      await saveLocalMismatchRule({ id: editingId, draft: editDraft })
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm('Delete this mismatch rule? Jobs already flagged stay flagged until the next apply.')) return
    setBusy(true)
    setError(null)
    try {
      await deleteLocalMismatchRule(id)
      if (editingId === id) setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-line p-4 shadow-card" data-testid="mismatch-rules">
      <h3 className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">Mismatch rules</h3>
      <p className="mt-2 text-sm text-ink-body">
        On Apply, a job is flagged when a call reason contains the pattern and the activity note contains the keyword.
        Capacity blocks are not flagged. The seeded example is GAS CHECK ↔ CLEANING.
      </p>
      {error ? <ErrorNote className="mt-2 text-sm" error={error} /> : null}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {rules.map((rule) => (
          <li key={rule.id} className="py-3">
            {editingId === rule.id ? (
              <form onSubmit={(event) => void onSaveEdit(event)} className="space-y-2">
                <RuleFields draft={editDraft} onChange={setEditDraft} idPrefix={`edit-${rule.id}`} />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    Save rule
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    <span aria-hidden="true">≠ </span>
                    {rule.call_reason_pattern} ↔ {rule.conflicting_keyword}
                    {rule.active ? '' : ' · inactive'}
                  </p>
                  {rule.notes ? <p className="mt-1 text-sm text-ink-body">{rule.notes}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(rule.id)
                      setEditDraft(draftFromRule(rule))
                    }}
                    className="rounded-md px-2 py-1 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onDelete(rule.id)}
                    className="rounded-md px-2 py-1 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {rules.length === 0 ? <li className="py-3 text-sm text-ink-body">No rules yet.</li> : null}
      </ul>
      <form onSubmit={(event) => void onAdd(event)} className="mt-4 space-y-2">
        <p className="text-sm font-semibold text-ink">Add a rule</p>
        <RuleFields draft={addDraft} onChange={setAddDraft} idPrefix="add-rule" />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          Add rule
        </button>
      </form>
    </section>
  )
}

function RuleFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: MismatchRuleDraft
  onChange: (next: MismatchRuleDraft) => void
  idPrefix: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label" htmlFor={`${idPrefix}-pattern`}>
        Call reason pattern
        <input
          id={`${idPrefix}-pattern`}
          className={controlClass}
          value={draft.call_reason_pattern}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, call_reason_pattern: event.target.value })}
        />
      </label>
      <label className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label" htmlFor={`${idPrefix}-keyword`}>
        Conflicting keyword
        <input
          id={`${idPrefix}-keyword`}
          className={controlClass}
          value={draft.conflicting_keyword}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, conflicting_keyword: event.target.value })}
        />
      </label>
      <label className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label sm:col-span-2" htmlFor={`${idPrefix}-notes`}>
        Notes
        <textarea
          id={`${idPrefix}-notes`}
          className={controlClass}
          rows={2}
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => onChange({ ...draft, active: event.target.checked })}
        />
        Active
      </label>
    </div>
  )
}

function TemplateSection({ revision }: { revision: number }) {
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null | 'new'>(null)
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_TEMPLATE)
  const [busy, setBusy] = useState(false)

  async function reload() {
    setTemplates(await queryTemplates())
  }

  useEffect(() => {
    let cancelled = false
    void queryTemplates()
      .then((rows) => {
        if (!cancelled) {
          setTemplates(rows)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  function startNew() {
    setEditingId('new')
    setDraft(EMPTY_TEMPLATE)
    setError(null)
  }

  function startEdit(template: TemplateRow) {
    setEditingId(template.id)
    setDraft(draftFromTemplate(template))
    setError(null)
  }

  function setItem(index: number, patch: Partial<TemplateDraftItem>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await saveLocalTemplate({ id: editingId === 'new' || editingId == null ? null : editingId, draft })
      setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm('Delete this template? Checklist items already copied onto jobs stay on those jobs.')) return
    setBusy(true)
    setError(null)
    try {
      await deleteLocalTemplate(id)
      if (editingId === id) setEditingId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-line p-4 shadow-card" data-testid="templates">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">Templates</h3>
          <p className="mt-2 text-sm text-ink-body">
            Apply a template from New job or the job drawer. The seeded Tank Install templates include required
            Excavator (Dan) scheduled. Trip 2 does not store a parent job.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          New template
        </button>
      </div>
      {error ? <ErrorNote className="mt-2 text-sm" error={error} /> : null}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {templates.map((template) => (
          <li key={template.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">{template.name}</p>
              <p className="mt-1 text-xs text-ink-label">
                {template.matches_activity_code ? `Matches ${template.matches_activity_code}` : 'No activity hint'}
                {template.items.length ? ` · ${template.items.map((item) => item.label).join(', ')}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => startEdit(template)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDelete(template.id)}
                className="rounded-md px-2 py-1 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {templates.length === 0 ? <li className="py-3 text-sm text-ink-body">No templates yet.</li> : null}
      </ul>
      {editingId != null ? (
        <form onSubmit={(event) => void onSave(event)} className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-ink">{editingId === 'new' ? 'New template' : 'Edit template'}</p>
          <label className="block text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Name
            <input
              className={controlClass}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Activity hint
            <input
              className={controlClass}
              value={draft.matches_activity_code}
              placeholder="TANK INSTALL (UG)"
              onChange={(event) => setDraft({ ...draft, matches_activity_code: event.target.value })}
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Card color
            <input
              className={controlClass}
              value={draft.card_color}
              placeholder="#B45309"
              onChange={(event) => setDraft({ ...draft, card_color: event.target.value })}
            />
          </label>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.05em] text-ink-label">Checklist</p>
            {draft.items.map((item, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <input
                  className="min-w-[200px] flex-1 rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                  value={item.label}
                  placeholder="Excavator (Dan) scheduled"
                  onChange={(event) => setItem(index, { label: event.target.value })}
                />
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={item.is_required}
                    onChange={(event) => setItem(index, { is_required: event.target.checked })}
                  />
                  Required
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }))
                  }
                  className="text-sm font-semibold text-ink-body hover:text-ink"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { label: '', is_required: true }] }))}
              className="text-sm font-semibold text-slate-900 underline underline-offset-2"
            >
              Add item
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Save template
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
