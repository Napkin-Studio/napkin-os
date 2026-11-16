// @vitest-environment happy-dom
// The Booth in the Storyboard and the Video rooms (features/script-freeform.clan; mock states storyboard,
// make, edit): what already needs the person there waits as cards (Dex's questions on shots a re-plan left
// out, a failed frame or take not cleared), the agent's recent notes from the decision chain, Fin's box goes
// to the Change tab's Words row, and a room below 1280 px starts with its Booth hidden.

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext, type Services } from '../app/context'
import type { Ask } from '../contracts/types'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { mainStoryboard, shotsOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { DexBooth } from '../stages/DexBooth'
import { addShots, id, job, MAYA, seedStages, wasm } from '../test/model'
import type { ChangeOpen } from './ChangeDrawer'
import type { Box, Gen } from './model'
import { RoomBooth } from './RoomBooth'
import type { RoomData } from './Rooms'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google'] }, quotas: null, projects: 0 }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
/** Wait (up to 3 s) until `ok` holds: the store and the chain take longer on a busy machine. */
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

async function project(width = 1600) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  const storage = memoryStorage()
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-16T10:00:00Z')), storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services = shell.get().session!.services
  await seedStages(services.doc)
  await updateDoc(services.doc, (d) => { addShots(d, 3, { status: 'planned', action: 'Shot words.' }) }, 'add shots')
  await services.doc.flush()
  const sb = mainStoryboard(services.doc.get())!.id
  const shots = shotsOf(services.doc.get(), sb).map((s) => s.id)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const render = (node: ReactElement) => act(() => {
    root ??= createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: services }, node))
  })
  return { services, sb, shots, el, render }
}

const failed = (services: Services, shotId: string, op: 'frame' | 'clip') => updateDoc(services.doc, (d) => {
  const j = job(d, op, [], null, { state: 'failed', node: { kind: 'shot', id: shotId }, purpose: op, crew: op === 'frame' ? 'dex' : 'wren', error: { code: 'invalid_input', message: '@mira is not one of the images this step was given.', retryable: false } })
  d.jobs[j.id] = j
}, 'fail')
const buttonIn = (at: Element, name: string) => [...at.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement
function typeInto(t: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(t, text)
  t.dispatchEvent(new Event('input', { bubbles: true }))
}

describe("Dex's Booth in the Storyboard", () => {
  it("waits with his question on a shot a re-plan left out, and a frame that did not draw; Clear clears it; his notes follow", async () => {
    const { services, sb, shots, el, render } = await project()
    const answered: string[] = []
    const q = id('q')
    const ask: Ask = {
      id: q, v: 1, field_v: {}, node: { kind: 'storyboard', id: sb }, crew: 'dex', state: 'open', answers: [],
      question: { id: q, kind: 'block', text: 'Shot 2 no longer has a scene. Keep it or remove it?', options: [
        { id: 'keep', label: 'Keep', value: { route: 'keep_shot', node: { kind: 'shot', id: shots[1] } } },
        { id: 'remove', label: 'Remove', value: { route: 'remove_shot', node: { kind: 'shot', id: shots[1] } } }], allow_text: false },
    }
    await updateDoc(services.doc, (d) => { d.asks[q] = ask }, 'ask')
    await failed(services, shots[2], 'frame')
    const docId = services.clan!.documentId()
    await services.clan!.record('plan 3 shots on the storyboard', undefined, { agent: 'dex', targets: [`${docId}#storyboards[${sb}]`] })
    render(createElement(DexBooth, { storyboardId: sb, onShotAsk: (_a: Ask, shotId: string, o: 'keep' | 'remove') => { answered.push(`${o}:${shotId}`) } }))
    await until(() => !!el.querySelector('.booth [data-booth-note]') && el.querySelectorAll('.booth .bc.ask').length === 2)
    const booth = el.querySelector('.booth') as HTMLElement
    expect(booth.querySelector('.bt-agent')?.textContent).toContain('Dex · directs')
    expect(booth.querySelector('textarea')).toBeNull()
    expect(booth.querySelector('.bt-sec')?.textContent).toBe('Waiting for you2')
    const cards = [...booth.querySelectorAll('.bc.ask')]
    expect(cards.map((c) => c.querySelector('.bc-q')?.textContent)).toEqual(['Shot 2 no longer has a scene. Keep it or remove it?', 'Shot 3’s frame did not draw.'])
    expect(cards[1].querySelector('.bc-note')?.textContent).toBe('@mira is not one of the images this step was given.')
    await act(async () => { buttonIn(cards[0], 'Keep').click() })
    expect(answered).toEqual([`keep:${shots[1]}`])
    await act(async () => { buttonIn(cards[1], 'Clear').click() })
    await until(() => booth.querySelectorAll('.bc.ask').length === 1)
    expect(booth.querySelectorAll('.bc.ask')).toHaveLength(1)
    expect([...booth.querySelectorAll('[data-booth-note] .bc-note')].map((n) => n.textContent)).toEqual(['Planned 3 shots on the storyboard.'])
    expect(el.querySelector('.booth-col')?.getAttribute('style')).toContain('--bw: 420px')
  })
})

describe('the Booth in the Video rooms', () => {
  const data = (shots: string[], gens: Gen[] = []): RoomData => ({
    videoId: 'video_main', title: 'Lost puppy', ratio: '16:9', targetS: 15, lengthS: 9,
    boxes: shots.map((s, i): Box => ({ key: s, n: i + 1, shotIds: [s], together: false, endCard: false, lengthS: 3 })), gens,
  })
  const take = (shotId: string): Gen => ({ id: id('gen'), kind: 'take' as Gen['kind'], boxKey: shotId, shotIds: [shotId], version: 1, delta: [], label: 'First take', durationS: 3, segments: [{ shotId, inS: 0, outS: 3 }], state: 'ready' })

  it("Make: Fin waits with a take that did not work, and his box sends words to Change's Words row for the shot's next take", async () => {
    const { services, shots, el, render } = await project()
    await failed(services, shots[0], 'clip')
    const opened: ChangeOpen[] = []
    const t = take(shots[1])
    render(createElement(RoomBooth, { room: 'make', data: data(shots, [t]), sel: { shotId: shots[1], boxKey: shots[1] }, change: null,
      onChange: (c: ChangeOpen) => { opened.push(c) }, onApart: () => {}, onReady: () => {} }))
    await settle()
    const booth = el.querySelector('.booth') as HTMLElement
    expect(booth.querySelector('.bt-agent')?.textContent).toContain('Fin · films')
    expect(el.querySelector('.booth-col')?.getAttribute('style')).toContain('--bw: 380px')
    expect(booth.querySelector('.bc.ask .bc-q')?.textContent).toBe('The take of shot 1 did not work.')
    expect(booth.querySelector('.bt-scope')?.textContent).toBe('Shot 2 · Box 2')
    await act(async () => { typeInto(booth.querySelector('textarea') as HTMLTextAreaElement, 'she looks up at the rain') })
    await act(async () => { buttonIn(booth, 'Ask Fin').click() })
    expect(opened).toEqual([{ parentId: t.id, shotId: shots[1], verb: 'words', words: 'she looks up at the rain' }])
  })

  it('Make: the same take stopping the same way twice is one card, and Clear clears both', async () => {
    const { services, shots, el, render } = await project()
    await failed(services, shots[0], 'clip')
    await failed(services, shots[0], 'clip')
    render(createElement(RoomBooth, { room: 'make', data: data(shots), sel: {}, change: null, onChange: () => {}, onApart: () => {}, onReady: () => {} }))
    await settle()
    const cards = el.querySelectorAll('.booth .bc.ask')
    expect(cards).toHaveLength(1)
    expect(cards[0].querySelector('.bc-tries')?.textContent).toBe('Tried 2 times, stopped the same way each time.')
    expect(el.querySelector('.booth .bt-sec')?.textContent).toBe('Waiting for you1')
    await act(async () => { buttonIn(cards[0], 'Clear').click() })
    await until(() => el.querySelectorAll('.booth .bc.ask').length === 0)
    expect(el.querySelectorAll('.booth .bc.ask')).toHaveLength(0)
    expect(Object.values(services.ui.get().jobs).filter((j) => j.dismissed)).toHaveLength(2)
  })

  it('Make: with no take of the box yet, the box waits for one', async () => {
    const { shots, el, render } = await project()
    render(createElement(RoomBooth, { room: 'make', data: data(shots), sel: { shotId: shots[0], boxKey: shots[0] }, change: null, onChange: () => {}, onApart: () => {}, onReady: () => {} }))
    await settle()
    expect((el.querySelector('.booth textarea') as HTMLTextAreaElement).disabled).toBe(true)
    expect(el.querySelector('.booth .bt-hint')?.textContent).toBe('Make a take of this box first. Then tell Fin what changes in the next one.')
  })

  it('Make: the Change tab on a shot filmed with others offers to make it apart', async () => {
    const { shots, el, render } = await project()
    const together: Gen = { ...take(shots[0]), boxKey: `${shots[0]},${shots[1]}`, shotIds: [shots[0], shots[1]], segments: [{ shotId: shots[0], inS: 0, outS: 3 }, { shotId: shots[1], inS: 3, outS: 6 }] }
    const d = data(shots, [together])
    d.boxes = [{ key: together.boxKey, n: 1, shotIds: [shots[0], shots[1]], together: true, endCard: false, lengthS: 6 }]
    const apart: string[] = []
    render(createElement(RoomBooth, { room: 'make', data: d, sel: { shotId: shots[1] }, change: { parentId: together.id, shotId: shots[1] },
      onChange: () => {}, onApart: (s: string) => { apart.push(s) }, onReady: () => {} }))
    await settle()
    const card = el.querySelector('.booth .bc.ask') as HTMLElement
    expect(card.querySelector('.bc-q')?.textContent).toBe('Make shot 2 apart?')
    await act(async () => { buttonIn(card, 'Make shot 2 apart').click() })
    expect(apart).toEqual([shots[1]])
  })

  it('Edit: Edie has no box', async () => {
    const { shots, el, render } = await project()
    render(createElement(RoomBooth, { room: 'edit', data: data(shots), sel: {}, change: null, onChange: () => {}, onApart: () => {}, onReady: () => {} }))
    await settle()
    expect(el.querySelector('.booth .bt-agent')?.textContent).toContain('Edie · edits')
    expect(el.querySelector('.booth textarea')).toBeNull()
  })

  it('a room below 1280 px starts with its Booth hidden as its edge tab, with a 44 px gutter', async () => {
    const { services, shots, el, render } = await project(1200)
    await failed(services, shots[0], 'clip')
    render(createElement(RoomBooth, { room: 'make', data: data(shots), sel: {}, change: null, onChange: () => {}, onApart: () => {}, onReady: () => {} }))
    await settle()
    const col = el.querySelector('.booth-col') as HTMLElement
    expect(col.dataset.boothOpen).toBe('false')
    expect(col.style.getPropertyValue('--bgut')).toBe('44px')
    const edge = el.querySelector('.booth-edge') as HTMLElement
    expect(edge.classList.contains('on')).toBe(true)
    expect(edge.querySelector('.booth-ct')?.textContent).toBe('1')
  })
})
