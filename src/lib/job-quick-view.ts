/**
 * Map hover quick-info for Local. Matches web `db-job-quick-view` structure
 * (Customer / Address / Primary / Secondary / Call notes) using Local JobRow
 * fields (activity_1/2/3) instead of web job_activities.
 */
import { formatCustomerAccount } from './format.ts'

export const JOB_QUICK_VIEW_DELAY_MS = 250

/** Tooltip preview length — full `activity_note` remains in the job drawer. */
export const JOB_QUICK_VIEW_CALL_NOTES_MAX_CHARS = 320
export const JOB_QUICK_VIEW_CALL_NOTES_MAX_LINES = 6

export type JobQuickViewFields = {
  customer_name: string
  customer_number?: string | null
  address_street?: string | null
  address_descriptor?: string | null
  address_city_state_zip?: string | null
  address_raw?: string | null
  city?: string | null
  activity_1?: string | null
  activity_2?: string | null
  activity_3?: string | null
  activity_note?: string | null
}

export type JobQuickViewModel = {
  customerName: string
  customerAccount: string | null
  address: string
  primary: string | null
  secondary: string[]
  callNotes: string | null
}

function formatJobAddress(job: JobQuickViewFields): string {
  const street = [job.address_street, job.address_descriptor]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(', ')
  const cityStZip = job.address_city_state_zip?.trim() ?? ''
  if (street && cityStZip) return `${street}\n${cityStZip}`
  if (street) return street
  const raw = job.address_raw?.trim()
  if (raw) return raw
  if (cityStZip) return cityStZip
  return job.city?.trim() ?? ''
}

function formatCallNotesForQuickView(note: string | null | undefined): string | null {
  const trimmed = note?.trim()
  if (!trimmed) return null

  const lines = trimmed.split(/\r?\n/)
  const overLines = lines.length > JOB_QUICK_VIEW_CALL_NOTES_MAX_LINES
  let text = overLines
    ? lines.slice(0, JOB_QUICK_VIEW_CALL_NOTES_MAX_LINES).join('\n')
    : trimmed
  const overChars = text.length > JOB_QUICK_VIEW_CALL_NOTES_MAX_CHARS
  if (!overLines && !overChars) return trimmed

  if (overChars) {
    text = text.slice(0, JOB_QUICK_VIEW_CALL_NOTES_MAX_CHARS)
    const withoutPartialWord = text.replace(/\s+\S*$/, '').trimEnd()
    if (withoutPartialWord.length >= JOB_QUICK_VIEW_CALL_NOTES_MAX_CHARS * 0.6) {
      text = withoutPartialWord
    } else {
      text = text.trimEnd()
    }
  }

  return `${text}…`
}

export function jobQuickViewModel(job: JobQuickViewFields): JobQuickViewModel {
  const primary = job.activity_1?.trim() || null
  const secondary = [job.activity_2, job.activity_3]
    .map((a) => a?.trim())
    .filter((a): a is string => Boolean(a))
  return {
    customerName: job.customer_name?.trim() || '—',
    customerAccount: formatCustomerAccount(job.customer_number),
    address: formatJobAddress(job) || '—',
    primary,
    secondary,
    callNotes: formatCallNotesForQuickView(job.activity_note),
  }
}

export function jobQuickViewElement(job: JobQuickViewFields): HTMLDivElement {
  const model = jobQuickViewModel(job)
  const root = document.createElement('div')
  root.className = 'db-job-quick-view'
  root.setAttribute('data-testid', 'job-quick-view')

  appendGroup(
    root,
    'Customer',
    model.customerAccount ? `${model.customerName} ${model.customerAccount}` : model.customerName,
    true,
  )
  appendGroup(root, 'Address', model.address)
  appendGroup(root, 'Primary', model.primary ?? '—')
  appendGroup(root, 'Secondary', model.secondary.length ? model.secondary.join('\n') : '—')
  if (model.callNotes) appendGroup(root, 'Call notes', model.callNotes)
  return root
}

function appendGroup(root: HTMLDivElement, label: string, value: string, first = false): void {
  const lab = document.createElement('p')
  lab.className = first
    ? 'db-job-quick-view__label db-job-quick-view__label--first'
    : 'db-job-quick-view__label'
  lab.textContent = label
  const body = document.createElement('p')
  body.className = first
    ? 'db-job-quick-view__value db-job-quick-view__value--title'
    : 'db-job-quick-view__value'
  body.textContent = value
  root.append(lab, body)
}
