// @vitest-environment happy-dom
// The Image editor to ui-behaviour 3.12 and its mock (features/image-editor.clan): the eight tools and
// their keys, the brush strip, the edits list with its own undo, layers, the four actions with no price,
// Before / After, the versions menu's words and the ask before leaving the frame.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
vi.mock('../ml/runtime', () => ({ deviceEnv: async () => ({ webgpu: false }) }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext, ShellContext, type Services } from '../app/context'
import { SnapshotStore, systemUpdate } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addFrame, addShots, job, MAYA, SHA, wasm } from '../test/model'
import type { EditSession } from './imageEditor/edits'
import { ImageEditor } from './ImageEditor'
import type { EditTarget } from '../model/purpose'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google', 'ideogram', 'magnific'] }, quotas: null, projects: 0 }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function open(session?: (frameId: string) => EditSession, makers = ['runway', 'google', 'ideogram', 'magnific']) {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage, () => new Date('2026-10-15T10:00:00Z'))
  // Routed as live (Runway), so the agency's makers decide what runs.
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), providerChoice: 'runway', me: { ...ME, allow: { claude: true, makers } } }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 2000, persistKey: null })
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services: Services = shell.get().session!.services
  let ids = { shots: [] as string[], frame: '' }
  await systemUpdate(services.doc, (d) => {
    const shots = addShots(d, 3, { camera: { size: 'insert' } })
    const f = addFrame(d, shots[1], SHA('a'), { pick: true })
    d.assets[SHA('a')] = { ...d.assets[SHA('a')], w: 1344, h: 768 }
    ids = { shots: shots.map((s) => s.id), frame: f.id }
  })
  await services.doc.flush()
  if (session) services.ui.update((u) => { u.imageEdits = { [ids.frame]: session(ids.frame) } })
  const onShot = vi.fn()
  const onBack = vi.fn()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    root.render(createElement(ShellContext.Provider, { value: shell },
      createElement(ServicesContext.Provider, { value: services }, createElement(ImageEditor, { target: { kind: 'shot', shotId: ids.shots[1] }, onBack, onTarget: (t: EditTarget) => onShot(t.kind === 'shot' ? t.shotId : t.nodeId) }))))
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return { el, services, ids, onShot, onBack }
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')]
const byLabel = (el: HTMLElement, label: string | RegExp) => buttons(el).find((b) => (typeof label === 'string' ? b.getAttribute('aria-label') === label : label.test(b.getAttribute('aria-label') ?? '')))
const byText = (el: HTMLElement, text: string) => buttons(el).find((b) => b.textContent?.trim() === text)
const stroke = { t: 'brush' as const, mode: 'add' as const, r: 0.03, soft: 0.2, pts: [{ x: 0.5, y: 0.5 }] }

describe('the tools (3.12)', () => {
  it('shows the eight tools with their keys, the crop kept at the ratio', async () => {
    const { el } = await open()
    const tools = [...el.querySelectorAll('[role="toolbar"][aria-label="Image tools"] button')].map((b) => b.getAttribute('aria-label'))
    expect(tools).toEqual(['Select (V)', 'Click-select, AI finds the object (A)', 'Brush mask (B)', 'Lasso (L)', 'Eraser (E)', 'Text (T)',
      'Crop, kept at 16:9 (C)', 'Hand, pan the frame (H)'])
    expect(el.querySelector('[role="tooltip"]')?.textContent).toBe('Brush mask B')
  })
  it('a key chooses its tool, Space holds the Hand, and [ ] change the brush size', async () => {
    const { el } = await open()
    const pressed = () => el.querySelector('[aria-label="Image tools"] button[aria-pressed="true"]')?.getAttribute('aria-label')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l' })) })
    expect(pressed()).toBe('Lasso (L)')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })) })
    expect(pressed()).toBe('Hand, pan the frame (H)')
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })) })
    expect(pressed()).toBe('Lasso (L)')
    const size = () => (el.querySelector('input[aria-label="Brush size"]') as HTMLInputElement).value
    expect(size()).toBe('48')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ']' })) })
    expect(size()).toBe('54')
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' })) })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '[' })) })
    expect(size()).toBe('42')
  })
  it('the brush strip has the mask name, Size, Soft, Add/Subtract, Snap to cut-out and Clear mask', async () => {
    const { el } = await open()
    const strip = el.querySelector('[aria-label="Brush mask options"]')!
    expect(strip.querySelector('b')?.textContent).toBe('New mask') // until the first paint (features/image-editor-masks-layers.clan)
    for (const l of ['Brush size', 'Brush softness']) expect(strip.querySelector(`input[aria-label="${l}"]`)).not.toBeNull()
    expect([...strip.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Add', 'Subtract', 'Snap to cut-out', 'Clear mask'])
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' })) })
    expect(el.querySelector('[aria-label="Brush mask options"]')).toBeNull()
  })
  it('says the mask legend under the stage', async () => {
    const { el } = await open()
    expect(el.textContent).toContain('Mask: blue paint marks what changes')
  })
})

describe('the edits and layers', () => {
  const painted = (frameId: string): EditSession => {
    void frameId
    return { edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }, { id: 't1', kind: 'text', text: 'Drink the morning.', x: 0.05, y: 0.86, size: 0.06 }], hidden: [], active: 'm1' }
  }
  it('lists each edit numbered with its own undo, names the next step and counts what is not applied', async () => {
    const { el } = await open(painted)
    const items = [...el.querySelectorAll('.ie-elist li')].map((li) => li.textContent?.replace('↶', '').trim())
    expect(items).toEqual(['1 Mask 1 · painting', '2 Text "Drink the morning."', 'Next: Fill Mask 1'])
    expect(el.textContent).toContain('2 edits not applied')
    expect(el.textContent).toContain('Nothing is sent until you run an action. v1 is never changed.')
    expect(byText(el, 'Apply as new version')?.disabled).toBe(false)
    act(() => byLabel(el, 'Undo edit 2, Text "Drink the morning."')!.click())
    expect(el.textContent).toContain('1 edit not applied')
  })
  it('layers run text, masks, then the locked frame, each can be hidden', async () => {
    const { el } = await open(painted)
    const names = [...el.querySelectorAll('.ie-layer .ie-lname > span:first-child')].map((s) => s.textContent)
    expect(names).toEqual(['Text', 'Mask 1', 'Frame'])
    expect(el.querySelector('.ie-layer [aria-label="Locked"]')).not.toBeNull()
    act(() => byLabel(el, 'Hide Text')!.click())
    expect(byLabel(el, 'Show Text')).toBeTruthy()
  })
  it('Before labels the frame as saved; After brings the edits back', async () => {
    const { el } = await open(painted)
    act(() => byText(el, 'Before')!.click())
    expect(el.querySelector('.ie-before')?.textContent).toBe('Before · v1 as saved')
    expect(el.querySelector('.ie-text')).toBeNull()
    act(() => byText(el, 'After')!.click())
    expect(el.querySelector('.ie-text')?.textContent).toBe('Drink the morning.')
  })
  it('asks before moving to another frame with edits not applied, and keeps them for later', async () => {
    const { el, onShot, services, ids } = await open(painted)
    act(() => byText(el, 'Frame 3 · Insert →')!.click())
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain('Keep the 2 edits for later, or discard them?')
    expect(onShot).not.toHaveBeenCalled()
    act(() => byText(el, 'Keep for later')!.click())
    expect(onShot).toHaveBeenCalledWith(ids.shots[2])
    expect(services.ui.get().imageEdits?.[ids.frame]?.edits).toHaveLength(2)
  })
  it('discarding drops the edits', async () => {
    const { el, onShot, services, ids } = await open(painted)
    act(() => byText(el, '← Frame 1 · Insert')!.click())
    act(() => byText(el, 'Discard')!.click())
    expect(onShot).toHaveBeenCalledWith(ids.shots[0])
    expect(services.ui.get().imageEdits?.[ids.frame]).toBeUndefined()
  })
  it('the versions menu says what Apply makes', async () => {
    const { el } = await open(painted)
    act(() => byText(el, 'v1 of 1 ▼')!.click())
    expect(document.body.textContent).toContain('Apply saves your 2 edits as v2. v1 stays.')
  })
})

describe("arriving from Jude's brand flag", () => {
  it('shows the rule at the top of the Edits panel, and nothing runs', async () => {
    const { el, services, ids } = await open()
    await act(async () => {
      await systemUpdate(services.doc, (d) => {
        d.checks.check_01K7A00000000000000000003A = { id: 'check_01K7A00000000000000000003A', v: 1, field_v: {}, target: { kind: 'frame', id: ids.frame },
          crew: 'jude', result: 'flag', reason_code: 'logo_clear_space', note: 'Logo clear space: one bottle-cap height' }
      })
    })
    expect(el.querySelector('.ie-edits [role="note"]')?.textContent).toContain('Logo clear space: one bottle-cap height')
    expect(el.textContent).not.toContain('edits not applied')
  })
})

describe('the actions (3.12), none with a price', () => {
  it('offers Remove background, Fill area, Change whole frame and Upscale with its output size', async () => {
    const { el } = await open()
    const actions = el.querySelector('[aria-label="Actions"]')!
    const titles = [...actions.querySelectorAll('.ie-action b')].map((b) => b.textContent)
    expect(titles).toEqual(['Remove background', 'Fill area', 'Change whole frame', 'Upscale'])
    expect(actions.textContent).toContain('On our server (no WebGPU here)')
    expect(actions.textContent).toContain('→ 2688 × 1536')
    act(() => byText(el, '4×')!.click())
    expect(actions.textContent).toContain('→ 5376 × 3072')
    expect(actions.textContent).toContain('Only the blue area changes')
    expect(actions.textContent).not.toMatch(/\$|credit|cost|price/i)
  })
  it('an agency with Magnific and Ideogram off: Upscale says why and cannot run', async () => {
    const { el } = await open(undefined, ['runway', 'google'])
    const actions = el.querySelector('[aria-label="Actions"]')!
    expect(actions.textContent).toContain('Magnific, the upscaler, is off for your agency')
    expect(byText(el, 'Upscale')?.disabled).toBe(true)
    // Fill area still runs, on Gemini 3 Pro (the box drawn), and the tray says so
    const box = el.querySelector('#ie-fill') as HTMLTextAreaElement
    expect(box.disabled).toBe(true)
  })
  it('with Ideogram off the fill goes to Gemini 3 Pro, and the tray names it', async () => {
    const { el } = await open(() => ({ edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }], hidden: [], active: 'm1' }), ['runway', 'google'])
    const box = el.querySelector('#ie-fill') as HTMLTextAreaElement
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => { set.call(box, 'drops'); box.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => byText(el, 'Fill area')!.click())
    expect(document.querySelector('.ie-tray')?.textContent).toContain('Gemini 3 Pro on Runway')
  })
  it('Fill area waits for a painted mask and words', async () => {
    const { el } = await open()
    expect(byText(el, 'Fill area')?.disabled).toBe(true)
  })
  it('a painted mask turns Fill area on, and its send tray names the model on Runway with no price', async () => {
    const { el } = await open(() => ({ edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }], hidden: [], active: 'm1' }))
    const box = el.querySelector('#ie-fill') as HTMLTextAreaElement
    expect(box.disabled).toBe(false)
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => { set.call(box, 'add condensation drops'); box.dispatchEvent(new Event('input', { bubbles: true })) })
    act(() => byText(el, 'Fill area')!.click())
    const tray = document.querySelector('.ie-tray')!
    expect(tray.textContent).toContain('What Rhea will send to fill the area')
    expect(tray.textContent).toContain('Mask 1')
    expect(tray.textContent).toContain('"add condensation drops"')
    expect(tray.textContent).toContain('Ideogram 4.5 on Runway')
    expect(tray.textContent).not.toMatch(/\$|credit|cost|price/i)
  })
})

describe('a job in its Edits row (features/image-editor-masks-layers.clan)', () => {
  it("an 'uncertain' job reads as did not work and holds nothing: no stripes, the actions on, Try again in its row", async () => {
    const { el, services, ids } = await open(() => ({ edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }], hidden: [], active: 'm1' }))
    let jobId = ''
    await act(async () => {
      await systemUpdate(services.doc, (d) => {
        const j = job(d, 'region_edit', [], null, { state: 'uncertain', crew: 'rhea' })
        d.jobs[j.id] = j
        jobId = j.id
      })
      services.ui.update((u) => {
        const s = u.imageEdits![ids.frame]
        u.imageEdits = { [ids.frame]: { ...s, edits: [...s.edits, { id: 'f1', kind: 'fill', maskId: 'm1', words: 'drops', keepOutside: true, jobId }] } }
      })
      await new Promise((r) => setTimeout(r, 20))
    })
    const row = [...el.querySelectorAll('.ie-elist li')].find((li) => li.textContent?.includes('Fill Mask 1'))!
    expect(row.textContent).toContain('did not work')
    expect(row.textContent).toContain('Try again')
    expect(el.querySelector('.ie-pending')).toBeNull()
    expect(el.querySelector('.ie-job')).toBeNull()
    expect(byText(el, 'Apply as new version')?.disabled).toBe(false)
    expect(byText(el, 'Remove')?.disabled).toBe(false)
  })
})

describe('hidden layers (features/image-editor-masks-layers.clan)', () => {
  it('a hidden mask cannot be filled and says why', async () => {
    const { el } = await open(() => ({ edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }], hidden: ['m1'], active: 'm1' }))
    expect((el.querySelector('#ie-fill') as HTMLTextAreaElement).disabled).toBe(true)
    expect(el.textContent).toContain('Mask 1 is hidden. Show it to fill.')
  })
  it('the pill counts hidden layers apart', async () => {
    const { el } = await open(() => ({ edits: [{ id: 'm1', kind: 'mask', name: 'Mask 1', ops: [stroke] }, { id: 't1', kind: 'text', text: 'Hi', x: 0.1, y: 0.1, size: 0.06 }], hidden: ['t1'], active: 'm1' }))
    expect(el.querySelector('.ie-pill .ie-n-long')?.textContent).toBe('1 edit not applied · 1 hidden layer is left out')
  })
})
