import { browser, OUT } from './lib.mjs'
const B = 'http://127.0.0.1:5401'
const b = await browser()
const only = process.argv[2]?.split(',')
const STATES = { b2: [], f1: ['Edit'], f2: ['Edit', 'Save as draft'], f3: ['Edit', 'Save as draft', 'Publish v3'], f3b: ['Edit', 'Save as draft', 'Publish v3', 'Publish v3#2'], f4: ['History'], f4b: ['History', 'Open, read-only#last'] }
for (const [w] of [[1280], [1024]]) for (const [st, steps] of Object.entries(STATES)) {
  if (only && !only.includes(st)) continue
  const h = st === 'f3b' ? 1500 : 1450
  const ctx = await b.newContext({ viewport: { width: w, height: st === 'f4b' ? 1250 : st.startsWith('f4') ? 1000 : h }, baseURL: B }); const p = await ctx.newPage()
  p.on('pageerror', e => console.log('PAGEERR', e.message.slice(0, 200)))
  await p.goto('/'); const { tenant } = await (await p.request.get('/api/session')).json(); const api = `/api/t/${tenant}`
  const c = await (await p.request.post(`${api}/clients`, { data: { name: 'Tidewell' } })).json()
  await p.request.post(`${api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title: 'Tidewell Zero: summer brief', client_id: c.id } })
  await p.goto(`/#client-${c.id}`); await p.waitForSelector('[data-testid=client-page]'); await p.waitForTimeout(800)
  await p.getByRole('button', { name: /Tidewell · Zero/ }).click()
  for (const s of steps) {
    const [name, flag] = s.split('#')
    const loc = p.locator('#bcm').getByRole('button', { name: name, exact: false })
    await (flag === 'last' ? loc.last() : flag === '2' ? loc.first() : loc.first()).click()
    await p.waitForTimeout(250)
  }
  await p.waitForTimeout(500); await p.mouse.move(2, 500)
  await p.screenshot({ path: `${OUT}${st}-${w}.png`, fullPage: false })
  await ctx.close()
}
await b.close()
