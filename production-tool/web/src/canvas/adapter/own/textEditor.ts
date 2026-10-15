// The in-place text editor (features/canvas-text.clan): a textarea over the canvas
// at the text's place, its font the text's size times the zoom, kept there as the
// view moves. It opens when the adapter's TextTool has a session (T then a click,
// or a double-click on a text) and commits once: Esc, or a click anywhere else.
// Enter is a new line. Every key typed stays in it (T types a "t", Delete deletes
// a letter), so no canvas or app shortcut fires while typing. The colour picker
// taking the window's focus is not a click elsewhere: the session stays open.

import { LINE_HEIGHT, resolveInk, TEXT_FONT } from '../../../../../canvas-engine/src'
import type { OwnAdapter } from './adapter'

/** Above the node cards and the boards' tools while typing. */
export const EDITOR_Z = 6

export interface TextEditor {
  /** Open, move or close the editor to match the adapter's session. */
  sync(): void
  /** The editor open now, or null. */
  field(): HTMLTextAreaElement | null
  destroy(): void
}

export function mountTextEditor(host: HTMLElement, adapter: OwnAdapter): TextEditor {
  let el: HTMLTextAreaElement | null = null
  let sessionId: string | null = null
  let closing = false

  const close = () => {
    const f = el
    el = null
    sessionId = null
    if (!f) return
    closing = true
    f.remove()
    closing = false
  }

  const commit = () => {
    if (!el || closing) return
    const typed = el.value
    close()
    adapter.commitText(typed)
  }

  const place = () => {
    const s = adapter.textSession()
    if (!el || !s) return
    const v = adapter.view()
    const size = s.look.size * v.zoom
    const lines = el.value.split('\n')
    const w = Math.max(...lines.map((l) => adapter.text.measure(l, s.look.size, TEXT_FONT))) * v.zoom
    Object.assign(el.style, {
      left: `${(s.x + v.scrollX) * v.zoom}px`,
      top: `${(s.y + v.scrollY) * v.zoom}px`,
      fontSize: `${size}px`,
      width: `${Math.ceil(w + size)}px`,
      height: `${Math.ceil(lines.length * size * LINE_HEIGHT)}px`,
      color: resolveInk(s.look.color, adapter.inkPalette()),
    })
  }

  const open = () => {
    const s = adapter.textSession()!
    const f = document.createElement('textarea')
    f.className = 'own-text-editor'
    f.setAttribute('aria-label', s.fresh ? 'New text' : 'Edit text')
    f.setAttribute('wrap', 'off')
    f.spellcheck = true
    f.value = s.plain
    f.style.cssText = [
      'position:absolute', `z-index:${EDITOR_Z}`, 'margin:0', 'padding:0', 'border:0', 'background:transparent', 'resize:none', 'overflow:hidden',
      'white-space:pre', `font-family:${TEXT_FONT}, sans-serif`, `line-height:${LINE_HEIGHT}`, 'caret-color:currentColor', 'box-sizing:content-box',
      // Keyboard focus is always visible: the field typed in has the tool colour round it.
      'outline:2px solid var(--tool, #2F64F5)', 'outline-offset:4px', 'border-radius:2px',
    ].join(';')
    f.addEventListener('input', place)
    f.addEventListener('keydown', (e) => {
      // Everything typed is the text's: no canvas, board or app shortcut sees it.
      e.stopPropagation()
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault()
        commit()
        host.focus({ preventScroll: true })
      }
    })
    f.addEventListener('blur', () => {
      // The window lost the focus (the system colour picker): still typing.
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return
      commit()
    })
    f.addEventListener('pointerdown', (e) => e.stopPropagation())
    host.appendChild(f)
    el = f
    sessionId = s.id
    place()
    f.focus({ preventScroll: true })
    f.setSelectionRange(f.value.length, f.value.length)
  }

  return {
    sync() {
      const s = adapter.textSession()
      if (!s) return close()
      if (el && sessionId !== s.id) close()
      if (!el) open()
      else place()
    },
    field: () => el,
    destroy() {
      // The canvas is going: what was typed is kept.
      commit()
      close()
    },
  }
}
