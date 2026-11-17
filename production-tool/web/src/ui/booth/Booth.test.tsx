// @vitest-environment happy-dom
// The Booth, rendered (features/booth.clan; features/script-freeform.clan): Hide and the edge tab, the
// remembered state per person, the width for each place, the count dot, a column below 1100 px, a room
// starting hidden below 1280 px, an agent's question bringing it in, and reduced motion.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, type Services } from '../../app/context'
import { SnapshotStore } from '../../doc/store'
import { initialUi, type UiState } from '../../doc/ui'
import { Booth } from './Booth'
import type { BoothPlace } from './state'
import { useBooth } from './useBooth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ME = { participantId: 'p_maya' } as UiState['me']
let root: Root | null = null
let reduce = false

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  reduce = false
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') ? reduce : false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function Harness({ place, scoped, count, asks }: { place: BoothPlace; scoped?: boolean; count?: number; asks?: number }) {
  const state = useBooth(place)
  return createElement(Booth, { state, scoped, count, asks, children: createElement('p', { className: 'inside' }, 'Skye') })
}

function mount(props: { place: BoothPlace; scoped?: boolean; count?: number; asks?: number }, ui: Partial<UiState> = {}, width = 1600) {
  setWidth(width)
  const store = new SnapshotStore<UiState>({ ...initialUi(), me: ME, ...ui }, null)
  const services = { ui: store } as unknown as Services
  const el = document.createElement('div')
  document.body.appendChild(el)
  const render = (p = props) => act(() => {
    root ??= createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: services }, createElement(Harness, p)))
  })
  render()
  const col = () => el.querySelector('.booth-col') as HTMLElement
  const edge = () => el.querySelector('.booth-edge') as HTMLButtonElement | null
  return { el, store, render, col, edge, open: () => col().dataset.boothOpen === 'true' }
}

describe('the Booth', () => {
  it('Hide slides it out to its edge tab and the tab brings it back; each is remembered for this person', () => {
    const b = mount({ place: 'script' })
    expect(b.open()).toBe(true)
    expect(b.el.querySelector('.booth-nm')?.textContent).toBe('Booth')
    const hide = b.el.querySelector('.booth-hide') as HTMLButtonElement
    expect(hide.textContent).toBe('Hide')
    act(() => hide.click())
    expect(b.open()).toBe(false)
    expect(b.col().classList.contains('booth-off')).toBe(true)
    expect(b.el.querySelector('.booth')?.hasAttribute('inert')).toBe(true)
    expect(b.edge()?.classList.contains('on')).toBe(true)
    expect(b.edge()?.textContent).toContain('Booth')
    expect(b.store.get().booth).toEqual({ 'human:p_maya': 'hidden' })
    act(() => b.edge()!.click())
    expect(b.open()).toBe(true)
    expect(b.store.get().booth).toEqual({ 'human:p_maya': 'shown' })
  })

  it('opens hidden when this person hid it last, and shown for someone else', () => {
    expect(mount({ place: 'script' }, { booth: { 'human:p_maya': 'hidden' } }).open()).toBe(false)
    act(() => root?.unmount())
    root = null
    expect(mount({ place: 'script' }, { booth: { 'human:p_jo': 'hidden' } }).open()).toBe(true)
  })

  it('is as wide as what it is on: 420 the whole script, 440 a part, 420 the Storyboard, 380 a room', () => {
    const b = mount({ place: 'script' })
    expect(b.col().style.getPropertyValue('--bw')).toBe('420px')
    b.render({ place: 'script', scoped: true })
    expect(b.col().style.getPropertyValue('--bw')).toBe('440px')
    b.render({ place: 'storyboard' })
    expect(b.col().style.getPropertyValue('--bw')).toBe('420px')
    expect(b.col().style.getPropertyValue('--bgut')).toBe('44px')
    b.render({ place: 'room' })
    expect(b.col().style.getPropertyValue('--bw')).toBe('380px')
    expect(b.col().classList.contains('flush')).toBe(true)
  })

  it('shows a count dot on the edge tab while something waits', () => {
    const b = mount({ place: 'script', count: 2 })
    expect(b.edge()?.classList.contains('has')).toBe(true)
    expect(b.edge()?.querySelector('.booth-ct')?.textContent).toBe('2')
    expect(b.edge()?.getAttribute('aria-label')).toBe('Open the Booth, 2 things waiting for you')
    b.render({ place: 'script', count: 0 })
    expect(b.edge()?.classList.contains('has')).toBe(false)
  })

  it('below 1100 px stays a column: no Hide, no edge tab, shown even when hidden last', () => {
    const b = mount({ place: 'script' }, { booth: { 'human:p_maya': 'hidden' } }, 1024)
    expect(b.open()).toBe(true)
    expect(b.el.querySelector('.booth-hide')).toBeNull()
    expect(b.edge()).toBeNull()
    expect(b.col().style.getPropertyValue('--bw')).toBe('320px')
  })

  it('in a room below 1280 px it starts hidden as its edge tab, without changing what is remembered', () => {
    const b = mount({ place: 'room' }, {}, 1200)
    expect(b.open()).toBe(false)
    expect(b.edge()?.classList.contains('on')).toBe(true)
    expect(b.store.get().booth).toBeUndefined()
    act(() => root?.unmount())
    root = null
    expect(mount({ place: 'room' }, {}, 1600).open()).toBe(true)
  })

  it('an agent asking while it is hidden pings the dot, then brings it in after about a second', () => {
    vi.useFakeTimers()
    const b = mount({ place: 'script', count: 0, asks: 0 }, { booth: { 'human:p_maya': 'hidden' } })
    expect(b.open()).toBe(false)
    b.render({ place: 'script', count: 1, asks: 1 })
    expect(b.edge()?.className).toMatch(/ping/)
    expect(b.open()).toBe(false)
    act(() => { vi.advanceTimersByTime(1100) })
    expect(b.open()).toBe(true)
    // Brought in by the question, not by the person: what they chose stays.
    expect(b.store.get().booth).toEqual({ 'human:p_maya': 'hidden' })
  })

  it('reduced motion (the OS or the account menu) gets the short fade', () => {
    reduce = true
    expect(mount({ place: 'script' }).col().classList.contains('booth-still')).toBe(true)
    act(() => root?.unmount())
    root = null
    reduce = false
    expect(mount({ place: 'script' }).col().classList.contains('booth-still')).toBe(false)
    act(() => root?.unmount())
    root = null
    expect(mount({ place: 'script' }, { motion: 'still' }).col().classList.contains('booth-still')).toBe(true)
  })

  it('] toggles it, but not while typing', () => {
    const b = mount({ place: 'script' })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' })) })
    expect(b.open()).toBe(false)
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true })) })
    expect(b.open()).toBe(false)
  })
})
