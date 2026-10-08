import { useState } from 'react'
import { explainError } from '../lib/errors.ts'

/** A plain-language error with the technical text one click away. */
export function ErrorNote({ error, className = '' }: { error: unknown; className?: string }) {
  const [open, setOpen] = useState(false)
  if (error == null || error === '') return null
  const { summary, detail } = explainError(error)
  return (
    <div className={`text-error ${className}`} role="alert">
      <p>{summary}</p>
      {detail ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-meta font-medium text-slate-600 underline underline-offset-2"
          >
            {open ? 'Hide details' : 'Details'}
          </button>
          {open ? <p className="mt-1 break-words font-mono text-meta text-slate-600">{detail}</p> : null}
        </>
      ) : null}
    </div>
  )
}
