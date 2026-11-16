// One-off smoke test of the by-hand recording hook (results/ is gitignored).
import { spawn } from 'node:child_process'
import { launch } from '../harness/scripts/browser.mjs'
const spike = process.argv[2]
const port = spike === 'excalidraw' ? 4173 : 4174
const pv = spawn('npx', ['vite', 'preview', '--config', `${spike}/vite.config.ts`, '--host', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((r) => pv.stdout.on('data', (d) => String(d).includes(String(port)) && r()))
const b = await launch()
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto(`http://127.0.0.1:${port}/index.html?scene=g3&nodes=1`)
await p.waitForFunction(() => window.__ready === true, null, { timeout: 120000 })
const r = await p.evaluate(() => window.__bench.manual(2, 'smoke'))
console.log(JSON.stringify(r.result))
await b.close()
pv.kill()
process.exit(0)
