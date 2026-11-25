// @vitest-environment happy-dom
// The picked size's bar on the page (UAT acceptance A56): a tall 9:16 tile near the top put its bar, and its Final button,
// under the top bar, where it could not be clicked. The bar keeps clear of the page's chrome, the top bar first.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileFloat } from './TileFloat'

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; root = undefined; host = undefined; vi.restoreAllMocks() })

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect

/** A tile as the board draws it: the picture inside a .cb-tile with its caption under it (24 px), at `rect`. */
function Tile({ rect }: { rect: DOMRect }) {
  const tile = document.createElement('div')
  tile.className = 'cb-tile'
  tile.getBoundingClientRect = () => box(rect.left, rect.top, rect.width, rect.height + 24)
  const pic = document.createElement('div')
  pic.getBoundingClientRect = () => rect
  tile.appendChild(pic)
  document.body.appendChild(tile)
  return createElement(TileFloat, { anchor: { current: pic }, onOffscreen: () => {}, children: createElement('button', null, 'Final') })
}

describe('the picked size\'s bar keeps clear of the top bar (UAT acceptance A56)', () => {
  it('a tall tile near the top: the bar goes under the tile, not under the top bar', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const bar = document.createElement('div')
    bar.setAttribute('data-float-avoid', '')
    bar.getBoundingClientRect = () => box(0, 0, 1440, 62)
    document.body.appendChild(bar)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    // A 9:16 tile from y 80 to 560: no room for a 40 px bar between the top bar (62) and the tile.
    act(() => root!.render(createElement(Tile, { rect: box(600, 80, 270, 480) })))
    const panel = document.querySelector<HTMLElement>('.cb-float')!
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(62)
    expect(parseFloat(panel.style.top)).toBeGreaterThan(560)
  })
  it('with room above the tile it stays above', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    const bar = document.createElement('div')
    bar.setAttribute('data-float-avoid', '')
    bar.getBoundingClientRect = () => box(0, 0, 1440, 62)
    document.body.appendChild(bar)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(createElement(Tile, { rect: box(600, 300, 270, 480) })))
    const panel = document.querySelector<HTMLElement>('.cb-float')!
    expect(parseFloat(panel.style.top)).toBeLessThan(300)
    expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(62)
  })
})
