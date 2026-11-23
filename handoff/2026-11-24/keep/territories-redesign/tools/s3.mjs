import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
await page.setViewportSize({ width: 1280, height: 2500 }); await page.waitForTimeout(1200)
await page.screenshot({ path: '../shots/03-pick-full-1280.png' })
await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(800)
const btns = await f.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => (b.innerText||'').trim().slice(0,40)))
console.log(JSON.stringify(btns))
await f.locator('[data-act="explore"]').scrollIntoViewIfNeeded()
await page.screenshot({ path: '../shots/03-pick-explore-button-1280.png' })
await f.locator('[data-act="explore"]').click()
const t0 = Date.now(); let n = 0
while (Date.now() - t0 < 1500000) {
  await page.waitForTimeout(15000); n++
  const body = await f.locator('body').innerText().catch(() => '')
  if (n % 2 === 1 || n < 6) await page.screenshot({ path: `../shots/04-explore-working-${String(n).padStart(2, '0')}.png` })
  const stat = (body.match(/\d+ agents?[^\n]*/)||[''])[0]
  console.log(n, Math.round((Date.now()-t0)/1000), stat.slice(0,100), /Step 3|Greenlight at least|Developed, then chosen/.test(body) ? 'G3' : '')
  if (/all back/.test(body) && !/Exploring…/.test(body)) { console.log('all back'); break }
  if (/Send the crew out again/.test(body) && n > 3) { console.log('failed?'); break }
}
await page.waitForTimeout(2000)
await page.screenshot({ path: '../shots/05-explore-done-1280.png' })
await b.close()
