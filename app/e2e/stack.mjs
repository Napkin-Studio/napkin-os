// The local stack the Playwright smoke runs against, in one command.
//
//   node e2e/stack.mjs            (Playwright starts this itself; see playwright.config.ts)
//
// What it does, all on this machine and nothing outside it:
//   1. builds the shell (app/dist) unless NAPKIN_E2E_SKIP_BUILD=1;
//   2. packs the template apps (Brief Maker, Research, Deck Maker) into a temp seed
//      directory with the SDK's own examples, as `npm run apps` does for the site;
//   3. builds napkin-web and starts it on 127.0.0.1:$NAPKIN_E2E_PORT (default 18080),
//      anonymous sessions, a fresh empty data directory, the seed installed into
//      every new workspace. With NAPKIN_E2E_ROSTER=1 it signs people in from a
//      placeholder roster instead (NAPKIN_AUTH=roster): sam@wk, tia@tbwa and
//      ann@napkin, so the agency's colours and the medallion can be seen.
//   5. a second napkin-web, always, on 127.0.0.1:$NAPKIN_E2E_ROSTER_PORT (default 18082): the roster
//      stack the role tests sign in to (seed/j001/people.mjs, with roles). The server has one auth
//      mode per process, and the existing specs need anonymous sessions, so the two modes run side by
//      side, each with its own data directory and signed-session key. A spec chooses by baseURL
//      (`rosterURL` in j001-pilot.spec.ts). Same shell build, same seed, same stand-in middleware.
// Nothing here calls a model or any network service. Ctrl-C (or SIGTERM from
// Playwright) stops the server and removes the temp directories.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANARY } from './seed/j001/canary.mjs'
import { ROSTER_LINES } from './seed/j001/people.mjs'

const app = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = resolve(app, '..')
const port = process.env.NAPKIN_E2E_PORT || '18080'
const work = mkdtempSync(join(tmpdir(), 'napkin-e2e-'))
const seed = join(work, 'seed')
const data = join(work, 'data')
const scratch = join(work, 'scratch')
const config = join(work, 'config')
for (const d of [seed, data, scratch, config]) mkdirSync(d)
const mwPort = process.env.NAPKIN_E2E_MW_PORT || '18081'
const rosterPort = process.env.NAPKIN_E2E_ROSTER_PORT || '18082'

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
  if (r.status !== 0) {
    console.error(`e2e stack: ${cmd} ${args.join(' ')} failed (${r.status})`)
    cleanup()
    process.exit(r.status ?? 1)
  }
}

function cleanup() {
  rmSync(work, { recursive: true, force: true })
}

if (process.env.NAPKIN_E2E_SKIP_BUILD !== '1') {
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], { cwd: app })
}
const example = (name, ...out) => run('cargo', ['run', '-q', '-p', 'clan-sdk', '--example', name, '--', ...out])
example('make_campaign_research', join(seed, 'campaign-research.app.clan'), join(scratch, 'research.example.clan'))
example('make_brief_maker', join(seed, 'brief-maker.app.clan'), join(scratch, 'research.example.clan'))
example('make_deck_maker', join(seed, 'deck-maker.app.clan'), join(scratch, 'deck.example.clan'))
run('cargo', ['build', '-q', '-p', 'napkin-web'])

// A stand-in middleware, local and free: it answers every task as one job whose
// state the test sets (POST /control {state, stage}). No model, no network.
// It speaks napkin.middleware/1 only as far as the job block the landing reads.
let job = { state: 'running', stage: 'research' }
const middleware = createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const send = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
    if (req.url === '/control' && req.method === 'POST') {
      job = { ...job, ...JSON.parse(body || '{}') }
      return send(200, job)
    }
    send(200, {
      api: 'napkin.middleware/1', task: 'start_campaign', handler: 'start_campaign@1.0',
      job: { id: 'job_e2e0001', state: job.state, stage: job.stage, progress: { done: 2, total: 6 }, started_at: '2026-11-04T09:00:00Z' },
      result: { summary: 'e2e stand-in' }, change: null, trace: {},
    })
  })
})
middleware.listen(Number(mwPort), '127.0.0.1')
// Placeholder people only, one per agency kit the screenshots compare (wk, tbwa) and Napkin's own.
const roster = process.env.NAPKIN_E2E_ROSTER === '1' ? join(config, 'roster.tsv') : null
if (roster) writeFileSync(roster, 'sam@wk\tSam Test\ntia@tbwa\tTia Test\nann@napkin\tAnn Test\n')
writeFileSync(join(config, 'workspace.yaml'), `proxies:\n  middleware:\n    endpoint: http://127.0.0.1:${mwPort}/v1/tasks\n`)

// Every provider key is unset for the server, whatever this shell holds (features/j001-pilot-suite.clan:
// the suite calls no model and no paid provider). A fake canary key is set in its place for pilot test 8.
const PROVIDER = /(^|_)(API_KEY|APIKEY|SECRET_KEY|ACCESS_KEY|MODEL_API)$|^(ANTHROPIC|OPENAI|ELEVENLABS|RUNWAY|GOOGLE_AI|GEMINI|REPLICATE|FAL|BEDROCK)_/i
const env = { ...process.env }
const unset = Object.keys(env).filter(k => PROVIDER.test(k) && !k.startsWith('NAPKIN_E2E_'))
for (const k of unset) delete env[k]
console.log(`e2e stack: provider keys unset (${unset.length} removed from the server's environment), no model route`)

function start(addr, data, auth) {
  return spawn(join(root, 'target/debug/napkin-web'), [], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...env,
      NAPKIN_CANARY_KEY: CANARY,
      // The Brief gate holds the lock list (features/brief-gate.clan). On for the roster stack, where the J001
      // people sign in; off on the primary, as it is by default, so the specs that count what needs a person are unchanged.
      NAPKIN_BRIEF_GATE: auth ? 'on' : 'off',
      NAPKIN_AUTH: auth ? 'roster' : 'none',
      // Signed sessions need a key: a throwaway one, made for this run and gone with it.
      ...(auth ? { NAPKIN_AUTH_ROSTER: auth, NAPKIN_SESSION_SECRET: randomBytes(32).toString('hex') } : {}),
      NAPKIN_WEB_ADDR: addr,
      NAPKIN_WEB_DATA: data,
      NAPKIN_WEB_STATIC: join(app, 'dist'),
      NAPKIN_WEB_SEED: seed,
      NAPKIN_CONFIG_DIR: config,
      // No model and no secrets: the only middleware is the local stand-in above.
      RUST_LOG: 'napkin_web=warn',
    },
  })
}

// The roster stack for the role tests: its own data directory, and a roster with the placeholder people
// and their roles. Started first and waited for, so the primary's health check (which Playwright waits on)
// means both are up.
const rosterData = join(work, 'data-roster')
mkdirSync(rosterData)
const rosterFile = join(work, 'roster-people.tsv')
writeFileSync(rosterFile, ROSTER_LINES.join('\n') + '\n')
const people = start(`127.0.0.1:${rosterPort}`, rosterData, rosterFile)
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${rosterPort}/api/healthz`)).ok) break } catch { /* not up yet */ }
  if (i > 200) { console.error('e2e stack: the roster server did not start'); people.kill('SIGTERM'); cleanup(); process.exit(1) }
  await new Promise(r => setTimeout(r, 100))
}

const server = start(`127.0.0.1:${port}`, data, roster)

const stop = () => { middleware.close(); server.kill('SIGTERM'); people.kill('SIGTERM') }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', code => { middleware.close(); people.kill('SIGTERM'); cleanup(); process.exit(code ?? 0) })
console.log(`e2e stack: http://127.0.0.1:${port}  (data ${data}); roster stack http://127.0.0.1:${rosterPort}`)
