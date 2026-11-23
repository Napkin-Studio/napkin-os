import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
const S = async (n, full) => { if (full) { await page.setViewportSize({ width: 1280, height: 2600 }); await page.waitForTimeout(900) } await page.screenshot({ path: `../shots/${n}-1280.png` }); if (full) { await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(600) } }
await S('06-greenlight-landing')
await S('06-greenlight-full', true)
console.log((await f.locator('body').innerText()).slice(0, 1800))
console.log(JSON.stringify(await f.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.innerText||b.getAttribute('aria-label')||'').trim().replace(/\n/g,' ').slice(0,40)))))
await f.locator('button[data-step]').nth(1).click(); await page.waitForTimeout(1500)
await S('05-explore-view'); await S('05-explore-full', true)
await b.close()
