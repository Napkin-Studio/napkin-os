// The pen's options over the tool bar while the pen is in use (features/theme-and-pencil.clan;
// plan decision 2), in the look of the mock's "Sketch area shape" popover (SketchInk): Pen or
// Highlighter, six inks, the colours picked lately, and three widths. The named swatches paint the
// --pen-* tokens, so they show the colour the canvas will draw in this theme. Double-clicking a
// swatch, or +, opens the system colour picker from that colour (owner, 2026-10-15).

import { useRef } from 'react'
import { COLOUR_NAMES, hexOf, isHex, PEN_COLOURS, PEN_WIDTHS, setPen, WIDTH_NAMES, type PenChoice, type PenColour } from './penStyle'
import './pen.css'

export function PenOptions({ pen, vertical = false }: { pen: PenChoice; vertical?: boolean }) {
  const look = pen[pen.mode]
  const picker = useRef<HTMLInputElement>(null)
  const pick = (from: PenColour) => {
    const el = picker.current
    if (!el) return
    el.value = hexOf(from)
    // The picker moves the ink live; the colour it closes on joins the recent swatches.
    el.onchange = () => setPen({ color: el.value, remember: true })
    if (el.showPicker) el.showPicker()
    else el.click()
  }
  const swatch = (c: PenColour, label: string) => (
    <button key={c} type="button" role="radio" aria-checked={look.color === c} aria-label={label} title={`${label} · double-click for more colours`}
      className="pen-swatch" style={{ ['--swatch' as string]: isHex(c) ? c : `var(--pen-${c})` }}
      onClick={() => setPen({ color: c })} onDoubleClick={() => pick(c)} />
  )
  const shown = isHex(look.color) && !pen.recent.includes(look.color) ? [look.color, ...pen.recent] : pen.recent
  return (
    <div className={`pen-options pt-panel ${vertical ? 'vertical' : ''}`} role="group" aria-label="Pen options">
      <div className="pt-seg pen-mode" role="radiogroup" aria-label="Draw with">
        {(['pen', 'highlighter'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={pen.mode === m} aria-pressed={pen.mode === m} onClick={() => setPen({ mode: m })}>
            {m === 'pen' ? 'Pen' : 'Highlighter'}
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="pen-sep" />
      <div className="pen-swatches" role="radiogroup" aria-label="Ink">
        {PEN_COLOURS.map((c) => swatch(c, COLOUR_NAMES[c]))}
        {shown.map((c) => swatch(c, `Colour ${c}`))}
        <button type="button" className="pen-more" aria-label="More colours" title="More colours" onClick={() => pick(look.color)}>+</button>
        <input ref={picker} type="color" className="pen-picker" aria-hidden="true" tabIndex={-1}
          onInput={(e) => setPen({ color: (e.target as HTMLInputElement).value })} />
      </div>
      <span aria-hidden="true" className="pen-sep" />
      <div className="pen-widths" role="radiogroup" aria-label="Width">
        {PEN_WIDTHS[pen.mode].map((w, i) => (
          <button key={w} type="button" role="radio" aria-checked={look.width === w} aria-label={WIDTH_NAMES[i]} title={WIDTH_NAMES[i]}
            className="pen-width" onClick={() => setPen({ width: w })}>
            <span aria-hidden="true" style={{ height: [2, 4, 7][i], opacity: pen.mode === 'highlighter' ? 0.45 : 1, background: isHex(look.color) ? look.color : `var(--pen-${look.color})` }} />
          </button>
        ))}
      </div>
    </div>
  )
}
