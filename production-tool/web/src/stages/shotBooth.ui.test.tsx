// @vitest-environment happy-dom
// The Storyboard's Booth rule (features/production-new-ui.clan; mock production-new-ui-v2 storyboard, frame,
// states): no Booth with no shot selected; a click on a cell selects the shot and its Booth comes in with its
// crumb, Change this frame, camera and rows; × or Esc puts it down. What the Director agent's Booth held now sits
// where it belongs: his latest note on the sheet, a frame that did not draw on its own cell (Try again, Clear),
// a re-plan's Keep or Remove on the cell.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { RouterContext, ServicesContext, ShellContext, type Services } from '../app/context'
import { Router, type HistoryLike } from '../app/route'
import { SnapshotStore, updateDoc } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { mainStoryboard, shotsOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addFrame, addShots, job, MAYA, seedStages, SHA, wasm } from '../test/model'
import { Storyboard } from './Storyboard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway'] }, quotas: null, projects: 0 }

function memoryRouter(): Router {
  const location = { pathname: '/', search: '' }
  const history = { pushState: () => {}, replaceState: () => {}, back: () => {} } as unknown as HistoryLike
  return new Router({ base: '/', history, location, win: { addEventListener: () => {} } as never })
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

async function mount() {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  const storage = memoryStorage()
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-17T10:00:00Z')), storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  await seedStages(services.doc)
  await updateDoc(services.doc, (d) => { addShots(d, 3, { status: 'planned', action: 'Shot words.', camera: { size: 'medium', angle: 'eye_level' } }) }, 'add shots')
  await services.doc.flush()
  const sb = mainStoryboard(services.doc.get())!.id
  const shots = shotsOf(services.doc.get(), sb).map((s) => s.id)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const render = () => act(() => {
    root ??= createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell }, createElement(RouterContext.Provider, { value: memoryRouter() },
      createElement(ServicesContext.Provider, { value: services }, createElement(Storyboard)))))
  })
  return { services, sb, shots, el, render }
}

const cell = (el: HTMLElement, n: number) => el.querySelector(`[aria-label="Shot ${n}"]`) as HTMLElement
const click = (at: Element) => act(() => { at.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const buttonIn = (at: Element, name: string) => [...at.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement

describe('the Storyboard Booth on a selected shot', () => {
  it('shows no Booth until a shot is selected; then its crumb, Change this frame and rows; × and Esc put it down', async () => {
    const { el, render } = await mount()
    render()
    await settle()
    expect(el.querySelector('.booth-col')).toBeNull()
    expect(el.querySelector('.booth-edge')).toBeNull()
    click(cell(el, 2).querySelector('.sb-words')!)
    await settle()
    const booth = el.querySelector('[data-shot-booth]') as HTMLElement
    expect(booth).toBeTruthy()
    expect(cell(el, 2).classList.contains('on')).toBe(true)
    expect(booth.querySelector('.sp-crumb')?.textContent).toMatch(/Storyboard›Shot 2/)
    expect([...booth.querySelectorAll('.bsec h4')].map((h) => h.firstChild?.textContent)).toEqual(['Change this frame', 'Camera ', 'This shot'])
    expect(booth.textContent).not.toMatch(/\$|credits/)
    act(() => buttonIn(booth, '×').click())
    await settle()
    expect(el.querySelector('[data-shot-booth]')).toBeNull()
    click(cell(el, 3).querySelector('.sb-words')!)
    await settle()
    expect(el.querySelector('[data-shot-booth]')).toBeTruthy()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await settle()
    expect(el.querySelector('[data-shot-booth]')).toBeNull()
  })

  it('Delete with a shot selected deletes it, whatever has the focus, and Undo brings it back (UAT round 4 A23)', async () => {
    const { el, render, services, sb } = await mount()
    render()
    await settle()
    click(cell(el, 2).querySelector('.sb-words')!)
    await settle()
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) })
    await settle()
    expect(shotsOf(services.doc.get(), sb)).toHaveLength(2)
    const note = el.querySelector('.sb-deleted') as HTMLElement
    expect(note.textContent).toContain('Deleted shot 2.')
    act(() => buttonIn(note, 'Undo').click())
    await settle()
    expect(shotsOf(services.doc.get(), sb)).toHaveLength(3)
  })

  it('What the Camera agent will send shows all of Your words (re-test N-I)', async () => {
    const { el, render, services, shots } = await mount()
    await updateDoc(services.doc, (d) => { addFrame(d, d.shots[shots[0]], SHA('a'), { pick: true }) }, 'a frame')
    render()
    await settle()
    click(cell(el, 1).querySelector('.sb-words')!)
    await settle()
    const booth = el.querySelector('[data-shot-booth]') as HTMLElement
    const field = booth.querySelector('input[aria-label="What to change in this frame"]') as HTMLInputElement
    const words = 'The blue kettle steams on the yellow stove in the centre, rain on the window behind, no people in the room'
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, words)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await settle()
    const row = [...booth.querySelectorAll('.disc-line li')].find((li) => li.textContent?.startsWith('Your words'))
    expect(row?.textContent).toBe(`Your words · “${words}”`)
  })

  it("changes the camera and the length from the shot's Booth, through the real store", async () => {
    const { el, render, services, shots } = await mount()
    render()
    await settle()
    click(cell(el, 1).querySelector('.sb-words')!)
    await settle()
    const booth = el.querySelector('[data-shot-booth]') as HTMLElement
    const size = booth.querySelector('select[aria-label="Size"]') as HTMLSelectElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(size, 'close')
      size.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await until(() => services.doc.get().shots[shots[0]].camera.size === 'close')
    expect(services.doc.get().shots[shots[0]].camera.size).toBe('close')
    const was = services.doc.get().shots[shots[0]].duration_s
    act(() => (booth.querySelector('[aria-label="Shot 1 longer"]') as HTMLButtonElement).click())
    await until(() => services.doc.get().shots[shots[0]].duration_s === was + 0.5)
    expect(services.doc.get().shots[shots[0]].duration_s).toBe(was + 0.5)
  })

  it("puts a frame that did not draw on its own cell, with Try again and Clear, and the Director agent's note on the sheet", async () => {
    const { el, render, services, shots, sb } = await mount()
    await updateDoc(services.doc, (d) => {
      const j = job(d, 'frame', [], null, { state: 'failed', node: { kind: 'shot', id: shots[2] }, purpose: 'frame', crew: 'dex', error: { code: 'invalid_input', message: '@mira is not one of the images this step was given.', retryable: false } })
      d.jobs[j.id] = j
    }, 'fail')
    const docId = services.clan!.documentId()
    await services.clan!.record('plan 3 shots on the storyboard', undefined, { agent: 'dex', targets: [`${docId}#storyboards[${sb}]`] })
    render()
    await until(() => !!el.querySelector('.sheet-note .wl') && !!el.querySelector('.sb-failed'))
    expect(el.querySelector('.sheet-note .wl')?.textContent).toBe('Director agent: Planned 3 shots on the storyboard.')
    const fail = cell(el, 3).querySelector('.sb-failed') as HTMLElement
    expect(fail.textContent).toMatch(/Couldn’t draw this frame/)
    expect(fail.textContent).toMatch(/@mira is not one of the images/)
    expect([...fail.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again', 'Clear'])
    act(() => buttonIn(fail, 'Clear').click())
    await until(() => !el.querySelector('.sb-failed'))
    expect(el.querySelector('.sb-failed')).toBeNull()
    expect(el.querySelector('.booth-col')).toBeNull()
  })
})
