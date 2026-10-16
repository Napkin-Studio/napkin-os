// @vitest-environment happy-dom
// A canvas picture in the Image editor (features/edit-canvas-pictures.clan): Edit in the picture's own
// bar (not on a drawing), and the editor opened on the picture: its name for a title, Canvas to go back,
// its own shape for the crop, Apply in place, and its versions once it has some.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
vi.mock('../ml/runtime', () => ({ deviceEnv: async () => ({ webgpu: false }) }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext, ShellContext, type Services } from '../app/context'
import type { CanvasController } from '../canvas/controller'
import type { El } from '../canvas/scene'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { asset, id, MAYA, SHA, wasm } from '../test/model'
import { FloatingToolbar } from './Character'
import { ImageEditor } from './ImageEditor'
import { applyPictureEditedStep } from './imageEditor/apply'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google', 'ideogram', 'magnific'] }, quotas: null, projects: 0 }
const NODE = 'node_baby01'

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function world() {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-10-15T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), providerChoice: 'runway', me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await systemUpdate(services.doc, (d) => {
    d.assets[SHA('a')] = asset(SHA('a'), 'image', { origin: 'uploaded', w: 800, h: 1000 })
    const k = id('key')
    d.keys[k] = { id: k, v: 1, field_v: {}, key: 'baby', role: 'character' }
    const r = id('ref')
    d.refs[r] = { id: r, v: 1, field_v: {}, key: 'baby', variant: 'front', role: 'character', asset: SHA('a'), node: NODE }
  })
  await services.doc.flush()
  return { shell, services }
}

function render(w: Awaited<ReturnType<typeof world>>, node: React.ReactElement) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: w.shell }, createElement(ServicesContext.Provider, { value: w.services }, node)))
  })
  return el
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const byText = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const picEl = (customData: unknown) => ({ id: 'P', type: 'image', x: 0, y: 0, width: 300, height: 375, isDeleted: false, frameId: null, customData }) as unknown as El
/** The controller as far as the bar reads it. */
const ctrl = (doc: Services['doc']) => ({
  preview: () => ({ inputs: [{ nodeId: NODE, kind: 'pic' }], drawings: 0, notes: [], pending: 0, sketch: null }),
  nameOn: (nodeId: string) => Object.values(doc.get().refs).find((r) => r.node === nodeId),
  deletable: (els: El[]) => els,
  liveElements: () => [],
}) as unknown as CanvasController

describe('Edit in a canvas picture’s bar', () => {
  it('opens the picture: a dropped picture and a result have it, a drawing does not', async () => {
    const w = await world()
    const onEdit = vi.fn()
    const bar = (el: El) => createElement(FloatingToolbar, { ctrl: ctrl(w.services.doc), selected: [el], toView: (p) => p, onDelete: () => {}, onPlace: () => {}, limits: { max: 4, characters: 3 }, onEdit })
    let el = render(w, bar(picEl({ kind: 'pic', id: NODE, asset: SHA('a') })))
    expect(byText(el, '@baby_front')).toBeTruthy()
    act(() => byText(el, 'Edit')!.click())
    expect(onEdit).toHaveBeenCalledWith(NODE)
    act(() => root?.unmount())
    el = render(w, bar(picEl({ kind: 'gen', id: 'job_b', op: 'generate', parentIds: [], state: 'completed', asset: SHA('a') })))
    expect(byText(el, 'Edit')).toBeTruthy()
    act(() => root?.unmount())
    el = render(w, bar(picEl({ kind: 'drawn', id: 'node_d', asset: SHA('a') })))
    expect(byText(el, 'Edit')).toBeUndefined()
  })
})

describe('the Image editor on a canvas picture', () => {
  it('is titled by its name, goes back to the canvas, keeps the picture’s shape and applies in place', async () => {
    const w = await world()
    const onBack = vi.fn()
    const el = render(w, createElement(ImageEditor, { target: { kind: 'picture', nodeId: NODE }, picture: { sha: SHA('a'), w: 800, h: 1000 }, onBack }))
    await settle()
    expect(el.querySelector('.ptbar')?.textContent).toContain('@baby_front')
    // The decluttered bar (topbar-declutter) may fold the meta away at this width; never a ratio lock for a picture.
    expect(el.querySelector('.ptbar')?.textContent ?? '').not.toContain('locked')
    expect(el.querySelector('[aria-label="Crop, kept at its shape (C)"]')).not.toBeNull()
    expect(el.textContent).toContain('Applying makes v2 and puts it in place on the canvas')
    expect(el.textContent).not.toContain('Delete v1')
    act(() => byText(el, 'Canvas')?.click() ?? (el.querySelector('.ptbar button') as HTMLButtonElement).click())
    expect(onBack).toHaveBeenCalled()
  })

  it('after Apply: v2 open, with v1 as it was in its versions', async () => {
    const w = await world()
    await applyPictureEditedStep(w.services.doc, { nodeId: NODE, sha: SHA('a'), w: 800, h: 1000 }, { sha: SHA('b'), bytes: 10, w: 800, h: 1000, edits: [{ op: 'fill' }] })
    const el = render(w, createElement(ImageEditor, { target: { kind: 'picture', nodeId: NODE }, picture: { sha: SHA('b') }, onBack: () => {} }))
    await settle()
    const v = [...el.querySelectorAll('button')].find((b) => b.classList.contains('ie-vbtn'))!
    expect(v.textContent).toContain('v2 of 2')
    act(() => v.click())
    const rows = [...document.querySelectorAll('.ie-vrow')].map((r) => r.textContent)
    expect(rows[0]).toContain('v1 · as it was on the canvas')
    expect(rows[1]).toContain('v2 · edited · open now')
  })
})
