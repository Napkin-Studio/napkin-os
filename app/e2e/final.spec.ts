// The final screenshot matrix of the landing, on the real shell and the real server:
// every screen at 1440 and 390 wide, in light and dark, with WebGL on (SwiftShader,
// so it runs with no GPU) and the flat fallback. It writes nothing unless a folder is
// given, and it asserts only that each screen shows up, so it stays a cheap smoke.
//
//   NAPKIN_E2E_SHOTS=<dir> npm run e2e -- final
//
// Clients are placeholders (Client A, Client B ...).

import { expect, test, type Browser, type Page } from '@playwright/test'
import { seedClients } from './seedClients'

const shots = process.env.NAPKIN_E2E_SHOTS
const SOFT_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const BRIEF = 'ie.napkin.brief-maker'
const DECK = 'ie.napkin.deck-maker'
const CONTEST = {
  selection: { contested: [{ id: 'c1', key: 'headline', status: 'open', values: [{ value: 'One' }, { value: 'Two' }] }] },
}
const SIZES = [{ tag: '1440', width: 1440, height: 900 }, { tag: '390', width: 390, height: 844 }]
const THEMES = ['light', 'dark'] as const

test.use({ launchOptions: { args: SOFT_GL } })
test.skip(!shots, 'set NAPKIN_E2E_SHOTS=<dir> to write the final screenshots')

async function open(browser: Browser, size: { width: number; height: number }, theme: string, flat = false) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
  await ctx.addInitScript(([t, f]) => {
    try {
      localStorage.setItem('napkin.theme', t as string)
      if (f) localStorage.setItem('napkin.circles.flat', '1')
    } catch { /* not kept */ }
  }, [theme, flat])
  const page = await ctx.newPage()
  await page.goto('/')
  return { ctx, page }
}

async function work(page: Page, api: string, app: string, title: string, clientId: string | null, patch?: unknown) {
  const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, ...(clientId ? { client_id: clientId } : {}) } })
  expect(r.status(), title).toBe(200)
  if (patch) {
    const { token } = await r.json() as { token: string }
    const p = await page.request.post(`/s/${token}/patch-data`, { data: { patch } })
    expect(p.status(), `patch ${title}`).toBe(200)
  }
}

async function snap(page: Page, name: string, hash: string, ready: string) {
  await page.goto(`/${hash}`)
  await page.reload()
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(1200) // the cross-fade from flat to 3D
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true })
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    const tag = `${size.tag}-${theme}`

    test(`screens with work in flight, ${tag}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, size, theme)
      const names = ['Client A', 'Client B', 'Client C', 'Client D', 'Client E']
      const { api, ids } = await seedClients(page, names.length)
      await work(page, api, BRIEF, 'Spring brief', ids[0], CONTEST)
      await work(page, api, BRIEF, 'Autumn brief', ids[0])
      await work(page, api, DECK, 'Pitch deck', ids[0], { run: { state: 'building', stage: 'Layout' } })
      await work(page, api, BRIEF, 'Launch brief', ids[1])
      await work(page, api, DECK, 'Board deck', ids[2], { run: { state: 'failed' } })
      await work(page, api, BRIEF, 'Review brief', ids[3], CONTEST)
      await snap(page, `01-landing-running-needs-you-${tag}`, '#agency', 'agency-circle')
      await snap(page, `02-clients-${tag}`, '#clients', 'client-circle')
      await snap(page, `03-client-tools-${tag}`, `#client-${ids[0]}`, 'tool-brief')
      await snap(page, `04-tool-page-${tag}`, `#tool-${ids[0]}-brief`, 'tool-page')
      await ctx.close()
    })

    test(`screens empty, ${tag}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, size, theme)
      await snap(page, `05-empty-landing-${tag}`, '#agency', 'agency-circle')
      await snap(page, `06-empty-clients-${tag}`, '#clients', 'empty')
      await ctx.close()
    })

    test(`screens with twenty clients, ${tag}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, size, theme)
      const { api, ids } = await seedClients(page, 20)
      for (const id of ids.slice(0, 6)) await work(page, api, BRIEF, 'A brief', id)
      await work(page, api, BRIEF, 'Needs brief', ids[1], CONTEST)
      await snap(page, `07-twenty-clients-${tag}`, '#clients', 'client-circle')
      await page.getByRole('button', { name: 'Show all 20' }).click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${shots}/08-twenty-clients-all-${tag}.png`, fullPage: true })
      await ctx.close()
    })

    test(`screens in the flat fallback, ${tag}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, size, theme, true)
      const { api, ids } = await seedClients(page, 4)
      await work(page, api, BRIEF, 'Spring brief', ids[0], CONTEST)
      await work(page, api, DECK, 'Pitch deck', ids[1], { run: { state: 'building', stage: 'Layout' } })
      await snap(page, `09-flat-landing-${tag}`, '#agency', 'agency-circle')
      await snap(page, `10-flat-clients-${tag}`, '#clients', 'client-circle')
      await snap(page, `11-flat-client-tools-${tag}`, `#client-${ids[0]}`, 'tool-brief')
      await expect(page.locator('html')).not.toHaveAttribute('data-orbs', 'gl')
      await ctx.close()
    })
  }
}
