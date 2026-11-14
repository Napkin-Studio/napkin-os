// Each decision targets only what it changed (smoke test 2026-10-13: "start clip for shot 3" targeted the
// other clips' jobs[…].director). A director block keeps `question: null`; the store drops nulls (RFC 7396),
// so a draft holding one must not differ from the store for ever.

import { describe, expect, it } from 'vitest'
import type { DocJob } from '../contracts/types'
import { systemUpdate } from '../doc/store'
import { addShots, id, MAYA, modelStore, T } from '../test/model'

describe('decision targets with several jobs in flight', () => {
  it('each start, and each job state change, targets only its own job', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Soup')
    let shots: ReturnType<typeof addShots> = []
    await systemUpdate(s, (d) => { shots = addShots(d, 3) }, 'edit')
    const jobs: string[] = []
    const start = async (shot: string) => {
      const jid = id('job')
      jobs.push(jid)
      await systemUpdate(s, (d) => {
        d.jobs[jid] = {
          id: jid, v: 1, field_v: {}, op: 'clip', state: 'queued', node: { kind: 'shot', id: shot }, purpose: 'clip',
          started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: `n_${jid.slice(-12)}`, crew: 'wren',
          parent_ids: [], input_hashes: [], created_at: T,
        } as DocJob
      }, 'submit clip')
    }
    const direct = async (jid: string) => {
      await systemUpdate(s, (d) => {
        d.jobs[jid].state = 'submitted'
        d.jobs[jid].director = { model: 'claude', promptVersion: 'director.v6', rationale: 'r', output: { op: 'clip', question: null, rationale: 'r', confidence: 0.5 } }
      })
    }
    // Polls land while the next start is pending: nothing waits for a write in between.
    await start(shots[0].id)
    await direct(jobs[0])
    await start(shots[1].id)
    await direct(jobs[1])
    await start(shots[2].id)
    await direct(jobs[1])
    await start(shots[0].id)
    await s.flush()
    const docId = s.documentId()
    const chain = await s.chain()
    const starts = chain.filter((e) => e.action.startsWith('start clip'))
    expect(starts).toHaveLength(4)
    for (const [k, e] of [...starts].reverse().entries()) {
      const own = `${docId}#jobs[${jobs[k]}]`
      expect(e.targets!.every((t) => t.startsWith(own))).toBe(true)
    }
    // The director block stays as written, without its nulls, and no write re-sets it.
    expect(s.get().jobs[jobs[0]].director?.output).toEqual({ op: 'clip', rationale: 'r', confidence: 0.5 })
  })
})
