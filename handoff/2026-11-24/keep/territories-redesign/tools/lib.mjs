import { chromium } from 'playwright'
export const TENANT = '84c4a28f-3d0b-4cf4-8621-7507ab7ca797', BASE = 'http://127.0.0.1:9099'
export const DOC = 'doc-ie-napkin-territories-9508bfa4'
export async function open(w = 1280, h = 800, scheme = 'dark') {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme })
  await ctx.addCookies([{ name: 'napkin_tenant', value: TENANT, domain: '127.0.0.1', path: '/' }])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 300)))
  await page.goto(BASE + '/?open=' + DOC); await page.waitForTimeout(4000)
  const F = () => page.frames().find(f => /\/s\/|document/.test(f.url()) && f !== page.mainFrame()) || page.mainFrame()
  return { b, ctx, page, F }
}
