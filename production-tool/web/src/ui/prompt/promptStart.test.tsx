// @vitest-environment happy-dom
// Make from a prompt (features/prompt-start.clan): which start an empty node shows, the words and
// asks the spec gives them, and the start rendered: a line in the box starts the kind's job.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServicesContext, type Services } from '../../app/context'
import type { JobInput, Op } from '../../contracts/types'
import type { JobPurpose } from '../../model/purpose'
import { SnapshotStore, systemUpdate, updateDoc } from '../../doc/store'
import { initialUi, type UiState } from '../../doc/ui'
import { mainScript, mainStoryboard, mainVideo } from '../../model/selectors'
import type { ModelStore } from '../../model/store'
import { MockRelay } from '../../relay/mock'
import { addScene } from '../../script/edits'
import { addFrame, addShots, asset, id, job, MAYA, modelStore, SHA } from '../../test/model'
import { PromptStart } from './PromptStart'
import {
  DESCRIBE, insertMention, LINK_SCRIPT, LINK_STORYBOARD, makeItLabel, mentionAt, PLAN_NOW, PROMPT_COPY, promptState, SCRIPT_FIRST, storyboardNudge, videoBlock,
} from './promptFlow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function project(): Promise<ModelStore> {
  const store = modelStore()
  await store.create(MAYA, 'First Light')
  await store.flush()
  return store
}

const unlinkVideo = async (store: ModelStore) => {
  const v = mainVideo(store.get())!
  await updateDoc(store, (d) => { for (const l of Object.values(d.links)) if (l.to.id === v.id) delete d.links[l.id] }, 'unlink')
  await store.flush()
  return v.id
}

describe('which start an empty node shows', () => {
  it('a script with no words shows the box; one with words, or Skye at work, shows none', async () => {
    const s = await project()
    const id = mainScript(s.get())!.id
    expect(promptState(s.get(), 'script', id)).toEqual({ show: 'script' })
    const scene = await addScene(s, id)
    await updateDoc(s, (d) => { d.scenes[scene].text = 'A runner at dawn.' }, 'edit')
    await s.flush()
    expect(promptState(s.get(), 'script', id)).toBeNull()
  })

  it('a storyboard with no shots asks for the ad in a line, or offers the plan when the script has words', async () => {
    const s = await project()
    const sb = mainStoryboard(s.get())!.id
    expect(promptState(s.get(), 'storyboard', sb)).toEqual({ show: 'storyboard', fromScript: false })
    const scene = await addScene(s, mainScript(s.get())!.id)
    await updateDoc(s, (d) => { d.scenes[scene].text = 'Maya runs the cliffs.' }, 'edit')
    await s.flush()
    expect(promptState(s.get(), 'storyboard', sb)).toEqual({ show: 'storyboard', fromScript: true })
    await updateDoc(s, (d) => { addShots(d, 2) }, 'plan')
    await s.flush()
    expect(promptState(s.get(), 'storyboard', sb)).toBeNull()
  })

  it('a video with nothing linked is blocked; linked to an empty storyboard it offers the plan; with shots, nothing', async () => {
    const s = await project()
    const v = mainVideo(s.get())!.id
    expect(promptState(s.get(), 'video', v)).toEqual({ show: 'video-plan', storyboardId: mainStoryboard(s.get())!.id })
    await unlinkVideo(s)
    expect(promptState(s.get(), 'video', v)).toEqual({ show: 'video-block' })
  })

  it('a video a script drives and no storyboard renders waits on Dex\'s question (3.5)', async () => {
    const s = await project()
    const v = await unlinkVideo(s)
    const sc = mainScript(s.get())!.id
    await updateDoc(s, (d) => { const l = id('link'); d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'script', id: sc }, to: { kind: 'video', id: v }, role: 'drives' } }, 'link')
    await s.flush()
    expect(promptState(s.get(), 'video', v)).toEqual({ show: 'video-script', scriptId: sc })
  })

  it('the project\'s video, its storyboard not planned and its script written, asks the same; planned, nothing', async () => {
    const s = await project()
    const v = mainVideo(s.get())!.id
    const sc = mainScript(s.get())!.id
    const scene = await addScene(s, sc)
    await updateDoc(s, (d) => { d.scenes[scene].text = 'A runner at dawn.' }, 'edit')
    await s.flush()
    expect(promptState(s.get(), 'video', v)).toEqual({ show: 'video-script', scriptId: sc })
    await updateDoc(s, (d) => { addShots(d, 2) }, 'plan')
    await s.flush()
    expect(promptState(s.get(), 'video', v)).toBeNull()
  })

  it('a shot with no frame offers the picture; with a frame, nothing', async () => {
    const s = await project()
    let shot = ''
    await updateDoc(s, (d) => { shot = addShots(d, 1)[0].id }, 'plan')
    await s.flush()
    expect(promptState(s.get(), 'image', shot)).toEqual({ show: 'image-frame' })
    await systemUpdate(s, (d) => { addFrame(d, d.shots[shot], SHA('f'), { pick: true }) }, 'sync')
    await s.flush()
    expect(promptState(s.get(), 'image', shot)).toBeNull()
  })

  it('a picture node shows its start until its picture is named', async () => {
    const s = await project()
    expect(promptState(s.get(), 'image', 'pic_node_1')).toEqual({ show: 'image-picture' })
    const j = job(s.get(), 'generate', [], SHA('b'), { node: { kind: 'group', id: 'pic_node_1' }, state: 'completed', outputs: [SHA('b')] })
    await systemUpdate(s, (d) => { d.jobs[j.id] = j; d.assets[SHA('b')] = asset(SHA('b')) }, 'sync')
    await s.flush()
    expect(promptState(s.get(), 'image', 'pic_node_1')).toEqual({ show: 'image-picture' })
    await updateDoc(s, (d) => {
      const k = id('key')
      const r = id('ref')
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'bottle', role: 'product' }
      d.refs[r] = { id: r, v: 1, field_v: {}, key: 'bottle', variant: 'main', role: 'product', asset: SHA('b') }
    }, 'name')
    await s.flush()
    expect(promptState(s.get(), 'image', 'pic_node_1')).toBeNull()
  })
})

describe('the asks', () => {
  it('the video\'s is a hard block: three options, a text box, nothing recommended (3.17)', () => {
    const q = videoBlock('video_1')
    expect(q.kind).toBe('block')
    expect(q.text).toBe('What should this video be?')
    expect(q.why).toBe('Nothing is linked to it yet, so I have nothing to direct from.')
    expect(q.options.map((o) => [o.id, o.label])).toEqual([[DESCRIBE, 'Describe it'], [LINK_SCRIPT, 'Link a script'], [LINK_STORYBOARD, 'Link a storyboard']])
    expect(q.allow_text).toBe(true)
    expect(q.recommended_option_id).toBeUndefined()
    expect(makeItLabel(15)).toBe('15 s · Make it')
    expect(PROMPT_COPY.video.placeholder).toBe('Describe it in a line or two. Type @ to pull in a character, place or product.')
  })

  it('the storyboard\'s is a nudge with the script first recommended, and the plan goes ahead too (decision 1)', () => {
    const q = storyboardNudge('sb_1')
    expect(q.kind).toBe('nudge')
    expect(q.text).toBe('Write a script first?')
    expect(q.recommended_option_id).toBe(SCRIPT_FIRST)
    expect(q.options.map((o) => o.id)).toEqual([SCRIPT_FIRST, PLAN_NOW])
    expect(q.options.every((o) => !o.cost)).toBe(true)
  })

  it('the words are the spec\'s', () => {
    expect(PROMPT_COPY.script.placeholder).toBe('Paste a script, or write the idea in a line.')
    expect(PROMPT_COPY.storyboard.placeholder).toBe('Describe the ad in a line')
    expect(PROMPT_COPY.image.placeholder).toBe('Describe the picture')
  })

  it('@ at the caret lists names, and picking one puts it in', () => {
    expect(mentionAt('by the @se', 10)).toEqual({ from: 7, query: 'se' })
    expect(mentionAt('mail me@home', 12)).toBeNull()
    expect(insertMention('by the @se', 7, 10, 'sea_wide')).toEqual({ text: 'by the @sea_wide ', caret: 17 })
  })
})

// ── rendered ────────────────────────────────────────────────────────────────

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function services(store: ModelStore) {
  const sent: { op: Op; input: JobInput; purpose: JobPurpose }[] = []
  const runner = {
    subscribe: () => () => {},
    getVersion: () => 0,
    submit: vi.fn(async (op: Op, input: JobInput, _p: string[], purpose: JobPurpose) => {
      sent.push({ op, input, purpose })
      const j = job(store.get(), op, [], null)
      await systemUpdate(store, (d) => { d.jobs[j.id] = j }, 'sync')
      return j.id
    }),
  }
  const s = {
    project: { id: store.get().project.id, canvasKey: 'c', beforeClose: new Set(), usedElsewhere: () => false },
    relay: new MockRelay({ renderer: { async render() { return [] } }, persistKey: null }),
    doc: store, ui: new SnapshotStore<UiState>(initialUi()), runner, remoteConfig: null, clan: store, storeNote: null, serverCopy: null,
  } as unknown as Services
  return { s, sent }
}

async function render(store: ModelStore, el: ReturnType<typeof createElement>) {
  const { s, sent } = services(store)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(ServicesContext.Provider, { value: s }, el)))
  return { host, sent }
}

const type = async (area: HTMLTextAreaElement, text: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const enter = async (el: Element) => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
}

describe('PromptStart, rendered', () => {
  it('an empty script: the line goes in, and Skye\'s draft is asked for', async () => {
    const store = await project()
    const { host, sent } = await render(store, createElement(PromptStart, { kind: 'script', nodeId: mainScript(store.get())!.id, place: 'editor' }))
    const area = host.querySelector('textarea')!
    expect(area.placeholder).toBe('Paste a script, or write the idea in a line.')
    await type(area, 'A runner drinks Lumen water at dawn.')
    await enter(area)
    expect(sent.map((x) => [x.op, x.input.write?.intent])).toEqual([['write', 'draft']])
  })

  it('an unlinked video: Dex\'s block, Describe it opens the box, "15 s · Make it" plans', async () => {
    const store = await project()
    const v = await unlinkVideo(store)
    const { host, sent } = await render(store, createElement(PromptStart, { kind: 'video', nodeId: v }))
    expect(host.textContent).toContain('What should this video be?')
    const describe = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Describe it'))!
    await act(async () => describe.click())
    const area = host.querySelector('textarea')!
    await type(area, 'A runner at dawn, fifteen seconds.')
    const make = [...host.querySelectorAll('button')].find((b) => b.textContent === '15 s · Make it')!
    expect(make).toBeTruthy()
    await act(async () => make.click())
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(sent.map((x) => x.op)).toEqual(['shot_list'])
    expect(Object.values(store.get().links).some((l) => l.to.id === v && l.role === 'renders')).toBe(true)
  })

  it('a video from a script alone: "Plan a storyboard first?"; straight from the script plans into the video\'s own shot list, no storyboard node, and opens the Video', async () => {
    const store = await project()
    const v = await unlinkVideo(store)
    const sc = mainScript(store.get())!.id
    const scene = await addScene(store, sc)
    await updateDoc(store, (d) => {
      d.scenes[scene].text = 'A runner crests the cliff at dawn.'
      const l = id('link')
      d.links[l] = { id: l, v: 1, field_v: {}, from: { kind: 'script', id: sc }, to: { kind: 'video', id: v }, role: 'drives' }
    }, 'make video')
    await store.flush()
    const { s, sent } = services(store)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(ServicesContext.Provider, { value: s }, createElement(PromptStart, { kind: 'video', nodeId: v }))))
    expect(host.textContent).toContain('Plan a storyboard first?')
    expect(host.textContent).toContain('Clips come out better from frames you\'ve checked.')
    expect(host.textContent).toContain('You can always switch later.')
    expect(host.querySelector('.askcard-opt.rec')?.textContent).toMatch(/^Plan the storyboard firstRecommendedAbout \d+ shots, with frames you check first$/)
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Later')).toBe(true)
    expect(sent).toHaveLength(0)
    const straight = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Make clips straight from the script'))!
    await act(async () => straight.click())
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(sent.map((x) => x.op)).toEqual(['shot_list'])
    const d = store.get()
    // No Storyboard node and no link (decided 2026-10-15): the video's own shot list, planned into.
    const own = Object.values(d.storyboards).find((x) => x.video_id === v)
    expect(own).toMatchObject({ implicit: true })
    expect(Object.values(d.links).some((l) => l.to.id === v && l.role === 'renders')).toBe(false)
    expect(Object.keys(d.storyboards)).toHaveLength(2)
    expect(Object.values(d.asks).find((a) => a.node.id === v)?.answers.map((a) => a.option_id)).toEqual(['straight'])
    expect(s.ui.get()).toMatchObject({ stage: 'video', openNode: { video: v } })
  })

  it('an empty storyboard: the line, then the nudge; planning from the line goes ahead', async () => {
    const store = await project()
    const { host, sent } = await render(store, createElement(PromptStart, { kind: 'storyboard', nodeId: mainStoryboard(store.get())!.id }))
    const area = host.querySelector('textarea')!
    expect(area.placeholder).toBe('Describe the ad in a line')
    await type(area, 'A runner at dawn.')
    await enter(area)
    expect(host.textContent).toContain('Write a script first?')
    expect(host.querySelector('.askcard-opt.rec')?.textContent).toContain('Recommended')
    const plan = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Plan shots from the line'))!
    await act(async () => plan.click())
    for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
    expect(sent.map((x) => [x.op, x.input.script])).toEqual([['shot_list', 'A runner at dawn.']])
  })
})
