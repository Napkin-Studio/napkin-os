// The text tool (features/canvas-text.clan): DOM-free. The host opens an editor
// (web adapter/own: a textarea over the canvas) for an edit session that begin()
// or edit() starts, and commit() ends it with one write: a new text record, the
// edited one, or its removal when it was emptied. So a session is one undo step,
// and two people editing one text is last write wins (live co-editing is next).
//
// A text is napkin/1's 'text' kind: props.plain (and props.doc, the Tiptap
// checkpoint the importer writes), style.fontSize, style.stroke (an ink name,
// painted per theme, or a picked #rrggbb). Its box is its lines measured by the
// host (canvas measureText) at LINE_HEIGHT; the renderer and the editor use the
// same line height, so what is typed sits where it will be drawn.

import { tiptapDoc } from '../import/excalidraw'
import { element, type ElementRecord } from '../model/records'
import type { SceneStore } from '../model/store'
import { zTop } from '../model/z'

/** Lines are this many font sizes apart (renderer, editor and box). */
export const LINE_HEIGHT = 1.25
/** The family texts are written in. */
export const TEXT_FONT = 'Geist'
/** Small, Medium and Large, in scene pixels. */
export const TEXT_SIZES = { small: 16, medium: 24, large: 36 } as const
export type TextSize = keyof typeof TEXT_SIZES

/** How wide a line is at a font size (the host measures; this guess serves a bare host and tests). */
export type Measure = (line: string, size: number, family: string) => number
export const approxMeasure: Measure = (line, size) => line.length * size * 0.55

export interface TextLook {
  /** Font size, scene pixels. */
  size: number
  /** An ink name or #rrggbb. */
  color: string
}

/** The box a text takes: its widest line, and its lines at LINE_HEIGHT. Never narrower than a caret's room. */
export function textBox(plain: string, size: number, measure: Measure = approxMeasure, family = TEXT_FONT): { w: number; h: number } {
  const lines = plain.split('\n')
  const w = Math.max(size * 0.5, ...lines.map((l) => measure(l, size, family)))
  return { w: Math.ceil(w), h: lines.length * size * LINE_HEIGHT }
}

/** What a text says (its plain lines). */
export const plainOf = (r: ElementRecord): string => (typeof r.props.plain === 'string' ? r.props.plain : '')

/** Typed text as it is kept: trailing blank space dropped. Empty means no text. */
export const trimTyped = (typed: string) => typed.replace(/\s+$/, '')

export interface TextSession {
  /** The record being edited, or the id the new one will take. */
  id: string
  /** A new text (no record yet). */
  fresh: boolean
  x: number
  y: number
  look: TextLook
  /** What it said when the session began. */
  plain: string
}

export class TextTool {
  private readonly scene: SceneStore
  private readonly newId: (prefix: string) => string
  /** The host's measure (canvas measureText); approxMeasure until it says. */
  measure: Measure = approxMeasure
  /** The look the next text takes (the Text tool's options). */
  look: TextLook = { size: TEXT_SIZES.medium, color: 'ink' }
  session: TextSession | null = null

  constructor(scene: SceneStore, opts: { newId?: (prefix: string) => string; measure?: Measure } = {}) {
    this.scene = scene
    this.newId = opts.newId ?? ((p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
    if (opts.measure) this.measure = opts.measure
  }

  /** A new text at a click: its first line centred on the point. */
  begin(p: { x: number; y: number }): TextSession {
    const look = { ...this.look }
    this.session = { id: this.newId('text'), fresh: true, x: p.x, y: p.y - (look.size * LINE_HEIGHT) / 2, look, plain: '' }
    return this.session
  }

  /** Edit a text in place. Null when it is not a text, or locked. */
  edit(id: string): TextSession | null {
    const r = this.scene.get(id)
    if (!r || r.kind !== 'text' || r.locked) return null
    this.session = { id, fresh: false, x: r.x, y: r.y, look: { size: r.style.fontSize ?? 20, color: r.style.stroke ?? 'ink' }, plain: plainOf(r) }
    return this.session
  }

  /** Change the open session's size or colour (the options, while typing). */
  restyleSession(change: Partial<TextLook>) {
    if (this.session) this.session = { ...this.session, look: { ...this.session.look, ...change } }
  }

  /**
   * End the session with what was typed, as one step: a new text, the edited one, or (emptied) its
   * removal. A new empty box writes nothing. Returns the text as written, or null.
   */
  commit(typed: string): ElementRecord | null {
    const s = this.session
    this.session = null
    if (!s) return null
    const plain = trimTyped(typed)
    const cur = s.fresh ? undefined : this.scene.get(s.id)
    if (!plain) {
      if (cur && !cur.locked) this.scene.change((tx) => tx.remove([s.id]))
      return null
    }
    const { w, h } = textBox(plain, s.look.size, this.measure, cur?.style.fontFamily ?? TEXT_FONT)
    if (s.fresh || !cur) {
      const rec = element({
        id: s.id, kind: 'text', z: zTop(this.scene.all().map((r) => r.z)), x: s.x, y: s.y, w, h,
        style: { stroke: s.look.color, fontFamily: TEXT_FONT, fontSize: s.look.size }, props: { plain, doc: tiptapDoc(plain) },
      })
      this.scene.change((tx) => tx.put([rec]))
      return rec
    }
    if (cur.locked) return cur
    if (plain === plainOf(cur) && s.look.size === cur.style.fontSize && s.look.color === (cur.style.stroke ?? 'ink')) return cur
    const next: ElementRecord = {
      ...cur, w, h, style: { ...cur.style, stroke: s.look.color, fontSize: s.look.size }, props: { ...cur.props, plain, doc: tiptapDoc(plain) },
    }
    this.scene.change((tx) => tx.put([next]))
    return next
  }

  /** Close the session without writing (the canvas went away). */
  cancel() {
    this.session = null
  }

  /** Restyle texts (size or colour from the options, a text selected), as one step. Returns how many changed. */
  restyle(ids: Iterable<string>, change: Partial<TextLook>): number {
    const out: ElementRecord[] = []
    for (const id of ids) {
      const r = this.scene.get(id)
      if (!r || r.kind !== 'text' || r.locked) continue
      const size = change.size ?? r.style.fontSize ?? 20
      const color = change.color ?? r.style.stroke ?? 'ink'
      if (size === r.style.fontSize && color === r.style.stroke) continue
      const { w, h } = textBox(plainOf(r), size, this.measure, r.style.fontFamily ?? TEXT_FONT)
      out.push({ ...r, w, h, style: { ...r.style, fontSize: size, stroke: color } })
    }
    if (out.length) this.scene.change((tx) => tx.put(out))
    return out.length
  }
}
