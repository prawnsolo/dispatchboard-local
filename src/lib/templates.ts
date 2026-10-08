/**
 * Checklist templates. Ported from office `src/lib/templates.ts`.
 * A required item that is still unchecked is the ⚑ on cards.
 * Trip 2 parent jobs are not stored: Local jobs have no parent column.
 */

export type TemplateChecklistShape = {
  id: number
  label: string
  sequence: number
  is_required: boolean | number
}

export type CopiedChecklistItem = {
  template_checklist_item_id: number
  label: string
  is_required: boolean
  is_checked: false
}

export function jobHasChecklistFlag(
  items: Array<{ is_required: boolean | number; is_checked: boolean | number }>,
): boolean {
  return items.some((item) => Boolean(item.is_required) && !item.is_checked)
}

export function sortTemplateItems<T extends { sequence: number; label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sequence - b.sequence || a.label.localeCompare(b.label))
}

/** Copy template rows that are not already on the job (match by label, case-insensitive). */
export function itemsToCopyFromTemplate(
  templateItems: TemplateChecklistShape[],
  existing: Array<{ label: string }>,
): CopiedChecklistItem[] {
  const have = new Set(existing.map((row) => row.label.trim().toLowerCase()).filter(Boolean))
  return sortTemplateItems(templateItems)
    .filter((item) => !have.has(item.label.trim().toLowerCase()))
    .map((item) => ({
      template_checklist_item_id: item.id,
      label: item.label,
      is_required: Boolean(item.is_required),
      is_checked: false as const,
    }))
}

export function suggestTemplateId(
  activity: string | null | undefined,
  templates: Array<{ id: number; matches_activity_code: string | null }>,
): number | null {
  const code = activity?.trim()
  if (!code) return null
  const upper = code.toUpperCase()
  const exact = templates.find((template) => template.matches_activity_code?.trim().toUpperCase() === upper)
  if (exact) return exact.id
  const partial = templates.find((template) => {
    const hint = template.matches_activity_code?.trim().toUpperCase()
    return Boolean(hint && (upper.includes(hint) || hint.includes(upper)))
  })
  return partial?.id ?? null
}

export const TANK_INSTALL_ITEM = 'Excavator (Dan) scheduled'

export type TemplateDraftItem = {
  label: string
  is_required: boolean
}

export type TemplateDraft = {
  name: string
  matches_activity_code: string
  card_color: string
  items: TemplateDraftItem[]
}

const NAME_MAX = 120
const ACTIVITY_MAX = 120
const COLOR_MAX = 32
const LABEL_MAX = 200
const ITEMS_MAX = 40

export function parseTemplateDraft(
  draft: TemplateDraft,
):
  | {
      ok: true
      value: {
        name: string
        matches_activity_code: string | null
        card_color: string | null
        items: TemplateDraftItem[]
      }
    }
  | { ok: false; error: string } {
  const name = draft.name.replace(/\s+/g, ' ').trim()
  const matches = draft.matches_activity_code.replace(/\s+/g, ' ').trim()
  const color = draft.card_color.trim()
  if (!name) return { ok: false, error: 'Template name is required.' }
  if (name.length > NAME_MAX) return { ok: false, error: 'Template name is too long.' }
  if (matches.length > ACTIVITY_MAX) return { ok: false, error: 'Activity hint is too long.' }
  if (color.length > COLOR_MAX) return { ok: false, error: 'Color is too long.' }
  if (draft.items.length > ITEMS_MAX) return { ok: false, error: 'Too many checklist items.' }
  const items: TemplateDraftItem[] = []
  const seen = new Set<string>()
  for (const item of draft.items) {
    const label = item.label.replace(/\s+/g, ' ').trim()
    if (!label) return { ok: false, error: 'Each checklist item needs a label.' }
    if (label.length > LABEL_MAX) return { ok: false, error: 'A checklist label is too long.' }
    const key = label.toLowerCase()
    if (seen.has(key)) return { ok: false, error: 'Each checklist label must be unique on the template.' }
    seen.add(key)
    items.push({ label, is_required: item.is_required })
  }
  return {
    ok: true,
    value: {
      name,
      matches_activity_code: matches || null,
      card_color: color || null,
      items,
    },
  }
}
