import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { daySheetPages } from '../lib/day-sheet.ts'
import { formatDate, formatTimeRange } from '../lib/format.ts'
import { locationAppliances } from '../lib/job-icons.ts'
import type { JobRow } from '../lib/store.ts'

/**
 * Paper copy of one day: a page per technician, jobs in time order, with the
 * address, what is at the house and the notes a tech needs in the truck. Renders
 * into #print-root, which is visible only when printing. Calls window.print()
 * once it is on the page; Windows' print dialog offers Save as PDF.
 */
export function PrintDaySheet({
  jobs,
  date,
  tech,
  onDone,
}: {
  jobs: readonly JobRow[]
  date: string
  tech: string | null
  onDone: () => void
}) {
  const pages = daySheetPages(jobs, date, tech)

  useEffect(() => {
    const done = () => onDone()
    window.addEventListener('afterprint', done)
    // Let the portal paint before the dialog opens.
    const t = window.setTimeout(() => window.print(), 50)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', done)
    }
  }, [onDone])

  let root = document.getElementById('print-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'print-root'
    document.body.appendChild(root)
  }

  return createPortal(
    <>
      {pages.map((page) => (
        <section key={page.tech} className="print-page" style={{ fontFamily: 'Inter Variable, system-ui, sans-serif', fontSize: '11pt', padding: '0.4in' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2px solid #111', paddingBottom: 6 }}>
            <h1 style={{ fontSize: '18pt', fontWeight: 700, margin: 0 }}>{page.tech}</h1>
            <p style={{ margin: 0 }}>
              {formatDate(date)} · {page.jobs.length} {page.jobs.length === 1 ? 'job' : 'jobs'}
            </p>
          </header>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <tbody>
              {page.jobs.map((job) => {
                const at = locationAppliances(job.location_definition)
                const extra = [job.service_instructions, job.activity_note].filter((x) => x && x.trim())
                return (
                  <tr key={job.id} style={{ borderBottom: '1px solid #bbb', verticalAlign: 'top' }}>
                    <td style={{ padding: '8px 8px 8px 0', width: '1.3in', fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{formatTimeRange(job.begin_time, job.end_time)}</strong>
                      <div style={{ fontSize: '9pt' }}>{job.wo_number ? `WO ${job.wo_number}` : 'Tentative'}</div>
                    </td>
                    <td style={{ padding: '8px 0' }}>
                      <strong>{job.customer_name}</strong>
                      <div>{[job.activity_1, job.activity_2, job.activity_3].filter(Boolean).join(' / ')}</div>
                      <div>{[job.address_street, job.address_city_state_zip].filter(Boolean).join(', ')}</div>
                      {at.length ? <div style={{ fontSize: '9pt' }}>At the house: {at.join(', ')}</div> : null}
                      {extra.map((x, i) => (
                        <div key={i} style={{ fontSize: '9pt', whiteSpace: 'pre-wrap' }}>
                          {x}
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: '8px 0 8px 8px', width: '0.9in', textAlign: 'right' }}>
                      <span style={{ display: 'inline-block', width: 16, height: 16, border: '1.5px solid #111' }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ))}
    </>,
    root,
  )
}
