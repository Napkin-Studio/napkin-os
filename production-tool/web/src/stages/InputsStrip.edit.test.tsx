// @vitest-environment happy-dom
// Editing the inputs strip (ui-behaviour 3.16): a chip's × unlinks it, asking first when shots use it;
// "+ Link input" links a board, group or reference picked from a searchable list, by the rules of 3.4.
// Each write is one undo step, on the real CLAN store; a deleted picture is never offered or shown.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesContext, type Services } from '../app/context'
import type { Link, NamedRef } from '../contracts/types'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { lifeOf } from '../model/live'
import { mainStoryboard } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { rankBetween } from '../../../clan-store/src'
import { addShots, asset, id, MAYA, modelStore, SHA } from '../test/model'
import { InputsStrip, ScopeLine } from './InputsStrip'
import { linkChoices, unlinkQuestion } from './inputsEdit'
import { scopeOf } from '../model/scope'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let store: ModelStore | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  await store?.close()
  store = null
})

const view = (variant: string, node: string, c: string): NamedRef =>
  ({ id: id('ref'), v: 1, field_v: {}, key: 'home', variant, role: 'location', asset: SHA(c), node })

/** @home's four views (the front deleted on the canvas), its key linked into the storyboard, two shots using @home. */
async function seeded() {
  const s = modelStore()
  store = s
  await s.create(MAYA, 'Kapi')
  const ids = { key: '', link: '', closeup: '', front: '', board: '' }
  await systemUpdate(s, (d) => {
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key: 'home', role: 'location' }
    const views = [view('front', 'node_front', 'a'), view('closeup', 'node_close', 'b'), view('surroundings', 'node_around', 'c'), view('side-view', 'node_sidev', 'e')]
    for (const r of views) { d.refs[r.id] = r; d.assets[r.asset!] = asset(r.asset!, 'image', { origin: 'uploaded' }) }
    const sb = mainStoryboard(d)!
    const l: Link = { id: id('link'), v: 1, field_v: {}, from: { kind: 'key', id: k }, to: { kind: 'storyboard', id: sb.id }, role: 'location' }
    d.links[l.id] = l
    const [a, b] = addShots(d, 2)
    a.action = 'Kapi runs to @home.'
    b.action = 'Night at @home.'
    Object.assign(ids, { key: k, link: l.id, closeup: views[1].id, front: views[0].id })
  }, 'sync')
  await s.flush()
  if (s.trouble) throw new Error(`the fixture was refused: ${s.trouble}`)
  lifeOf(s).set(new Set(['node_close', 'node_around', 'node_sidev'])) // home_front's picture was deleted
  return { s, sb: mainStoryboard(s.get())!.id, ...ids }
}

function mount(s: ModelStore, node: ReturnType<typeof createElement>) {
  const ui = new SnapshotStore<UiState>(initialUi())
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: { doc: s, ui } as unknown as Services }, node))
  })
  return el
}

const settle = async (s: ModelStore) => {
  await act(async () => {
    await s.flush()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  })
}
const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('nothing to click')
  await act(async () => { (el as HTMLElement).click() })
}
const chips = (el: Element) => [...el.querySelectorAll('.in-strip .in-chip')].map((c) => c.textContent)

describe('the inputs strip’s ×', () => {
  it('asks first when shots use it, then unlinks as one undo step', async () => {
    const { s, sb, link } = await seeded()
    expect(unlinkQuestion(s.get(), scopeOf(s.get(), sb), scopeOf(s.get(), sb).find((it) => it.linkId === link)!)).toBe('Shots 1 and 2 use @home. Unlink anyway?')
    const el = mount(s, createElement(InputsStrip, { nodeId: sb }))
    expect(chips(el)).toEqual(['Script', '@home · 3 views']) // the deleted front is not counted
    await click(el.querySelector('[aria-label="Unlink @home · 3 views"]'))
    const pop = document.body.querySelector('.in-pop[aria-label="Unlink"]')
    expect(pop?.querySelector('.in-q')?.textContent).toBe('Shots 1 and 2 use @home. Unlink anyway?')
    expect(s.get().links[link]).toBeDefined() // nothing yet
    await click([...pop!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'))
    expect(s.get().links[link]).toBeDefined()
    await click(el.querySelector('[aria-label="Unlink @home · 3 views"]'))
    await click([...document.body.querySelectorAll('.in-pop button')].find((b) => b.textContent === 'Unlink'))
    await settle(s)
    expect(s.get().links[link]).toBeUndefined()
    expect(chips(el)).toEqual(['Script'])
    await act(async () => { await s.undo() })
    await settle(s)
    expect(s.get().links[link]).toBeDefined()
    expect(chips(el)).toEqual(['Script', '@home · 3 views'])
  })

  it('unlinks at once when no shot uses it', async () => {
    const { s, sb, closeup } = await seeded()
    await systemUpdate(s, (d) => { for (const x of Object.values(d.shots)) x.action = 'Kapi runs.' }, 'sync')
    const own: Link = { id: id('link'), v: 1, field_v: {}, from: { kind: 'ref', id: closeup }, to: { kind: 'script', id: Object.keys(s.get().scripts)[0] }, role: 'location' }
    await systemUpdate(s, (d) => { d.links[own.id] = own }, 'sync')
    await s.flush()
    const el = mount(s, createElement(InputsStrip, { nodeId: own.to.id }))
    await click(el.querySelector('[aria-label^="Unlink @home_closeup"]'))
    await settle(s)
    expect(document.body.querySelector('.in-pop')).toBeNull()
    expect(s.get().links[own.id]).toBeUndefined()
    void sb
  })
})

describe('"+ Link input"', () => {
  it('offers boards, groups and live references only, and links the one picked as one undo step', async () => {
    const { s, sb, link, closeup } = await seeded()
    const choices = linkChoices(s.get(), sb).map((c) => c.label) // the stored document: what the strip must not use
    expect(choices).toContain('@home_front')
    const el = mount(s, createElement(ScopeLine, { nodeId: sb }))
    await click(el.querySelector('.in-add'))
    const pop = () => document.body.querySelector('.in-pop[aria-label="Link input"]')!
    const rows = () => [...pop().querySelectorAll('.in-choice')].map((b) => b.querySelector('.in-clabel')?.textContent)
    expect(rows()).not.toContain('@home_front')
    expect(rows()).toEqual(expect.arrayContaining(['@home · 3 views', '@home_closeup', '@home_surroundings', '@home_side-view']))
    // The linked key says so and is not offered again.
    const linked = [...pop().querySelectorAll('.in-choice')].find((b) => b.querySelector('.in-clabel')?.textContent === '@home · 3 views')!
    expect(linked.getAttribute('aria-disabled')).toBe('true')
    // Search, then pick a single reference: its own link, with its role.
    const input = pop().querySelector('input')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'closeup')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['@home_closeup'])
    await click(pop().querySelector('.in-choice'))
    await settle(s)
    const made = Object.values(s.get().links).filter((l) => l.to.id === sb && l.from.id === closeup)
    expect(made.map((l) => [l.from.kind, l.role])).toEqual([['ref', 'location']])
    expect(document.body.querySelector('.in-pop')).toBeNull()
    expect(s.get().links[link]).toBeDefined()
    await act(async () => { await s.undo() })
    await settle(s)
    expect(Object.values(s.get().links).filter((l) => l.from.id === closeup)).toEqual([])
  })

  it('refuses what the rules refuse, with the reason', async () => {
    const { s, sb } = await seeded()
    const b = { id: id('board'), v: 1, field_v: {}, title: 'Locations', purpose: 'location' as const, rank: rankBetween(null, null) }
    await systemUpdate(s, (d) => { d.boards[b.id] = b }, 'sync')
    await s.flush()
    const once = await import('../canvas/nodes/nodes').then((m) => m.linkInput(s, s.get(), { kind: 'board', id: b.id }, { kind: 'storyboard', id: sb }))
    expect(once.ok).toBe(true)
    const twice = await import('../canvas/nodes/nodes').then((m) => m.linkInput(s, s.get(), { kind: 'board', id: b.id }, { kind: 'storyboard', id: sb }))
    expect(twice).toEqual({ ok: false, reason: 'These are already linked.' })
  })
})
