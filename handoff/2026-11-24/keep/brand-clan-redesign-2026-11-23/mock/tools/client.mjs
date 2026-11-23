import { browser, OUT } from './lib.mjs'
const B = 'http://127.0.0.1:5401'
const b = await browser()
const only = process.argv[2]?.split(',')
for (const [w,h0] of [[1280,800],[1024,800]]) for (const st of ['b1','b2','b3']) { const h = st==='b1'?h0:(st==='b2'?(w===1280?1300:1300):(w===1280?1100:1250))
  if (only && !only.includes(st)) continue
  const ctx = await b.newContext({ viewport: { width: w, height: h }, baseURL: B }); const p = await ctx.newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0,200)))
  await p.goto('/'); const { tenant } = await (await p.request.get('/api/session')).json(); const api = `/api/t/${tenant}`
  const c = await (await p.request.post(`${api}/clients`, { data: { name: 'Tidewell' } })).json()
  for (const [app, title] of [['ie.napkin.brief-maker','Tidewell Zero: summer brief'],['ie.napkin.campaign-research','Sparkling water: category research'],['ie.napkin.deck-maker','Summer Zero pitch']])
    { const r = await p.request.post(`${api}/documents`, { data: { app_id: app, title, client_id: c.id } }); if (r.status() !== 201) console.log('doc', r.status()) }
  await p.goto(`/#client-${c.id}`); await p.waitForSelector('[data-testid=client-page]'); await p.waitForTimeout(800)
  if (st === 'b2') await p.getByRole('button', { name: /Tidewell · Zero/ }).click()
  if (st === 'b3') await p.getByRole('button', { name: /Tidewell · Original/ }).click()
  await p.waitForTimeout(400)
  await p.evaluate(() => { const e = document.getElementById('bcm'); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 90) })
  await p.waitForTimeout(700); await p.mouse.move(2, 400)
  await p.screenshot({ path: `${OUT}${st}-${w}.png` })
  await ctx.close()
}
await b.close()
