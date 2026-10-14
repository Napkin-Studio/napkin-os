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
      onChange: () => () => {}, setSketchRatio: (r) => sent.push(r),
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
})
