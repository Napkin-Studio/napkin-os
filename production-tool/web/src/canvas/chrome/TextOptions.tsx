// The Text tool's options over the tool bar (features/canvas-text.clan), in the pen's options' look:
// Small, Medium, Large, and the pen's swatches and colour picker. Shown while the Text tool is in hand
// or a text is selected; a change restyles the text being typed or the selected texts, and is the
// next text's look. A press on the panel never takes the focus, so the text being typed stays open.

import { InkSwatches } from './PenOptions'
import { sizeOf, TEXT_SIZE_NAMES, TEXT_SIZES, type TextSize } from './textStyle'
import type { PenColour } from './penStyle'
import './pen.css'

export function TextOptions({ look, recent, onSize, onColor, vertical = false }: {
  /** The look shown: the selected text's (its font size in scene pixels), else the tool's. */
  look: { size: number; color: PenColour }
  recent: readonly string[]
  onSize: (s: TextSize) => void
  onColor: (c: PenColour, remember?: boolean, live?: boolean) => void
  vertical?: boolean
}) {
  const size = sizeOf(look.size)
  return (
    <div className={`pen-options text-options pt-panel ${vertical ? 'vertical' : ''}`} role="group" aria-label="Text options"
      onMouseDown={(e) => e.preventDefault()}>
      <div className="pt-seg pen-mode" role="radiogroup" aria-label="Size">
        {TEXT_SIZES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={size === s} aria-pressed={size === s} onClick={() => onSize(s)}>
            {TEXT_SIZE_NAMES[s]}
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="pen-sep" />
      <InkSwatches color={look.color} recent={recent} onColor={onColor} label="Colour" />
    </div>
  )
}
