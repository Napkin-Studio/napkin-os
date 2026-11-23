import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
const S = async (n, full) => { if (full) { await page.setViewportSize({ width: 1280, height: 2600 }); await page.waitForTimeout(900) } await page.screenshot({ path: `../shots/${n}-1280.png` }); if (full) { await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(600) } }
page.on('response', r => { if (r.request().method()!=='GET') console.log(r.status(), r.url().slice(-60)) })
const g = f.getByRole('button', { name: 'Greenlight' }).first()
await g.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await S('07-card-scrolled')
await g.evaluate(el=>el.click()); await page.waitForTimeout(7000)
await S('07-greenlit-one')
console.log((await f.locator('body').innerText()).match(/\d+ greenlit/)?.[0])
await S('07-greenlit-full', true)
await b.close()
