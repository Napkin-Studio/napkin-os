// A popover anchored to the caret (features/script-editor.clan): placed by @floating-ui/dom
// against a virtual element (the caret's rect), it never takes focus, so typing goes on in
// the editor, and it leaves Escape to its owner (the @ suggestion closes on it). ui/Float.tsx
// stays for button-anchored menus.

import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from '@floating-ui/dom'

export class CaretFloat {
  readonly el: HTMLDivElement
  private rect: () => DOMRect | null
  private stop: (() => void) | null = null

  constructor(opts: { className?: string; label: string; rect: () => DOMRect | null }) {
    this.rect = opts.rect
    this.el = document.createElement('div')
    this.el.className = `caretfloat ${opts.className ?? ''}`.trim()
    this.el.setAttribute('role', 'listbox')
    this.el.setAttribute('aria-label', opts.label)
    // Clicks inside must not move the focus out of the editor.
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    document.body.appendChild(this.el)
    const anchor: VirtualElement = { getBoundingClientRect: () => this.rect() ?? new DOMRect(0, 0, 0, 0) }
    const place = () => {
      void computePosition(anchor, this.el, { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(6), flip(), shift({ padding: 8 })] })
        .then(({ x, y }) => Object.assign(this.el.style, { position: 'fixed', left: `${x}px`, top: `${y}px` }))
    }
    this.stop = autoUpdate(anchor, this.el, place)
  }

  /** The caret moved (the query grew). */
  anchor(rect: () => DOMRect | null) {
    this.rect = rect
  }

  destroy() {
    this.stop?.()
    this.el.remove()
  }
}
