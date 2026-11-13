// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The shell's two themes, light and dark (features/align-landing-look.clan). Grey, the third mode the agency-look
// record added, is gone: a stored `grey` (or `white`) reads as light and a stored `black` as dark, so nobody who chose
// before is sent anywhere unexpected. `data-theme` on <html> names the theme; the colour scheme native widgets and app
// frames follow is the same value (a tool frame is told with clan:colorscheme, and its agency colours with clan:me).
//
// The palette is CSS custom properties on `:root`, so switching is one attribute flip and nothing re-renders to change
// colour. Until someone picks a theme we follow the OS and keep following it; the moment they do pick, that choice is
// theirs and the OS stops overriding it.

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'napkin.theme'
const QUERY = '(prefers-color-scheme: light)'

const listeners = new Set<(theme: Theme) => void>()

function systemTheme(): Theme {
  return window.matchMedia?.(QUERY).matches ? 'light' : 'dark'
}

/** What storage holds as a theme: the two names, or the three the shell stored while it had Grey. */
export function parseTheme(v: string | null): Theme | null {
  if (v === 'light' || v === 'white' || v === 'grey') return 'light'
  if (v === 'dark' || v === 'black') return 'dark'
  return null
}

/** The user's own choice, if they have made one. */
function storedTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private windows and locked-down browsers throw on access, not on read.
    return null
  }
}

let current: Theme = storedTheme() ?? systemTheme()

function apply(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  // Native widgets — scrollbars, form controls, the canvas behind the page — follow this rather than our variables.
  root.style.colorScheme = theme
}

function set(theme: Theme, remember: boolean) {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch { /* the preference just won't survive the tab */ }
  }
  if (theme === current) return
  current = theme
  apply(theme)
  for (const fn of listeners) fn(theme)
}

apply(current)

// Keep following the OS, but only for as long as there is nothing to override.
window.matchMedia?.(QUERY).addEventListener?.('change', e => {
  if (storedTheme()) return
  set(e.matches ? 'light' : 'dark', false)
})

/** The colour scheme in force. */
export function getTheme(): Theme {
  return current
}

export function setTheme(theme: Theme) {
  set(theme, true)
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

/** Told when the theme changes. */
export function onThemeChange(fn: (theme: Theme) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useTheme(): Theme {
  const [theme, setLocal] = useState(getTheme)
  useEffect(() => onThemeChange(setLocal), [])
  return theme
}

// The design tokens, by name. The values live in index.css (one place, both
// themes); this is only so TS code can refer to them without stringly typos.
export type Token =
  | 'paper' | 'card' | 'soft' | 'soft-2' | 'frost' | 'line' | 'line-soft'
  | 'ink' | 'ink2' | 'ink3' | 'ink-fixed'
  | 'plan' | 'create' | 'produce' | 'learn' | 'desk'
  | 'plan-fg' | 'create-fg' | 'produce-fg' | 'learn-fg' | 'desk-fg'
  | 'plan-eye' | 'create-eye' | 'produce-eye' | 'learn-eye' | 'desk-eye'
  | 'status-green' | 'status-amber' | 'status-red'
  | 'shadow-soft' | 'shadow-pill'
  | 'f-display' | 'f-mono' | 'r-pill' | 'r-card' | 'r-panel' | 'blur' | 'ease' | 'dur' | 'dur-slow'

/** `var(--name)` for inline styles and SVG fills. */
export function tokenVar(name: Token): string {
  return `var(--${name})`
}

/** The studio's one easing curve, for code that animates outside CSS. */
export const EASE = 'cubic-bezier(.2,.8,.2,1)'
