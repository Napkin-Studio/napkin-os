// Starts the REAL napkin-web of the build worktree on 5480 with the real shell (app/dist) and the seeded apps
// (Brief Maker, Research, Deck, Brand Clan). Roster sign-in (aoife@javelin), no middleware, no paid call. Stop with SIGTERM.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = '/home/batunii/Documents/Code/napkin-wt-bc2'
const target = join(root, 'target')
const work = mkdtempSync(join(tmpdir(), 'trash-mock-')); const [seed, data, scratch, config] = ['seed','data','scratch','config'].map(d => { const p = join(work, d); mkdirSync(p); return p })
const ex = (n, ...o) => { const r = spawnSync('cargo', ['run','-q','-p','clan-sdk','--example',n,'--',...o], { cwd: root, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target } }); if (r.status) process.exit(1) }
ex('make_campaign_research', join(seed,'campaign-research.app.clan'), join(scratch,'r.clan'))
ex('make_brief_maker', join(seed,'brief-maker.app.clan'), join(scratch,'r2.clan'))
ex('make_deck_maker', join(seed,'deck-maker.app.clan'), join(scratch,'d.clan'))
ex('make_production', join(seed,'production.app.clan'), join(scratch,'p.clan'))
writeFileSync(join(config,'workspace.yaml'), '')
writeFileSync(join(work,'roster.tsv'), 'aoife@napkin\tAoife\n')
console.log('WORK', work)
const s = spawn(join(target,'debug/napkin-web'), [], { stdio: 'inherit', cwd: root, env: { ...process.env, NAPKIN_AUTH: 'roster', NAPKIN_SESSION_SECRET: 'a-local-build-secret-of-32-bytes-or-more-xx', NAPKIN_AUTH_ROSTER: join(work,'roster.tsv'), NAPKIN_WEB_ADDR: '127.0.0.1:5480', NAPKIN_WEB_DATA: data, NAPKIN_WEB_STATIC: '/home/batunii/Documents/napkin-local-keep/trash-all-tools-mock/repo/app/dist', NAPKIN_WEB_SEED: seed, NAPKIN_CONFIG_DIR: config, RUST_LOG: 'napkin_web=warn' } })
process.on('SIGTERM', () => s.kill('SIGTERM'))
