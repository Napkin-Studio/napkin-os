// @vitest-environment happy-dom
// Apply keeps the edits (fix/editor-apply-keeps-edits; features/image-editor-masks-layers.clan): the owner
// filled or removed an area, saw the result, pressed Apply, and v2 came back pixel-identical to v1. A fill
// is cut by its mask when Apply composes, and the mask had changed after the result arrived (Clear mask,
// ⌘Z or a Subtract stroke on the still-active mask), while the stage kept its earlier picture. Here a
// software compositor stands in for the canvas (happy-dom has none) and reads which picture each pixel
// of v2 comes from, through the editor's own plan and mask.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))

/** Each saved picture: which picture each of its pixels comes from. */
const composed: { w: number; h: number; at: (fx: number, fy: number) => string }[] = []
vi.mock('./imageEditor/compose', async (orig) => {
  const real = await orig<typeof import('./imageEditor/compose')>()
  const { rasterize } = await import('./imageEditor/mask')
  let n = 0
  return {
    ...real,
    compose: async (p: import('./imageEditor/compose').Plan, _image: unknown, mask?: (id: string, w: number, h: number) => Uint8Array) => {
      const layers: { sha: string; m?: Uint8Array }[] = []
      for (const st of p.steps) {
        if (st.kind === 'base') layers.push({ sha: st.pic.sha })
        else if (st.kind === 'fill') {
          const ops = (st as { ops?: import('./imageEditor/edits').MaskOp[] }).ops
          const m = ops ? rasterize(ops, p.w, p.h) : mask!((st as unknown as { maskId: string }).maskId, p.w, p.h)
          layers.push({ sha: st.pic.sha, ...(st.keepOutside ? { m } : {}) })
        }
      }
      const at = (fx: number, fy: number) => {
        const i = Math.floor(fy * (p.h - 1)) * p.w + Math.floor(fx * (p.w - 1))
        let got = 'transparent'
        for (const l of layers) if (!l.m || l.m[i] >= 128) got = l.sha
        return got
      }
      return { width: p.w, height: p.h, at } as unknown as HTMLCanvasElement
    },
    // What is saved (Apply's picture, or an action's input): recorded here, the stage's own draws are not.
    toPng: async (c: { width: number; height: number; at: (fx: number, fy: number) => string }) => {
      composed.push({ w: c.width, h: c.height, at: c.at })
      return new Blob([`composed ${++n}`], { type: 'image/png' })
    },
  }
})

import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext, ShellContext, type Services } from '../app/context'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { putBlobAs } from '../lib/blobs'
import { ModelStore } from '../model/store'
import { currentFrame, currentPictureFrame } from '../model/selectors'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addFrame, addShots, asset, job, MAYA, SHA, wasm } from '../test/model'
import type { EditSession } from './imageEditor/edits'
import { ImageEditor } from './ImageEditor'
import type { EditTarget } from '../model/purpose'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google', 'ideogram', 'magnific'] }, quotas: null, projects: 0 }
const NODE = 'node_baby01'
const V1 = SHA('a')
const RESULT = SHA('b')
/** A stroke over the middle of the picture. */
const stroke = { t: 'brush' as const, mode: 'add' as const, r: 0.08, soft: 0, pts: [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }] }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  composed.length = 0
})

type Kind = 'shot' | 'picture'

/** The editor open on a storyboard frame or a canvas picture, with a fill (or remove) whose job is done. */
async function open(kind: Kind, opts: { remove?: boolean; jobState?: 'completed' | 'failed' } = {}) {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-10-15T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), providerChoice: 'runway', me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await putBlobAs(V1, new Blob(['v1'], { type: 'image/png' }))
  await putBlobAs(RESULT, new Blob(['result'], { type: 'image/png' }))
  let shotId = ''
  let jobId = ''
  await systemUpdate(services.doc, (d) => {
    if (kind === 'shot') {
      const shots = addShots(d, 2)
      addFrame(d, shots[0], V1, { pick: true })
      shotId = shots[0].id
    } else {
      const k = 'key_01K7A00000000000000000000K'
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'baby', role: 'character' }
      const r = 'ref_01K7A00000000000000000000R'
      d.refs[r] = { id: r, v: 1, field_v: {}, key: 'baby', variant: 'front', role: 'character', asset: V1, node: NODE }
    }
    d.assets[V1] = asset(V1, 'image', { w: 400, h: 300 })
    d.assets[RESULT] = asset(RESULT, 'image', { w: 400, h: 300 })
    const j = job(d, 'region_edit', [V1], RESULT, { state: opts.jobState ?? 'completed', crew: 'rhea' })
    d.jobs[j.id] = j
    jobId = j.id
  })
  await services.doc.flush()
  const target: EditTarget = kind === 'shot' ? { kind: 'shot', shotId } : { kind: 'picture', nodeId: NODE }
  const key = kind === 'shot' ? currentFrame(services.doc.get(), services.doc.get().shots[shotId])!.id : NODE
  const session: EditSession = {
    edits: [
      { id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] },
      { id: 'f1', kind: 'fill', maskId: 'm1', ops: [stroke], words: opts.remove ? '' : 'a red balloon', keepOutside: true, jobId, ...(opts.remove ? { remove: true as const } : {}) },
    ] as EditSession['edits'],
    hidden: [],
    active: 'm1',
  }
  services.ui.update((u) => { u.imageEdits = { [key]: session } })
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell }, createElement(ServicesContext.Provider, { value: services },
      createElement(ImageEditor, { target, ...(kind === 'picture' ? { picture: { sha: V1, w: 400, h: 300 } } : {}), onBack: () => {} }))))
  })
  await settle()
  const saved = () => (kind === 'shot' ? currentFrame(services.doc.get(), services.doc.get().shots[shotId]) : currentPictureFrame(services.doc.get(), NODE))
  return { el, services, saved, jobId }
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const byText = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const apply = async (el: HTMLElement) => {
  act(() => byText(el, 'Apply as new version')!.click())
  await settle()
}

describe('Apply keeps the result in its mask (the owner, 2026-10-16: "I save it, the new pic disappears")', () => {
  for (const kind of ['shot', 'picture'] as Kind[]) {
    for (const remove of [false, true]) {
      const what = `${remove ? 'Remove' : 'Fill'} on a ${kind === 'shot' ? 'storyboard frame' : 'canvas picture'}`
      it(`${what}: v2 has the result inside the mask and v1 outside`, async () => {
        const { el, saved } = await open(kind, { remove })
        await apply(el)
        const v2 = composed.at(-1)!
        expect(v2.at(0.52, 0.5)).toBe(RESULT)
        expect(v2.at(0.05, 0.05)).toBe(V1)
        expect(saved()?.version).toBe(2)
      })
      it(`${what}: the mask cleared after the result came still applies the result`, async () => {
        const { el, saved } = await open(kind, { remove })
        act(() => byText(el, 'Clear mask')!.click())
        await settle()
        await apply(el)
        expect(el.querySelector('[role="alert"]')).toBeNull()
        expect(composed.at(-1)!.at(0.52, 0.5)).toBe(RESULT)
        expect(saved()?.version).toBe(2)
      })
    }
  }
})

describe('Apply refuses loudly rather than saving an unchanged copy', () => {
  it('a visible result that did not come back: an error naming it, and no v2', async () => {
    const { el, saved } = await open('shot', { jobState: 'failed' })
    await apply(el)
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/^Fill Mask 1: "a red balloon" has no result/)
    expect(saved()?.version).toBe(1)
  })
  it('a painted mask with nothing filled: an error, and no v2', async () => {
    const { el, saved, services } = await open('shot')
    // Only the mask: the fill undone.
    act(() => [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label')?.startsWith('Undo edit 2'))!.click())
    await settle()
    expect(Object.values(services.ui.get().imageEdits ?? {})[0]?.edits.map((e) => e.kind)).toEqual(['mask'])
    await apply(el)
    expect(el.querySelector('[role="alert"]')?.textContent).toMatch(/Mask 1/)
    expect(saved()?.version).toBe(1)
  })
})

describe('Before and After compare the right pictures', () => {
  const shownSrc = (el: HTMLElement) => el.querySelector<HTMLImageElement>('img.ie-pic')?.getAttribute('src')
  it('with edits: Before is the version as saved; after Apply: Before is v1 and After v2, every press toggling', async () => {
    const { el } = await open('shot')
    act(() => byText(el, 'Before')!.click())
    await settle()
    expect(el.querySelector('.ie-before')?.textContent).toBe('Before · v1 as saved')
    const v1url = shownSrc(el)
    expect(v1url).toBeTruthy()
    act(() => byText(el, 'After')!.click())
    await apply(el)
    for (let i = 0; i < 5; i++) {
      act(() => byText(el, 'Before')!.click())
      await settle()
      expect(byText(el, 'Before')?.getAttribute('aria-pressed'), `press ${i}`).toBe('true')
      expect(el.querySelector('.ie-before')?.textContent).toBe('Before · v1 as saved')
      expect(shownSrc(el)).toBe(v1url)
      act(() => byText(el, 'After')!.click())
      await settle()
      expect(byText(el, 'After')?.getAttribute('aria-pressed')).toBe('true')
      expect(el.querySelector('.ie-before')).toBeNull()
    }
  })
})
