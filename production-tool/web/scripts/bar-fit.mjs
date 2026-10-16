// The top bars fit (features/topbar-declutter.clan): a hand-run check against a MOCK stack, never a
// live one. It makes a project (a picture named @samurai_front, a script, a plan, frame 1, the Image
// editor), holds jobs running (or failed, or asking) by rewriting the relay's job polls, and on each
// bar (canvas, Script, Storyboard, Video Picture and Sound, Image, phone) at 1440, 1280, 1180 and 1024
// with a mouse and at 1180 and 820 on touch, in light and dark, checks header.scrollWidth <= clientWidth
// and that the way back, the job button, the primary and the account are inside the window. Saves a
// screenshot of each bar.
//
//   BASE=http://127.0.0.1:8211 OUT=/tmp/shots PLAYWRIGHT=/path/to/node_modules/playwright \
//   CHROMIUM=/usr/bin/chromium node production-tool/web/scripts/bar-fit.mjs
//
// Exit code 1 when any bar overflows or loses a key control.

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright')
const BASE = process.env.BASE ?? 'http://127.0.0.1:8120'
const OUT = process.env.OUT ?? 'bar-fit'
const PICTURE = process.env.PICTURE // a .png to upload as the named picture
const SIGN_IN = process.env.SIGN_IN ?? 'dev@napkin'
mkdirSync(OUT, { recursive: true })

const FINE = [1440, 1280, 1180, 1024]
const TOUCH = [1180, 820]
const results = []
let mode = 'pass' // pass | hold | fail | ask

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
// The relay's jobs (POST /production/api/jobs and its polls, GET .../jobs/{id}): held running, failed or
// asking on demand, so each state can be looked at for as long as the sweep needs.
const hold = (job) => {
  if (mode === 'hold') Object.assign(job, { state: 'fetching', nextPollS: 2, outputs: undefined, shots: undefined, writes: undefined })
  if (mode === 'fail') Object.assign(job, { state: 'failed', error: { code: 'provider_error', message: 'Runway did not answer.', retryable: true } })
  if (mode === 'ask') Object.assign(job, { state: 'needs_input', nextPollS: 5, question: { id: `q_${job.jobId}`, kind: 'block', text: 'Which samurai is this?', options: [{ id: 'old', label: 'The old one' }, { id: 'young', label: 'The young one' }], allow_text: true } })
  return job
}
await ctx.route(/\/api\/jobs(\/[^/?]+)?(\?.*)?$/, async (route) => {
  const method = route.request().method()
  if (mode === 'pass' || (method !== 'GET' && method !== 'POST')) return route.continue()
  const res = await route.fetch()
  const job = await res.json().catch(() => null)
  if (!job || typeof job !== 'object' || !job.jobId) return route.fulfill({ response: res })
  return route.fulfill({ response: res, json: hold(job) })
})
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
const wait = (ms) => p.waitForTimeout(ms)
const button = (name) => p.getByRole('button', { name }).filter({ visible: true }).first()

async function signIn() {
  await p.goto(`${BASE}/production/?engine=own`)
  await wait(1500)
  await p.locator('text=Sign in').last().click()
  await wait(1200)
  const input = p.locator('input:visible').first()
  await input.fill(SIGN_IN)
  await input.press('Enter')
  await wait(2500)
}

/** Every visible top bar: does it fit, and are its key controls inside the window? */
async function measure(label) {
  return p.evaluate((label) => [...document.querySelectorAll('header.ptbar, header.ph-bar')].filter((h) => h.offsetParent).map((h) => {
    const inside = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth }
    const key = {
      back: inside(h.querySelector('.pt-back, .pt-home')),
      job: h.querySelector('.pt-job') ? inside(h.querySelector('.pt-job')) : 'none',
      primary: h.querySelector('.btn.primary') ? inside(h.querySelector('.btn.primary')) : 'none',
      account: inside(h.querySelector('.pt-account')),
    }
    return { label, bar: h.dataset.bar ?? 'phone', fit: h.dataset.fit, width: innerWidth, sw: h.scrollWidth, cw: h.clientWidth, height: h.clientHeight, key,
      ok: h.scrollWidth <= h.clientWidth && Object.values(key).every((v) => v === true || v === 'none') }
  }), label)
}

async function sweep(name) {
  for (const dark of [false, true]) {
    await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    for (const [touch, widths] of [[false, FINE], [true, TOUCH]]) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 })
      for (const w of widths) {
        await p.setViewportSize({ width: w, height: 900 })
        await wait(350)
        const tag = `${name}-${w}${touch ? '-touch' : ''}-${dark ? 'dark' : 'light'}`
        for (const r of await measure(tag)) results.push(r)
        await p.screenshot({ path: join(OUT, `${tag}.png`), clip: { x: 0, y: 0, width: w, height: 140 } })
      }
    }
  }
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 5 })
  await p.emulateMedia({ colorScheme: 'light' })
  await p.setViewportSize({ width: 1440, height: 900 })
  await wait(300)
}

const back = async () => { await p.locator('header.ptbar .pt-back').filter({ visible: true }).first().click(); await wait(1200) }
const openNode = async (i) => { await p.getByRole('button', { name: 'Open', exact: true }).nth(i).click(); await wait(1800) }
const primary = () => p.locator('header.ptbar .btn.primary').filter({ visible: true }).first()
const jobLabel = () => p.evaluate(() => document.querySelector('.pt-job')?.getAttribute('aria-label') ?? 'no job button')

await signIn()
await button(/New project/).click()
await wait(3500)

// A picture named @samurai_front, so frames can be drawn.
if (PICTURE) {
  const chooser = p.waitForEvent('filechooser', { timeout: 8000 })
  await button('Add a picture (I)').click()
  await (await chooser).setFiles(PICTURE)
  await wait(2500)
  await button('Name…').click()
  await wait(800)
  if (process.env.DEBUG) { await p.screenshot({ path: join(OUT, 'debug-name.png') }); console.log(await p.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.outerHTML).join('\n'))) }
  await p.locator('input[aria-label="Character or object"]').fill('samurai')
  const shows = p.locator('input[aria-label="What this one shows"]')
  await shows.fill('front')
  await shows.press('Enter')
  await wait(1200)
}
await sweep('canvas-idle')

// A script (Skye drafts it from the line; it opens the Script editor), kept, and planned by Dex.
const line = p.locator('textarea[placeholder^="Paste a script"]')
await line.fill('@samurai_front drinks Lumen water at dawn on a cliff above the sea.')
await line.press('Enter')
await wait(2500)
const keep = p.getByRole('button', { name: 'Keep', exact: true })
if (await keep.count()) { await keep.first().click(); await wait(800) }
await sweep('script-idle')
await primary().click()
await wait(7000)
await back()

// Frame 1 drawing, held running: every bar with the job button turning.
await openNode(1)
await sweep('storyboard-idle')
mode = 'hold'
const draw = button('Draw frame 1')
if (await draw.count()) { await draw.click(); await wait(2500) }
console.log('running:', await jobLabel())
await sweep('storyboard-running')
await back()
await sweep('canvas-running')
// The job button's words: its tooltip on hover, its popover's first row on click; and the canvas's More.
for (const dark of [false, true]) {
  await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  const t = dark ? 'dark' : 'light'
  await p.locator('.pt-job').hover()
  await wait(400)
  await p.screenshot({ path: join(OUT, `job-tooltip-${t}.png`), clip: { x: 700, y: 0, width: 740, height: 120 } })
  await p.locator('.pt-job').click()
  await wait(500)
  await p.screenshot({ path: join(OUT, `job-popover-${t}.png`), clip: { x: 560, y: 0, width: 880, height: 360 } })
  await p.keyboard.press('Escape')
  await button('More').click()
  await wait(500)
  await p.screenshot({ path: join(OUT, `canvas-more-${t}.png`), clip: { x: 900, y: 0, width: 540, height: 520 } })
  await p.keyboard.press('Escape')
}
await p.emulateMedia({ colorScheme: 'light' })
await openNode(2)
await sweep('video-picture-running')
const sound = button('Sound')
if (await sound.count()) { await sound.click(); await wait(800); await sweep('video-sound-running') }
await back()
await openNode(0)
await sweep('script-running')
// A question waiting for you, then a failure.
mode = 'ask'
await wait(7000)
console.log('asking:', await jobLabel())
await sweep('script-asking')
await back()
await sweep('canvas-asking')
mode = 'fail'
await wait(7000)
console.log('failed:', await jobLabel())
await sweep('canvas-failed')

// Frame 1 drawn for real, then the Image editor.
mode = 'pass'
await openNode(1)
const again = p.getByRole('button', { name: /Draw frame 1|Retry|Try again/ }).filter({ visible: true }).first()
if (await again.count()) { await again.click(); await wait(7000) }
const ie = p.getByRole('button', { name: 'Open in image editor' }).filter({ visible: true }).first()
if (await ie.count()) { await ie.click(); await wait(2500); await p.screenshot({ path: join(OUT, 'image-editor-full-light.png') }); await sweep('image') } else console.log('no frame drawn: the Image editor was not reached')

// The phone bar.
await p.setViewportSize({ width: 390, height: 844 })
await wait(800)
for (const r of await measure('phone-390')) results.push(r)
await p.screenshot({ path: join(OUT, 'phone-390-light.png'), clip: { x: 0, y: 0, width: 390, height: 140 } })

await browser.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
const bad = results.filter((r) => !r.ok)
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.label.padEnd(40)} ${String(r.bar).padEnd(10)} ${r.fit ?? ''} ${r.sw}/${r.cw} h${r.height} ${JSON.stringify(r.key)}`)
console.log(`${results.length - bad.length}/${results.length} bars fit`)
process.exit(bad.length ? 1 : 0)
