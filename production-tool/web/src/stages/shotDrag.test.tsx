// @vitest-environment happy-dom
// Drag reorder on the Storyboard editor (ui-behaviour 3.11): where a drop lands, Dex's words,
// a real dnd-kit drag by pointer and by keyboard over a wrapping row of cards, and the write:
// one rank, the drift marks, one undo step.

import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addShots, addTake, job, MAYA, modelStore, SHA } from '../test/model'
import { shotsOf } from '../model/selectors'
import type { ProductionDocument } from '../contracts/types'
import { dragWords, dropPlace, dropSide, moveOnStoryboard, useShotSort } from './shotDrag'
import { ShotSort } from './ShotSort'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ids = ['a', 'b', 'c', 'd', 'e', 'f']

describe('where a drop lands', () => {
  it('before or after the card under it, leaving out the shot itself', () => {
    expect(dropPlace(ids, 'e', { over: 'c', side: 'before' })).toEqual({ beforeId: 'b', afterId: 'c' })
    expect(dropPlace(ids, 'a', { over: 'c', side: 'after' })).toEqual({ beforeId: 'c', afterId: 'd' })
    expect(dropPlace(ids, 'c', { over: 'a', side: 'before' })).toEqual({ beforeId: null, afterId: 'a' })
    expect(dropPlace(ids, 'a', { over: 'f', side: 'after' })).toEqual({ beforeId: 'f', afterId: null })
  })

  it('is no move when it leaves the shot where it is', () => {
    expect(dropPlace(ids, 'c', { over: 'c', side: 'after' })).toBeNull()
    expect(dropPlace(ids, 'c', { over: 'd', side: 'before' })).toBeNull()
    expect(dropPlace(ids, 'c', { over: 'b', side: 'after' })).toBeNull()
  })

  it('takes the side the dragged card is on, else the side it came from', () => {
    expect(dropSide(ids, 'a', 'c', { active: 100, over: 160 })).toBe('before')
    expect(dropSide(ids, 'a', 'c', { active: 200, over: 160 })).toBe('after')
    expect(dropSide(ids, 'a', 'c', { active: 160, over: 160 })).toBe('after')
    expect(dropSide(ids, 'e', 'c')).toBe('before')
  })
})

async function board(n = 6, clips: number[] = []) {
  const store = modelStore()
  await store.create(MAYA, 'Drag')
  await store.change((d) => {
    const shots = addShots(d, n, { status: 'planned' })
    for (const i of clips) addTake(d, shots[i], SHA(String(i)), job(d, 'clip', [], SHA(String(i))), { pick: true })
  }, { action: 'create shots' })
  await store.flush()
  return { store, order: () => shotsOf(store.get()).map((s) => s.id) }
}

describe("Dex's words while dragging", () => {
  it('names the neighbours, and says their clips stay as they are', async () => {
    const { store, order } = await board(6, [1, 4])
    const o = order()
    expect(dragWords(store.get(), o, o[4], { beforeId: o[1], afterId: o[2] }))
      .toBe('If shot 5 lands between 2 and 3, the cuts on both sides change. Clips 2 and 5 stay as they are.')
    expect(dragWords(store.get(), o, o[2], { beforeId: null, afterId: o[0] }))
      .toBe('If shot 3 goes first, before 1, the cut into 1 changes. No clips are made yet, so nothing needs checking.')
    expect(dragWords(store.get(), o, o[0], { beforeId: o[5], afterId: null }))
      .toBe('If shot 1 goes last, after 6, the cut out of 6 changes. No clips are made yet, so nothing needs checking.')
  })
})

describe('the drop is one undo step', () => {
  it('moves the shot and marks no clip; undo puts it back', async () => {
    const { store, order } = await board(6, [1, 2, 4])
    const o = order()
    await moveOnStoryboard(store, o[4], { beforeId: o[1], afterId: o[2] })
    expect(order()).toEqual([o[0], o[1], o[4], o[2], o[3], o[5]])
    const d: ProductionDocument = store.get()
    expect(Object.values(d.stale)).toEqual([]) // takes are never marked (features/make-and-edit.clan)
    // Frames and takes stay with their shot: the shot keeps its id.
    expect(Object.values(d.generations).find((t) => t.shot_ids.includes(o[4]))).toBeTruthy()
    expect(store.undoLabels().undo).toMatch(/^move shots/)
    await store.undo()
    expect(order()).toEqual(o)
    expect(Object.values(store.get().stale)).toEqual([])
  })
})

// A wrapping row of cards, three across, 100 × 80 with 20 between: shots in rank order.
function rectOf(i: number) {
  const col = i % 3
  const row = Math.floor(i / 3)
  const left = col * 120
  const top = row * 100
  return { x: left, y: top, left, top, width: 100, height: 80, right: left + 100, bottom: top + 80, toJSON() { return this } }
}

function Card({ id, i }: { id: string; i: number }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, lifted, line, moving } = useShotSort(id)
  return h('article', { ref: setNodeRef, 'data-i': i, 'data-card': id, className: `${lifted ? 'slot' : ''} ${line ? `drop-${line}` : ''}` },
    line ? h('span', { className: 'line' }, `Shot ${moving} moves here`) : null,
    h('button', { ref: setActivatorNodeRef, ...attributes, ...listeners, type: 'button', 'aria-label': `Move shot ${i + 1}` }, '⋮⋮'),
    h('input', { 'aria-label': `Words ${i + 1}` }))
}

let root: Root | null = null
let rects: ReturnType<typeof vi.spyOn> | null = null
beforeEach(() => {
  rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    // The lifted card (dnd-kit's overlay) starts where the card it lifts from is, as in a browser.
    const card = (this.closest('[data-i]') ?? document.querySelector('article.slot')) as HTMLElement | null
    if (!card) return rectOf(0) as DOMRect
    const r = rectOf(Number(card.dataset.i))
    // The handle sits at the card's top left.
    return (card === this || !this.closest('[data-i]') ? r : { ...r, width: 20, height: 20, right: r.left + 20, bottom: r.top + 20 }) as DOMRect
  })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  rects?.mockRestore()
  document.body.innerHTML = ''
})

async function mount(doc: ProductionDocument, order: string[]) {
  const moves: { shotId: string; place: unknown }[] = []
  const notes: (string | null)[] = []
  const el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => {
    root!.render(h(ShotSort, {
      ids: order, doc,
      onMove: (shotId, place) => { moves.push({ shotId, place }) },
      overlay: (id) => h('div', { className: 'lifted' }, id),
      note: (w) => { notes.push(w); return w ? h('div', { role: 'status', className: 'note' }, w) : null },
      children: order.map((id, i) => h(Card, { key: id, id, i })),
    }))
  })
  return { moves, notes, el }
}

const handle = (n: number) => document.querySelector(`[aria-label="Move shot ${n}"]`) as HTMLButtonElement
const key = async (target: Element, k: string) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 0))
  })
}
const pointer = async (target: EventTarget, type: string, x: number, y: number) => {
  await act(async () => {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 1 }))
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('the drag over the cards', () => {
  it('pointer: dragging shot 5 between 2 and 3 shows the line and Dex, and the drop moves it there', async () => {
    const { store, order } = await board(6, [1, 4])
    const o = order()
    const { moves, el } = await mount(store.get(), o)
    // Shot 5's handle is at (130, 110); shot 2's card centre is (170, 40), shot 3's (290, 40).
    await pointer(handle(5), 'pointerdown', 130, 110)
    await pointer(document, 'pointermove', 140, 110)
    // The pointer goes onto the left half of shot 3: before 3.
    await pointer(document, 'pointermove', 240, 10)
    expect(el.querySelector(`[data-card="${o[4]}"]`)?.className).toContain('slot')
    expect(el.querySelector(`[data-card="${o[2]}"] .line`)?.textContent).toBe('Shot 5 moves here')
    expect(el.querySelector(`[data-card="${o[2]}"]`)?.className).toContain('drop-before')
    expect(el.querySelector('.note')?.textContent).toBe('If shot 5 lands between 2 and 3, the cuts on both sides change. Clips 2 and 5 stay as they are.')
    await pointer(document, 'pointerup', 240, 10)
    expect(moves).toEqual([{ shotId: o[4], place: { beforeId: o[1], afterId: o[2] } }])
    expect(el.querySelector('.note')).toBeNull()
  })

  it('keyboard: Space, the arrows, Space drops; Esc leaves it where it was', async () => {
    const { store, order } = await board(6)
    const o = order()
    const { moves } = await mount(store.get(), o)
    handle(1).focus()
    await key(handle(1), ' ')
    await key(document.activeElement ?? handle(1), 'ArrowRight')
    await key(document.activeElement ?? handle(1), 'ArrowRight')
    await key(document.activeElement ?? handle(1), ' ')
    expect(moves).toEqual([{ shotId: o[0], place: { beforeId: o[2], afterId: o[3] } }])

    handle(4).focus()
    await key(handle(4), ' ')
    await key(document.activeElement ?? handle(4), 'ArrowUp')
    await key(document.activeElement ?? handle(4), 'Escape')
    expect(moves).toHaveLength(1)
  })

  it('typing in a card does not start a drag', async () => {
    const { store, order } = await board(3)
    const { moves } = await mount(store.get(), order())
    const input = document.querySelector('[aria-label="Words 2"]') as HTMLInputElement
    await pointer(input, 'pointerdown', 150, 50)
    await pointer(document, 'pointermove', 300, 50)
    await pointer(document, 'pointerup', 300, 50)
    expect(document.querySelector('.slot')).toBeNull()
    expect(moves).toEqual([])
  })
})
