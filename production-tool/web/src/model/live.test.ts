// A deleted picture's reference stops counting (model/live.ts): out of scope, out of the @ names and out
// of every request, its name free; the canvas's undo brings it all back. And a plan whose words name a
// bare @key with no live front is stopped before anything is sent (lib/names.ts checkFronts), until a
// front is chosen (jobs/fronts.ts). On the real CLAN store (modelStore), with the mock relay.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../jobs/assets', () => ({
  assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }),
}))

import type { JobRequest, Key, Link, NamedRef, ProductionDocument } from '../contracts/types'
import { SnapshotStore, systemUpdate, updateDoc } from '../doc/store'
import { initialUi, type UiState } from '../doc/ui'
import { setFront } from '../jobs/fronts'
import { nameAsset } from '../jobs/prompt'
import { planShots } from '../jobs/plan'
import { JobRunner } from '../jobs/runner'
import { shotRefSet } from '../jobs/select'
import { plainJobError } from '../jobs/errorWords'
import { FrontsMissingError, frontKeysIn, keyViews, wholeKeys } from '../lib/names'
import { MockRelay, type MockRenderer } from '../relay/mock'
import { addShots, asset, id, MAYA, modelStore, SHA, scriptWords } from '../test/model'
import { deadRefs, lifeOf, liveGet, liveInput } from './live'
import { scopeOf } from './scope'
import { mainStoryboard, refName, refsList } from './selectors'
import type { ModelStore } from './store'

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(r))
}

const ref = (key: Key, variant: string, node: string, sha: string, role: NamedRef['role'] = 'location'): NamedRef =>
  ({ id: id('ref'), v: 1, field_v: {}, key, variant, role, asset: sha, node, named_at: '2026-10-20T10:00:00Z' })

/** @home with four views on the canvas (front, side, close-up, surroundings), its key linked into the
 *  storyboard, and two shots that name @home. */
async function seeded() {
  const s = modelStore()
  await s.create(MAYA, 'Kapi')
  const out = { front: '', side: '', closeup: '', around: '', keyId: '', link: '', shots: [] as string[] }
  await systemUpdate(s, (d) => {
    const keyId = id('key')
    d.keys[keyId] = { id: keyId, v: 1, field_v: {}, key: 'home', role: 'location' }
    const views = [ref('home', 'front', 'n_front', SHA('a')), ref('home', 'side', 'n_side', SHA('b')), ref('home', 'closeup', 'n_close', SHA('c')), ref('home', 'surroundings', 'n_around', SHA('e'))]
    for (const r of views) { d.refs[r.id] = r; d.assets[r.asset!] = asset(r.asset!, 'image', { origin: 'uploaded' }) }
    const sb = mainStoryboard(d)!
    const l: Link = { id: id('link'), v: 1, field_v: {}, from: { kind: 'key', id: keyId }, to: { kind: 'storyboard', id: sb.id }, role: 'location' }
    d.links[l.id] = l
    const shots = addShots(d, 2)
    shots[0].action = 'Kapi runs to @home.'
    shots[1].action = 'Dusk falls on @home.'
    Object.assign(out, { front: views[0].id, side: views[1].id, closeup: views[2].id, around: views[3].id, keyId, link: l.id, shots: shots.map((x) => x.id) })
  }, 'sync')
  await updateDoc(s, (d) => scriptWords(d, 'EXT. HOME - DUSK\nKapi runs to @home_closeup.'), 'edit')
  await s.flush()
  if (s.trouble) throw new Error(`the fixture was refused: ${s.trouble}`)
  return { s, ...out }
}

const ALL = ['n_front', 'n_side', 'n_close', 'n_around']
const without = (...gone: string[]) => new Set(ALL.filter((n) => !gone.includes(n)))

function withRunner(s: ModelStore) {
  const renderer: MockRenderer = { async render() { return [] } }
  const relay = new MockRelay({ renderer, now: () => 1_000_000, delayMs: 2000, persistKey: null })
  const sent: JobRequest[] = []
  const real = relay.createJob.bind(relay)
  vi.spyOn(relay, 'createJob').mockImplementation(async (req) => { sent.push(req); return real(req) })
  const ui = new SnapshotStore<UiState>(initialUi())
  const runner = new JobRunner(relay, s, ui)
  return { relay, runner, sent, deps: { relay, doc: s, ui, runner } }
}

const names = (d: ProductionDocument, ids: string[]) => ids.map((x) => (d.refs[x] ? refName(d.refs[x]) : x))

describe('a deleted picture’s reference stops counting', () => {
  it('is left out of scope, the key’s views and the @ names, and comes back when the picture does', async () => {
    const { s, keyId } = await seeded()
    const sb = mainStoryboard(s.get())!.id
    lifeOf(s).set(new Set(ALL))
    const scoped = () => scopeOf(liveGet(s), sb).filter((it) => it.kind === 'ref').map((it) => it.name)
    expect(scoped()).toContain('home_front')
    // The front's picture is deleted on the canvas: nothing is written to the document.
    const before = structuredClone(s.get())
    lifeOf(s).set(without('n_front'))
    expect(s.get()).toEqual(before)
    expect(scoped()).not.toContain('home_front')
    expect(scopeOf(liveGet(s), sb).find((it) => it.kind === 'key' && it.id === keyId)?.label).toBe('@home · 3 views')
    expect(keyViews(liveGet(s), 'home').sent.map(refName)).not.toContain('home_front')
    expect(wholeKeys(liveGet(s))).toEqual([]) // no front left: @home cannot be named bare
    // Undo on the canvas: the picture is back, and so is everything.
    lifeOf(s).set(new Set(ALL))
    expect(scoped()).toContain('home_front')
    expect(wholeKeys(liveGet(s))).toEqual(['home'])
    await s.close()
  })

  it('is never in a built request, and the runner drops one a caller still passes', async () => {
    const { s, front, side, shots } = await seeded()
    const { runner, sent } = withRunner(s)
    lifeOf(s).set(without('n_side'))
    const shot = liveGet(s).shots[shots[0]]
    expect(shotRefSet(liveGet(s), shot).map((x) => refName(x.ref))).not.toContain('home_side')
    // A request built before the delete still carries @home_side: the runner's guard takes it out.
    const input = { text: 'x', refs: [front, side].map((r) => ({ id: r, name: refName(s.get().refs[r]), role: 'location' as const, kind: 'picture' as const, asset: { sha256: SHA('a'), url: 'u', mime: 'image/png' as const } })) }
    await runner.submit('generate', input, [], { for: 'canvas' })
    await flush()
    expect(names(s.get(), sent[0].input.refs!.map((r) => r.id))).toEqual(['home_front'])
    expect(liveInput(input, deadRefs(s.get(), lifeOf(s).get())).refs!.map((r) => r.id)).toEqual([front])
    runner.stop?.()
    await s.close()
  })

  it('Plan shots sends only the live views; back on undo', async () => {
    const { s } = await seeded()
    const { deps, sent } = withRunner(s)
    lifeOf(s).set(without('n_front', 'n_side'))
    await planShots(deps)
    await flush()
    expect(sent[0].op).toBe('shot_list')
    expect(sent[0].input.refs!.map((r) => r.name).sort()).toEqual(['home_closeup', 'home_surroundings'])
    lifeOf(s).set(new Set(ALL))
    await planShots(deps)
    await flush()
    expect(sent[1].input.refs!.map((r) => r.name)).toContain('home_front')
    deps.runner.stop?.()
    await s.close()
  })

  it('frees its name: naming another picture with it takes it, as one undo step', async () => {
    const { s, side } = await seeded()
    lifeOf(s).set(without('n_side'))
    const made = await nameAsset(s, SHA('f'), { key: 'home', variant: 'side', role: 'location' }, 'n_newpic')
    expect(made).not.toBe(side)
    expect(refsList(s.get()).filter((r) => refName(r) === 'home_side').map((r) => r.node)).toEqual(['n_newpic'])
    await s.undo()
    expect(refsList(s.get()).filter((r) => refName(r) === 'home_side').map((r) => r.node)).toEqual(['n_side'])
    await s.close()
  })
})

describe('a bare @key with no front stops a plan before anything is sent', () => {
  async function kapi(words: string) {
    const s = modelStore()
    await s.create(MAYA, 'Kapi')
    const ids = { ref: '', side: '' }
    await systemUpdate(s, (d) => {
      const k = id('key')
      d.keys[k] = { id: k, v: 1, field_v: {}, key: 'kapi', role: 'character' }
      const a = ref('kapi', 'ref', 'n_kref', SHA('1'), 'character')
      const b = ref('kapi', 'side', 'n_kside', SHA('2'), 'character')
      for (const r of [a, b]) { d.refs[r.id] = r; d.assets[r.asset!] = asset(r.asset!, 'image', { origin: 'uploaded' }) }
      const h = id('key')
      d.keys[h] = { id: h, v: 1, field_v: {}, key: 'home', role: 'location' }
      const hf = ref('home', 'front', 'n_hfront', SHA('3'))
      d.refs[hf.id] = hf
      d.assets[hf.asset!] = asset(hf.asset!, 'image', { origin: 'uploaded' })
      Object.assign(ids, { ref: a.id, side: b.id, homeFront: hf.id })
    }, 'sync')
    await updateDoc(s, (d) => scriptWords(d, words), 'edit')
    await s.flush()
    lifeOf(s).set(new Set(['n_kref', 'n_kside', 'n_hfront']))
    return { s, ...ids, ...withRunner(s) }
  }

  it('says which key and sends nothing', async () => {
    const { s, deps, sent } = await kapi('EXT. PARK - DAY\n@kapi chases a ball to @home.')
    const err = await planShots(deps).catch((e) => e)
    expect(err).toBeInstanceOf(FrontsMissingError)
    expect(err.keys).toEqual(['kapi'])
    expect(err.message).toBe('Set a front for @kapi first: @kapi stands for the whole character, led by its front.')
    expect(frontKeysIn(err.message)).toEqual(['kapi'])
    expect(sent).toEqual([])
    expect(Object.keys(s.get().jobs)).toEqual([])
    deps.runner.stop?.()
    await s.close()
  })

  it('names every key that lacks one; a deleted front does not count', async () => {
    const { s, deps, sent } = await kapi('EXT. PARK - DAY\n@kapi chases a ball to @home.')
    lifeOf(s).set(new Set(['n_kref', 'n_kside'])) // @home's front was deleted on the canvas
    const err = await planShots(deps).catch((e) => e)
    expect(err.keys).toEqual(['kapi', 'home'])
    expect(err.message).toBe('Set a front for @kapi and @home first: each stands for the whole character, led by its front.')
    expect(frontKeysIn(err.message)).toEqual(['kapi', 'home'])
    expect(sent).toEqual([])
    deps.runner.stop?.()
    await s.close()
  })

  it('choosing a front renames that picture kapi_front (one undo step), and the plan then sends it', async () => {
    const { s, side, deps, sent } = await kapi('EXT. PARK - DAY\n@kapi chases a ball.')
    await expect(planShots(deps)).rejects.toThrow(FrontsMissingError)
    expect(await setFront(s, side)).toBe('kapi_front')
    expect(refName(s.get().refs[side])).toBe('kapi_front')
    await planShots(deps)
    await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0].input.refs!.map((r) => r.name)).toContain('kapi_front')
    await s.undo()
    expect(refName(s.get().refs[side])).toBe('kapi_side')
    deps.runner.stop?.()
    await s.close()
  })

  it('a front only a deleted picture held is free: the chosen one takes it, and undo puts it back', async () => {
    const { s, ref: kref, deps } = await kapi('@kapi waits.')
    const deadFront = ref('kapi', 'front', 'n_gone', SHA('4'), 'character')
    await systemUpdate(s, (d) => { d.refs[deadFront.id] = deadFront }, 'sync')
    await s.flush()
    await expect(planShots(deps)).rejects.toThrow('Set a front for @kapi first')
    await setFront(s, kref)
    expect(s.get().refs[deadFront.id]).toBeUndefined()
    expect(refName(s.get().refs[kref])).toBe('kapi_front')
    await s.undo()
    expect(refName(s.get().refs[deadFront.id])).toBe('kapi_front')
    expect(refName(s.get().refs[kref])).toBe('kapi_ref')
    deps.runner.stop?.()
    await s.close()
  })
})

describe('the relay’s director error in plain words', () => {
  it('a refused plan says what to do; other errors stay as they came', () => {
    const e = { code: 'internal' as const, message: 'The director failed (DirectorError).', retryable: true }
    expect(plainJobError(e, 'shot_list').message).toMatch(/^Dex could not plan these shots/)
    expect(plainJobError(e, 'shot_list').code).toBe('internal')
    const other = { code: 'timeout' as const, message: 'Runway took too long.', retryable: true }
    expect(plainJobError(other, 'clip')).toBe(other)
  })
})
