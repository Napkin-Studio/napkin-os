// composeScript: the one row model both views render (features/script-editor.clan).

import { describe, expect, it } from 'vitest'
import { ranksBetween } from '../../../clan-store/src'
import type { Beat, ProductionDocument, Scene, Shot } from '../contracts/types'
import { mainScript, mainStoryboard } from '../model/selectors'
import { id, MAYA, modelStore } from '../test/model'
import { composeScript, neighboursAt, roughSeconds, sceneAt } from './compose'

async function doc(): Promise<ProductionDocument> {
  const s = modelStore()
  await s.create(MAYA, 'Rows')
  return structuredClone(s.get())
}

function scene(d: ProductionDocument, rank: string, heading: string): Scene {
  const sc = { id: id('scene'), v: 1, field_v: {}, script_id: mainScript(d)!.id, rank, heading } as Scene
  d.scenes[sc.id] = sc
  return sc
}
function shot(d: ProductionDocument, rank: string, extra: Partial<Shot> = {}): Shot {
  const s = { id: id('shot'), v: 1, field_v: {}, storyboard_id: mainStoryboard(d)!.id, rank, kind: 'shot', duration_s: 2, camera: { size: 'medium' }, status: 'planned', ...extra } as Shot
  d.shots[s.id] = s
  return s
}
function beat(d: ProductionDocument, shotId: string, rank: string, at_s: number): Beat {
  const b = { id: id('beat'), v: 1, field_v: {}, shot_id: shotId, rank, at_s, kind: 'moment' } as Beat
  d.beats[b.id] = b
  return b
}

describe('composeScript', () => {
  it('orders scenes by rank, shots by scene then rank, beats by at_s then rank; scene-less shots after the last scene; the end card last', async () => {
    const d = await doc()
    const [r1, r2] = ranksBetween(null, null, 2)
    const b = scene(d, r2, 'INT. CAR')
    const a = scene(d, r1, 'EXT. BEACH')
    const end = shot(d, 'a0', { kind: 'end_card' })
    const s3 = shot(d, 'a3', { scene_id: b.id })
    const loose = shot(d, 'a1')
    const s2 = shot(d, 'a5', { scene_id: a.id })
    const s1 = shot(d, 'a4', { scene_id: a.id })
    const gone = shot(d, 'a2', { scene_id: 'scene_' + '0'.repeat(26) })
    const late = beat(d, s1.id, 'a0', 1.5)
    const early = beat(d, s1.id, 'a1', 0.5)
    const tie = beat(d, s1.id, 'a0', 0.5)
    const c = composeScript(d)!
    expect(c.rows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      `scene:${a.id}`, `shot:${s1.id}`, `beat:${tie.id}`, `beat:${early.id}`, `beat:${late.id}`, `shot:${s2.id}`,
      `scene:${b.id}`, `shot:${s3.id}`,
      `shot:${loose.id}`, `shot:${gone.id}`,
      `end_card:${end.id}`,
    ])
    expect(c.shots.map((s) => s.id)).toEqual([s1.id, s2.id, s3.id, loose.id, gone.id, end.id])
    expect(c.rows.filter((r) => r.kind === 'shot').map((r) => (r.kind === 'shot' ? r.start_s : -1))).toEqual([0, 2, 4, 6, 8])
    expect(c.total_s).toBe(12)
  })

  it('a drop lands between neighbours, in the scene of the shot above (or below at the top)', async () => {
    const d = await doc()
    const a = scene(d, 'a0', 'EXT. BEACH')
    const b = scene(d, 'a1', 'INT. CAR')
    const s1 = shot(d, 'a0', { scene_id: a.id })
    const s2 = shot(d, 'a1', { scene_id: b.id })
    const s3 = shot(d, 'a2', { scene_id: b.id })
    const rows = composeScript(d)!.rows
    const ids = [s1.id, s2.id, s3.id]
    expect(neighboursAt(ids, s3.id, 0)).toEqual({ beforeId: null, afterId: s1.id })
    expect(neighboursAt(ids, s1.id, 2)).toEqual({ beforeId: s3.id, afterId: null })
    expect(sceneAt(rows, null, s1.id)).toBe(a.id)
    expect(sceneAt(rows, s1.id, s2.id)).toBe(a.id)
    expect(sceneAt(rows, s2.id, null)).toBe(b.id)
  })

  it('a rough length from the words before there are shots', () => {
    expect(roughSeconds('Maya walks.\nShe stops.\n\nMAYA\nIt is perfect today, isn\'t it?')).toBe(6.4)
  })
})
