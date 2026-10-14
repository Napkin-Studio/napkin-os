// The pen's options over the tool bar while the pen is in use (features/theme-and-pencil.clan;
// plan decision 2), in the look of the mock's "Sketch area shape" popover (SketchInk): Pen or
// Highlighter, six inks and three widths. No free colour picker. The swatches paint the --pen-*
// tokens, so they show the colour the canvas will draw in this theme.

import { COLOUR_NAMES, PEN_COLOURS, PEN_WIDTHS, setPen, WIDTH_NAMES, type PenChoice } from './penStyle'
import './pen.css'

export function PenOptions({ pen, vertical = false }: { pen: PenChoice; vertical?: boolean }) {
  const look = pen[pen.mode]
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
        {PEN_COLOURS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={look.color === c} aria-label={COLOUR_NAMES[c]} title={COLOUR_NAMES[c]}
            className="pen-swatch" style={{ ['--swatch' as string]: `var(--pen-${c})` }} onClick={() => setPen({ color: c })} />
        ))}
      </div>
      <span aria-hidden="true" className="pen-sep" />
      <div className="pen-widths" role="radiogroup" aria-label="Width">
        {PEN_WIDTHS[pen.mode].map((w, i) => (
          <button key={w} type="button" role="radio" aria-checked={look.width === w} aria-label={WIDTH_NAMES[i]} title={WIDTH_NAMES[i]}
            className="pen-width" onClick={() => setPen({ width: w })}>
            <span aria-hidden="true" style={{ height: [2, 4, 7][i], opacity: pen.mode === 'highlighter' ? 0.45 : 1, background: `var(--pen-${look.color})` }} />
          </button>
        ))}
      </div>
    </div>
  )
}
