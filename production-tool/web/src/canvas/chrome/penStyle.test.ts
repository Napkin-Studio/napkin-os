// The pen's options (features/theme-and-pencil.clan; plan decision 2): six inks, three widths for
// pen and highlighter, any colour from the picker with the last three kept as swatches (owner,
// 2026-10-15, replacing "no free colour"), and the last choice kept in this browser, safely.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PenOptions } from './PenOptions'
import { DEFAULT_PEN, getPen, hexOf, loadPen, PEN_COLOURS, PEN_KEY, PEN_WIDTHS, resetPenForTests, savePen, setPen } from './penStyle'

describe('the pen\'s options', () => {
  it('six inks, the theme\'s ink first and the default; three widths each', () => {
    expect(PEN_COLOURS).toEqual(['ink', 'orange', 'blue', 'green', 'amber', 'grey'])
    expect(DEFAULT_PEN.pen.color).toBe('ink')
    expect(PEN_WIDTHS.pen).toHaveLength(3)
    expect(PEN_WIDTHS.highlighter).toHaveLength(3)
    expect(PEN_WIDTHS.pen).toContain(DEFAULT_PEN.pen.width)
    expect(PEN_WIDTHS.highlighter).toContain(DEFAULT_PEN.highlighter.width)
  })

  it('the last choice comes back, a picked colour too; junk or a throwing store give the defaults', () => {
    let kept = ''
    const chosen = { mode: 'highlighter' as const, pen: { color: '#ff00ff', width: 8 }, highlighter: { color: 'green', width: 28 }, recent: ['#ff00ff'] }
    savePen(chosen, (v) => (kept = v))
    expect(loadPen(() => kept)).toEqual(chosen)
    expect(loadPen(() => null)).toEqual(DEFAULT_PEN)
    expect(loadPen(() => '{not json')).toEqual(DEFAULT_PEN)
    expect(loadPen(() => JSON.stringify({ mode: 'pen', pen: { color: 'red; x', width: 99 }, recent: ['nope', '#00ff00'] })))
      .toEqual({ ...DEFAULT_PEN, recent: ['#00ff00'] })
    expect(loadPen(() => { throw new Error('SecurityError') })).toEqual(DEFAULT_PEN)
    expect(() => savePen(DEFAULT_PEN, () => { throw new Error('QuotaExceeded') })).not.toThrow()
    expect(PEN_KEY).toBe('napkin.production.pen')
  })

  it('the popover: Pen or Highlighter, the six swatches in their tokens, three widths, + for more colours', () => {
    const html = renderToStaticMarkup(createElement(PenOptions, { pen: DEFAULT_PEN }))
    expect(html).toContain('aria-label="Pen options"')
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Pen</)
    expect(html).toContain('>Highlighter<')
    for (const c of PEN_COLOURS) expect(html).toContain(`--swatch:var(--pen-${c})`)
    expect(html.match(/class="pen-swatch"/g)).toHaveLength(6)
    expect(html.match(/class="pen-width"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-checked="true" aria-label="Ink"/)
    expect(html).toMatch(/aria-checked="true" aria-label="Medium"/)
    expect(html).toContain('type="color"')
    expect(html).toContain('aria-label="More colours"')
  })

  it('a picked colour draws at once; the one the picker closes on joins the recent swatches, three at most', () => {
    resetPenForTests()
    setPen({ color: '#123456' })
    expect(getPen().pen.color).toBe('#123456')
    expect(getPen().recent).toEqual([])
    for (const c of ['#111111', '#222222', '#333333', '#444444', '#222222']) setPen({ color: c, remember: true })
    expect(getPen().recent).toEqual(['#222222', '#444444', '#333333'])
    const html = renderToStaticMarkup(createElement(PenOptions, { pen: getPen() }))
    expect(html.match(/class="pen-swatch"/g)).toHaveLength(9)
    expect(html).toContain('--swatch:#444444')
    resetPenForTests()
  })

  it('the picker starts from the swatch\'s colour in this theme', () => {
    expect(hexOf('#ABCDEF')).toBe('#abcdef')
    expect(hexOf('blue', () => ' #2F64F5')).toBe('#2f64f5')
    expect(hexOf('ink', () => 'rgb(20, 22, 27)')).toBe('#14161b')
    expect(hexOf('grey', () => '#abc')).toBe('#aabbcc')
  })
})
