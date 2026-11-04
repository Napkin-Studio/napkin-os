// Try the landing yourself: opens a visible browser on the local stack, makes it
// your anonymous tenant, seeds placeholder clients and work, and leaves the window open.
//
//   node e2e/stack.mjs                      (terminal 1)
//   node e2e/try.mjs [clients] [--empty]    (terminal 2; default 6 clients; --empty seeds nothing)
//
// Clients are placeholders (Client A, Client B ...). No model, no network.
import { chromium } from '@playwright/test'

const base = `http://127.0.0.1:${process.env.NAPKIN_E2E_PORT || '18080'}`
const n = Number(process.argv.find(a => /^\d+$/.test(a)) || 6)
const empty = process.argv.includes('--empty')
const BRIEF = 'ie.napkin.brief-maker'
const DECK = 'ie.napkin.deck-maker'
const CONTEST = { selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] } }

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const ctx = await browser.newContext({ viewport: null })
const page = await ctx.newPage()
await page.goto(base)
if (!empty) {
  const { tenant } = await (await page.request.get('/api/session')).json()
  const api = `/api/t/${tenant}`
  const ids = []
  for (let i = 0; i < n; i++) {
    const r = await page.request.post(`${api}/clients`, { data: { name: `Client ${i < 26 ? String.fromCharCode(65 + i) : `A${i - 25}`}` } })
    ids.push((await r.json()).id)
  }
  const work = async (app, title, c, patch) => {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, ...(c ? { client_id: c } : {}) } })
    if (patch) await page.request.post(`/s/${(await r.json()).token}/patch-data`, { data: { patch } })
  }
  if (ids[0]) { await work(BRIEF, 'Spring brief', ids[0], CONTEST); await work(BRIEF, 'Autumn brief', ids[0]); await work(DECK, 'Pitch deck', ids[0], { run: { state: 'building', stage: 'Layout' } }) }
  if (ids[1]) await work(BRIEF, 'Launch brief', ids[1])
  if (ids[2]) await work(DECK, 'Board deck', ids[2], { run: { state: 'failed' } })
  if (ids[3]) await work(BRIEF, 'Review brief', ids[3], CONTEST)
  await page.reload()
}
console.log(`Open in the browser window: ${base}/  (close the window or Ctrl-C to finish)`)
await new Promise(res => browser.on('disconnected', res))
