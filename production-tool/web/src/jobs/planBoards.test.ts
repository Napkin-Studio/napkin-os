// More than one storyboard per project (features/canvas-nodes.clan): Plan shots on a second storyboard
// (made with + Node, driven by a second script) sends that script's words and lands the shots on that
// storyboard, never the main one; the plan job's node is that storyboard, read back after a reload;
// its frames are drawn from its own shots at its own ratio; its clips land in the video it renders and
// that video's ad renders it. On the CLAN store, with the mock relay.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ClanDocumentStore, rankBetween } from '../../../clan-store/src'
import { newEntity } from '../canvas/nodes/nodes'
import type { Link, Script, Storyboard, Video } from '../contracts/types'
import { SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { newId } from '../lib/ulid'
import { purposeOf } from '../model/purpose'
import { currentRender, currentTake, edlOf, mainStoryboard, mainVideo, openStoryboard, scenesOf, scriptOfStoryboard, shotsOf } from '../model/selectors'
import { ModelStore } from '../model/store'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { MAYA } from '../test/jobFixtures'
import { makeClip, renderAd } from './clips'
import { drawFrame, type FrameDeps } from './frames'
import { planInput, planOrJoin, runningPlan } from './plan'
import { JobRunner } from './runner'
import { wireJobs } from './wire'

const here = dirname(fileURLToPath(import.meta.url))
const wasmPath = join(here, '..', '..', '..', 'clan-store', 'src', 'wasm', 'napkin_wasm_bg.wasm')
if (!existsSync(wasmPath)) throw new Error(`no ${wasmPath}: run \`npm run clan-store\` first`)
const wasm = new Uint8Array(readFileSync(wasmPath))

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

const MAIN = 'A razor rests on a marble sink. A hand picks it up slowly.'
const SECOND = 'Rain on a bus shelter. Maya opens a yellow umbrella. She steps into the street.'

async function setup() {
  let t = 1_000_000
  const renderer: MockRenderer = {
    async render(req) {
      const mime = req.op === 'clip' || req.op === 'stitch' ? 'video/mp4' : 'image/png'
      return [{ blob: new Blob([`${req.op}-${Math.random()}`], { type: mime }), mime, w: 9, h: 16, ...(mime === 'video/mp4' ? { durationS: 5 } : {}) }]
    },
  }
  const relay = new MockRelay({ renderer, now: () => t, delayMs: 2000, persistKey: null })
  const store = new ModelStore(new ClanDocumentStore({ wasm, persistence: null, person: MAYA }), { debounceMs: 5 })
  await store.create(MAYA, 'Razor')
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, store, ui)
  const deps: FrameDeps = { relay, doc: store, ui, runner }
  wireJobs(deps)
  // A second script driving a second storyboard (9:16), as + Node and a link make them.
  const d0 = store.get()
  const script = newEntity(d0, 'script').entity as Script
  const sb = { ...(newEntity(d0, 'storyboard').entity as Storyboard), ratio: '9:16' as const }
  const video = { ...(newEntity(d0, 'video').entity as Video), ratio: '9:16' as const }
  const drives: Link = { id: newId('link'), v: 1, field_v: {}, from: { kind: 'script', id: script.id }, to: { kind: 'storyboard', id: sb.id }, role: 'drives' }
  const renders: Link = { id: newId('link'), v: 1, field_v: {}, from: { kind: 'storyboard', id: sb.id }, to: { kind: 'video', id: video.id }, role: 'renders' }
  await systemUpdate(store, (d) => {
    d.scripts[script.id] = script
    d.storyboards[sb.id] = sb
    d.videos[video.id] = video
  }, 'add a script, a storyboard and a video')
  await updateDoc(store, (d) => {
    d.links[drives.id] = drives
    d.links[renders.id] = renders
  }, 'link script to storyboard')
  const scene = (scriptId: string, text: string, heading: string) => {
    const id = newId('scene')
    return { id, v: 1, field_v: {}, script_id: scriptId, rank: rankBetween(null, null), heading, text }
  }
  await updateDoc(store, (d) => {
    const a = scene(scriptOfStoryboard(d, mainStoryboard(d)!.id)!.id, MAIN, 'INT. BATHROOM - DAY')
    const b = scene(script.id, SECOND, 'EXT. STREET - NIGHT')
    d.scenes[a.id] = a
    d.scenes[b.id] = b
  }, 'set')
  await store.flush()
  const land = async () => {
    t += 5000
    await runner.pollNow()
    await relay.settled()
    await runner.pollNow()
    await flush()
    await store.flush()
  }
  return { store, ui, runner, relay, deps, land, script, sb, video }
}

describe('Plan shots on a second storyboard', () => {
  it('sends the words of the script that drives it, and lands its shots there, not on the main storyboard', async () => {
    const { store, deps, land, script, sb, relay } = await setup()
    const input = await planInput(relay, store.get(), undefined, sb.id)
    expect(input.script).toContain('yellow umbrella')
    expect(input.script).not.toContain('razor')
    const { jobId } = await planOrJoin(deps, { storyboardId: sb.id })
    // Its job runs on that storyboard; the main storyboard's plan is not it.
    expect(store.get().jobs[jobId].node).toEqual({ kind: 'storyboard', id: sb.id })
    expect(runningPlan(store.get(), sb.id)).toBe(jobId)
    expect(runningPlan(store.get())).toBeUndefined()
    expect(purposeOf(store.get().jobs[jobId])).toEqual({ for: 'shot_list', storyboardId: sb.id })
    await land()
    await vi.waitFor(() => expect(shotsOf(store.get(), sb.id).length).toBeGreaterThan(0), { timeout: 4000, interval: 10 })
    expect(shotsOf(store.get()).length).toBe(0)
    // The words moved from the second script's scene into its shots; the main script's stay.
    expect(scenesOf(store.get(), script.id).map((s) => s.text ?? '').join('')).toBe('')
    expect(scenesOf(store.get()).map((s) => s.text).join('')).toContain('razor')
    await store.close()
  })

  it('draws a frame of the open storyboard\'s shot at its ratio', async () => {
    const { store, deps, land, sb } = await setup()
    await planOrJoin(deps, { storyboardId: sb.id })
    await land()
    await vi.waitFor(() => expect(shotsOf(store.get(), sb.id).length).toBeGreaterThan(0), { timeout: 4000, interval: 10 })
    const first = shotsOf(store.get(), sb.id)[0]
    const jobId = await drawFrame(deps, 0, 'first', { storyboardId: sb.id })
    expect(store.get().jobs[jobId].node).toEqual({ kind: 'shot', id: first.id })
    expect(deps.ui.get().jobs[jobId].request!.input.ratio).toBe('9:16')
    // The Storyboard panel shows the storyboard opened on the canvas.
    expect(openStoryboard(store.get(), { storyboard: sb.id })!.id).toBe(sb.id)
    expect(openStoryboard(store.get(), {})!.id).toBe(mainStoryboard(store.get())!.id)
    await store.close()
  })

  it('a clip of its shot lands in the video that storyboard renders, and its ad renders that video', async () => {
    const { store, deps, land, sb, video } = await setup()
    await planOrJoin(deps, { storyboardId: sb.id })
    await land()
    await vi.waitFor(() => expect(shotsOf(store.get(), sb.id).length).toBeGreaterThan(0), { timeout: 4000, interval: 10 })
    const shots = shotsOf(store.get(), sb.id)
    for (const [i] of shots.entries()) {
      await drawFrame(deps, i, i ? 'next' : 'first', { storyboardId: sb.id })
      await land()
    }
    for (const s of shots) {
      const clip = await makeClip(deps, s.id, { videoId: video.id })
      expect(deps.ui.get().jobs[clip].request!.input.ratio).toBe('9:16')
    }
    await land()
    await vi.waitFor(() => expect(shots.every((s) => !!currentTake(store.get(), s.id, video.id))).toBe(true), { timeout: 4000, interval: 10 })
    expect(edlOf(store.get(), video.id)).toHaveLength(shots.length)
    expect(edlOf(store.get(), mainVideo(store.get())!.id)).toHaveLength(0)
    const ad = await renderAd(deps, { videoId: video.id })
    expect(store.get().jobs[ad].node).toEqual({ kind: 'video', id: video.id })
    expect(purposeOf(store.get().jobs[ad])).toEqual({ for: 'stitch', videoId: video.id })
    await land()
    await vi.waitFor(() => expect(currentRender(store.get(), video.id)).toBeTruthy(), { timeout: 4000, interval: 10 })
    expect(currentRender(store.get(), mainVideo(store.get())!.id)).toBeUndefined()
    await store.close()
  })
})
