import { chromium } from 'playwright'
const url = process.argv[2], out = process.argv[3], w = +(process.argv[4]||1280), h = +(process.argv[5]||800)
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const p = await (await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage()
await p.goto(url); await p.waitForTimeout(2500); await p.screenshot({ path: out }); console.log(await p.title()); await b.close()
