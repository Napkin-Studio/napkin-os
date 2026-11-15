#!/usr/bin/env node
// The big-tenant bench (features/store-scan-under-lock.clan): how long the ops that read the whole tenant take
// as one agency's documents grow. A check run on demand, not in CI.
//
//   node scripts/bench-store.mjs <napkin-web binary> <out.json> [N,N,...]
//
// Starts ONE napkin-web (roster mode, the Brief gate off so a brief spins off without a second signer) on
// 127.0.0.1:$NAPKIN_E2E_PORT (default 18270) with a fresh data dir, signs in as a placeholder planner of agency
// wk, grows the agency's tenant through its own API in groups of five documents (a research, a brief spun off it
// and written, a deck, an idea room and a script spun off the brief), and at each N times the ops on the first
// group's brief, idea room and script: one client in turn, then six concurrent clients. No model, no middleware.
//
// BENCH_WORK=<dir> keeps the data dir and the seed state between runs (seed once, time several builds on copies);
// BENCH_TIME=0 seeds only. BENCH_SEED=<dir> names the app templates (*.app.clan); without it they are built once
// into the work dir with the clan-sdk examples, as app/e2e/stack.mjs builds them.
// Print a table with `python3 scripts/bench-store.py <out.json> ...`.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, createWriteStream, rmSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [bin, outFile, nsArg] = process.argv.slice(2)
if (!bin || !outFile) {
  console.error('usage: node scripts/bench-store.mjs <napkin-web binary> <out.json> [N,N,...]')
  process.exit(2)
}
const NS = (nsArg || '10,100,300,1000').split(',').map(Number)
const PORT = process.env.NAPKIN_E2E_PORT || '18270'
const BASE = `http://127.0.0.1:${PORT}`
const keep = process.env.BENCH_WORK
const work = keep || mkdtempSync(join(tmpdir(), 'napkin-bench-'))
if (keep) mkdirSync(keep, { recursive: true })
const stateFile = join(work, 'state.json')
const TIME = process.env.BENCH_TIME !== '0'
const SECRET = keep && existsSync(join(work, 'secret')) ? readFileSync(join(work, 'secret'), 'utf8') : randomBytes(32).toString('hex')
if (keep) writeFileSync(join(work, 'secret'), SECRET)

let seed = process.env.BENCH_SEED
if (!seed) {
  seed = join(work, 'seed')
  if (!existsSync(join(seed, 'script-editor.app.clan'))) {
    mkdirSync(join(seed, 'scratch'), { recursive: true })
    const example = (name, ...out) => {
      const r = spawnSync('cargo', ['run', '-q', '-p', 'clan-sdk', '--example', name, '--', ...out], { cwd: root, stdio: 'inherit' })
      if (r.status !== 0) throw new Error(`clan-sdk example ${name} failed`)
    }
    const s = join(seed, 'scratch')
    example('make_campaign_research', join(seed, 'campaign-research.app.clan'), join(s, 'research.example.clan'))
    example('make_brief_maker', join(seed, 'brief-maker.app.clan'), join(s, 'research.example.clan'))
    example('make_deck_maker', join(seed, 'deck-maker.app.clan'), join(s, 'deck.example.clan'))
    example('make_script_editor', join(seed, 'script-editor.app.clan'), join(s, 'script-editor.example.clan'))
    example('make_idea_room', join(seed, 'idea-room.app.clan'), join(s, 'idea-room.example.clan'))
    rmSync(s, { recursive: true, force: true })
  }
}

const roster = join(work, 'roster.tsv')
writeFileSync(roster, 'aoife@wk\tAoife Test\tplanning\ndara@wk\tDara Test\tcreative-director\n')
writeFileSync(join(work, 'workspace.yaml'), `proxies:\n  middleware:\n    endpoint: http://127.0.0.1:1/v1/tasks\n`)
const log = createWriteStream(outFile.replace(/\.json$/, '.server.log'), { flags: 'a' })
const server = spawn(bin, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME,
    NAPKIN_AUTH: 'roster', NAPKIN_AUTH_ROSTER: roster, NAPKIN_SESSION_SECRET: SECRET,
    NAPKIN_WEB_ADDR: `127.0.0.1:${PORT}`, NAPKIN_WEB_DATA: join(work, 'data'), NAPKIN_CONFIG_DIR: work,
    NAPKIN_WEB_SEED: seed, NAPKIN_WEB_STATIC: process.env.BENCH_STATIC || work,
    NAPKIN_BRIEF_GATE: 'off', NAPKIN_JUDGE_BACKEND: 'fixture', NAPKIN_AGENT_CAP: '400', RUST_LOG: 'napkin_web=info',
  },
})
server.stdout.pipe(log); server.stderr.pipe(log)
const stop = () => { try { server.kill('SIGKILL') } catch {} ; if (!keep) rmSync(work, { recursive: true, force: true }) }
process.on('exit', stop)
process.on('SIGINT', () => process.exit(130))

let cookie = ''
async function req(method, path, body) {
  const t = performance.now()
  const r = await fetch(BASE + path, {
    method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  const ms = performance.now() - t
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, ms, text }
}
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r.json }

for (let i = 0; ; i++) {
  try { if ((await fetch(BASE + '/api/healthz')).ok) break } catch {}
  if (i > 300) throw new Error('server did not start')
  await new Promise(r => setTimeout(r, 100))
}
const si = await fetch(BASE + '/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'aoife@wk' }) })
cookie = (si.headers.getSetCookie?.() || [si.headers.get('set-cookie')]).map(c => c.split(';')[0]).join('; ')
const { tenant } = must(await req('GET', '/api/session'), 'session')
const api = `/api/t/${tenant}`

const { READY_BRIEF: BRIEF } = await import(join(root, 'app/e2e/seed/j001/brief.ts'))
let groups = 0, docs = 0, probe = null
if (existsSync(stateFile)) {
  const st = JSON.parse(readFileSync(stateFile, 'utf8'))
  groups = st.groups; docs = st.docs
  // tokens live in the server's memory: open the probe documents again for fresh ones
  const reopen = async p => ({ ...must(await req('GET', `${api}/d/${encodeURIComponent(p)}`), 'reopen'), path: p })
  probe = { brief: await reopen(st.brief), room: await reopen(st.room), script: await reopen(st.script), client: st.client }
}
const save = () => keep && writeFileSync(stateFile, JSON.stringify({ groups, docs, brief: probe.brief.path, room: probe.room.path, script: probe.script.path, client: probe.client }))
async function group() {
  groups++
  const c = must(await req('POST', `${api}/clients`, { name: `Client A${groups}` }), 'client')
  const job = `J${String(groups).padStart(4, '0')}`
  must(await req('POST', `${api}/jobs`, { number: job, client_id: c.id, title: 'Summer', due: '2026-12-18' }), 'job')
  const make = async (app, title, patch) => {
    const d = must(await req('POST', `${api}/documents`, { app_id: app, title, client_id: c.id, job }), `create ${app}`)
    if (patch) must(await req('POST', `/s/${d.token}/patch-data`, { patch, agent: 'bench-seed', action: `seed: ${title}` }), 'patch')
    docs++
    return d
  }
  const research = await make('ie.napkin.campaign-research', 'Research')
  const spin = async (from, app, title) => { const d = must(await req('POST', `${api}/d/${encodeURIComponent(from.path)}/spinoff`, { app_id: app, title }), `spinoff ${app}`); docs++; return d }
  const brief = await spin(research, 'ie.napkin.brief-maker', 'Summer brief')
  must(await req('POST', `/s/${brief.token}/patch-data`, { patch: BRIEF, agent: 'bench-seed', action: 'seed: brief' }), 'patch brief')
  await make('ie.napkin.deck-maker', 'Deck')
  const room = await spin(brief, 'ie.napkin.idea-room', 'Ideas')
  const script = await spin(brief, 'ie.napkin.script-editor', 'Script')
  if (!probe) probe = { brief, room, script, client: c.id }
}

// [name, method, path, body]
const OPS = [
  ['upstream (brief)', 'GET', () => `/s/${probe.brief.token}/upstream`],
  ['upstream (room)', 'GET', () => `/s/${probe.room.token}/upstream`],
  ['decisions', 'GET', () => `/s/${probe.brief.token}/decisions`],
  ['related', 'GET', () => `/s/${probe.brief.token}/related`],
  ['judge (room)', 'GET', () => `/s/${probe.room.token}/judge`],
  ['judge (script)', 'GET', () => `/s/${probe.script.token}/judge`],
  ['ideas/room', 'GET', () => `/s/${probe.room.token}/ideas/room`],
  ['capabilities', 'GET', () => `/s/${probe.brief.token}/capabilities`],
  ['edit-mode', 'POST', () => `${api}/d/${encodeURIComponent(probe.brief.path)}/edit-mode`, { active: false }],
  ['attach-targets', 'GET', () => `/s/${probe.brief.token}/attach-targets`],
  ['open (GET /d)', 'GET', () => `${api}/d/${encodeURIComponent(probe.brief.path)}`],
  ['needs', 'GET', () => `${api}/needs`],
]
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
async function timeOps(clients, rounds) {
  const out = Object.fromEntries(OPS.map(([n]) => [n, []]))
  await Promise.all(Array.from({ length: clients }, async (_, w) => {
    for (let r = 0; r < rounds; r++) {
      for (let k = 0; k < OPS.length; k++) {
        const [name, method, path, body] = OPS[(k + w) % OPS.length]
        const res = await req(method, path(), body)
        if (res.status !== 200) out[name].err = `${res.status} ${res.text.slice(0, 120)}`
        out[name].push(res.ms)
      }
    }
  }))
  return Object.fromEntries(Object.entries(out).map(([n, a]) => [n, { n: a.length, median: +q(a, 0.5).toFixed(1), p95: +q(a, 0.95).toFixed(1), max: +Math.max(...a).toFixed(1), ...(a.err ? { err: a.err } : {}) }]))
}

const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')).results : []
for (const N of NS) {
  const t = performance.now()
  while (docs < N) { await group(); save() }
  if (!TIME) { console.log(`seeded to N=${docs}`); continue }
  const seedMs = performance.now() - t
  await timeOps(1, 1) // warm: the first read after a start or a seed rebuilds the job index and the catalogue
  const one = await timeOps(1, N >= 1000 ? 3 : N >= 300 ? 5 : 9)
  const six = await timeOps(6, N >= 300 ? 2 : 4)
  results.push({ N: docs, seedMs: Math.round(seedMs), one, six })
  console.log(`N=${docs} (seeded in ${Math.round(seedMs / 1000)} s)`)
  for (const [n] of OPS) console.log(`  ${n.padEnd(18)} 1c med ${String(one[n].median).padStart(8)} p95 ${String(one[n].p95).padStart(8)} | 6c med ${String(six[n].median).padStart(8)} p95 ${String(six[n].p95).padStart(8)} max ${six[n].max}${one[n].err ? ' ERR ' + one[n].err : ''}`)
  writeFileSync(outFile, JSON.stringify({ bin, results }, null, 1))
}
process.exit(0)
