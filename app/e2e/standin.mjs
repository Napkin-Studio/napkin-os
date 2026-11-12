// The stand-in middleware of the e2e stack (stack.mjs), local and free. It speaks napkin.middleware/1 only as far as the job block
// the landing reads. Phase 2 (features/j001-phase2-suite.clan): a task with a file in seed/j001/p2/answers/ gets that file's reply
// (see answers.mjs); POST /control {fail: <task>} makes that task return a provider error once; {variant: {<task>: <name>}} picks an
// answer variant; GET /control/log lists the tasks asked, and nothing else (no body). Any other task gets the old canned reply, byte for byte.
// Moved out of stack.mjs so a unit test can start it on a free port (app/tests/phase2Suite.test.ts).

import { createServer } from 'node:http'
import { answerFor } from './seed/j001/p2/answers.mjs'

/** A new stand-in server (not listening yet): `standIn().listen(port, '127.0.0.1')`. */
export function standIn(answersDir) {
  let job = { state: 'running', stage: 'research' }
  const failNext = new Set()
  const variants = {}
  const asked = []
  return createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const send = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
      if (req.url === '/control/log' && req.method === 'GET') return send(200, asked)
      if (req.url === '/control' && req.method === 'POST') {
        const { fail, variant, ...state } = JSON.parse(body || '{}')
        if (typeof fail === 'string') failNext.add(fail)
        if (variant && typeof variant === 'object') Object.assign(variants, variant)
        job = { ...job, ...state }
        return send(200, job)
      }
      let task = null
      try { task = JSON.parse(body || '{}')?.payload?.task ?? null } catch { /* not JSON: the old reply */ }
      if (typeof task === 'string') asked.push({ task, at: new Date().toISOString() })
      if (typeof task === 'string' && failNext.delete(task)) {
        return send(502, { error: { type: 'provider_error', message: 'e2e stand-in: the provider failed' } })
      }
      const answer = typeof task === 'string' ? answerFor(task, variants[task], answersDir) : null
      if (answer) {
        return send(200, {
          api: 'napkin.middleware/1',
          job: { id: 'job_e2e0002', state: 'done', stage: 'done', progress: { done: 1, total: 1 }, started_at: '2026-11-04T09:00:00Z' },
          ...answer,
        })
      }
      send(200, {
        api: 'napkin.middleware/1', task: 'start_campaign', handler: 'start_campaign@1.0',
        job: { id: 'job_e2e0001', state: job.state, stage: job.stage, progress: { done: 2, total: 6 }, started_at: '2026-11-04T09:00:00Z' },
        result: { summary: 'e2e stand-in' }, change: null, trace: {},
      })
    })
  })
}
