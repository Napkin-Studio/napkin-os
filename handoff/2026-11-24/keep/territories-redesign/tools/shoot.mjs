import { chromium } from 'playwright'
import fs from 'fs'
const [,, states, themes='dark', widths='1280'] = process.argv
const MOCK = new URL('../mock/index.html', import.meta.url).pathname
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] })
for (const th of themes.split(',')) for (const w of widths.split(',')) {
  const h = +w === 1280 ? 800 : 768
  const dir = `../mock/png/${th}-${w}`; fs.mkdirSync(dir, { recursive: true })
  const ctx = await b.newContext({ viewport: { width: +w, height: h }, colorScheme: th })
  const p = await ctx.newPage()
  p.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 300)))
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)) })
  for (const s of states.split(',')) {
    await p.goto(`file://${MOCK}?shot=1&theme=${th}&s=${s}`); await p.waitForTimeout(1800)
    await p.screenshot({ path: `${dir}/${s}.png` })
    if (process.env.FULL) { await p.setViewportSize({ width: +w, height: 2200 }); await p.waitForTimeout(400); await p.screenshot({ path: `${dir}/${s}-full.png` }); await p.setViewportSize({ width: +w, height: h }) }
  }
  await ctx.close()
}
await b.close()
