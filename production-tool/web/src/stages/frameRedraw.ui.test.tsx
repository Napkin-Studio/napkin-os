// @vitest-environment happy-dom
// Change this frame: Edit parts or Redraw frame, on the Storyboard card and in the Image editor
// (features/frame-edit-or-redraw.clan, mock frame-edit-or-redraw-v2): the switch, its hint and price, Dex's
// recast ask before anything is paid, the redraw's result, the no-change card, and the Image editor's offer.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext, type Services } from '../app/context'
import { Router, type HistoryLike } from '../app/route'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addFrame, addShots, MAYA, seedStages, wasm } from '../test/model'
import { putBlob } from '../lib/blobs'
import { jobsList } from '../model/selectors'
import { ImageEditor } from './ImageEditor'
import { Storyboard } from './Storyboard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google', 'ideogram', 'magnific'] }, quotas: null, projects: 0 }
const SWAP = 'An Indian seller is selling the cloth to Nigerian buyers'

/** A router on an in-memory history (as script/page.test.tsx's). */
function memoryRouter(): Router {
  const location = { pathname: '/', search: '' }
  const history: HistoryLike = {
    pushState: (_s, _u, url) => { const [p, q] = String(url).split('?'); location.pathname = p; location.search = q ? `?${q}` : '' },
    replaceState: (_s, _u, url) => { const [p, q] = String(url).split('?'); location.pathname = p; location.search = q ? `?${q}` : '' },
    back: () => {},
  } as HistoryLike
  return new Router({ base: '/', history, location, win: { addEventListener: () => {} } as never })
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function mount(view: 'storyboard' | 'editor') {
  let t = 1_000_000
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-11-17T10:00:00Z'))
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), providerChoice: 'runway', me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [{ blob: new Blob([`pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 16, h: 9 }] } }, now: () => t, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await seedStages(services.doc)
  let shots: string[] = []
  const pics = await Promise.all([0, 1, 2].map((i) => putBlob(new Blob([`frame-${i}`], { type: 'image/png' }))))
  await systemUpdate(services.doc, (d) => {
    const s = addShots(d, 3, { camera: { size: 'medium_wide', angle: 'eye_level' } })
    for (const [i, shot] of s.entries()) {
      addFrame(d, shot, pics[i], { pick: true })
      d.assets[pics[i]] = { ...d.assets[pics[i]], w: 1344, h: 768 }
    }
    shots = s.map((x) => x.id)
  })
  await services.doc.flush()
  const onBack = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell }, createElement(RouterContext.Provider, { value: memoryRouter() }, createElement(ServicesContext.Provider, { value: services },
      view === 'storyboard' ? createElement(Storyboard) : createElement(ImageEditor, { target: { kind: 'shot', shotId: shots[1] }, onBack })))))
  })
  await settle()
  const land = async () => {
    t += 5000
    await act(async () => {
      await services.runner.pollNow()
      await relay.settled()
      await services.runner.pollNow()
      await new Promise((r) => setTimeout(r, 30))
    })
  }
  return { el, services, shots, onBack, land }
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const buttons = () => [...document.querySelectorAll('button')]
const byText = (text: string | RegExp) => buttons().find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')))
const card = (el: HTMLElement, n: number) => el.querySelector(`[aria-label="Shot ${n}"]`) as HTMLElement

async function openChange(el: HTMLElement, n = 2) {
  const more = document.querySelector(`[aria-label="More for shot ${n}"]`) as HTMLButtonElement
  act(() => more.click())
  await settle()
  act(() => byText('Change this frame')!.click())
  await settle()
  return card(el, n).querySelector('.sb-change') as HTMLElement
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const pressed = (box: HTMLElement) => [...box.querySelectorAll('.sb-mode button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent

describe('the switch on the Storyboard card', () => {
  it('starts on Edit parts with its hint and no price; Redraw frame changes the hint, placeholder and button', async () => {
    const { el } = await mount('storyboard')
    const box = await openChange(el)
    expect(pressed(box)).toBe('Edit parts')
    expect(box.querySelector('.sb-modehint')?.textContent).toBe('Keeps this picture and changes only what you name. Everyone and everything else stays as it is.')
    expect((box.querySelector('input') as HTMLInputElement).placeholder).toBe('Make her scarf red')
    act(() => byText('Redraw frame')!.click())
    expect(pressed(box)).toBe('Redraw frame')
    expect(box.querySelector('.sb-modehint')?.textContent).toMatch(/^Draws frame 2 again from the shot\./)
    expect((box.querySelector('input') as HTMLInputElement).placeholder).toBe('An Indian seller, Nigerian buyers in the line')
    type(box.querySelector('input')!, SWAP)
    expect(box.querySelector('.row .btn.sm')?.textContent).toBe('Redraw')
  })

  it('Redraw sends a redraw, shows the Director agent redrawing, then the result with Kept and New, and Redo keeps the mode', async () => {
    const { el, services, land } = await mount('storyboard')
    const box = await openChange(el)
    act(() => byText('Redraw frame')!.click())
    type(box.querySelector('input')!, SWAP)
    await act(async () => { byText('Redraw')!.click() })
    await settle()
    const job = jobsList(services.doc.get()).find((j) => j.op === 'frame_edit')!
    expect(job.purpose).toBe('frame_edit redraw')
    expect(services.ui.get().jobs[job.id].request!.input.mode).toBe('redraw')
    expect(card(el, 2).querySelector('.sb-running')?.textContent).toMatch(/The Director agent is redrawing frame 2/)
    expect([...card(el, 2).querySelectorAll('.sb-mode button')].every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    await land()
    await land()
    const result = card(el, 2).querySelector('.sb-result')!
    expect(result.textContent).toMatch(/The Director agent redrew frame 2 from the shot\./)
    expect(result.querySelector('.sb-keeps')?.textContent).toBe(`Keptthe place, the light, Medium wide, Eye levelNew${SWAP}.`)
    expect([...result.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Apply', 'Keep both', 'Discard'])
    expect(pressed(card(el, 2))).toBe('Redraw frame')
    expect(byText('Redo')).toBeTruthy()
  })

  it('an edit that swaps the people asks before anything is paid; Redraw frame instead goes on as a redraw', async () => {
    const { el, services, land } = await mount('storyboard')
    const box = await openChange(el)
    type(box.querySelector('input')!, SWAP)
    await act(async () => { byText('Send')!.click() })
    await land()
    await land()
    const ask = card(el, 2).querySelector('.sb-ask')!
    expect(ask.textContent).toMatch(/This changes who is in the picture\./)
    expect(ask.textContent).toMatch(/Nothing paid yet/)
    expect([...ask.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Redraw frame instead', 'Edit anyway'])
    expect(document.querySelector('.askcard')).toBeNull() // the card carries the ask; no second one
    await act(async () => { byText('Redraw frame instead')!.click() })
    expect(pressed(card(el, 2))).toBe('Redraw frame')
    await land()
    await land()
    const job = jobsList(services.doc.get()).find((j) => j.op === 'frame_edit')!
    expect((job.director?.output as { frameEdit?: { reading: string } }).frameEdit?.reading).toBe('redraw')
    expect(card(el, 2).querySelector('.sb-result')?.textContent).toMatch(/The Director agent redrew frame 2/)
  })

  it('an edit that came back the same offers no Apply, says nothing changed (no price) and offers Redraw frame', async () => {
    const { el, land } = await mount('storyboard')
    const box = await openChange(el)
    type(box.querySelector('input')!, 'make her scarf red [same]')
    await act(async () => { byText('Send')!.click() })
    await land()
    await land()
    const none = card(el, 2).querySelector('.sb-nochange')!
    expect(none.textContent).toMatch(/This edit came back the same as frame 2\./)
    expect(none.textContent).toMatch(/Nothing in it changed/)
    expect(none.textContent).not.toMatch(/\$|charged/)
    expect([...none.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Redraw frame', 'Discard'])
    expect(card(el, 2).querySelector('.sb-result')).toBeNull()
  })

  it('an ordinary local edit says so, with the way to redraw instead', async () => {
    const { el, land } = await mount('storyboard')
    const box = await openChange(el)
    type(box.querySelector('input')!, 'make her scarf red')
    await act(async () => { byText('Send')!.click() })
    await land()
    await land()
    const result = card(el, 2).querySelector('.sb-result')!
    expect(result.textContent).toMatch(/The Director agent edited frame 2; everything else in it stays\./)
    expect(result.querySelector('.sb-notmeant')?.textContent).toBe('Not what you meant? Redraw the frame with the same words.')
  })
})

describe("the Image editor's Change whole frame on a shot's frame", () => {
  it('when the words swap the people, the Director agent offers Redraw frame N under the field; it hands the words to the Storyboard as a redraw', async () => {
    const { el, services, onBack, land } = await mount('editor')
    const field = el.querySelector('[aria-label="Describe the change to the whole frame"]') as HTMLTextAreaElement
    type(field, SWAP)
    await act(async () => { byText('Change')!.click() })
    await settle()
    const send = [...document.querySelectorAll('.tray-foot button, [role="dialog"] button')].find((b) => b.textContent?.trim() === 'Change') as HTMLButtonElement
    await act(async () => { send.click() })
    await land()
    await land()
    const offer = el.querySelector('.ie-offer')!
    expect(offer.textContent).toMatch(/This changes who is in the picture\./)
    expect(offer.textContent).toMatch(/Redraw frame 2 from the shot instead\?/)
    expect([...offer.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Redraw frame 2', 'Change anyway'])
    const whole = jobsList(services.doc.get()).find((j) => j.op === 'region_edit')!
    expect(services.ui.get().jobs[whole.id].request!.input.shot?.refs).toEqual([])
    await act(async () => { byText('Redraw frame 2')!.click() })
    await settle()
    expect(onBack).toHaveBeenCalled()
    expect(services.doc.get().jobs[whole.id].state).toBe('cancelled')
    const redraw = jobsList(services.doc.get()).find((j) => j.op === 'frame_edit')!
    expect(redraw.purpose).toBe('frame_edit redraw')
    expect(services.ui.get().jobs[redraw.id].request!.input.text).toBe(SWAP)
  })

  it('an ordinary whole-frame change offers nothing, and its tray names the words-only model, never Ideogram', async () => {
    const { el, land } = await mount('editor')
    type(el.querySelector('[aria-label="Describe the change to the whole frame"]') as HTMLTextAreaElement, 'warmer light')
    await act(async () => { byText('Change')!.click() })
    await settle()
    const tray = document.querySelector('.ie-tray')!
    expect(tray.textContent).toContain('Gemini 3 Pro on Runway')
    expect(tray.textContent).not.toContain('Ideogram')
    const send = [...document.querySelectorAll('.tray-foot button, [role="dialog"] button')].find((b) => b.textContent?.trim() === 'Change') as HTMLButtonElement
    await act(async () => { send.click() })
    await land()
    await land()
    expect(el.querySelector('.ie-offer')).toBeNull()
  })
})
