import { chromium } from 'playwright'
const OUT = new URL('../', import.meta.url).pathname
const URL_ = 'http://127.0.0.1:5461/'
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const seedHome = async (p) => {
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)))
  await p.goto(URL_)
  await p.waitForFunction(() => !!window.__shell, null, { timeout: 30000 })
  await p.evaluate(async () => {
    const sh = window.__shell, idx = sh.deps.index
    const sm = (stage, shots, s) => ({ stage, pictures: 3, shots, behind: 0, adSeconds: s, active: 0, shas: [] })
    const day = (n) => new Date(Date.now() - n * 864e5).toISOString()
    await idx.create({ name: 'Ferncliff summer film', naming: 'person', at: day(1), summary: sm('storyboard', 4, 30) })
    await idx.create({ name: 'Stena ferry, 20s', naming: 'person', at: day(2), summary: sm('film', 6, 20) })
    await idx.create({ name: 'Linden Bank explainer', naming: 'person', at: day(5), summary: sm('character', 0, null) })
    await sh.goHome()
  })
  await p.waitForSelector('.film-cards')
}
const shot = async (p, n, w) => {
  await p.evaluate((n) => { location.hash = '#' + n; document.activeElement?.blur?.() }, n)
  await p.mouse.move(5, 5)
  await p.waitForTimeout(500)
  await p.screenshot({ path: `${OUT}${n}-${w}.png` })
}
for (const [w, h] of [[1280, 800], [1024, 768]]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
  await seedHome(p)
  await shot(p, 'tr1', w)
  await p.getByRole('button', { name: 'Trash (2)' }).click()
  await shot(p, 'tr2', w)
  await p.getByRole('button', { name: 'Restore' }).first().click()
  await p.waitForSelector('.hm-toast')
  await shot(p, 'tr3', w)
  await p.evaluate(() => { window.__trash.clear(); window.__trash.dismiss(); window.__trash.show('trash') })
  await p.waitForSelector('.pp-trashempty')
  await shot(p, 'tr4', w)
  await p.close()
}
await b.close()
