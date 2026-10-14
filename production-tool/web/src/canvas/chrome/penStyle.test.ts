// The pen's options (features/theme-and-pencil.clan; plan decision 2): six inks, three widths for
// pen and highlighter, no free colour, and the last choice kept in this browser, safely.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PenOptions } from './PenOptions'
import { DEFAULT_PEN, loadPen, PEN_COLOURS, PEN_KEY, PEN_WIDTHS, savePen } from './penStyle'

describe('the pen\'s options', () => {
  it('six inks, the theme\'s ink first and the default; three widths each', () => {
    expect(PEN_COLOURS).toEqual(['ink', 'orange', 'blue', 'green', 'amber', 'grey'])
    expect(DEFAULT_PEN.pen.color).toBe('ink')
    expect(PEN_WIDTHS.pen).toHaveLength(3)
    expect(PEN_WIDTHS.highlighter).toHaveLength(3)
    expect(PEN_WIDTHS.pen).toContain(DEFAULT_PEN.pen.width)
    expect(PEN_WIDTHS.highlighter).toContain(DEFAULT_PEN.highlighter.width)
  })

  it('the last choice comes back; junk, a free colour or a throwing store give the defaults', () => {
    let kept = ''
    savePen({ mode: 'highlighter', pen: { color: 'blue', width: 8 }, highlighter: { color: 'green', width: 28 } }, (v) => (kept = v))
    expect(loadPen(() => kept)).toEqual({ mode: 'highlighter', pen: { color: 'blue', width: 8 }, highlighter: { color: 'green', width: 28 } })
    expect(loadPen(() => null)).toEqual(DEFAULT_PEN)
    expect(loadPen(() => '{not json')).toEqual(DEFAULT_PEN)
    expect(loadPen(() => JSON.stringify({ mode: 'pen', pen: { color: '#ff00ff', width: 99 } }))).toEqual(DEFAULT_PEN)
    expect(loadPen(() => { throw new Error('SecurityError') })).toEqual(DEFAULT_PEN)
    expect(() => savePen(DEFAULT_PEN, () => { throw new Error('QuotaExceeded') })).not.toThrow()
    expect(PEN_KEY).toBe('napkin.production.pen')
  })

  it('the popover: Pen or Highlighter, the six swatches in their tokens, three widths, no colour input', () => {
    const html = renderToStaticMarkup(createElement(PenOptions, { pen: DEFAULT_PEN }))
    expect(html).toContain('aria-label="Pen options"')
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Pen</)
    expect(html).toContain('>Highlighter<')
    for (const c of PEN_COLOURS) expect(html).toContain(`--swatch:var(--pen-${c})`)
    expect(html.match(/class="pen-swatch"/g)).toHaveLength(6)
    expect(html.match(/class="pen-width"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-checked="true" aria-label="Ink"/)
    expect(html).toMatch(/aria-checked="true" aria-label="Medium"/)
    expect(html).not.toContain('type="color"')
  })
})
