// The pen's options (features/theme-and-pencil.clan; plan decision 2): pen or
// highlighter, six named inks (the theme's ink first, then Napkin orange, blue,
// green, amber and grey; no free picker, so sketches stay readable for Dex),
// and three widths for each. Colours are ink names (canvas-engine ink/palette),
// painted per theme from the --pen-* tokens. Each person's last choice is kept
// in this browser; storage that throws or holds junk gives the defaults.
// Engine-neutral: the names are canvas-engine's (adapter/own's test holds them
// equal), and each adapter applies a choice through CanvasChrome.setPen.

import { useEffect, useSyncExternalStore } from 'react'
import type { CanvasChrome } from './controls'

/** The ink names, in the popover's order; a stroke stores the name, not a colour. */
export const PEN_COLOURS = ['ink', 'orange', 'blue', 'green', 'amber', 'grey'] as const
export type InkColour = (typeof PEN_COLOURS)[number]

export type PenMode = 'pen' | 'highlighter'
export interface PenLook {
  color: InkColour
  width: number
}
export interface PenChoice {
  mode: PenMode
  pen: PenLook
  highlighter: PenLook
}

export const COLOUR_NAMES: Record<InkColour, string> = {
  ink: 'Ink', orange: 'Napkin orange', blue: 'Blue', green: 'Green', amber: 'Amber', grey: 'Grey',
}
/** Thin, medium, thick, in scene pixels. */
export const PEN_WIDTHS: Record<PenMode, readonly [number, number, number]> = {
  pen: [2, 4, 8],
  highlighter: [12, 18, 28],
}
export const WIDTH_NAMES = ['Thin', 'Medium', 'Thick'] as const

export const DEFAULT_PEN: PenChoice = {
  mode: 'pen',
  pen: { color: 'ink', width: 4 },
  highlighter: { color: 'amber', width: 18 },
}

export const PEN_KEY = 'napkin.production.pen'

function look(v: unknown, mode: PenMode): PenLook {
  const d = DEFAULT_PEN[mode]
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PenLook>
  return {
    color: (PEN_COLOURS as readonly unknown[]).includes(o.color) ? (o.color as InkColour) : d.color,
    width: (PEN_WIDTHS[mode] as readonly unknown[]).includes(o.width) ? (o.width as number) : d.width,
  }
}

/** The stored choice, each part checked, the defaults for anything missing or wrong. */
export function loadPen(read: () => string | null = () => localStorage.getItem(PEN_KEY)): PenChoice {
  try {
    const raw = JSON.parse(read() ?? 'null') as Partial<PenChoice> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_PEN
    return {
      mode: raw.mode === 'highlighter' ? 'highlighter' : 'pen',
      pen: look(raw.pen, 'pen'),
      highlighter: look(raw.highlighter, 'highlighter'),
    }
  } catch {
    // Private windows throw on access; junk does not parse.
    return DEFAULT_PEN
  }
}

export function savePen(p: PenChoice, write: (v: string) => void = (v) => localStorage.setItem(PEN_KEY, v)) {
  try {
    write(JSON.stringify(p))
  } catch {
    /* the choice just won't survive the tab */
  }
}

let current: PenChoice | null = null
const listeners = new Set<(p: PenChoice) => void>()

export function getPen(): PenChoice {
  return (current ??= typeof window === 'undefined' ? DEFAULT_PEN : loadPen())
}

/** Change part of the choice: the mode, or the look of the mode in use. */
export function setPen(change: { mode?: PenMode; color?: InkColour; width?: number }) {
  const p = getPen()
  const mode = change.mode ?? p.mode
  const next: PenChoice = { ...p, mode, [mode]: { ...p[mode], ...(change.color ? { color: change.color } : {}), ...(change.width ? { width: change.width } : {}) } }
  current = next
  savePen(next)
  for (const fn of listeners) fn(next)
}

export function onPenChange(fn: (p: PenChoice) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** For tests: forget the cached choice. */
export function resetPenForTests() {
  current = null
}

/** Keep the engine drawing with the person's pen choice: on mount and on every change. */
export function usePenChoice(chrome: CanvasChrome | null): PenChoice {
  const pen = useSyncExternalStore(onPenChange, getPen, getPen)
  useEffect(() => {
    chrome?.setPen(pen)
  }, [chrome, pen])
  return pen
}
