// The tool bar and the rail's "+ New board" (ui-behaviour 3.2, 3.4, 7; features/art-boards.clan,
// features/canvas-nodes.clan): every button says its name and key in a tooltip; nothing is dead: a
// tool this canvas does not have yet is shown off with the reason; Board (B), Link (L) and + New board
// work when the canvas below registers its actions (our own engine), and are off with why when not.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyDocument } from '../../doc/store'
import { canvasActions } from './actions'
import { boardRows } from './boards'
import { BoardRail, CanvasToolbar } from './CanvasChrome'
import type { CanvasChrome, ChromeTool } from './controls'

const chrome = (has: ChromeTool[] | null): CanvasChrome => ({
  tool: () => 'select', setTool: () => {}, zoom: () => 1, zoomBy: () => {}, fitAll: () => {}, fitRect: () => {}, onChange: () => () => {},
  ...(has ? { supports: (t: ChromeTool) => has.includes(t) } : {}),
})

const bar = (c: CanvasChrome) => renderToStaticMarkup(createElement(CanvasToolbar, { chrome: c, ratio: '16:9', onNode: () => {} }))
/** Each <button …> opening tag of the markup. */
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? []
const button = (html: string, label: RegExp) => buttons(html).find((b) => label.test(b)) ?? ''

let off: (() => void) | null = null
afterEach(() => {
  off?.()
  off = null
})

describe('the tool bar', () => {
  it('gives every button a tooltip with its name and key', () => {
    off = canvasActions.register({ node: () => {}, board: () => {} })
    const html = bar(chrome(null))
    const all = buttons(html)
    expect(all.length).toBeGreaterThanOrEqual(9)
    for (const b of all) expect(b).toMatch(/data-tip="[^"]+"/)
    for (const [name, key] of [['Select', 'V'], ['Hand', 'H'], ['Pen', 'P'], ['Text', 'T'], ['Board', 'B'], ['Link', 'L']]) {
      expect(button(html, new RegExp(`aria-label="${name}[^"]*\\(${key}\\)"`))).toMatch(new RegExp(`data-tip="${name}[^"]*\\(${key}\\)`))
    }
  })

  it('Board and Link work when the canvas has them, and are off with the reason when it has not', () => {
    let html = bar(chrome(null))
    expect(button(html, /aria-label="Board \(B\)"/)).toContain('aria-disabled="true"')
    expect(button(html, /aria-label="Board \(B\)"/)).toContain('needs the new canvas')
    expect(button(html, /aria-label="Link two nodes \(L\)"/)).toContain('aria-disabled="true"')
    off = canvasActions.register({ node: () => {}, board: () => {} })
    html = bar(chrome(null))
    expect(button(html, /aria-label="Board \(B\)"/)).not.toContain('aria-disabled')
    expect(button(html, /aria-label="Link two nodes \(L\)"/)).not.toContain('aria-disabled')
    // Turned on, Link shows pressed and the engine's tool does not.
    canvasActions.setMode('link')
    html = bar(chrome(null))
    expect(button(html, /aria-label="Link two nodes \(L\)"/)).toContain('aria-pressed="true"')
    expect(button(html, /aria-label="Select \(V\)"/)).toContain('aria-pressed="false"')
    canvasActions.setMode(null)
  })

  it('a tool the engine does not have yet is shown off, saying so (no dead buttons)', () => {
    const html = bar(chrome(['select', 'hand', 'pen', 'eraser']))
    expect(button(html, /aria-label="Text \(T\)"/)).toContain('aria-disabled="true"')
    expect(button(html, /aria-label="Text \(T\)"/)).toContain('not on this canvas yet')
    expect(button(html, /aria-label="Sketch area/)).toContain('aria-disabled="true"')
    expect(button(html, /aria-label="Add a picture \(I\)"/)).toContain('aria-disabled="true"')
    expect(button(html, /aria-label="Pen \(P\)"/)).not.toContain('aria-disabled')
  })
})

describe('the chrome\'s actions', () => {
  it('+ Node and + New board reach the canvas that registered them, and nothing after it unmounts', () => {
    const made: string[] = []
    off = canvasActions.register({ node: (k) => made.push(k), board: () => made.push('board') })
    expect(canvasActions.node('storyboard')).toBe(true)
    expect(canvasActions.board()).toBe(true)
    expect(made).toEqual(['storyboard', 'board'])
    off()
    off = null
    expect(canvasActions.node('script')).toBe(false)
    expect(canvasActions.canBoard()).toBe(false)
    // A mode needs the canvas that runs it.
    canvasActions.setMode('board')
    expect(canvasActions.mode()).toBeNull()
  })

  it('the rail\'s + New board is live on our own canvas and off with why on the other', () => {
    const rows = boardRows(emptyDocument({ id: 'p1', handle: 'shrey', tenant_id: 't1' }))
    const rail = () => renderToStaticMarkup(createElement(BoardRail, { rows, current: null, onPick: () => {}, onFit: () => {} }))
    expect(button(rail(), /br-new/)).toContain('aria-disabled="true"')
    off = canvasActions.register({ board: () => {} })
    const live = button(rail(), /br-new/)
    expect(live).not.toContain('aria-disabled')
    expect(live).toContain('data-tip="New board (B)')
  })
})
