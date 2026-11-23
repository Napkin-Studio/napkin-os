import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
const S = async (n, full) => { if (full) { await page.setViewportSize({ width: 1280, height: 2600 }); await page.waitForTimeout(900) } await page.screenshot({ path: `../shots/${n}-1280.png` }); if (full) { await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(600) } }
const clk = async (loc) => { await loc.evaluate(el => el.click()); await page.waitForTimeout(2500) }
await S('07-greenlit-one')
await S('07-greenlit-full', true)
console.log((await f.locator('.booth-body').innerText()).slice(0, 1500))
// send
await clk(f.locator('button', { hasText: /^Send/ }).first()); await S('08-send-dialog')
console.log('DIALOG', (await f.locator('[role=dialog]').innerText().catch(() => 'none')).slice(0, 1200))
await page.keyboard.press('Escape'); await page.waitForTimeout(800)
// export
await clk(f.locator('button', { hasText: /^Export$/ }).first()); await S('09-export')
console.log('EXPORT', (await f.locator('[role=dialog]').innerText().catch(() => 'none')).slice(0, 1200))
await page.keyboard.press('Escape'); await page.waitForTimeout(800)
// open the world: click the card title
await clk(f.locator('.gcard, .gc, [data-route]').first()); await S('10-world')
console.log((await f.locator('body').innerText()).slice(0, 700))
await S('10-world-full', true)
await b.close()
