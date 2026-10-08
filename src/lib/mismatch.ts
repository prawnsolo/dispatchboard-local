/**
 * Advisory mismatch rules. Ported from office `src/lib/import/parse.ts`
 * `evaluateMismatch` and `src/lib/mismatch-rules.ts` validation.
 * A hit sets a flag on the job. Apply still writes the row.
 */

export type MismatchRule = {
  call_reason_pattern: string
  conflicting_keyword: string
  active: boolean
}

export type MismatchRuleDraft = {
  call_reason_pattern: string
  conflicting_keyword: string
  active: boolean
  notes: string
}

export type MismatchRuleInput = {
  call_reason_pattern: string
  conflicting_keyword: string
  active: boolean
  notes: string | null
}

const PATTERN_MAX = 200
const KEYWORD_MAX = 200
const NOTES_MAX = 500

export function normalizeMismatchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Case-insensitive match key used at import time. */
export function normalizeMismatchKey(value: string): string {
  return normalizeMismatchText(value).toUpperCase()
}

export function parseMismatchRuleDraft(
  draft: MismatchRuleDraft,
): { ok: true; value: MismatchRuleInput } | { ok: false; error: string } {
  const call_reason_pattern = normalizeMismatchText(draft.call_reason_pattern)
  const conflicting_keyword = normalizeMismatchText(draft.conflicting_keyword)
  const notes = normalizeMismatchText(draft.notes)
  if (!call_reason_pattern) return { ok: false, error: 'Call reason pattern is required.' }
  if (!conflicting_keyword) return { ok: false, error: 'Conflicting keyword is required.' }
  if (call_reason_pattern.length > PATTERN_MAX) return { ok: false, error: 'Call reason pattern is too long.' }
  if (conflicting_keyword.length > KEYWORD_MAX) return { ok: false, error: 'Conflicting keyword is too long.' }
  if (notes.length > NOTES_MAX) return { ok: false, error: 'Notes are too long.' }
  return {
    ok: true,
    value: {
      call_reason_pattern,
      conflicting_keyword,
      active: draft.active,
      notes: notes || null,
    },
  }
}

function ruleKey(pattern: string, keyword: string): string {
  return `${normalizeMismatchKey(pattern)}\0${normalizeMismatchKey(keyword)}`
}

export function findDuplicateMismatchRule(
  rows: Array<{ id: number; call_reason_pattern: string; conflicting_keyword: string }>,
  input: Pick<MismatchRuleInput, 'call_reason_pattern' | 'conflicting_keyword'>,
  exceptId?: number,
): boolean {
  const key = ruleKey(input.call_reason_pattern, input.conflicting_keyword)
  return rows.some((row) => row.id !== exceptId && ruleKey(row.call_reason_pattern, row.conflicting_keyword) === key)
}

export function sortMismatchRules<T extends { active: boolean | number; call_reason_pattern: string; conflicting_keyword: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const aActive = Boolean(a.active)
    const bActive = Boolean(b.active)
    if (aActive !== bActive) return aActive ? -1 : 1
    const pattern = a.call_reason_pattern.localeCompare(b.call_reason_pattern)
    if (pattern !== 0) return pattern
    return a.conflicting_keyword.localeCompare(b.conflicting_keyword)
  })
}

/**
 * Flag when an activity contains the call-reason pattern and the activity
 * note contains the keyword. Capacity rows are not passed in by Apply.
 */
export function evaluateMismatch(
  activities: Array<string | null | undefined>,
  activityNote: string | null | undefined,
  rules: MismatchRule[],
): { mismatch_flag: boolean; mismatch_note: string | null } {
  const noteNorm = normalizeMismatchKey(activityNote ?? '')
  const hits: string[] = []
  for (const rule of rules) {
    if (!rule.active) continue
    const pattern = normalizeMismatchKey(rule.call_reason_pattern)
    const keyword = normalizeMismatchKey(rule.conflicting_keyword)
    if (!pattern || !keyword) continue
    const activityHit = activities.some((activity) => normalizeMismatchKey(activity ?? '').includes(pattern))
    if (activityHit && noteNorm.includes(keyword)) {
      hits.push(`${rule.call_reason_pattern} ↔ ${rule.conflicting_keyword}`)
    }
  }
  if (!hits.length) return { mismatch_flag: false, mismatch_note: null }
  return { mismatch_flag: true, mismatch_note: hits.join('; ') }
}
