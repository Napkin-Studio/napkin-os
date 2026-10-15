// The pen's options (features/theme-and-pencil.clan; plan decision 2): pen or
// highlighter, six named inks (the theme's ink first, then Napkin orange, blue,
// green, amber and grey) and any colour from the picker (a swatch double-clicked,
// or +; owner 2026-10-15, replacing "no free picker"), the last three picked kept
// as swatches, and three widths for each. A picked colour is a literal hex: the
// engine paints it as it is in both themes (ink/palette resolveInk). Colours are ink names (canvas-engine ink/palette),
// painted per theme from the --pen-* tokens. Each person's last choice is kept
// in this browser; storage that throws or holds junk gives the defaults.
// Engine-neutral: the names are canvas-engine's (adapter/own's test holds them
// equal), and each adapter applies a choice through CanvasChrome.setPen.

import { useEffect, useSyncExternalStore } from 'react'
import type { CanvasChrome } from './controls'

/** The ink names, in the popover's order; a stroke stores the name, not a colour. */
export const PEN_COLOURS = ['ink', 'orange', 'blue', 'green', 'amber', 'grey'] as const
export type InkColour = (typeof PEN_COLOURS)[number]
/** A named ink, or a colour from the picker (#rrggbb). */
export type PenColour = InkColour | string
export const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
const isPenColour = (c: unknown): c is PenColour => isHex(c) || (PEN_COLOURS as readonly unknown[]).includes(c)
/** How many picked colours stay as swatches. */
export const RECENT_MAX = 3

export type PenMode = 'pen' | 'highlighter'
export interface PenLook {
  color: PenColour
  width: number
}
export interface PenChoice {
  mode: PenMode
  pen: PenLook
  highlighter: PenLook
  /** The colours picked lately (#rrggbb), newest first. */
  recent: string[]
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
  recent: [],
}

export const PEN_KEY = 'napkin.production.pen'

function look(v: unknown, mode: PenMode): PenLook {
  const d = DEFAULT_PEN[mode]
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PenLook>
  return {
    color: isPenColour(o.color) ? o.color : d.color,
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
      recent: Array.isArray(raw.recent) ? raw.recent.filter(isHex).slice(0, RECENT_MAX) : [],
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

/** Change part of the choice: the mode, or the look of the mode in use. `remember`: a colour the
 *  picker settled on joins the recent swatches (the picker's live moves do not). */
export function setPen(change: { mode?: PenMode; color?: PenColour; width?: number; remember?: boolean }) {
  const p = getPen()
  const mode = change.mode ?? p.mode
  const color = change.color && isPenColour(change.color) ? change.color.toLowerCase() as PenColour : undefined
  const recent = change.remember && color && isHex(color) ? [color, ...p.recent.filter((c) => c !== color)].slice(0, RECENT_MAX) : p.recent
  const next: PenChoice = { ...p, mode, recent, [mode]: { ...p[mode], ...(color ? { color } : {}), ...(change.width ? { width: change.width } : {}) } }
  current = next
  savePen(next)
  for (const fn of listeners) fn(next)
}

/** A colour the picker closed on, picked for something else (a text): it joins the recent swatches, the pen's ink unchanged. */
export function rememberColour(hex: string) {
  if (!isHex(hex)) return
  const p = getPen()
  const c = hex.toLowerCase()
  const next: PenChoice = { ...p, recent: [c, ...p.recent.filter((x) => x !== c)].slice(0, RECENT_MAX) }
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

/** A swatch's colour as #rrggbb, to start the picker from: a named ink through this theme's token. */
export function hexOf(c: PenColour, read: (name: string) => string = cssVar): string {
  if (isHex(c)) return c.toLowerCase()
  const v = read(`--pen-${c}`).trim()
  if (isHex(v)) return v.toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v)
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  return '#000000'
}

function cssVar(name: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name)
  } catch {
    return ''
  }
}
