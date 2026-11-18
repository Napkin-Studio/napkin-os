// @vitest-environment happy-dom
// The "what must stay" editor: select a box, move it, rename it, change what it is, remove it.

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProtectBox } from '../contracts/types'
import { ProtectEditor } from './ProtectEditor'

vi.mock('../ui/hooks', () => ({ useBlobUrl: () => undefined }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const master = { asset: 'sha256:x', w: 1000, h: 500 }
const START: ProtectBox[] = [
  { role: 'subject', label: 'model', x: 100, y: 100, w: 200, h: 200 },
  { role: 'product', label: 'can', x: 600, y: 100, w: 100, h: 200 },
]

let root: Root | undefined
let host: HTMLElement | undefined
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined })

function mount(start: ProtectBox[] = START) {
  const seen: ProtectBox[][] = []
  const Harness = () => {
    const [boxes, setBoxes] = useState<ProtectBox[]>(start)
    return createElement(ProtectEditor, { master, boxes, setBoxes: (b: ProtectBox[]) => { setBoxes(b); seen.push(b) } })
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(Harness)))
  return seen
}

// The picture is 560 px wide for 1000 master pixels: 0.56 on screen.
const S = 0.56
const q = <T extends Element>(sel: string) => host!.querySelector(sel) as T
const picture = () => q<HTMLElement>('[data-testid="protect-picture"]')
const fire = (el: Element, type: string, init: object = {}) => act(() => { el.dispatchEvent(new Event(type, { bubbles: true, ...init })) })
const pointer = (type: string, x?: number, y?: number) => {
  const ev = new Event(type, { bubbles: true }) as Event & Record<string, unknown>
  Object.assign(ev, { clientX: (x ?? 0) * S, clientY: (y ?? 0) * S, pointerId: 1 })
  act(() => { picture().dispatchEvent(ev) })
}
const press = (x: number, y: number) => pointer('pointerdown', x, y)
const moveTo = (x: number, y: number) => pointer('pointermove', x, y)
const release = () => pointer('pointerup')
const type = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
const key = (k: string) => act(() => { picture().dispatchEvent(Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: k, shiftKey: false })) })

describe('ProtectEditor', () => {
  it('a name can be changed after the box is drawn', () => {
    const seen = mount()
    type(q('[aria-label="Name of box 2"]'), 'the tin')
    expect(seen.at(-1)![1].label).toBe('the tin')
    expect(host!.textContent).toContain('the tin')
  })
  it('a cleared name goes back to the role\'s own word', () => {
    const seen = mount()
    type(q('[aria-label="Name of box 1"]'), '')
    expect(seen.at(-1)![0].label).toBeUndefined()
    expect(q<HTMLInputElement>('[aria-label="Name of box 1"]').placeholder).toBe('subject')
  })
  it('what a box is can be changed', () => {
    const seen = mount()
    type(q('[aria-label="What box 1 is"]'), 'product')
    expect(seen.at(-1)![0].role).toBe('product')
  })
  it('a box can be removed from the list', () => {
    const seen = mount()
    fire(q('[aria-label="Remove box 1"]'), 'click')
    expect(seen.at(-1)).toHaveLength(1)
    expect(seen.at(-1)![0].label).toBe('can')
  })
  it('a click on a box selects it instead of drawing a new one, and Delete removes it', () => {
    const seen = mount()
    press(200, 200)
    release()
    expect(seen).toHaveLength(0)
    expect(host!.querySelectorAll('[data-testid="protect-box"]')[0].className).toContain('sel')
    key('Delete')
    expect(seen.at(-1)).toHaveLength(1)
  })
  it('dragging a box moves it, and a drag on empty ground draws a new one', () => {
    const seen = mount()
    press(200, 200)
    moveTo(300, 250)
    release()
    expect(seen.at(-1)![0]).toMatchObject({ x: 200, y: 150, w: 200, h: 200, label: 'model' })
    press(800, 50)
    moveTo(900, 150)
    release()
    expect(seen.at(-1)).toHaveLength(3)
    expect(seen.at(-1)![2]).toMatchObject({ x: 800, y: 50, w: 100, h: 100 })
  })
  it('a handle resizes the selected box', () => {
    const seen = mount()
    press(650, 200)
    release()
    const handle = q<HTMLElement>('[data-handle="e"]')
    const ev = Object.assign(new Event('pointerdown', { bubbles: true }), { clientX: 700 * S, clientY: 200 * S, pointerId: 1 })
    act(() => { handle.dispatchEvent(ev) })
    moveTo(780, 200)
    release()
    expect(seen.at(-1)![1]).toMatchObject({ x: 600, w: 180, h: 200 })
  })
  it('the arrow keys nudge the selected box', () => {
    const seen = mount()
    press(650, 200)
    release()
    key('ArrowRight')
    expect(seen.at(-1)![1].x).toBe(605)
  })
  it('stops at eight boxes and says so', () => {
    mount(Array.from({ length: 8 }, (_, i): ProtectBox => ({ role: 'other', x: i * 100, y: 0, w: 50, h: 50 })))
    expect(host!.textContent).toContain('8 boxes, the most')
  })
})
