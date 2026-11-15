// The stand-in middleware of the e2e stack (stack.mjs), local and free. It speaks napkin.middleware/1 only as far as the job block
// the landing reads. Phase 2 (features/j001-phase2-suite.clan): a task with a file in seed/j001/p2/answers/ gets that file's reply
// (see answers.mjs); POST /control {fail: <task>} makes that task return a provider error once; {variant: {<task>: <name>}} picks an
// answer variant; GET /control/log lists the tasks asked, and nothing else (no body). A judge_work answer carries a usage block (what the
// run cost), as the real middleware's does. Any other task gets the old canned reply, byte for byte.
// Moved out of stack.mjs so a unit test can start it on a free port (app/tests/phase2Suite.test.ts).

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { answerFor } from './seed/j001/p2/answers.mjs'

// Judge (features/judge.clan): the fixture backend of the stand-in. An answer for judge_work holds `result.fail`, how many tests of each
// dimension fail ({ idea, craft, effect }); asked for a kind of work, the stand-in writes all thirty of that kind's tests from the rubric
// (server/napkin/judge/rubric.json): the last N llm tests of a dimension fail, the rest pass, each with a line of evidence. The host adds
// them up. An answer with `_status` and `error` is a refusal the middleware makes (ai_off, not_eu, not_configured, spend_refused).
function judgeTests(rubric, kind, fail) {
  const out = []
  for (const dim of ['idea', 'craft', 'effect']) {
    const set = rubric.tests.filter(t => t.dim === dim && (t.kind === null || t.kind === kind))
    const llm = set.filter(t => t.method === 'llm')
    const failing = new Set(llm.slice(Math.max(0, llm.length - (fail?.[dim] ?? 0))).map(t => t.id))
    for (const t of set) out.push({ id: t.id, value: failing.has(t.id) ? 'fail' : 'pass', evidence: `Fixture evidence for ${t.id}.` })
  }
  return out
}

/** A new stand-in server (not listening yet): `standIn().listen(port, '127.0.0.1')`. */
export function standIn(answersDir, rubricPath = new URL('../../server/napkin/judge/rubric.json', import.meta.url)) {
  // State is kept apart per caller (the e2e README, "Several workers"). A request from napkin-web carries the document it came from
  // (`clan.id`) and, when the document has one, its client (`clan.workspace_client.id`); the host sends nothing else that names the caller
  // (the tenant is not in it, and x-napkin-agency is shared by every test of an agency). A test says which documents and clients are its own
  // with POST /control {scope: {docs: [...], clients: [...]}, ...}: that makes (or finds) one state for those ids, and a request is answered from
  // the state of its client or document. A request that matches no scope, and a /control with no scope, use the shared state, as before.
  const fresh = () => ({ job: { state: 'running', stage: 'research' }, failNext: new Set(), variants: {} })
  const shared = fresh()
  const byId = new Map() // a document id or a client id -> its state
  const asked = []
  const idsOf = body => {
    const clan = body?.clan
    const doc = typeof clan?.id === 'string' ? clan.id : null
    const client = typeof clan?.workspace_client?.id === 'string' ? clan.workspace_client.id : null
    return { doc, client }
  }
  const stateFor = ({ doc, client }) => {
    const st = (doc && byId.get(doc)) || (client && byId.get(client)) || null
    // A document of a client that has a scope belongs to it too, so a document the page made later is found by its client.
    if (st) for (const id of [doc, client]) if (id && !byId.has(id)) byId.set(id, st)
    return st
  }
  return createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const send = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
      const url = new URL(req.url, 'http://stand-in')
      if (url.pathname === '/control/log' && req.method === 'GET') {
        // ?docs=a,b&clients=c: only what was asked about those documents or clients (and what the clients' later documents asked).
        const docs = (url.searchParams.get('docs') ?? '').split(',').filter(Boolean)
        const clients = (url.searchParams.get('clients') ?? '').split(',').filter(Boolean)
        if (!docs.length && !clients.length) return send(200, asked.map(({ task, at }) => ({ task, at })))
        const mine = new Set([...docs, ...clients].map(id => byId.get(id)).filter(Boolean))
        return send(200, asked
          .filter(e => docs.includes(e.doc) || clients.includes(e.client) || (mine.size > 0 && mine.has(stateFor(e))))
          .map(({ task, at }) => ({ task, at })))
      }
      if (url.pathname === '/control' && req.method === 'POST') {
        const { fail, variant, scope, ...state } = JSON.parse(body || '{}')
        let st = shared
        const ids = [...(scope?.docs ?? []), ...(scope?.clients ?? [])].filter(id => typeof id === 'string' && id)
        if (ids.length) {
          st = ids.map(id => byId.get(id)).find(Boolean) ?? fresh()
          for (const id of ids) byId.set(id, st)
        }
        if (typeof fail === 'string') st.failNext.add(fail)
        if (variant && typeof variant === 'object') Object.assign(st.variants, variant)
        st.job = { ...st.job, ...state }
        return send(200, st.job)
      }
      let task = null
      let parsed = null
      try { parsed = JSON.parse(body || '{}'); task = parsed?.payload?.task ?? null } catch { /* not JSON: the old reply */ }
      const ids = idsOf(parsed)
      const { job, failNext, variants } = stateFor(ids) ?? shared
      if (typeof task === 'string') asked.push({ task, at: new Date().toISOString(), ...ids })
      if (typeof task === 'string' && failNext.delete(task)) {
        return send(502, { error: { type: 'provider_error', message: 'e2e stand-in: the provider failed' } })
      }
      let answer = typeof task === 'string' ? answerFor(task, variants[task], answersDir) : null
      if (answer && answer._status) return send(answer._status, { error: answer.error })
      if (answer && task === 'judge_work' && answer.result?.fail) {
        let kind = null
        try { kind = JSON.parse(body).payload?.input?.work?.kind ?? null } catch { /* no work named */ }
        if (kind) {
          const { fail, ...rest } = answer.result
          answer = { ...answer, result: { ...rest, tests: judgeTests(JSON.parse(readFileSync(rubricPath, 'utf8')), kind, fail) } }
        }
      }
      if (answer) {
        return send(200, {
          api: 'napkin.middleware/1',
          job: { id: 'job_e2e0002', state: 'done', stage: 'done', progress: { done: 1, total: 1 }, started_at: '2026-11-04T09:00:00Z' },
          // What the spend guard let through, as the real middleware hands it back (features/align-confidential-prices.clan):
          // the host writes it as the document's run_cost decision. A run through the stand-in is free; these are made-up figures.
          ...(task === 'judge_work' ? { usage: { estimate_eur: 0.05, charged_eur: 0.02, route: 'e2e-stand-in' } } : {}),
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
