// @vitest-environment happy-dom
// UAT round 5, S3-1 (features/pt-canvas-r5.clan): after the picture editor or the Storyboard, the pen's options sat
// beside the rail again and swallowed strokes: the top bar's slot was looked up once, and the bar is made anew.
import { act, createElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { TOOL_OPTIONS_SLOT, useToolSlot } from './toolSlot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** As the canvas chrome places them: in the bar's slot when there is one, else beside the rail. */
function Options(): ReactNode {
  const slot = useToolSlot()
  const options = createElement('div', { 'data-pen-options': '' }, 'pen')
  return slot && slot.isConnected ? createPortal(options, slot) : createElement('aside', { 'data-rail': '' }, options)
}

const bar = () => {
  const s = document.createElement('span')
  s.id = TOOL_OPTIONS_SLOT
  document.body.append(s)
  return s
}
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)) })

describe('the pen options follow the top bar when it is made again', () => {
  it('in the bar, then the bar goes (picture editor), then a new bar: in the new bar, never beside the rail', async () => {
    const first = bar()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(Options)))
    await tick()
    expect(first.querySelector('[data-pen-options]')).not.toBeNull()
    // The picture editor's page: no bar. Beside the rail, as before.
    first.remove()
    await tick()
    expect(host.querySelector('[data-rail] [data-pen-options]')).not.toBeNull()
    // Back on the canvas: the bar and its slot are made again.
    const second = bar()
    await tick()
    expect(second.querySelector('[data-pen-options]')).not.toBeNull()
    expect(host.querySelector('[data-rail]')).toBeNull()
    await act(async () => root.unmount())
  })
})
