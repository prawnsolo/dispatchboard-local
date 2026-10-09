import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { JobChecklist } from './JobChecklist.tsx'
import { JobHistory } from './JobHistory.tsx'
import { zoneCodeFromServiceZone } from '../lib/add.ts'
import { applyLocalTemplate, saveLocalJob } from '../lib/db.ts'
import { announceJobEdited } from '../lib/undo.ts'
import type { JobDraft } from '../lib/store.ts'

const controlClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500'

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-sm font-medium text-ink-label">{label}</span>
      {children}
    </label>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink-label">{label}</span>
      <p className="text-sm text-ink">{value.trim() ? value : '—'}</p>
    </div>
  )
}

function woSummary(draft: JobDraft): string {
  if (draft.is_capacity_block) {
    return 'No work order. ADD files mark these as WO 0; this database stores that as empty.'
  }
  if (draft.id == null) {
    return 'Tentative. No work order is stored, so a later ADD apply will not match this row.'
  }
  if (draft.wo_number) return `Work order ${draft.wo_number}`
  return 'No work order on this row.'
}

export function JobDrawer({
  initial,
  mismatchFlag = false,
  mismatchNote = null,
  onClose,
  onSaved,
  onChanged,
  onDirtyChange,
}: {
  initial: JobDraft
  mismatchFlag?: boolean
  mismatchNote?: string | null
  onClose: () => void
  onSaved: () => void
  onChanged: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState(initial)
  const [templateToApply, setTemplateToApply] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const capacity = initial.is_capacity_block
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial])
  const zoneCode = zoneCodeFromServiceZone(form.service_zone)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  function requestClose() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (dirty && !window.confirm('Discard unsaved changes?')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, onClose])

  function setField<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await saveLocalJob(form)
      if (initial.id != null) announceJobEdited(initial)
      if (form.id == null) setForm((current) => ({ ...current, id: saved.id }))
      onChanged()
      if (initial.id == null && templateToApply != null && !initial.is_capacity_block) {
        await applyLocalTemplate(saved.id, templateToApply)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const title = capacity ? 'Capacity block' : initial.id == null ? 'New job' : initial.customer_name || 'Job'

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onMouseDown={() => requestClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full max-w-[640px] flex-col border-l border-slate-200 bg-white shadow-sm outline-none"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-600">
              {capacity ? 'Capacity' : initial.id == null ? 'Tentative' : 'Job'}
            </p>
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-body">{woSummary(initial)}</p>
            {mismatchFlag ? (
              <p className="mt-2 text-sm font-medium text-error" title={mismatchNote ?? undefined}>
                ≠ {mismatchNote || 'Call reason / note mismatch'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded-md px-3 py-2 text-sm font-semibold text-ink-body hover:bg-surface hover:text-ink"
          >
            Close
          </button>
        </div>

        <form id="job-editor" onSubmit={(event) => void onSubmit(event)} className="flex-1 space-y-3 overflow-auto px-4 py-3" spellCheck={false}>
          {capacity ? (
            <p className="text-sm text-ink-body">
              Schedule fields only. Activity 1 is part of the capacity match key, with technician, date, and begin time.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={capacity ? 'Label' : 'Customer name'} className="sm:col-span-2">
              <input
                className={controlClass}
                value={form.customer_name}
                onChange={(event) => setField('customer_name', event.target.value)}
                required
              />
            </Field>
            <Field label="Technician">
              <input
                className={controlClass}
                value={form.technician_name}
                onChange={(event) => setField('technician_name', event.target.value)}
              />
            </Field>
            <Field label="Schedule date">
              <input
                className={controlClass}
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={form.schedule_date}
                onChange={(event) => setField('schedule_date', event.target.value)}
              />
            </Field>
            <Field label="Begin">
              <input
                className={controlClass}
                inputMode="numeric"
                placeholder="HH:MM"
                value={form.begin_time}
                onChange={(event) => setField('begin_time', event.target.value)}
              />
            </Field>
            <Field label="End">
              <input
                className={controlClass}
                inputMode="numeric"
                placeholder="HH:MM"
                value={form.end_time}
                onChange={(event) => setField('end_time', event.target.value)}
              />
            </Field>
            <Field label="Activity 1" className={capacity ? 'sm:col-span-2' : undefined}>
              <input
                className={controlClass}
                value={form.activity_1}
                onChange={(event) => setField('activity_1', event.target.value)}
              />
            </Field>
          </div>

          {capacity ? (
            <details className="rounded-md border border-line bg-surface px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-ink">Other stored fields</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Readout label="Customer #" value={form.customer_number} />
                <Readout label="Account" value={form.account_num} />
                <Readout label="Service location #" value={form.service_location_number} />
                <Readout label="City" value={form.city} />
                <Readout label="Zone" value={form.service_zone} />
                <Readout label="Address name" value={form.address_name} />
                <Readout label="Street" value={form.address_street} />
                <Readout label="Descriptor" value={form.address_descriptor} />
                <Readout label="City / state / ZIP" value={form.address_city_state_zip} />
                <Readout label="Address" value={form.address_raw} />
                <Readout label="Activity 2" value={form.activity_2} />
                <Readout label="Activity 3" value={form.activity_3} />
                <Readout label="Service instructions" value={form.service_instructions} />
                <Readout label="Location definition" value={form.location_definition} />
                <Readout label="Activity note" value={form.activity_note} />
              </div>
            </details>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Customer #">
                <input
                  className={controlClass}
                  value={form.customer_number}
                  onChange={(event) => setField('customer_number', event.target.value)}
                />
              </Field>
              <Field label="Account">
                <input
                  className={controlClass}
                  value={form.account_num}
                  onChange={(event) => setField('account_num', event.target.value)}
                />
              </Field>
              <Field label="Service location #">
                <input
                  className={controlClass}
                  inputMode="numeric"
                  value={form.service_location_number}
                  onChange={(event) => setField('service_location_number', event.target.value)}
                />
              </Field>
              <Field label="City">
                <input className={controlClass} value={form.city} onChange={(event) => setField('city', event.target.value)} />
              </Field>
              <Field label="Zone" className="sm:col-span-2">
                <input
                  className={controlClass}
                  placeholder="FP-712 - FREDERICKSBURG"
                  value={form.service_zone}
                  onChange={(event) => setField('service_zone', event.target.value)}
                />
                {zoneCode ? <span className="text-xs text-ink-label">Zone code {zoneCode}</span> : null}
              </Field>
              <Field label="Activity 2">
                <input
                  className={controlClass}
                  value={form.activity_2}
                  onChange={(event) => setField('activity_2', event.target.value)}
                />
              </Field>
              <Field label="Activity 3">
                <input
                  className={controlClass}
                  value={form.activity_3}
                  onChange={(event) => setField('activity_3', event.target.value)}
                />
              </Field>
              <Field label="Address name">
                <input
                  className={controlClass}
                  value={form.address_name}
                  onChange={(event) => setField('address_name', event.target.value)}
                />
              </Field>
              <Field label="Street">
                <input
                  className={controlClass}
                  value={form.address_street}
                  onChange={(event) => setField('address_street', event.target.value)}
                />
              </Field>
              <Field label="Descriptor">
                <input
                  className={controlClass}
                  value={form.address_descriptor}
                  onChange={(event) => setField('address_descriptor', event.target.value)}
                />
              </Field>
              <Field label="City / state / ZIP">
                <input
                  className={controlClass}
                  value={form.address_city_state_zip}
                  onChange={(event) => setField('address_city_state_zip', event.target.value)}
                />
              </Field>
              <Field label="Address (raw)" className="sm:col-span-2">
                <textarea
                  className={controlClass}
                  rows={2}
                  value={form.address_raw}
                  onChange={(event) => setField('address_raw', event.target.value)}
                />
              </Field>
              <Field label="Service instructions" className="sm:col-span-2">
                <textarea
                  className={controlClass}
                  rows={3}
                  value={form.service_instructions}
                  onChange={(event) => setField('service_instructions', event.target.value)}
                />
              </Field>
              <Field label="Location definition" className="sm:col-span-2">
                <textarea
                  className={controlClass}
                  rows={2}
                  value={form.location_definition}
                  onChange={(event) => setField('location_definition', event.target.value)}
                />
              </Field>
              <Field label="Activity note" className="sm:col-span-2">
                <textarea
                  className={controlClass}
                  rows={3}
                  value={form.activity_note}
                  onChange={(event) => setField('activity_note', event.target.value)}
                />
              </Field>
            </div>
          )}

          {capacity ? null : (
            <JobChecklist
              jobId={form.id}
              activity={form.activity_1}
              onTemplateId={setTemplateToApply}
              onChanged={onChanged}
            />
          )}

          {form.id != null ? <JobHistory jobId={form.id} /> : null}
        </form>

        <div className="border-t border-line px-5 py-3">
          {error ? <p className="mb-2 text-sm text-error">{editorError(error)}</p> : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-body hover:border-ink hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="job-editor"
              disabled={saving}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:bg-brand-tint"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function editorError(message: string): string {
  if (message.includes('invoke')) {
    return `${message}. Open the desktop window with npm run desktop so SQLite is available.`
  }
  return message
}
