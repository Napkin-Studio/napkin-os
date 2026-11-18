// A take's references (live test 2026-11-16): a character that reaches the shots only through the
// Script's input link (offered, jobs/select.ts shotRefSet) goes with a together box's take, as with a
// clip, characters first; what the person unticked on every shot stays out.
import { describe, expect, it, vi } from 'vitest'
import type { JobInput, ProductionDocument } from '../contracts/types'
import { SnapshotDocumentStore } from '../doc/store'
import { mainScript, mainVideo } from '../model/selectors'
import { MAYA, addRef, snapshotDoc } from '../test/jobFixtures'
import { SHA, addFrame, addShots } from '../test/model'
import { makeTake } from './clips'

vi.mock('./assets', () => ({ assetRef: async (_relay: unknown, sha: string) => ({ sha256: sha, url: `https://cdn.test/${sha}`, mime: 'image/png' }) }))

function box(opts: { frames: boolean; declined?: (shotIds: string[], ids: { side: string }) => Record<string, string[]> }) {
  const d = structuredClone(snapshotDoc(MAYA).get()) as ProductionDocument
  const shots = addShots(d, 2)
  shots.forEach((s, i) => Object.assign(s, { duration_s: 3, action: i === 0 ? '@mira walks into the workshop.' : '@mira waves.' }))
  const front = addRef(d, 'mira', 'front', SHA('a'))
  const side = addRef(d, 'mira', 'side', SHA('b'))
  const script = mainScript(d)!.id
  for (const r of [front, side]) {
    d.links[`link_${r.id}`] = { id: `link_${r.id}`, v: 1, field_v: {}, from: { kind: 'ref', id: r.id }, to: { kind: 'script', id: script }, role: 'character' } as ProductionDocument['links'][string]
  }
  if (opts.frames) shots.forEach((s, i) => addFrame(d, s, SHA(String(i + 1)), { pick: true }))
  const videoId = mainVideo(d)!.id
  d.videos[videoId].runs = { run_1: { shot_ids: shots.map((s) => s.id), mode: opts.frames ? 'take' : 'take_refs', model: 'wan3', state: 'planned', planned_by: 'human' } }
  const store = new SnapshotDocumentStore(d, null, 0)
  const sent: JobInput[] = []
  const runner = { submit: vi.fn(async (_op: string, input: JobInput) => { sent.push(input); return 'job_1' }) }
  const declinedAdds = opts.declined?.(shots.map((s) => s.id), { side: side.id })
  const deps = { relay: {} as never, doc: store as never, ui: { get: () => ({ jobs: {}, ...(declinedAdds ? { declinedAdds } : {}) }) } as never, runner: runner as never }
  return { deps, sent, videoId, front, side }
}

describe('a take sends the characters the Script brings in', () => {
  it('a frameless together box (take_refs) sends mira front and side, characters first, as optional', async () => {
    const a = box({ frames: false })
    await makeTake(a.deps, a.videoId, 'run_1', { refsMax: 10 })
    const [input] = a.sent
    expect(input.mode).toBe('take_refs')
    expect(input.refs!.map((r) => r.id)).toEqual([a.front.id, a.side.id])
    expect(input.refs!.every((r) => r.role === 'character' && r.optional)).toBe(true)
  })

  it('a take pinned on a frame still sends the refs the relay resolves @mira against', async () => {
    const a = box({ frames: true })
    await makeTake(a.deps, a.videoId, 'run_1', { refsMax: 10 })
    const [input] = a.sent
    expect(input.mode).toBe('take')
    expect(input.image).toBeTruthy()
    expect(input.refs!.map((r) => r.id)).toEqual([a.front.id, a.side.id])
  })

  it('a picture the person unticked on every shot stays out; the cap keeps characters first', async () => {
    const a = box({ frames: false, declined: (ids, { side }) => Object.fromEntries(ids.map((id) => [id, [side]])) })
    await makeTake(a.deps, a.videoId, 'run_1', { refsMax: 10 })
    expect(a.sent[0].refs!.map((r) => r.id)).toEqual([a.front.id])
    const b = box({ frames: false })
    await makeTake(b.deps, b.videoId, 'run_1', { refsMax: 1 })
    expect(b.sent[0].refs!.map((r) => r.id)).toEqual([b.front.id])
  })
})
