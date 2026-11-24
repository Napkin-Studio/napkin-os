// @vitest-environment happy-dom
// The end card's Legal field in the Edit room's Inspector (owner 2026-11-23, features/uat-flow-fixes.clan): from the
// LINKED Brief with a "from the brief" mark, the person's words overwrite it, empty with a hint when no Brief is
// linked, and saved in the document under its own key.

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext } from '../app/context'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { id, MAYA, seedStages, SHA, T, wasm } from '../test/model'
import type { ProductionDocument } from '../contracts/types'

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
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })

async function project() {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  const storage = memoryStorage()
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-16T10:00:00Z')), storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services = shell.get().session!.services
  await seedStages(services.doc)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const render = (node: ReactElement) => act(() => {
    root ??= createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: services }, node))
  })
  return { services, el, render }
}

/** A valid Brief node; legal mandatory included. */
const briefNode = (mandatories: string[]) => ({ id: id('brief'), v: 1, field_v: {}, title: 'Ferncliff brief', source: { document_id: 'doc_1', app_id: 'ie.napkin.brief-maker', data_sha256: SHA('b'), taken: 1, at: T, how: 'link' }, spine: { mandatories } }) as unknown as NonNullable<ProductionDocument['briefs']>[string]

import { Inspector } from './Inspector'
import { editCut } from './editOps'
import { readCut } from './timeline'
import { linkInput } from '../canvas/nodes/nodes'
import { mainVideo } from '../model/selectors'
import type { RoomData } from './Rooms'

async function film(linked: boolean, mandatories = ['No apples', 'Legal: Please recycle. Contains 12% fruit juice.']) {
  const p = await project()
  const store = p.services.doc
  const videoId = mainVideo(store.get())!.id
  const b = briefNode(mandatories)
  await updateDoc(store, (d) => { d.briefs = { [b.id]: b } }, 'brief')
  if (linked) await linkInput(store, store.get(), { kind: 'brief', id: b.id }, { kind: 'video', id: videoId })
  await editCut.endCard(store, videoId, { headline: 'Ferncliff', line: 'Cool, lightly.', cta: 'Find Ferncliff near you' })
  const show = () => {
    const data = { videoId, title: 'F', ratio: '16:9', targetS: 15, lengthS: 2, boxes: [], gens: [] } as RoomData
    const props = { data, cut: readCut(store.get(), videoId), picked: { kind: 'card' as const }, onPick: () => {}, onChange: () => {}, onFeel: () => {}, onSwap: () => {}, handleShort: () => 1 }
    return p.render(createElement(Inspector, props))
  }
  await show()
  await settle()
  return { ...p, store, videoId, show }
}
const legalInput = (el: Element) => [...el.querySelectorAll('label.rm-fieldlabel')].find((l) => l.textContent?.startsWith('Legal'))!.querySelector('input') as HTMLInputElement
const legalLabel = (el: Element) => [...el.querySelectorAll('label.rm-fieldlabel')].find((l) => l.textContent?.startsWith('Legal')) as HTMLElement
function typeInto(t: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(t, text)
  t.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('the end card\'s Legal field', () => {
  it('is its own field under Call to action, filled from the linked Brief\'s legal mandatory with "from the brief"', async () => {
    const { el } = await film(true)
    const labels = [...el.querySelectorAll('label.rm-fieldlabel')].map((l) => l.textContent)
    expect(labels.findIndex((t) => t?.startsWith('Legal'))).toBe(labels.findIndex((t) => t?.startsWith('Call to action')) + 1)
    expect(legalInput(el).value).toBe('Please recycle. Contains 12% fruit juice.')
    expect(legalLabel(el).textContent).toContain('from the brief')
    expect(legalLabel(el).textContent).not.toContain('Link the Brief')
    expect((el.querySelectorAll('label.rm-fieldlabel input')[2] as HTMLInputElement).value).toBe('Find Ferncliff near you') // the call to action stays only that
  })

  it('the person\'s words overwrite it: saved in the document under legal, the mark goes', async () => {
    const { el, store, videoId, show } = await film(true)
    await act(async () => { legalInput(el).focus(); typeInto(legalInput(el), 'Ask a grown-up first.') })
    await act(async () => { legalInput(el).blur() })
    await settle()
    expect(store.get().videos[videoId].end_card).toMatchObject({ cta: 'Find Ferncliff near you', legal: 'Ask a grown-up first.' })
    await show()
    expect(legalInput(el).value).toBe('Ask a grown-up first.')
    expect(legalLabel(el).textContent).not.toContain('from the brief')
  })

  it('with no Brief linked it is empty and says how to fill it in', async () => {
    const { el } = await film(false)
    expect(legalInput(el).value).toBe('')
    expect(legalLabel(el).textContent).toContain('Link the Brief to this film to fill it in.')
    expect(legalLabel(el).textContent).not.toContain('from the brief')
  })

  it('stops at 200 characters, and the stale studio-card sentence is gone', async () => {
    const { el } = await film(true)
    expect(legalInput(el).maxLength).toBe(200)
    expect(el.textContent).toContain('The logo comes from the Brand board when it has one.')
    expect(el.textContent).not.toContain("studio's own card")
  })
})

describe('the end card\'s Headline field (UAT round 3, Harrowgate: it was empty and had to be typed)', () => {
  const headlineInput = (el: Element) => [...el.querySelectorAll('label.rm-fieldlabel')].find((l) => l.textContent?.startsWith('Headline'))!.querySelector('input') as HTMLInputElement

  async function addedCard(mandatories: string[]) {
    const p = await project()
    const store = p.services.doc
    const videoId = mainVideo(store.get())!.id
    const b = briefNode(mandatories)
    await updateDoc(store, (d) => { d.briefs = { [b.id]: b } }, 'brief')
    await linkInput(store, store.get(), { kind: 'brief', id: b.id }, { kind: 'video', id: videoId })
    await editCut.endCard(store, videoId, {}) // what "Add an end card" does
    const data = { videoId, title: 'F', ratio: '16:9', targetS: 15, lengthS: 2, boxes: [], gens: [] } as RoomData
    await p.render(createElement(Inspector, { data, cut: readCut(store.get(), videoId), picked: { kind: 'card' as const }, onPick: () => {}, onChange: () => {}, onFeel: () => {}, onSwap: () => {}, handleShort: () => 1 }))
    await settle()
    return p
  }

  it('starts as the linked Brief\'s end line, and is saved with the card', async () => {
    const { el, services, } = await addedCard(['End line must be "Proper crunch."', 'Legal: Contains wheat.'])
    expect(headlineInput(el).value).toBe('Proper crunch.')
    expect(services.doc.get().videos[mainVideo(services.doc.get())!.id].end_card).toMatchObject({ headline: 'Proper crunch.' })
  })

  it('stays empty when neither the Brief nor the script has a line', async () => {
    const { el } = await addedCard(['No apples'])
    expect(headlineInput(el).value).toBe('')
  })
})
