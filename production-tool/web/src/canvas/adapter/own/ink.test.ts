// Theme ink and the pen's options on the own engine (features/theme-and-pencil.clan): a default
// stroke stores the name 'ink' and is painted in the theme's value (light ink in dark mode, the
// bug Shrey hit), the pen's options choose the ink tool's look, the tokens hold every name in
// both themes, and exports (always on white) paint names in the light values.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INK_COLOURS, LIGHT_INK } from '../../../../../canvas-engine/src'
import { DEFAULT_PEN, PEN_COLOURS } from '../../chrome/penStyle'
import { OwnAdapter } from './adapter'
import { drawElements, svgOf, type Ctx2D } from './draw'

function stroke(a: OwnAdapter) {
  a.ink.begin(a.inkTool, { x: 0, y: 0, pressure: 0.5 }, a.inkStyle)
  a.ink.add([{ x: 20, y: 10, pressure: 0.6 }])
  return a.ink.end()!
}

/** A 2D context that records what each element was painted in. */
function recorder() {
  const painted: string[] = []
  const ctx = new Proxy({} as Ctx2D, {
    get: (_t, k) => (k === 'lineWidth' || k === 'globalAlpha' ? 1 : () => {}),
    set: (_t, k, v) => {
      if (k === 'strokeStyle' || k === 'fillStyle') painted.push(`${String(k)}:${v}`)
      return true
    },
  })
  return { ctx, painted }
}

describe('the pen draws in the theme\'s ink', () => {
  it('a default stroke stores the name ink, never a literal colour', () => {
    const a = new OwnAdapter()
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    const r = stroke(a)
    expect(r.style.stroke).toBe('ink')
    expect(r.style.width).toBe(DEFAULT_PEN.pen.width)
  })

  it('the pen\'s options pick the ink, the width and the highlighter', () => {
    const a = new OwnAdapter()
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    a.setPen({ ...DEFAULT_PEN, pen: { color: 'blue', width: 8 } })
    expect(stroke(a).style).toEqual({ stroke: 'blue', width: 8 })
    a.setPen({ mode: 'highlighter', pen: { color: 'blue', width: 8 }, highlighter: { color: 'green', width: 28 } })
    expect(a.inkTool).toBe('highlighter')
    const h = stroke(a)
    expect(h.style).toEqual({ stroke: 'green', width: 28 })
    expect(h.props.tool).toBe('highlighter')
    // The eraser is not turned into a pen by a change of options.
    a.setActiveTool({ type: 'native', id: 'eraser' })
    a.setPen(DEFAULT_PEN)
    expect(a.inkTool).toBe('eraser')
    // Picking the pen again takes the mode the options hold.
    a.setActiveTool({ type: 'native', id: 'freedraw' })
    expect(a.inkTool).toBe('pen')
  })

  it('the screen paints ink in the theme\'s value; a literal colour stays itself', () => {
    const dark = { ...LIGHT_INK, ink: '#F2F3F5' }
    const els = [
      { id: 'a', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], strokeColor: 'ink' },
      { id: 'b', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], strokeColor: '#a33b2b' },
    ] as never
    const { ctx, painted } = recorder()
    drawElements(ctx, els, () => undefined, 'dark', dark)
    expect(painted).toEqual(['strokeStyle:#F2F3F5', 'strokeStyle:#a33b2b'])
  })

  it('exports paint ink names in the light values, on white', () => {
    const els = [{ id: 'a', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]], strokeColor: 'orange', strokeWidth: 4 }] as never
    const svg = svgOf(els, { x: 0, y: 0, w: 10, h: 10 }, '#ffffff', () => undefined)
    expect(svg).toContain(`stroke="${LIGHT_INK.orange}"`)
    expect(svg).not.toContain('stroke="orange"')
    const { ctx, painted } = recorder()
    drawElements(ctx, els, () => undefined)
    expect(painted).toEqual([`strokeStyle:${LIGHT_INK.orange}`])
  })
})

describe('the ink names', () => {
  const css = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8')
  const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('\n}', css.indexOf(sel)))
  const light = block(":root,\n:root[data-theme='light']")
  const dark = block(":root[data-theme='dark']")
  const token = (b: string, name: string) => b.match(new RegExp(`--pen-${name}:\\s*([^;]+);`))?.[1].trim()

  it('the chrome offers the engine\'s names, ink first', () => {
    expect([...PEN_COLOURS]).toEqual([...INK_COLOURS])
    expect(PEN_COLOURS[0]).toBe('ink')
  })

  it('every name has a token in both themes, and the engine\'s light values are the light tokens', () => {
    for (const c of INK_COLOURS) {
      expect(token(light, c)?.toUpperCase()).toBe(LIGHT_INK[c].toUpperCase())
      expect(token(dark, c), `--pen-${c} in dark`).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    // The default ink is the theme's own: dark on light, light on dark.
    expect(token(light, 'ink')).toBe(light.match(/--ink:\s*([^;]+);/)?.[1])
    expect(token(dark, 'ink')).toBe(dark.match(/--ink:\s*([^;]+);/)?.[1])
  })
})
