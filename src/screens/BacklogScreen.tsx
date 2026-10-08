import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  BACKLOG_PRIORITIES,
  BACKLOG_STATUSES,
  BACKLOG_STATUS_LABELS,
  BACKLOG_TYPE_LABELS,
  BACKLOG_TYPES,
  blankBacklogDraft,
  canPromoteBacklog,
  draftFromBacklog,
  type BacklogDraft,
  type BacklogItem,
  type BacklogStatus,
  type BacklogType,
} from '../lib/backlog.ts'
import { deleteLocalBacklog, promoteLocalBacklog, queryBacklog, saveLocalBacklog } from '../lib/db.ts'
import { ENABLE_JOB_CREATE } from '../lib/features.ts'

const controlClass =
  'w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-label focus:border-brand'

function labelFor(item: BacklogItem): string {
  return item.customer_name?.trim() || item.customer_number || BACKLOG_TYPE_LABELS[item.backlog_type]
}

export function BacklogScreen({
  revision,
  date,
  query,
  onChanged,
}: {
  revision: number
  date: string
  query: string
  onChanged: () => void
}) {
  const [items, setItems] = useState<BacklogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<BacklogType | ''>('')
  const [statusFilter, setStatusFilter] = useState<BacklogStatus | ''>('open')
  const [draft, setDraft] = useState<BacklogDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [promoteDate, setPromoteDate] = useState(date)
  const [promoteTech, setPromoteTech] = useState('')

  useEffect(() => {
    setPromoteDate(date)
  }, [date])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void queryBacklog(query)
      .then((rows) => {
        if (cancelled) return
        setItems(rows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, revision])

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (typeFilter && item.backlog_type !== typeFilter) return false
        if (statusFilter && item.status !== statusFilter) return false
        return true
      }),
    [items, statusFilter, typeFilter],
  )
  const editing = draft?.id != null ? items.find((item) => item.id === draft.id) ?? null : null

  async function onSave(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      const saved = await saveLocalBacklog(draft)
      setDraft(draftFromBacklog(saved))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!draft?.id) return
    if (!window.confirm('Delete this backlog item? A job it already promoted is left in place.')) return
    setSaving(true)
    setError(null)
    try {
      await deleteLocalBacklog(draft.id)
      setDraft(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onPromote() {
    if (!ENABLE_JOB_CREATE || !draft?.id || !editing || !canPromoteBacklog(editing)) return
    setSaving(true)
    setError(null)
    try {
      const result = await promoteLocalBacklog(draft.id, {
        schedule_date: promoteDate.trim() || null,
        technician_name: promoteTech.trim() || null,
      })
      setDraft(draftFromBacklog(result.item))
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h2 className="text-lg font-semibold">Backlog</h2>
            <p className="mt-1 text-sm text-ink-body">
              {loading ? 'Loading…' : `${visible.length} shown`}
              {query.trim() ? ' · header search' : ''}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Type
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as BacklogType | '')}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm normal-case tracking-normal text-ink"
            >
              <option value="">All types</option>
              {BACKLOG_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BACKLOG_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as BacklogStatus | '')}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm normal-case tracking-normal text-ink"
            >
              <option value="">All statuses</option>
              {BACKLOG_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {BACKLOG_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setDraft(blankBacklogDraft())}
            className="ml-auto rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            New item
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-label">
          Tank pickup, lockout, monitor swap, and meter site stay here until you promote one into a tentative job.
          ADD import does not write this list.
        </p>
        {error && !draft ? (
          <p className="mt-2 text-sm text-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Zone</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  tabIndex={0}
                  onClick={() => {
                    setDraft(draftFromBacklog(item))
                    setPromoteTech('')
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    setDraft(draftFromBacklog(item))
                  }}
                  className={`cursor-pointer border-t border-line hover:bg-brand-wash ${
                    draft?.id === item.id ? 'bg-brand-wash' : 'bg-white'
                  }`}
                >
                  <td className="px-3 py-2">{BACKLOG_TYPE_LABELS[item.backlog_type]}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">{labelFor(item)}</div>
                    <div className="text-xs text-ink-label">
                      {[item.customer_number ? `#${item.customer_number}` : null, item.address_street || item.address_raw]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2">{BACKLOG_STATUS_LABELS[item.status]}</td>
                  <td className="px-3 py-2 capitalize">{item.priority}</td>
                  <td className="px-3 py-2">{item.zone_code ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && visible.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-body">No backlog items on this filter.</p>
          ) : null}
        </div>
      </div>

      {draft ? (
        <form
          onSubmit={(event) => void onSave(event)}
          className="flex w-full shrink-0 flex-col gap-3 border-t border-line bg-white px-4 py-4 lg:w-[380px] lg:border-t-0 lg:border-l"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold">{draft.id == null ? 'New backlog item' : 'Edit backlog item'}</h3>
            <button type="button" onClick={() => setDraft(null)} className="text-sm font-semibold text-ink-body hover:text-ink">
              Close
            </button>
          </div>
          {error ? (
            <p className="text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Type
            <select
              value={draft.backlog_type}
              onChange={(event) => setDraft({ ...draft, backlog_type: event.target.value as BacklogType })}
              className={controlClass}
            >
              {BACKLOG_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BACKLOG_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Customer
            <input
              value={draft.customer_name}
              onChange={(event) => setDraft({ ...draft, customer_name: event.target.value })}
              className={controlClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Cust #
              <input
                value={draft.customer_number}
                onChange={(event) => setDraft({ ...draft, customer_number: event.target.value })}
                className={controlClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Zone
              <input
                value={draft.zone_code}
                onChange={(event) => setDraft({ ...draft, zone_code: event.target.value })}
                className={controlClass}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Street
            <input
              value={draft.address_street}
              onChange={(event) => setDraft({ ...draft, address_street: event.target.value })}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            City ST ZIP
            <input
              value={draft.address_city_state_zip}
              onChange={(event) => setDraft({ ...draft, address_city_state_zip: event.target.value })}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Address line
            <input
              value={draft.address_raw}
              onChange={(event) => setDraft({ ...draft, address_raw: event.target.value })}
              className={controlClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Lat
              <input
                value={draft.lat}
                onChange={(event) => setDraft({ ...draft, lat: event.target.value })}
                className={controlClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Lng
              <input
                value={draft.lng}
                onChange={(event) => setDraft({ ...draft, lng: event.target.value })}
                className={controlClass}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Priority
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as BacklogDraft['priority'] })}
                className={controlClass}
              >
                {BACKLOG_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
              Status
              <select
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as BacklogStatus })}
                className={controlClass}
              >
                {BACKLOG_STATUSES.filter((status) => status !== 'promoted' || draft.status === 'promoted').map((status) => (
                  <option key={status} value={status}>
                    {BACKLOG_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Campaign
            <input
              value={draft.campaign}
              onChange={(event) => setDraft({ ...draft, campaign: event.target.value })}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
            Notes
            <textarea
              value={draft.notes}
              rows={3}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className={controlClass}
            />
          </label>
          {ENABLE_JOB_CREATE && editing && canPromoteBacklog(editing) ? (
            <div className="rounded-md border border-line bg-surface p-3">
              <p className="text-sm font-semibold text-ink">Promote</p>
              <p className="mt-1 text-xs text-ink-body">
                Creates a tentative job with no work order and stores that job on this item.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
                  Date
                  <input
                    type="date"
                    value={promoteDate}
                    onChange={(event) => setPromoteDate(event.target.value)}
                    className={controlClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-[0.05em] text-ink-label">
                  Tech
                  <input
                    value={promoteTech}
                    onChange={(event) => setPromoteTech(event.target.value)}
                    className={controlClass}
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void onPromote()}
                className="mt-2 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                Promote to job
              </button>
            </div>
          ) : null}
          {editing?.promoted_job_id != null ? (
            <p className="text-sm text-ink-body">Linked to job {editing.promoted_job_id}.</p>
          ) : null}
          <div className="mt-auto flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {draft.id != null ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onDelete()}
                className="rounded-md px-3 py-2 text-sm font-semibold text-error hover:bg-brand-wash disabled:opacity-50"
              >
                Delete
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  )
}
