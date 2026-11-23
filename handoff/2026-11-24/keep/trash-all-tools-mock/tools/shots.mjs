import { chromium } from 'playwright'
const B = 'http://127.0.0.1:5480'
const OUT = new URL('../shots/', import.meta.url).pathname
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const only = process.argv[2]?.split(',')
const APPS = { brief: 'ie.napkin.brief-maker', research: 'ie.napkin.campaign-research', deck: 'ie.napkin.deck-maker', prod: 'ie.napkin.production' }
async function seed(page) {
  await page.goto(B + '/')
  const si = await page.request.post(`${B}/api/auth/sign-in`, { data: { username: 'aoife@napkin' } })
  if (!si.ok()) throw new Error('sign-in ' + si.status())
  await page.goto(B + '/')
  const { tenant } = await (await page.request.get(`${B}/api/session`)).json()
  const t = `${B}/api/t/${tenant}`
  const j = async (m, p, data) => { const r = await page.request.fetch(t + p, { method: m, ...(data ? { data } : {}) }); if (!r.ok()) throw new Error(`${m} ${p} ${r.status()} ${await r.text()}`); return r.json().catch(() => ({})) }
  for (const old of await j('GET', '/clients')) await j('PATCH', `/clients/${old.id}`, { name: `Earlier ${old.id.slice(4)}` })
  const c = await j('POST', '/clients', { name: 'Tidewell' })
  const mk = async (app, title) => (await j('POST', '/documents', { app_id: APPS[app], title, client_id: c.id })).path
  const brief = await mk('brief', 'Tidewell Zero: summer brief')
  await mk('brief', 'Summer refill: launch brief')
  await mk('research', 'Sparkling water: category research')
  await mk('deck', 'Summer Zero pitch')
  await mk('prod', 'Summer Zero film')
  const meta = {}
  for (const [app, title, by, daysAgo] of [['brief', 'Zero Sugar: first-pass brief', 'Aoife', 3], ['research', 'Flavoured water: shelf audit', 'Marcus', 9], ['prod', 'Lakeside teaser cuts', 'Aoife', 20]]) {
    const p = await mk(app, title)
    await j('DELETE', `/d/${p}`)
    meta[p] = { title, app_id: APPS[app], by, daysAgo }
  }
  return { tenant, client: c.id, brief, meta }
}
const STATES = {
  d1: async p => { await p.getByRole('button', { name: 'Options for Tidewell Zero: summer brief' }).click() },
  d2: async p => { await STATES.d1(p); await p.getByRole('menuitem', { name: /Move to Trash/ }).click(); await p.waitForSelector('[data-testid=trash-confirm]') },
  d3: async (p, s) => { await p.getByRole('button', { name: 'Tidewell Zero: summer brief' }).first().click(); await p.waitForSelector('[data-testid=os-bar]'); await p.waitForTimeout(2500); await p.locator('.tb-name, [aria-haspopup=menu][title^="Document menu"]').first().click(); await p.waitForSelector('[data-testid=doc-menu]') },
  d4: async p => { await p.getByTestId('trash-link').click(); await p.waitForSelector('[data-testid=trash-list]') },
  d5: async p => { await STATES.d4(p); await p.getByRole('button', { name: 'Restore Zero Sugar: first-pass brief' }).click(); await p.getByTestId('trash-back').click(); await p.waitForSelector('[data-testid=toast]') },
  d6: async p => { await STATES.d4(p); for (const n of ['Zero Sugar: first-pass brief', 'Flavoured water: shelf audit', 'Lakeside teaser cuts']) await p.getByRole('button', { name: 'Restore ' + n }).click(); await p.waitForSelector('[data-testid=trash-empty]') },
}
for (const w of [1280, 1024]) for (const [st, run] of Object.entries(STATES)) {
  if (only && !only.includes(st)) continue
  const ctx = await b.newContext({ viewport: { width: w, height: st === 'd1' || st === 'd2' ? 1200 : st === 'd3' ? 800 : st === 'd5' ? 1300 : 900 } })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 300)))
  const s = await seed(p)
  await p.evaluate(m => { window.__trashMeta = m }, s.meta)
  await p.goto(`${B}/#client-${s.client}`)
  await p.waitForSelector('[data-testid=client-page]', {timeout:8000}).catch(async e => { await p.screenshot({path:'/tmp/dbg.png'}); console.log(p.url(), (await p.innerText('body')).slice(0,200)); throw e }); await p.waitForSelector('[data-testid=trash-link]'); await p.waitForTimeout(700)
  await run(p, s)
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500); if (st !== 'd1' && st !== 'd3') await p.mouse.move(2, 500)
  await p.screenshot({ path: `${OUT}${st}-${w}.png` })
  await ctx.close()
}
await b.close()
