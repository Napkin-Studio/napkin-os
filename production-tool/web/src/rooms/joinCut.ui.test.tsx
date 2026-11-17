// @vitest-environment happy-dom
// The Make room strip on the real CLAN store (features/join-or-cut-shots.clan, mock join-or-cut-v1): the gap
// toggles join and cut, Fin's note in the Booth takes it back with Undo, ← and → move between gaps and a
// keyboard flip keeps the focus, the tip says what a flip does; a joined box keeps the earlier box's model,
// says when the join is past it, turns Make off, and its two offers (the model that can, the cut) work.

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({ serializeScene: () => '{}' }))
import { ClanDocumentStore } from '../../../clan-store/src'
import { ServicesContext, useConfig, useDoc, useServices, useUi } from '../app/context'
import { CONFIGS } from '../contracts/load'
import type { Config } from '../contracts/types'
import { SnapshotStore, updateDoc } from '../doc/store'
import { undo } from '../doc/undo'
import { separateAll } from '../jobs/runView'
import { initialAppUi, type AppUi } from '../doc/ui'
import { mainStoryboard, mainVideo, shotsOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { ProjectIndex } from '../projects/projectIndex'
import type { MakeClan } from '../projects/session'
import { Shell } from '../projects/shell'
import { memoryStorage } from '../projects/storage'
import { MockRelay } from '../relay/mock'
import { addFrame, addShots, MAYA, SHA, seedStages, wasm } from '../test/model'
import { MakeRoom } from './MakeRoom'
import { roomBoxes, roomGens } from './model'
import { RoomBooth } from './RoomBooth'
import type { Selection } from './Rooms'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
/** The live config with connected video on (the Make room's boxes group shots only with it). */
const ON: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })
const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google', 'alibaba', 'bytedance', 'kuaishou', 'minimax'] }, quotas: null, projects: 0 }

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 330 && !ok(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
}

/** The Make room and its Booth, wired as Rooms wires them (the done note and its Undo). */
function Harness() {
  const doc = useDoc()
  const ui = useUi()
  const { config } = useConfig()
  const { doc: store } = useServices()
  const videoId = mainVideo(doc)!.id
  const boxes = roomBoxes(doc, ui, videoId, config)
  const data = { videoId, title: 'Mira in the rain', ratio: '16:9', targetS: 15, boxes, gens: roomGens(doc, ui, videoId, boxes) }
  const [sel, setSel] = useState<Selection>({})
  const [done, setDone] = useState<{ id: number; text: string } | null>(null)
  return createElement('div', { className: 'rooms' },
    createElement(MakeRoom, { data, shots: shotsOf(doc, mainStoryboard(doc)!.id), sel, onSel: setSel, change: null, onChange: () => {}, onCloseChange: () => {},
      onRoom: () => {}, register: () => () => {}, onDone: (text: string) => setDone((d) => ({ id: (d?.id ?? 0) + 1, text })) }),
    createElement(RoomBooth, { room: 'make', data, sel, change: null, onChange: () => {}, onApart: () => {}, onReady: () => {}, done, onUndo: () => { setDone(null); void undo(store) } }))
}

async function room(lengths: number[]) {
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true })
  const storage = memoryStorage()
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME, configChoice: 'remote', providerChoice: 'config' }, null)
  const relay = new MockRelay({ renderer: { async render() { return [] } }, delayMs: 60_000, persistKey: null })
  const shell = new Shell({ relay, app, index: new ProjectIndex(storage, () => new Date('2026-11-16T10:00:00Z')), storage, remoteConfig: ON, makeClan, summaryDelayMs: 1 })
  await shell.newProject()
  const services = shell.get().session!.services
  await seedStages(services.doc)
  await updateDoc(services.doc, (d) => {
    const shots = addShots(d, lengths.length, { status: 'planned' })
    shots.forEach((s, i) => { Object.assign(s, { duration_s: lengths[i], action: `Beat ${i + 1}.` }); addFrame(d, s, SHA('0123456789'[i]), { pick: true }) })
  }, 'add shots')
  // One scene: the crew would make it one video; start with a cut at every gap (Make every shot separately).
  await separateAll(services.doc, mainVideo(services.doc.get())!.id)
  await services.doc.flush()
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root ??= createRoot(el)
    root.render(createElement(ServicesContext.Provider, { value: services }, createElement(Harness)))
  })
  await until(() => el.querySelectorAll('.jc-box').length === lengths.length)
  const boxes = () => [...el.querySelectorAll('.jc-box')].map((b) => b.querySelectorAll('.jc-shot').length)
  const gaps = () => [...el.querySelectorAll<HTMLButtonElement>('.jc-gap')]
  const button = (name: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement | undefined
  return { services, el, boxes, gaps, button }
}

describe('the Make room strip', () => {
  it('a gap flips a cut to a join and back, the Camera agent says so in the Booth, and Undo restores it', async () => {
    const r = await room([3.5, 3.5, 4, 4])
    expect(r.boxes()).toEqual([1, 1, 1, 1])
    expect(r.gaps().map((g) => [g.getAttribute('aria-pressed'), g.textContent])).toEqual([['false', 'cut'], ['false', 'cut'], ['false', 'cut']])
    await act(async () => { r.gaps()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await until(() => r.boxes().length === 3)
    expect(r.boxes()).toEqual([2, 1, 1])
    expect(r.el.querySelector('.jc-box')?.getAttribute('aria-label')).toBe('Box 1: One video · 2 shots · 7 s')
    await until(() => !!r.el.querySelector('.booth .bc.done')?.textContent?.includes('Joined shots 1 and 2'))
    const note = r.el.querySelector('.booth .bc.done')!
    expect(note.textContent).toContain('Joined shots 1 and 2: one video now. Nothing is sent until you press Make.')
    await act(async () => { (note.querySelector('button') as HTMLButtonElement).click() })
    await until(() => r.boxes().length === 4)
    expect(r.boxes()).toEqual([1, 1, 1, 1])
    expect(r.el.querySelector('.booth .bc.done')).toBeNull()
  })

  it('← and → move between gaps; a keyboard flip keeps the focus on its gap; the tip says what a flip does', async () => {
    const r = await room([3.5, 3.5, 4])
    act(() => { r.gaps()[0].focus() })
    expect(document.getElementById('jcTip')?.textContent).toContain('Join: shots 1 and 2 become one video')
    expect(document.getElementById('jcTip')?.textContent).toContain('One video · 2 shots · 7 s, every frame a guide.')
    act(() => { r.gaps()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(document.activeElement).toBe(r.gaps()[1])
    act(() => { r.gaps()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
    expect(document.activeElement).toBe(r.gaps()[0])
    const shot2 = r.gaps()[0].dataset.gap
    // Enter or Space on a button is a click with no pointer (detail 0): the gap is drawn anew and keeps the focus.
    await act(async () => { r.gaps()[0].click() })
    await until(() => r.boxes().length === 2)
    await until(() => (document.activeElement as HTMLElement | null)?.dataset?.gap === shot2)
    expect((document.activeElement as HTMLElement).getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('jcTip')?.textContent).toContain('Cut here: two videos')
    expect(document.getElementById('jcTip')?.textContent).toContain('Shots 1 and 2 are made apart: shot 1 (3.5 s), then shot 2 (3.5 s).')
  })

  it('a joined box keeps the earlier box’s model; past it, Make is off and the two offers work', async () => {
    const r = await room([3.5, 3.5, 4, 4])
    await act(async () => { r.gaps()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await until(() => r.boxes().length === 3)
    // Box 1 (shots 1-2, 7 s) on Omni Flash, from its Box tab.
    await act(async () => { (r.el.querySelector('.jc-bhd') as HTMLButtonElement).click() })
    const omni = [...r.el.querySelectorAll<HTMLButtonElement>('.jc-mrow')].find((b) => b.textContent?.startsWith('Gemini Omni Flash 1.1'))!
    await act(async () => { omni.click() })
    expect(r.el.querySelector('.jc-box .jc-model')?.textContent).toBe('Gemini Omni Flash 1.1')
    // Join shots 3 and 4 into it: 15 s, past Omni Flash's 10 s. The box keeps Omni Flash and says so.
    await act(async () => { r.gaps()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await act(async () => { r.gaps()[2].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await until(() => r.boxes().length === 1)
    const box = () => r.el.querySelector('.jc-box') as HTMLElement
    expect(box().classList.contains('over')).toBe(true)
    expect(box().querySelector('.jc-model')?.textContent).toBe('Gemini Omni Flash 1.1')
    expect(box().querySelector('.jc-limit b')?.textContent).toBe('15 s is longer than Gemini Omni Flash 1.1 makes in one go (10 s).')
    expect((box().querySelector('.jc-bft .btn.primary') as HTMLButtonElement).disabled).toBe(true)
    expect(box().querySelector('.jc-gap.suggest')?.getAttribute('aria-label')).toBe('Shots 2 and 3 are one video. Cut here')
    // Use WAN 3: the limit goes and Make is on.
    expect(box().querySelector('.jc-lacts')?.textContent).toBe('Use WAN 3 · up to 15 sCut before shot 3')
    await act(async () => { r.button('Use WAN 3 · up to 15 s')!.click() })
    expect(box().classList.contains('over')).toBe(false)
    expect(box().querySelector('.jc-model')?.textContent).toBe('WAN 3')
    expect((box().querySelector('.jc-bft .btn.primary') as HTMLButtonElement).disabled).toBe(false)
    // Back on Omni Flash (kept, from the tab), then Cut before shot 3: two boxes, each on its own Make.
    const omni2 = [...r.el.querySelectorAll<HTMLButtonElement>('.jc-mrow')].find((b) => b.textContent?.startsWith('Gemini Omni Flash 1.1'))!
    expect(omni2.disabled).toBe(true) // past its limits it is greyed with why
    expect(omni2.textContent).toContain('Longer than Gemini Omni Flash 1.1 makes in one go (10 s)')
  })

  it('Cut before shot N splits the box where it suggests', async () => {
    const r = await room([3.5, 3.5, 4, 4])
    await act(async () => { r.gaps()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await until(() => r.boxes().length === 3)
    await act(async () => { (r.el.querySelector('.jc-bhd') as HTMLButtonElement).click() })
    await act(async () => { [...r.el.querySelectorAll<HTMLButtonElement>('.jc-mrow')].find((b) => b.textContent?.startsWith('Gemini Omni Flash 1.1'))!.click() })
    await act(async () => { r.gaps()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })) })
    await until(() => r.boxes().length === 2)
    expect(r.boxes()).toEqual([3, 1])
    await act(async () => { r.button('Cut before shot 3')!.click() })
    await until(() => r.boxes().length === 3)
    expect(r.boxes()).toEqual([2, 1, 1])
    expect(r.el.querySelector('.jc-box.over')).toBeNull()
    await until(() => !!r.el.querySelector('.booth .bc.done')?.textContent?.includes('Cut before shot 3'))
    expect(r.el.querySelector('.booth .bc.done')?.textContent).toContain('Cut before shot 3: two videos now.')
  })
})
