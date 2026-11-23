import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { seed, select, unlinkBrief, linkCanToScript, openNode, endCardScreen } from './setup.mjs'
const OUT = new URL('../', import.meta.url).pathname
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : [1, 2, 3, 4, 5]
const SIZES = [[1280, 800], [1024, 768]]
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const shot = async (p, n, w) => {
  await p.evaluate((n) => { location.hash = '#' + n; document.activeElement?.blur?.() }, n)
  await p.mouse.move(5, 790)
  await p.waitForTimeout(600)
  await p.screenshot({ path: `${OUT}${n}-${w}.png` })
}
for (const [w, h] of SIZES) {
  for (const n of only) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage()
    p.on('pageerror', (e) => console.log('PAGEERR', n, e.message.slice(0, 200)))
    await seed(p, { noFrames: n === 5 })
    if (n === 1 || n === 2) {
      if (n === 2) await unlinkBrief(p)
      await endCardScreen(p)
      // the end card is the playhead's place
      await p.evaluate(() => {})
      const end = p.locator('.rm-tlwrap').getByText('End card').first()
      await p.waitForTimeout(300)
      await shot(p, n, w)
    } else if (n === 3 || n === 4) {
      await select(p, 'script')
      await p.waitForTimeout(800)
      if (n === 4) { await p.getByRole('button', { name: 'Link it' }).click(); await p.waitForTimeout(1200) }
      await shot(p, n, w)
    } else {
      await linkCanToScript(p)
      await unlinkBrief(p)
      await openNode(p, 'storyboard')
      await shot(p, n, w)
    }
    await p.context().close()
  }
}
await b.close()
