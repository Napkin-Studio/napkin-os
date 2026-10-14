// @vitest-environment happy-dom
// The sketch area shape picker (ui-behaviour 3.7): the bar's sketch button shows the next area's
// ratio (the storyboard's by default); pressed again while the tool is on, it opens "Sketch area
// shape" with 16:9, 9:16, 1:1 and 4:5 as radios; a pick goes to the engine for the next area only.

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { CanvasToolbar } from './CanvasChrome'
import type { CanvasChrome } from './controls'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('the sketch area shape picker', () => {
  it('opens on a second press, and a pick sets the next area\'s ratio and the button\'s label', async () => {
    let tool: 'select' | 'sketch' = 'select'
    const sent: string[] = []
    const chrome: CanvasChrome = {
      tool: () => tool, setTool: (t) => { tool = t as typeof tool }, zoom: () => 1, zoomBy: () => {}, fitAll: () => {}, fitRect: () => {},
      onChange: () => () => {}, setSketchRatio: (r) => sent.push(r), setPen: () => {},
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const render = () => root.render(createElement(CanvasToolbar, { chrome, ratio: '16:9', onNode: () => {} }))
    await act(async () => render())
    const button = () => host.querySelector('button[aria-label^="Sketch area"]') as HTMLButtonElement
    expect(button().textContent).toContain('16:9')
    // First press: the tool. Not the picker yet.
    await act(async () => button().click())
    expect(tool).toBe('sketch')
    await act(async () => render())
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    // Second press: the picker.
    await act(async () => button().click())
    const radios = [...document.querySelectorAll('[role="radio"]')] as HTMLButtonElement[]
    expect(radios.map((r) => r.textContent?.replace('storyboard', ''))).toEqual(['16:9', '9:16', '1:1', '4:5'])
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    await act(async () => radios[1].click())
    expect(sent).toEqual(['9:16'])
    expect(button().textContent).toContain('9:16')
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    await act(async () => root.unmount())
  })

  it('with a sketch area selected, offers copies named for each other ratio and never reshapes the area', async () => {
    const sent: string[] = []
    const copied: string[] = []
    const chrome: CanvasChrome = {
      tool: () => 'select', setTool: () => {}, zoom: () => 1, zoomBy: () => {}, fitAll: () => {}, fitRect: () => {},
      onChange: () => () => {}, setSketchRatio: (r) => sent.push(r), setPen: () => {},
      selectedSketch: () => ({ id: 'area_1', ratio: '16:9' }), copySketch: (r) => { copied.push(r); return true },
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(CanvasToolbar, { chrome, ratio: '16:9', onNode: () => {} })))
    const button = host.querySelector('button[aria-label^="Sketch area"]') as HTMLButtonElement
    // One press opens the copies: the tool stays Select.
    await act(async () => button.click())
    expect(document.querySelector('[role="radiogroup"]')).toBeNull()
    const items = [...document.querySelectorAll('[role="menu"][aria-label="Copy this area into a shape"] [role="menuitem"]')] as HTMLButtonElement[]
    expect(items.map((r) => r.textContent)).toEqual(['16:9 · this area', 'Make a 9:16 copy', 'Make a 1:1 copy', 'Make a 4:5 copy'])
    expect(items[0].getAttribute('aria-disabled')).toBe('true')
    await act(async () => items[0].click())
    expect(copied).toEqual([])
    await act(async () => items[1].click())
    expect(copied).toEqual(['9:16'])
    expect(sent).toEqual([])
    await act(async () => root.unmount())
  })
})
