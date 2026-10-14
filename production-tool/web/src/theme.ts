// Light or dark, the way the Napkin OS shell does it (app/src/theme.ts): `data-theme` on <html>,
// from the person's stored choice under the shell's key (napkin.theme; /production is served on the
// shell's origin, so it is the same choice), and the OS only while there is none. The palette is in
// styles.css; switching is one attribute flip. The tool follows a change made in the shell's tab too.
// The account menu's Light / Dark / System (setThemeChoice) writes the key the way the shell's
// ThemeToggle does, and System clears it, which the shell also reads as "follow the OS".

export type Theme = 'light' | 'dark'
/** What the person picked: a side, or the OS's. */
export type ThemeChoice = Theme | 'system'

export const STORAGE_KEY = 'napkin.theme'
const QUERY = '(prefers-color-scheme: light)'
const listeners = new Set<(t: Theme) => void>()

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches ? 'light' : 'dark'
}

/** The person's own choice, if they made one (in the shell or here). */
export function storedTheme(read: () => string | null = () => localStorage.getItem(STORAGE_KEY)): Theme | null {
  try {
    const v = read()
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    // Private windows and locked-down browsers throw on access.
    return null
  }
}

let current: Theme = typeof window === 'undefined' ? 'light' : storedTheme() ?? systemTheme()

function apply(t: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t
}

function set(t: Theme) {
  if (t === current) return
  current = t
  apply(t)
  for (const fn of listeners) fn(t)
}

if (typeof window !== 'undefined') {
  apply(current)
  window.matchMedia?.(QUERY).addEventListener?.('change', (e) => {
    if (!storedTheme()) set(e.matches ? 'light' : 'dark')
  })
  // The shell's theme switch, in another tab of the same origin.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    set(storedTheme() ?? systemTheme())
    for (const fn of choiceListeners) fn(themeChoice())
  })
}

/** Light or Dark (remembered under the shell's key) or System (forgotten: follow the OS). Applies at once. */
export function setThemeChoice(choice: ThemeChoice, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    if (choice === 'system') storage?.removeItem(STORAGE_KEY)
    else storage?.setItem(STORAGE_KEY, choice)
  } catch {
    /* the choice just won't survive the tab */
  }
  set(choice === 'system' ? systemTheme() : choice)
  for (const fn of choiceListeners) fn(choice)
}

const choiceListeners = new Set<(c: ThemeChoice) => void>()

/** The stored choice, System when there is none. */
export function themeChoice(read?: () => string | null): ThemeChoice {
  return storedTheme(read) ?? 'system'
}

/** Called when the choice changes here (the theme itself may not: System on a dark OS after Dark). */
export function onThemeChoice(fn: (c: ThemeChoice) => void): () => void {
  choiceListeners.add(fn)
  return () => void choiceListeners.delete(fn)
}

export function getTheme(): Theme {
  return current
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
