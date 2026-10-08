/**
 * Keyboard shortcuts. Pure so it can be tested: given a key event's facts and
 * whether a text field has focus, say which action (if any) it triggers.
 */

export type ShortcutAction =
  | { type: 'palette' }
  | { type: 'help' }
  | { type: 'today' }
  | { type: 'day'; delta: -1 | 1 }
  | { type: 'focus-search' }
  | { type: 'tab'; index: number }

export type KeyFacts = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** True when focus is in an input, textarea, select or editable element. */
  inField: boolean
}

export const SHORTCUT_HELP: ReadonlyArray<readonly [string, string]> = [
  ['Ctrl K', 'Command palette: jump to a screen or search jobs'],
  ['Alt 1 to 7', 'Today, Map, Calendar, Jobs, Sheet, Backlog, Import'],
  ['T', 'Go to today'],
  ['[  and  ]', 'Previous and next day'],
  ['/', 'Search the header'],
  ['?', 'This list'],
  ['Ctrl Z', 'Undo the last move'],
  ['Esc', 'Close a panel'],
]

export function shortcutFor(e: KeyFacts): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.altKey && e.key.toLowerCase() === 'k') return { type: 'palette' }
  if (e.altKey && !mod && /^[1-7]$/.test(e.key)) return { type: 'tab', index: Number(e.key) - 1 }
  // Plain keys never fire while someone is typing.
  if (e.inField || mod || e.altKey) return null
  switch (e.key) {
    case '?':
      return { type: 'help' }
    case 't':
    case 'T':
      return { type: 'today' }
    case '[':
      return { type: 'day', delta: -1 }
    case ']':
      return { type: 'day', delta: 1 }
    case '/':
      return { type: 'focus-search' }
    default:
      return null
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}
