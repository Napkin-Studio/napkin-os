// A finished clip whose landing was refused (a rationale over the .clan's limit, owner 2026-10-15)
// lands when the project opens; one whose take was deleted on purpose stays gone.

import { describe, expect, it } from 'vitest'
import type { Job } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { addShots, job, MAYA, modelStore, SHA } from '../test/model'
import { landTake } from './handlers'
import { landMissedClips } from './wire'

async function project() {
  const s = modelStore()
  await s.create(MAYA, 'Baby')
  let shotId = ''
  const ids: string[] = []
  await systemUpdate(s, (d) => {
    shotId = addShots(d, 1)[0].id
    for (const c of ['a', 'b']) {
      const j = job(d, 'clip', [], SHA(c), { node: { kind: 'shot', id: shotId }, purpose: 'clip', provider: 'runway', model: 'veo3.1' })
      d.jobs[j.id] = j
      ids.push(j.id)
    }
  }, 'sync')
  return { s, shotId, ids }
}

describe('finished clips that never landed', () => {
  it('land when the project opens, once', async () => {
    const { s, ids } = await project()
    expect(await landMissedClips(s)).toBe(2)
    expect(Object.values(s.get().generations).map((t) => t.job_id).sort()).toEqual([...ids].sort())
    expect(await landMissedClips(s)).toBe(0)
  })

  it('a clip whose take was deleted after it landed stays gone', async () => {
    const { s, shotId, ids } = await project()
    await landTake(s, { jobId: ids[0], op: 'clip', outputs: [{ sha256: SHA('a') }], provider: 'runway', model: 'veo3.1', kind: 'generated' } as unknown as Job, { for: 'clip', shotId })
    await systemUpdate(s, (d) => { for (const t of Object.values(d.generations)) delete d.generations[t.id]; for (const v of Object.values(d.videos)) v.timeline = {} }, 'delete the clip')
    expect(await landMissedClips(s)).toBe(1)
    expect(Object.values(s.get().generations).map((t) => t.job_id)).toEqual([ids[1]])
  })
})
