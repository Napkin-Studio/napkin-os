// The words written on the canvas. Text never goes into an exported picture
// (Runway fails on lettering in an input image: INTERNAL.BAD_OUTPUT.01), so the
// words travel as `input.text` instead. Pure helpers, no Excalidraw runtime.

import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

type El = ExcalidrawElement
type TextEl = El & { type: 'text'; text: string; originalText?: string; containerId?: string | null }

/** The contract's limit on input.text (relay-api.schema.json JobInput.text). */
export const MAX_TEXT = 1000

const inside = (e: El, f: El) => e.x >= f.x && e.y >= f.y && e.x + e.width <= f.x + f.width && e.y + e.height <= f.y + f.height

/**
 * The text a frame holds, top to bottom: text elements in the frame, text bound
 * to the frame or to a shape in it, and loose text that sits wholly inside it.
 * Each element is one line (its own wrapping folded); empty ones are dropped.
 */
export function frameText(els: readonly El[], frame: El): string {
  const live = els.filter((e) => !e.isDeleted)
  const kidIds = new Set(live.filter((e) => e.frameId === frame.id).map((e) => e.id))
  const texts = live.filter((e): e is TextEl => {
    if (e.type !== 'text') return false
    const t = e as TextEl
    if (e.frameId === frame.id) return true
    if (t.containerId && (t.containerId === frame.id || kidIds.has(t.containerId))) return true
    return !e.frameId && !t.containerId && inside(e, frame)
  })
  texts.sort((a, b) => a.y - b.y || a.x - b.x)
  return texts
    .map((t) => (t.originalText ?? t.text).replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT)
}

/**
 * A Combine instruction plus the words written in any drawing among its items.
 * The user's instruction comes first and is never cut; the notes fill what is left.
 */
export function withNotes(instruction: string, notes: { tag: string; text: string }[], max = MAX_TEXT): string {
  const base = instruction.trim().slice(0, max)
  let out = base
  for (const n of notes) {
    if (!n.text.trim()) continue
    const add = `${out ? '\n' : ''}Written in @${n.tag}: ${n.text.trim().replace(/\n/g, ' / ')}`
    const room = max - out.length
    if (room <= 0) break
    out += add.slice(0, room)
  }
  return out
}
