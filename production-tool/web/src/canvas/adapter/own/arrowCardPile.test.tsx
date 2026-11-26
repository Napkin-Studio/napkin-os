// @vitest-environment happy-dom
// The pinned card of a generation arrow (owner screenshots 2026-10-15): while the arrow's ends lie in one
// closed pile it has no line, so no card is pinned anywhere (never over an unrelated sketch area at the
// place the views had when spread); laid out again, the card sits beside the arrow's live middle; an
// arrow whose middle is out of view shows no card.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesContext, type Services } from '../../../app/context'
import { OwnAdapter } from './adapter'
import { setStacked } from '../../nodes/stack'
import { snapshotDoc } from '../../../test/jobFixtures'
import { initialUi } from '../../../doc/ui'
import { ArrowCards } from '../../../ui/ArrowCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('a pile’s arrow card', () => {
  it('pins no card while stacked, beside the live line when spread, none when out of view', () => {
    const a = new OwnAdapter()
    const pic = (x: number, id: string) => a.patch(a.imageNode({ x, y: 0, width: 300, height: 400, assetSha: null, status: 'saved', customData: { kind: 'pic', id, asset: 'sha256:' + '0'.repeat(64) } }), { groupIds: ['key:samurai'] })
    const front = pic(0, 'n_front')
    const side = pic(700, 'n_side')
    const arrow = a.provenanceArrow({ origin: { x: 308, y: 200 }, points: [[0, 0], [384, 0]], fromElId: front.id, toElId: side.id, color: '#FF4F2E', customData: { kind: 'provenance', from: 'n_front', to: 'n_side' } })
    a.transact(() => [front, side, arrow], { undoable: false })
    const wrap = document.createElement('div')
    Object.defineProperty(wrap, 'clientWidth', { value: 1200 })
    Object.defineProperty(wrap, 'clientHeight', { value: 800 })
    document.body.appendChild(wrap)
    const ui = initialUi()
    const services = { doc: snapshotDoc(), ui: { subscribe: () => () => {}, get: () => ui } } as unknown as Services
    let offset = 0
    const render = () => {
      const sel = a.elements().filter((e) => e.id === arrow.id)
      act(() => root!.render(createElement(ServicesContext.Provider, { value: services },
        createElement(ArrowCards, { canvas: a, wrap: { current: wrap }, selected: sel, toView: (p: { x: number; y: number }) => ({ x: p.x + offset, y: p.y }) }))))
    }
    act(() => { root = createRoot(wrap) })
    const imgs = () => a.elements().filter((e) => e.type === 'image')
    setStacked(a, imgs(), true)
    render()
    expect(wrap.querySelector('[role=dialog], .arrow-card, .ac-card')).toBeNull()
    expect(wrap.textContent).toBe('')
    setStacked(a, imgs(), false)
    render()
    expect(wrap.textContent).not.toBe('')
    offset = 5000
    render()
    expect(wrap.textContent).toBe('')
  })
})
