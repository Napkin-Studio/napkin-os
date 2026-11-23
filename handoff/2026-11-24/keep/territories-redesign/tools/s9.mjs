import { open } from './lib.mjs'
const { b, page, F } = await open()
const f = F()
await f.locator('button[data-step]').nth(1).evaluate(e=>e.click()); await page.waitForTimeout(1500)
const ta = f.locator('[data-lq-draft]').first()
await ta.scrollIntoViewIfNeeded()
const btn = f.locator('[data-act="lookup"]').first()
const st = async (n) => { await page.screenshot({ path: `../shots/12-lookup-${n}-1280.png`, clip: { x: 830, y: 0, width: 450, height: 800 } }); console.log(n, await btn.isDisabled(), await btn.evaluate(e => getComputedStyle(e).backgroundColor + ' / ' + getComputedStyle(e).color)) }
await st('empty')
await ta.fill('Which Irish pubs now pour a 0.0 cider on draught?'); await page.waitForTimeout(500); await st('typed')
await b.close()
