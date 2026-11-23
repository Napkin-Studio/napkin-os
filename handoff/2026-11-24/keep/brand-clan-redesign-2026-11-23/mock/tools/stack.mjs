// Starts the real napkin-web (built in the territory-plan worktree) on 5401 with the mock shell build (../repo/app/dist) and seeded apps. Stop with SIGTERM.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = '/home/batunii/Documents/Code/napkin-wt-territory-plan'
const work = mkdtempSync(join(tmpdir(), 'bc-mock-')); const [seed, data, scratch, config] = ['seed','data','scratch','config'].map(d => { const p = join(work, d); mkdirSync(p); return p })
const ex = (n, ...o) => { const r = spawnSync('cargo', ['run','-q','-p','clan-sdk','--example',n,'--',...o], { cwd: root, stdio: 'inherit' }); if (r.status) process.exit(1) }
ex('make_campaign_research', join(seed,'campaign-research.app.clan'), join(scratch,'r.clan'))
ex('make_brief_maker', join(seed,'brief-maker.app.clan'), join(scratch,'r2.clan'))
ex('make_deck_maker', join(seed,'deck-maker.app.clan'), join(scratch,'d.clan'))
ex('make_production', join(seed,'production.app.clan'), join(scratch,'p.clan'))
writeFileSync(join(config,'workspace.yaml'), '')
console.log('WORK', work)
const s = spawn(join(root,'target/debug/napkin-web'), [], { stdio: 'inherit', cwd: root, env: { ...process.env, NAPKIN_AUTH: 'none', NAPKIN_WEB_ADDR: '127.0.0.1:5401', NAPKIN_WEB_DATA: data, NAPKIN_WEB_STATIC: new URL('../repo/app/dist', import.meta.url).pathname, NAPKIN_WEB_SEED: seed, NAPKIN_CONFIG_DIR: config, RUST_LOG: 'napkin_web=warn' } })
process.on('SIGTERM', () => s.kill('SIGTERM'))
