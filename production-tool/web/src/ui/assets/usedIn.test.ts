// UAT round 5, S3-5 (features/pt-canvas-r5.clan): the @leo card said "Used in · 0" while @leo_front (kept from frame 1)
// was on all four frames, and "Show it on the canvas" was off with no reason.
import { describe, expect, it } from 'vitest'
import type { NamedRef, ProductionDocument } from '../../contracts/types'
import { showTarget, usedIn } from './usedIn'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const SB = 'storyboard_01M7Y8BVS2N21AZY5KVZV0WMJ0'
const KEY = { id: 'key_01M7Y8G4XK4K435J47RTTXKVV0', v: 1, field_v: {}, key: 'leo', role: 'character' } as const
const LEO = { id: 'ref_01M7Y8G4XK4K435J47RTTXKVV0', v: 1, field_v: {}, key: 'leo', variant: 'front', role: 'character', asset: SHA('1') } as unknown as NamedRef

function repro(): ProductionDocument {
  const actions = ['Leo unlocks his bike outside a bakery at dawn.', 'He rides along a misty canal path.', 'He stops on a stone bridge to watch rowers pass below.', 'He hangs the bike on the wall of his woodwork shop and smiles.']
  const shots: Record<string, unknown> = {}, frames: Record<string, unknown> = {}, jobs: Record<string, unknown> = {}
  actions.forEach((action, i) => {
    const id = `shot_01M7Y8BVS2N21AZY5KVZV0WMJ${i + 1}`
    const fid = `frame_01M7Y8BVS2N21AZY5KVZV0WMJ${i + 1}`
    const jid = `job_01M7Y8BVS2N21AZY5KVZV0WMJ${i + 1}`
    shots[id] = { id, v: 1, field_v: {}, storyboard_id: SB, kind: 'shot', action, duration_s: 4, rank: `a${i}`, refs: [], pick: { current: fid } }
    frames[fid] = { id: fid, v: 1, field_v: {}, shot_id: id, asset: SHA(String(i + 1)), version: 1, job_id: jid }
    // Frames 2-4 were drawn with @leo_front, the person kept from frame 1.
    jobs[jid] = { id: jid, op: 'frame', inputs: i ? [{ kind: 'ref', ref: LEO.id, used_as: 'character', included: true }] : [] }
  })
  return {
    storyboards: { [SB]: { id: SB, v: 1, field_v: {}, title: 'Storyboard 3' } },
    shots, frames, jobs, keys: { [KEY.id]: KEY }, refs: { [LEO.id]: LEO }, beats: {}, links: {}, scripts: {}, videos: {},
  } as unknown as ProductionDocument
}

describe('a character card counts every shot the person is in, on every storyboard (S3-5)', () => {
  it('@leo is in all four shots of a storyboard that is not the main one', () => {
    expect(usedIn(repro(), KEY as never, [LEO]).map((u) => u.n)).toEqual([1, 2, 3, 4])
  })
  it('Show it on the canvas goes to the frame\'s storyboard; with nothing to show, it says why', () => {
    expect(showTarget(repro(), LEO)).toEqual({ storyboard: SB })
    expect(showTarget(repro(), { ...LEO, node: 'el_1' } as NamedRef)).toEqual({ node: 'el_1' })
    const lost = showTarget(repro(), { ...LEO, asset: SHA('9') } as NamedRef)
    expect('why' in lost && lost.why).toMatch(/not on the canvas/)
  })
})
