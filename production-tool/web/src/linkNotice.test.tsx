// @vitest-environment happy-dom
// The link notice (owner 2026-11-23, features/uat-flow-fixes.clan): a named picture or the Brief that is not linked into an
// action's node is named by the node's action, with Link it and Run without it. It never links anything itself.

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from './../../clan-store/src'
import { ServicesContext } from './app/context'
import { SnapshotStore, updateDoc } from './doc/store'
import { initialAppUi, type AppUi } from './doc/ui'
import { ModelStore } from './model/store'
import { ProjectIndex } from './projects/projectIndex'
import type { MakeClan } from './projects/session'
import { Shell } from './projects/shell'
import { memoryStorage } from './projects/storage'
import { MockRelay } from './relay/mock'
import { id, MAYA, seedStages, SHA, T, wasm } from './test/model'
import type { ProductionDocument } from './contracts/types'

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
const briefNode = (mandatories: string[]) => ({ id: id('brief'), v: 1, field_v: {}, title: 'Ferncliff brief', source: { document_id: 'doc_1', app_id: 'ie.napkin.brief-maker', data_sha256: SHA('b'), taken: 1, version: 1, at: T, how: 'link' }, spine: { mandatories } }) as unknown as NonNullable<ProductionDocument['briefs']>[string]

import { LinkNotice } from './LinkNotice'
import { noticeWords, resetLinkNotices, unlinkedFor, workingFrom } from './model/unlinked'
import { job } from './test/model'
import { linkInput } from './canvas/nodes/nodes'
import { mainScript, mainStoryboard, mainVideo } from './model/selectors'
import type { Services } from './app/context'

async function seed(services: Services, o: { brief?: boolean; refs?: string[] } = {}) {
  const store = services.doc
  await updateDoc(store, (d) => {
    for (const key of o.refs ?? []) {
      const r = id('ref')
      d.refs[r] = { id: r, v: 1, field_v: {}, key, variant: 'front', role: 'product', asset: SHA('c'), label: key } as unknown as ProductionDocument['refs'][string]
    }
    if (o.brief) { const b = briefNode(['Legal: Please recycle.']); d.briefs = { [b.id]: b } }
  }, 'seed')
  await store.flush()
  const d = store.get()
  return { store, scriptId: mainScript(d)!.id, sbId: mainStoryboard(d)!.id, videoId: mainVideo(d)!.id, refId: Object.keys(d.refs)[0], briefId: Object.keys(d.briefs ?? {})[0] }
}
const button = (el: Element, name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined
const notice = () => document.body.querySelector('.linknote')

describe('the link notice', () => {
  afterEach(() => resetLinkNotices())

  it('names an unlinked picture and says what the action will not do (the mock\'s words)', async () => {
    const { services, render } = await project()
    const { scriptId } = await seed(services, { refs: ['ferncan'] })
    await render(createElement(LinkNotice, { kind: 'script', id: scriptId, style: { left: 0, top: 0 } }))
    await settle()
    expect(notice()?.querySelector('.linknote-text')?.textContent).toBe('@ferncan is not linked to the Script. Plan shots won’t use it.')
    expect(noticeWords('storyboard', ['The Brief'])).toBe('The Brief is not linked to the Storyboard. Drawing won’t use it.')
    expect(noticeWords('video', ['@a', 'The Brief'])).toBe('@a and The Brief are not linked to the Film. Making the film won’t use them.')
  })

  it('shows for the Brief and is not shown when the Brief and the picture are linked into the node', async () => {
    const { services, render } = await project()
    const { store, sbId, scriptId, refId, briefId } = await seed(services, { refs: ['ferncan'], brief: true })
    await render(createElement(LinkNotice, { kind: 'storyboard', id: sbId, style: { left: 0, top: 0 } }))
    await settle()
    expect(notice()?.textContent).toContain('@ferncan and The Brief are not linked to the Storyboard.')
    // linked into the Script that drives it: upstream counts as linked
    await linkInput(store, store.get(), { kind: 'ref', id: refId }, { kind: 'script', id: scriptId })
    await linkInput(store, store.get(), { kind: 'brief', id: briefId }, { kind: 'script', id: scriptId })
    await settle()
    expect(notice()).toBeNull()
  })

  it('steps aside while the action runs on the node, and comes back when it is done (UAT round 4 F21)', async () => {
    const { services, render } = await project()
    const { store, sbId } = await seed(services, { refs: ['ferncan'], brief: true })
    await render(createElement(LinkNotice, { kind: 'storyboard', id: sbId, style: { left: 0, top: 0 } }))
    await settle()
    expect(notice()).not.toBeNull()
    const jobId = id('job')
    await updateDoc(store, (d) => { d.jobs[jobId] = { ...job(d, 'shot_list', [], null, { state: 'submitted' }), id: jobId, purpose: 'shot_list' } }, 'Plan shots')
    await settle()
    expect(workingFrom(store.get(), sbId)).toBe(true)
    expect(notice()).toBeNull()
    await updateDoc(store, (d) => { d.jobs[jobId].state = 'completed' }, 'planned')
    await settle()
    expect(workingFrom(store.get(), sbId)).toBe(false)
    expect(notice()).not.toBeNull()
  })

  it('a project with no named picture and no Brief shows nothing', async () => {
    const { services, render } = await project()
    const { scriptId } = await seed(services)
    await render(createElement(LinkNotice, { kind: 'script', id: scriptId, style: { left: 0, top: 0 } }))
    await settle()
    expect(notice()).toBeNull()
  })

  it('Link it creates the link the person would by hand, and never before it is pressed', async () => {
    const { services, render } = await project()
    const { store, scriptId, refId, briefId } = await seed(services, { refs: ['ferncan'], brief: true })
    await render(createElement(LinkNotice, { kind: 'script', id: scriptId, style: { left: 0, top: 0 } }))
    await settle()
    expect(Object.keys(store.get().links)).toHaveLength(2) // the seed's two stage links only
    await act(async () => { button(notice()!, 'Link it')!.click() })
    await settle()
    const links = Object.values(store.get().links).filter((l) => l.to.id === scriptId)
    expect(links.map((l) => `${l.from.kind}:${l.from.id}`).sort()).toEqual([`brief:${briefId}`, `ref:${refId}`])
    expect(notice()).toBeNull()
  })

  it('Run without it hides the notice for that node and links nothing', async () => {
    const { services, render } = await project()
    const { store, scriptId } = await seed(services, { refs: ['ferncan'] })
    await render(createElement(LinkNotice, { kind: 'script', id: scriptId, style: { left: 0, top: 0 } }))
    await settle()
    await act(async () => { button(notice()!, 'Run without it')!.click() })
    expect(notice()).toBeNull()
    expect(Object.keys(store.get().links)).toHaveLength(2)
  })

  it('the rule: one entry per @key, a key with any view in scope is linked, a mention alone is not a link', async () => {
    const { services } = await project()
    const { store, scriptId, refId } = await seed(services, { refs: ['ferncan', 'maya'] })
    await updateDoc(store, (d) => {
      const r = id('ref')
      d.refs[r] = { id: r, v: 1, field_v: {}, key: 'ferncan', variant: 'side', role: 'product', asset: SHA('d') } as unknown as ProductionDocument['refs'][string]
    }, 'second view')
    expect(unlinkedFor(store.get(), scriptId).refs.map((r) => r.key).sort()).toEqual(['ferncan', 'maya'])
    await linkInput(store, store.get(), { kind: 'ref', id: refId }, { kind: 'script', id: scriptId })
    const linkedKey = store.get().refs[refId].key
    expect(unlinkedFor(store.get(), scriptId).refs.map((r) => r.key)).toEqual(['ferncan', 'maya'].filter((k) => k !== linkedKey))
  })
})
