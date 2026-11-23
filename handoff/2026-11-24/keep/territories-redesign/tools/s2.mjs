import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
await f.getByRole('button', { name: 'Find the insights' }).click()
const t0 = Date.now(); let n = 0
while (Date.now() - t0 < 420000) {
  await page.waitForTimeout(9000); n++
  const body = await f.locator('body').innerText().catch(() => '')
  await page.screenshot({ path: `../shots/02-find-working-${String(n).padStart(2, '0')}.png` })
  if (/Which insights should the crew explore/.test(body)) { console.log('pick after', (Date.now() - t0) / 1000); break }
  if (/Try again/.test(body)) { console.log('failed'); break }
}
await page.waitForTimeout(1500)
await page.screenshot({ path: '../shots/03-pick-1280.png' })
await f.locator('body').evaluate(() => 0)
console.log((await f.locator('body').innerText()).slice(0, 2500))
await b.close()
