import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
const S = async (n, full) => { if (full) { await page.setViewportSize({ width: 1280, height: 2600 }); await page.waitForTimeout(900) } await page.screenshot({ path: `../shots/${n}-1280.png` }); if (full) { await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(600) } }
await f.locator('[data-open]').first().evaluate(el => el.click()); await page.waitForTimeout(2500)
await S('10-world')
await S('10-world-full', true)
console.log(JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.innerText||b.getAttribute('aria-label')||'').trim().replace(/\n/g,' ').slice(0,40)))))
for (const k of ['animatic','wall']) { const bt = f.locator('[data-wview="'+k+'"], button:text-matches("'+k+'","i")').first(); if (await bt.count()) { await bt.evaluate(el=>el.click()); await page.waitForTimeout(1500); await S('11-world-'+k) } }
await b.close()
