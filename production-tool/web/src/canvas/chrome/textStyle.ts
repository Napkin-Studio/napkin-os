// The Text tool's options (features/canvas-text.clan): Small, Medium or Large,
// and a colour from the pen's swatches (a named ink, painted per theme, or a
// picked #rrggbb; the recent picked colours are the pen's, shared). The next
// text takes this look; a selected text is restyled through CanvasChrome.styleText.
// Kept in this browser like the pen's; storage that throws or holds junk gives
// the defaults. Engine-neutral: sizes are scene pixels (canvas-engine
// TEXT_SIZES; adapter/own's test holds them equal).

import { useEffect, useSyncExternalStore } from 'react'
import type { CanvasChrome } from './controls'
import { isHex, PEN_COLOURS, type PenColour } from './penStyle'

export const TEXT_SIZES = ['small', 'medium', 'large'] as const
export type TextSize = (typeof TEXT_SIZES)[number]
/** Scene pixels for each size. */
export const TEXT_SIZE_PX: Record<TextSize, number> = { small: 16, medium: 24, large: 36 }
export const TEXT_SIZE_NAMES: Record<TextSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

export interface TextChoice {
  size: TextSize
  color: PenColour
}

export const DEFAULT_TEXT: TextChoice = { size: 'medium', color: 'ink' }
export const TEXT_KEY = 'napkin.production.text'

const isColour = (c: unknown): c is PenColour => isHex(c) || (PEN_COLOURS as readonly unknown[]).includes(c)

/** The size a font size is, or null for one that is none of the three (an imported or scaled text). */
export const sizeOf = (px: number): TextSize | null => TEXT_SIZES.find((s) => TEXT_SIZE_PX[s] === px) ?? null

export function loadText(read: () => string | null = () => localStorage.getItem(TEXT_KEY)): TextChoice {
  try {
    const raw = JSON.parse(read() ?? 'null') as Partial<TextChoice> | null
    if (!raw || typeof raw !== 'object') return DEFAULT_TEXT
    return {
      size: (TEXT_SIZES as readonly unknown[]).includes(raw.size) ? (raw.size as TextSize) : DEFAULT_TEXT.size,
      color: isColour(raw.color) ? raw.color : DEFAULT_TEXT.color,
    }
  } catch {
    return DEFAULT_TEXT
  }
}

export function saveText(t: TextChoice, write: (v: string) => void = (v) => localStorage.setItem(TEXT_KEY, v)) {
  try {
    write(JSON.stringify(t))
  } catch {
    /* the choice just won't survive the tab */
  }
}

let current: TextChoice | null = null
const listeners = new Set<(t: TextChoice) => void>()

export function getText(): TextChoice {
  return (current ??= typeof window === 'undefined' ? DEFAULT_TEXT : loadText())
}

export function setText(change: { size?: TextSize; color?: PenColour }) {
  const t = getText()
  const color = change.color && isColour(change.color) ? (change.color.toLowerCase() as PenColour) : t.color
  const next: TextChoice = { size: change.size ?? t.size, color }
  current = next
  saveText(next)
  for (const fn of listeners) fn(next)
}

export function onTextChange(fn: (t: TextChoice) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** For tests: forget the cached choice. */
export function resetTextForTests() {
  current = null
}

/** Keep the engine's next text in the person's choice: on mount and on every change. */
export function useTextChoice(chrome: CanvasChrome | null): TextChoice {
  const t = useSyncExternalStore(onTextChange, getText, getText)
  useEffect(() => {
    chrome?.setText?.({ size: TEXT_SIZE_PX[t.size], color: t.color })
  }, [chrome, t])
  return t
}
