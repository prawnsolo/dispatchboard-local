import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'dispatchboard.local.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readThemePref(): ThemePref {
  try {
    if (typeof localStorage === 'undefined') return 'auto'
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'auto' || value === 'light' || value === 'dark') return value
  } catch {
    // Storage can be blocked. Follow the system for this session.
  }
  return 'auto'
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === 'auto') return systemDark ? 'dark' : 'light'
  return pref
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'dark' ? '#0e0e10' : '#ffffff')
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DARK_QUERY).matches
}

applyResolvedTheme(resolveTheme(readThemePref(), systemPrefersDark()))

type ThemeContextValue = {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (next: ThemePref) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(pref, systemDark)

  useEffect(() => {
    applyResolvedTheme(resolved)
  }, [resolved])

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Still applies for this session.
    }
  }, [])

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
