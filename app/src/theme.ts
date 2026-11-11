// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// White, Grey and Black: the shell's three modes (features/agency-look.clan).
//
// A mode is a set of the same tokens, not a second design. White and Black are
// the shell's light and dark; Grey is the warm paper pulled down to a mid
// grey, with ink that still reads on it. `data-mode` on <html> names the mode;
// `data-theme` stays `light` or `dark` (Grey is light), because everything
// written before the modes keys off that pair, and so does the colour scheme
// native widgets and app frames follow.
//
// The palette is CSS custom properties on `:root`, so switching is one
// attribute flip and nothing re-renders to change colour. Until someone picks
// a mode we follow the OS and keep following it; the moment they do pick, that
// choice is theirs and the OS stops overriding it.

import { useEffect, useState } from 'react'

export type Mode = 'white' | 'grey' | 'black'
/** The colour scheme a mode sits in: what native widgets and app frames follow. */
export type Theme = 'light' | 'dark'

export const MODES: readonly Mode[] = ['white', 'grey', 'black']

const STORAGE_KEY = 'napkin.theme'
const QUERY = '(prefers-color-scheme: light)'

const listeners = new Set<(theme: Theme) => void>()
const modeListeners = new Set<(mode: Mode) => void>()

export const schemeOf = (mode: Mode): Theme => (mode === 'black' ? 'dark' : 'light')

function systemMode(): Mode {
  return window.matchMedia?.(QUERY).matches ? 'white' : 'black'
}

/** What storage holds as a mode: the three names, or the two the shell stored before there were three. */
function parseMode(v: string | null): Mode | null {
  if (v === 'white' || v === 'grey' || v === 'black') return v
  if (v === 'light') return 'white'
  if (v === 'dark') return 'black'
  return null
}

/** The user's own choice, if they have made one. */
function storedMode(): Mode | null {
  try {
    return parseMode(localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private windows and locked-down browsers throw on access, not on read.
    return null
  }
}

let current: Mode = storedMode() ?? systemMode()

function apply(mode: Mode) {
  const root = document.documentElement
  const theme = schemeOf(mode)
  root.dataset.theme = theme
  root.dataset.mode = mode
  // Native widgets — scrollbars, form controls, the canvas behind the page —
  // follow this rather than our variables.
  root.style.colorScheme = theme
}

function set(mode: Mode, remember: boolean) {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch { /* the preference just won't survive the tab */ }
  }
  if (mode === current) return
  const before = schemeOf(current)
  current = mode
  apply(mode)
  for (const fn of modeListeners) fn(mode)
  if (schemeOf(mode) !== before) for (const fn of listeners) fn(schemeOf(mode))
}

apply(current)

// Keep following the OS, but only for as long as there is nothing to override.
window.matchMedia?.(QUERY).addEventListener?.('change', e => {
  if (storedMode()) return
  set(e.matches ? 'white' : 'black', false)
})

export function getMode(): Mode {
  return current
}

export function setMode(mode: Mode) {
  set(mode, true)
}

/** White, then Grey, then Black, then round again. */
export function nextMode(mode: Mode = current): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]
}

export function cycleMode() {
  setMode(nextMode())
}

export function onModeChange(fn: (mode: Mode) => void): () => void {
  modeListeners.add(fn)
  return () => modeListeners.delete(fn)
}

export function useMode(): Mode {
  const [mode, setLocal] = useState(getMode)
  useEffect(() => onModeChange(setLocal), [])
  return mode
}

/** The colour scheme of the current mode. */
export function getTheme(): Theme {
  return schemeOf(current)
}

export function setTheme(theme: Theme) {
  set(theme === 'dark' ? 'black' : 'white', true)
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark')
}

/** Told when the colour scheme changes (not for White to Grey, which share one). */
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
