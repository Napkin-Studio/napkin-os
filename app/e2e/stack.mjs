// The local stack the Playwright smoke runs against, in one command.
//
//   node e2e/stack.mjs            (Playwright starts this itself; see playwright.config.ts)
//
// What it does, all on this machine and nothing outside it:
//   1. builds the shell (app/dist) unless NAPKIN_E2E_SKIP_BUILD=1;
//   2. packs the template apps (Brief Maker, Research, Deck Maker, Visual Brief, Idea room) into a temp seed
//      directory with the SDK's own examples, as `npm run apps` does for the site;
//   3. builds napkin-web and starts it on 127.0.0.1:$NAPKIN_E2E_PORT (default 18080),
//      anonymous sessions, a fresh empty data directory, the seed installed into
//      every new workspace. With NAPKIN_E2E_ROSTER=1 it signs people in from a
//      placeholder roster instead (NAPKIN_AUTH=roster): sam@wk, tia@tbwa and
//      ann@napkin, so the agency's colours and the medallion can be seen.
//   5. a second napkin-web, always, on 127.0.0.1:$NAPKIN_E2E_ROSTER_PORT (default 18082): the roster
//      stack the role tests sign in to (seed/j001/people.mjs, with roles, most added through the People
//      store's API). The server has one auth
//      mode per process, and the existing specs need anonymous sessions, so the two modes run side by
//      side, each with its own data directory and signed-session key. A spec chooses by baseURL
//      (`rosterURL` in j001-pilot.spec.ts). Same shell build, same seed, same stand-in middleware.
//   6. the Production Tool at /production on the roster server (features/production-line-merge.clan): its web app built
//      with base /production/ (unless NAPKIN_E2E_SKIP_BUILD=1 and a build is there), and its relay (production-tool/relay,
//      `python -m local`) on 127.0.0.1:$NAPKIN_E2E_RELAY_PORT (default: the roster port plus one) with the mock provider,
//      the passthrough director, no key and the spend cap at 0. napkin-web signs each call to it (X-Napkin-Identity).
//      Skipped, with a line saying so, when production-tool/web has no node_modules or uv is missing.
// Nothing here calls a model or any network service. Ctrl-C (or SIGTERM from
// Playwright) stops the server and removes the temp directories.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANARY } from './seed/j001/canary.mjs'
import { addPeople, PEOPLE, ROSTER_LINES } from './seed/j001/people.mjs'
import { standIn } from './standin.mjs'

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
const relayPort = process.env.NAPKIN_E2E_RELAY_PORT || String(Number(rosterPort) + 1)

// Two stacks on one machine must not share a port: the second would talk to the first one's servers (or its stand-in, whose state is
// the first run's) or hang. Fail now, before any build, and name the three variables.
async function inUse(p) {
  return await new Promise(done => {
    const probe = createServer()
    probe.once('error', () => done(true))
    probe.listen(Number(p), '127.0.0.1', () => probe.close(() => done(false)))
  })
}
const wanted = [['NAPKIN_E2E_PORT', port], ['NAPKIN_E2E_ROSTER_PORT', rosterPort], ['NAPKIN_E2E_MW_PORT', mwPort], ['NAPKIN_E2E_RELAY_PORT', relayPort]]
const clash = []
for (const [name, p] of wanted) {
  if (await inUse(p)) clash.push(`${name}=${p} is already in use`)
  else if (wanted.some(([n, q]) => n < name && q === p)) clash.push(`${name}=${p} is the same port as another of the four`)
}
if (clash.length) {
  console.error(`e2e stack: ${clash.join('; ')}.\n  Another stack (or a lead's run) holds it. Choose free, different ports: NAPKIN_E2E_PORT, NAPKIN_E2E_ROSTER_PORT, NAPKIN_E2E_MW_PORT (and NAPKIN_E2E_RELAY_PORT, default the roster port plus one).`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts })
  if (r.status !== 0) {
    console.error(`e2e stack: ${cmd} ${args.join(' ')} failed (${r.status})`)
    cleanup()
    process.exit(r.status ?? 1)
  }
}

// The roster server's mail goes to a file, never to a network (features/client-review-full.clan): each mail is one JSON line,
// so a test reads the emailed code from it. The primary server has no mail, so the code option is not offered there.
const outboxFile = join(tmpdir(), `napkin-e2e-outbox-${rosterPort}.jsonl`)
rmSync(outboxFile, { force: true })

function cleanup() {
  rmSync(join(tmpdir(), `napkin-e2e-clock-${rosterPort}`), { force: true })
  rmSync(outboxFile, { force: true })
  rmSync(work, { recursive: true, force: true })
}

if (process.env.NAPKIN_E2E_SKIP_BUILD !== '1') {
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], { cwd: app })
}
const example = (name, ...out) => run('cargo', ['run', '-q', '-p', 'clan-sdk', '--example', name, '--', ...out])
example('make_campaign_research', join(seed, 'campaign-research.app.clan'), join(scratch, 'research.example.clan'))
example('make_brief_maker', join(seed, 'brief-maker.app.clan'), join(scratch, 'research.example.clan'))
example('make_deck_maker', join(seed, 'deck-maker.app.clan'), join(scratch, 'deck.example.clan'))
example('make_visual_brief', join(seed, 'visual-brief.app.clan'), join(scratch, 'visual-brief.example.clan'))
example('make_script_editor', join(seed, 'script-editor.app.clan'), join(scratch, 'script-editor.example.clan'))
// Send to Film (features/script-editor.clan) spins a script off into Advertising Studio, so the stack installs it.
example('make_advertising_studio', join(seed, 'advertising-studio.app.clan'))
example('make_idea_room', join(seed, 'idea-room.app.clan'), join(scratch, 'idea-room.example.clan'))
// The Napkin Brain (features/brain-template.clan): the template a brain is made from. Packed so the stack starts with it installed.
example('make_agency_brain', join(seed, 'agency-brain.app.clan'))
run('cargo', ['build', '-q', '-p', 'napkin-web'])

// The Production Tool's web app, built for /production (as the image does, Dockerfile's production stage). It builds on the
// CLAN store's napkin-wasm (production-tool/clan-store/src/wasm), which `npm run build` there makes.
const tool = join(root, 'production-tool')
const toolBuild = join(tmpdir(), `napkin-e2e-production-${rosterPort}`)
const hasUv = spawnSync('uv', ['--version'], { stdio: 'ignore' }).status === 0
let production = existsSync(join(tool, 'web', 'node_modules')) && existsSync(join(tool, 'clan-store', 'src', 'wasm', 'napkin_wasm.js')) && hasUv
if (!production) {
  console.log('e2e stack: no Production Tool (production-tool/web needs npm ci, clan-store its wasm build, and uv must be on PATH); /production is off')
} else if (process.env.NAPKIN_E2E_SKIP_BUILD !== '1' || !existsSync(join(toolBuild, 'index.html'))) {
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn', '--outDir', toolBuild, '--emptyOutDir'],
    { cwd: join(tool, 'web'), env: { ...process.env, VITE_BASE: '/production/', VITE_RELAY_URL: '/production/api' } })
}

// A stand-in middleware, local and free (standin.mjs): it answers every task as one job whose state the test sets
// (POST /control {state, stage}), and from fixture files for the tasks Phase 2 names (seed/j001/p2/answers/). No model, no network.
const middleware = standIn()
middleware.once('error', e => {
  console.error(`e2e stack: the stand-in middleware could not listen on 127.0.0.1:${mwPort} (${e.code ?? e.message}). Set NAPKIN_E2E_MW_PORT (with NAPKIN_E2E_PORT and NAPKIN_E2E_ROSTER_PORT) to a free port.`)
  cleanup()
  process.exit(1)
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

// The test clock of the roster server (features/approval-route.clan): "today" for the job index is read from this
// file when it exists, so a test can put a deadline two days in the past. Only this server is given it.
const clockFile = join(tmpdir(), `napkin-e2e-clock-${rosterPort}`)
rmSync(clockFile, { force: true })

function start(addr, data, auth, gate = false) {
  return spawn(join(root, 'target/debug/napkin-web'), [], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...env,
      NAPKIN_CANARY_KEY: CANARY,
      // The Brief gate holds the lock list (features/brief-gate.clan). On for the J001 roster stack only, where the
      // pilot tests sign in; off on the primary, as it is by default, so the specs that count what needs a person are unchanged.
      NAPKIN_BRIEF_GATE: gate ? 'on' : 'off',
      ...(gate ? { NAPKIN_TEST_CLOCK_FILE: clockFile, NAPKIN_MAIL_OUTBOX: outboxFile } : {}),
      // the Production Tool at /production, on the roster server only (anonymous mode never mounts it)
      ...(gate && relay ? { NAPKIN_PRODUCTION_RELAY_URL: `http://127.0.0.1:${relayPort}`, NAPKIN_PRODUCTION_RELAY_SECRET: relaySecret, NAPKIN_PRODUCTION_STATIC: toolBuild } : {}),
      NAPKIN_AUTH: auth ? 'roster' : 'none',
      // Signed sessions need a key: a throwaway one, made for this run and gone with it.
      ...(auth ? { NAPKIN_AUTH_ROSTER: auth, NAPKIN_SESSION_SECRET: randomBytes(32).toString('hex') } : {}),
      NAPKIN_WEB_ADDR: addr,
      NAPKIN_WEB_DATA: data,
      NAPKIN_WEB_STATIC: join(app, 'dist'),
      NAPKIN_WEB_SEED: seed,
      NAPKIN_CONFIG_DIR: config,
      // Judge answers from the stand-in's fixture scores (features/judge.clan): the backend is named, never defaulted, and unset means not set up.
      NAPKIN_JUDGE_BACKEND: 'fixture',
      // The agent quota is per agency per server start (meter.rs), and every spec's people share the agency wk on one server:
      // staging's cap (infra/modules/services/main.tf), so a full run is not refused by what earlier specs spent.
      NAPKIN_AGENT_CAP: '400',
      // No model and no secrets: the only middleware is the local stand-in above.
      RUST_LOG: 'napkin_web=warn',
    },
  })
}

// The Production Tool's relay, local (production-tool/relay/local.py): the mock provider and the passthrough director (no model
// key), the spend cap at 0, every agency of the J001 people turned on. The roster server signs each call with the same key.
const relaySecret = randomBytes(32).toString('hex')
let relay = null
const stopRelay = () => { relay?.kill('SIGTERM') }
if (production) {
  relay = spawn('uv', ['run', '-q', '--python', '3.12', 'python', '-m', 'local', '--port', relayPort, '--data', join(work, 'relay')], {
    // In the stack's process group (Playwright stops the whole group), with its output on the stack's.
    stdio: 'inherit',
    cwd: join(tool, 'relay'),
    env: {
      ...env,
      TOKEN_SECRET: relaySecret,
      NAPKIN_LOCAL_TENANTS: [...new Set(Object.values(PEOPLE).map(p => p.username.split('@')[1]))].join(','),
      NAPKIN_SPEND_CAP_EUR: '0',
      NAPKIN_PAID_CALLS: 'off',
    },
  })
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${relayPort}/health`)).ok) break } catch { /* not up yet */ }
    if (i > 600) { console.error('e2e stack: the Production relay did not start'); stopRelay(); cleanup(); process.exit(1) }
    await new Promise(r => setTimeout(r, 100))
  }
}

// The roster stack for the role tests: its own data directory, its People store seeded from a roster file with the
// people admin and the agencies the People page cannot add to yet, and everyone else added with their roles through the
// People store's API, as in production (features/align-needs-lock-people.clan). Started first and waited for, so the
// primary's health check (which Playwright waits on) means both are up.
const rosterData = join(work, 'data-roster')
mkdirSync(rosterData)
const rosterFile = join(work, 'roster-people.tsv')
writeFileSync(rosterFile, ROSTER_LINES.join('\n') + '\n')
const people = start(`127.0.0.1:${rosterPort}`, rosterData, rosterFile, true)
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://127.0.0.1:${rosterPort}/api/healthz`)).ok) break } catch { /* not up yet */ }
  if (i > 200) { console.error('e2e stack: the roster server did not start'); people.kill('SIGTERM'); stopRelay(); cleanup(); process.exit(1) }
  await new Promise(r => setTimeout(r, 100))
}
try {
  await addPeople(`http://127.0.0.1:${rosterPort}`)
} catch (e) {
  console.error(`e2e stack: ${e.message}`); people.kill('SIGTERM'); stopRelay(); cleanup(); process.exit(1)
}

const server = start(`127.0.0.1:${port}`, data, roster)

const stop = () => { middleware.close(); server.kill('SIGTERM'); people.kill('SIGTERM'); stopRelay() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', code => { middleware.close(); people.kill('SIGTERM'); stopRelay(); cleanup(); process.exit(code ?? 0) })
console.log(`e2e stack: http://127.0.0.1:${port}  (data ${data}); roster stack http://127.0.0.1:${rosterPort}${relay ? `; Production relay http://127.0.0.1:${relayPort}` : ''}`)
