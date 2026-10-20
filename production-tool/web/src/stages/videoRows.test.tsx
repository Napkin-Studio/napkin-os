// @vitest-environment happy-dom
// One track (features/connected-video.clan, the owner's choice 2026-10-20): every shot in order on one track,
// joined shots boxed as one video with one Make; Cut here splits a box and Join between separate shots boxes
// them; a refusal shows only in the box whose shots are exactly the refused take's (a split or a join starts
// clean); the right
// panel has no make action of its own. Split and join also go through the real CLAN store, which refused
// every seam until clan-store's leaf rules listed it (2026-10-19).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, ShellContext, type Services } from '../app/context'
import type { Shell } from '../projects/shell'
import { CONFIGS } from '../contracts/load'
import type { Config, ProductionDocument, Shot } from '../contracts/types'
import { SnapshotDocumentStore, SnapshotStore, systemUpdate } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { modelEntry } from '../jobs/runs'
import { joinHere, rowMakeWords, rowTitle, splitHere, videoPlan, videoRows } from '../jobs/runView'
import { edlItemFor, mainVideo } from '../model/selectors'
import { MAYA, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots, addTake, job, modelStore } from '../test/model'
import { Video } from './Video'
import { VideoRows } from './VideoStrips'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const OMNI = modelEntry('runway', 'gemini_omni_flash_1.1')!
const on: Config = { ...CONFIGS.live, flags: { ...CONFIGS.live.flags, connectedVideo: true } }

/** Six shots in one scene, the last an end card, each with a frame. */
function ad(build?: (d: ProductionDocument, shots: Shot[]) => void) {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, 6)
  shots.forEach((s, i) => { Object.assign(s, { duration_s: i === 5 ? 1.5 : 1.7, action: `Action ${i + 1}.`, ...(i === 5 ? { kind: 'end_card' } : {}) }); addFrame(d, s, SHA(`${i}`), { pick: true }) })
  build?.(d, shots)
  const store = new SnapshotDocumentStore(d, null, 0)
  return { store, shots, videoId: mainVideo(d)!.id }
}

const rowsOf = (d: ProductionDocument, videoId: string) => videoRows(d, { jobs: {} }, videoId, videoPlan(d, videoId, OMNI))
const titles = (d: ProductionDocument, videoId: string) => rowsOf(d, videoId).map((r) => rowTitle(d, r))

/** The take of shots `ids` was refused by Runway. */
function refuse(d: ProductionDocument, ids: string[]) {
  const videoId = mainVideo(d)!.id
  const runId = 'run_01K7A00000000000000000RUN1'
  d.videos[videoId].runs = { [runId]: { shot_ids: ids, mode: 'take', model: 'gemini_omni_flash_1.1', state: 'failed', planned_by: 'crew' } }
  d.jobs.job_r = job(d, 'clip', [], null, {
    id: 'job_r', state: 'failed', purpose: `run ${runId}`, node: { kind: 'video', id: videoId },
    error: { code: 'moderated', message: 'Runway refused the words twice.', retryable: false },
  })
}

function mount(store: SnapshotDocumentStore, node: ReturnType<typeof createElement>) {
  const ui = new SnapshotStore<UiState>({ ...initialUi(), configChoice: 'remote', providerChoice: 'config' })
  const services = { doc: store, ui, relay: { kind: 'http' }, remoteConfig: on, clan: null, project: { id: 'p', name: 'Test ad' }, storeNote: null, serverCopy: null,
    runner: { subscribe: () => () => {}, getVersion: () => 0, liveInfo: () => undefined } }
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    root = createRoot(el)
    // Home and the projects are not under test: every shell call does nothing.
    const index = { get: () => ({ name: 'Test ad' }), list: () => [], subscribe: () => () => {} }
    const app = new SnapshotStore({ ...initialUi() })
    const shell = new Proxy({ index, deps: { app } }, { get: (t, k) => (k in t ? t[k as 'index'] : () => {}) }) as unknown as Shell
    root.render(createElement(ShellContext.Provider, { value: shell }, createElement(ServicesContext.Provider, { value: services as unknown as Services }, node)))
  })
  return el
}

const rowsEl = (store: SnapshotDocumentStore, shots: Shot[], videoId: string, handlers: Partial<Record<'onMake' | 'onMakeAgain' | 'onMakeSeparately' | 'onSelectRow', () => void>> = {}) =>
  createElement(VideoRows, {
    videoId, shots, rows: rowsOf(store.get(), videoId), card: (s: Shot) => createElement('div', { key: s.id, className: 'card' }, s.action),
    onSelectRow: vi.fn(), onMake: vi.fn(), onMakeAgain: vi.fn(), onMakeSeparately: vi.fn(), ...handlers,
  })
const buttonsIn = (el: Element) => [...el.querySelectorAll('button')].map((b) => b.textContent)

describe('the track', () => {
  it('lays every shot on one track: the proposed video as ONE box, the end card a separate card, each with one Make', () => {
    const { store, shots, videoId } = ad()
    expect(titles(store.get(), videoId)).toEqual(['One video · shots 1–5 · 8.5 s', 'End card · shot 6 · 1.5 s'])
    const el = mount(store, rowsEl(store, shots, videoId))
    expect(el.querySelector('.ve-rowsum')!.textContent).toBe('Your ad · 2 videos · 10 s')
    const track = el.querySelector('.ve-track1')!
    // In storyboard order, one track: a box of five, then the end card on its own.
    expect([...track.querySelectorAll('.card')].map((c) => c.textContent)).toEqual(shots.map((s) => s.action))
    const boxes = [...track.querySelectorAll('.ve-box')]
    expect(boxes).toHaveLength(1)
    expect(boxes[0].querySelectorAll('.card')).toHaveLength(5)
    expect(boxes[0].querySelector('.ve-boxtitle')!.textContent).toBe('One video · shots 1–5 · 8.5 s')
    expect(buttonsIn(boxes[0].querySelector('.ve-boxhead')!)).toEqual(['One video · shots 1–5 · 8.5 s', 'Make'])
    expect(boxes[0].querySelectorAll('.ve-cuthere')).toHaveLength(4)
    const solo = track.querySelector('.ve-solo')!
    expect(solo.querySelectorAll('.card')).toHaveLength(1)
    expect(buttonsIn(solo.querySelector('.ve-solofoot')!)).toEqual(['Make'])
  })

  it('shows nothing in a gap where joining is not allowed but a dot whose title says why', () => {
    const { store, shots, videoId } = ad()
    const el = mount(store, rowsEl(store, shots, videoId))
    expect(el.querySelector('.ve-joingap')).toBeNull()
    const dot = el.querySelector('.ve-nogap')!
    expect(dot.textContent).toBe('·')
    expect(dot.getAttribute('title')).toBe('An end card is always its own video')
  })

  it('scrolls sideways rather than wrapping', () => {
    const css = readFileSync(join(process.cwd(), 'src/stages/video.css'), 'utf8')
    const rule = (sel: string) => css.match(new RegExp(`${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? ''
    expect(rule('.ve-track1')).toMatch(/flex-wrap: nowrap/)
    expect(rule('.ve-track1')).toMatch(/overflow-x: auto/)
    expect(rule('.ve-boxcards')).toMatch(/flex-wrap: nowrap/)
  })

  it('say their state on Make: as one video after separate clips, again once made', () => {
    expect(['new', 'separate', 'made', 'refused'].map((state) => rowMakeWords({ state } as never))).toEqual(['Make', 'Make as one video', 'Make again', 'Make'])
    const { store, videoId } = ad((d, shots) => { addTake(d, shots[0], SHA('t'), job(d, 'clip', [], SHA('t')), { pick: true }) })
    expect(rowsOf(store.get(), videoId).map((r) => r.state)).toEqual(['separate', 'new'])
    const single = ad((_d, shots) => { for (const i of [2, 3, 4]) shots[i].scene_id = 'scene_b' })
    expect(titles(single.store.get(), single.videoId)).toEqual(['One video · shots 1–2 · 3.4 s', 'One video · shots 3–5 · 5.1 s', 'End card · shot 6 · 1.5 s'])
  })

  it('Cut here splits the box; Join between separate neighbours makes one box again', async () => {
    const { store, shots, videoId } = ad()
    let el = mount(store, rowsEl(store, shots, videoId))
    const cut = el.querySelectorAll<HTMLButtonElement>('.ve-cuthere')[0] // between shots 1 and 2
    expect(cut.getAttribute('aria-label')).toBe('Cut here, between shot 1 and shot 2')
    expect(cut.textContent).toBe('Cut here')
    await act(async () => { cut.click() })
    expect(titles(store.get(), videoId)).toEqual(['Shot 1 · 1.7 s', 'One video · shots 2–5 · 6.8 s', 'End card · shot 6 · 1.5 s'])
    act(() => root?.unmount())
    el = mount(store, rowsEl(store, shots, videoId))
    // Shot 1 is now a separate card, with Join in the gap to the box.
    expect(el.querySelectorAll('.ve-box')).toHaveLength(1)
    expect(el.querySelectorAll('.ve-solo')).toHaveLength(2)
    const join = el.querySelector<HTMLButtonElement>('.ve-joingap')!
    expect(join.textContent).toBe('Join')
    expect(join.getAttribute('aria-label')).toBe('Join shot 1 and shot 2 into one video')
    await act(async () => { join.click() })
    expect(titles(store.get(), videoId)).toEqual(['One video · shots 1–5 · 8.5 s', 'End card · shot 6 · 1.5 s'])
  })

  it('Join between two separate shots makes a box of them', async () => {
    const { store, shots, videoId } = ad()
    // Shots 1 and 2 each on their own: a person's cuts.
    await splitHere(store, videoId, shots[1].id)
    await splitHere(store, videoId, shots[2].id)
    expect(titles(store.get(), videoId).slice(0, 2)).toEqual(['Shot 1 · 1.7 s', 'Shot 2 · 1.7 s'])
    const el = mount(store, rowsEl(store, shots, videoId))
    await act(async () => { el.querySelector<HTMLButtonElement>('.ve-joingap')!.click() })
    expect(titles(store.get(), videoId).slice(0, 2)).toEqual(['One video · shots 1–2 · 3.4 s', 'One video · shots 3–5 · 5.1 s'])
  })
})

describe('a refusal', () => {
  it('shows only in the box whose shots are exactly the refused take, under its cards, with Try again and Make separately', () => {
    const { store, shots, videoId } = ad((d, s) => refuse(d, s.slice(0, 5).map((x) => x.id)))
    const make = vi.fn()
    const separately = vi.fn()
    const el = mount(store, rowsEl(store, shots, videoId, { onMake: make, onMakeSeparately: separately }))
    const box = el.querySelector('.ve-box')!
    const line = box.querySelector('.ve-refusal')!
    expect(line.textContent).toContain('Runway refused the words.')
    expect(buttonsIn(line)).toEqual(['Try again', 'Make separately'])
    expect(box.querySelector('.ve-boxhead .ve-make')).toBeNull() // one action place: the refusal line
    expect(el.querySelector('.ve-solo .ve-refusal')).toBeNull()
    act(() => line.querySelectorAll<HTMLButtonElement>('button')[0].click())
    expect(make).toHaveBeenCalled()
    // No job bar inside the track.
    expect(el.querySelector('.jobslot')).toBeNull()
  })

  it('is gone from both halves after a split, and from the merged row after a join', async () => {
    const { store, videoId, shots } = ad((d, s) => refuse(d, s.slice(0, 5).map((x) => x.id)))
    await splitHere(store, videoId, shots[2].id)
    expect(rowsOf(store.get(), videoId).map((r) => r.state)).toEqual(['new', 'new', 'new'])
    await joinHere(store, videoId, shots[2].id)
    expect(rowsOf(store.get(), videoId).map((r) => r.state)).toEqual(['refused', 'new']) // the same five again
  })
})

describe('the right panel', () => {
  it('has no make action of its own: the row has the one Make', () => {
    const { store, videoId } = ad((d, shots) => {
      shots.forEach((s, i) => addTake(d, s, SHA(`c${i}`), job(d, 'clip', [], SHA(`c${i}`)), { pick: true }))
    })
    expect(videoId).toBeTruthy()
    const el = mount(store, createElement(Video))
    const panel = el.querySelector('.notes-panel')
    expect(panel).not.toBeNull()
    expect(buttonsIn(panel!).filter((t) => /make|new take/i.test(t ?? ''))).toEqual([])
    expect(el.querySelectorAll('.ve-box, .ve-solo')).toHaveLength(2)
  })
})

describe('the real CLAN store', () => {
  it('saves Cut here and Join (an edl item\'s seam), without refusing them', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Rows')
    let ids: string[] = []
    await systemUpdate(s, (d) => {
      const shots = addShots(d, 3)
      shots.forEach((x, i) => { x.duration_s = 2; addFrame(d, x, SHA(`${i}`), { pick: true }) })
      ids = shots.map((x) => x.id)
    }, 'sync')
    await s.flush()
    expect(s.trouble).toBeFalsy()
    const videoId = mainVideo(s.get())!.id
    await splitHere(s, videoId, ids[1])
    await s.flush()
    expect(s.trouble).toBeFalsy()
    expect(edlItemFor(s.get(), ids[1], videoId)?.seam).toEqual({ kind: 'cut', by: 'human' })
    expect(titles(s.get(), videoId)).toEqual(['Shot 1 · 2 s', 'One video · shots 2–3 · 4 s'])
    await joinHere(s, videoId, ids[1])
    await s.flush()
    expect(s.trouble).toBeFalsy()
    expect(edlItemFor(s.get(), ids[1], videoId)?.seam).toEqual({ kind: 'continue', by: 'human' })
    expect(titles(s.get(), videoId)).toEqual(['One video · shots 1–3 · 6 s'])
  })
})
