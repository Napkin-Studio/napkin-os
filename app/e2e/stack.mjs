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
//      every new workspace.
// Nothing here calls a model or any network service. Ctrl-C (or SIGTERM from
// Playwright) stops the server and removes the temp directories.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(fileURLToPath(new URL('..', import.meta.url)))
const root = resolve(app, '..')
const port = process.env.NAPKIN_E2E_PORT || '18080'
const work = mkdtempSync(join(tmpdir(), 'napkin-e2e-'))
const seed = join(work, 'seed')
const data = join(work, 'data')
const scratch = join(work, 'scratch')
for (const d of [seed, data, scratch]) mkdirSync(d)

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
// The apps inline the shared agent figures; generate them as `npm run apps` does.
run(process.execPath, ['scripts/agent-figures.mjs'], { cwd: app })
const example = (name, ...out) => run('cargo', ['run', '-q', '-p', 'clan-sdk', '--example', name, '--', ...out])
example('make_campaign_research', join(seed, 'campaign-research.app.clan'), join(scratch, 'research.example.clan'))
example('make_brief_maker', join(seed, 'brief-maker.app.clan'), join(scratch, 'research.example.clan'))
example('make_deck_maker', join(seed, 'deck-maker.app.clan'), join(scratch, 'deck.example.clan'))
run('cargo', ['build', '-q', '-p', 'napkin-web'])

const server = spawn(join(root, 'target/debug/napkin-web'), [], {
  stdio: 'inherit',
  cwd: root,
  env: {
    ...process.env,
    NAPKIN_AUTH: 'none',
    NAPKIN_WEB_ADDR: `127.0.0.1:${port}`,
    NAPKIN_WEB_DATA: data,
    NAPKIN_WEB_STATIC: join(app, 'dist'),
    NAPKIN_WEB_SEED: seed,
    // No model, no middleware, no secrets: the smoke never reaches either.
    RUST_LOG: 'napkin_web=warn',
  },
})

const stop = () => { server.kill('SIGTERM') }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('exit', code => { cleanup(); process.exit(code ?? 0) })
console.log(`e2e stack: http://127.0.0.1:${port}  (data ${data})`)
