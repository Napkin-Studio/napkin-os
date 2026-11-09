// The 3D circles, end to end, in the real shell with WebGL on (SwiftShader, so it
// runs on a machine with no GPU): one context, a canvas per circle, the pointer
// followed across the window, a press seen before the page moves on, the keyboard
// never held up, "Flat circles", dark, a lost context, reduced motion, and the
// frame budget at 390 px with 6 and 20 clients. Clients are placeholders.
//
//   npm run e2e -- circles
//   NAPKIN_E2E_SHOTS=<dir> npm run e2e -- circles     (also writes screenshots)

import { expect, test, type Page } from '@playwright/test'
import { ink, picture, seedClients } from './seedClients'

const shots = process.env.NAPKIN_E2E_SHOTS
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }) }
const ON = '[data-orb-host][data-orb="on"]'
const SOFT_GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

test.use({ launchOptions: { args: SOFT_GL } })

/** The page's WebGL context, kept so a test can lose and restore it. */
const keepGL = (page: Page) => page.addInitScript(() => {
  const real = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...a: unknown[]) {
    const c = (real as (...x: unknown[]) => unknown).call(this, kind, ...a)
    if (kind === 'webgl' && c) (window as unknown as { __gl?: unknown }).__gl = c
    return c
  } as typeof real
})

test('every screen draws its circles in 3D through one context', async ({ page }) => {
  await keepGL(page)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/')
  await seedClients(page, 3)
  await page.reload()

  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-orbs', 'gl')
  await expect(html).toHaveAttribute('data-orbs-gl', '1')
  await expect(page.locator(ON)).toHaveCount(1) // the agency circle
  expect(await ink(page, '[data-testid="agency-circle"]')).toBeGreaterThan(2000)
  // the flat circle is still the accessible mark: the button names it, the initials stay as text
  await expect(page.getByTestId('agency-circle').locator('.lc-ini')).toBeVisible()
  await shot(page, 'p4-01-landing-3d')

  await page.getByTestId('agency-circle').click()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await expect(page.locator(ON)).toHaveCount(4) // three clients and the hub
  for (let i = 0; i < 3; i++) expect(await ink(page, `[data-testid="client-circle"]:nth-child(${i + 2})`)).toBeGreaterThan(500)
  await shot(page, 'p4-02-clients-3d')

  await page.getByRole('button', { name: /^Client A,/ }).click()
  await expect(page).toHaveURL(/#client-/)
  await expect(page.getByTestId('tool-brief')).toBeVisible()
  await expect(page.locator(ON)).toHaveCount(7) // the client and six tools
  await expect(page.locator('.lc-dim[data-orb-host]')).toHaveCount(3) // Idea and Prod are "Soon"; so is Ads, which the seed does not install
  await expect(page.getByTestId('tool-idea')).toHaveAttribute('aria-disabled', 'true')
  await shot(page, 'p4-03-client-tools-3d')

  // one WebGL context for all of them: the page's one drawing canvas is not in the document
  expect(await page.evaluate(() => [...document.querySelectorAll('canvas')].filter(c => !c.closest('[data-orb-host]')).length)).toBe(0)
  expect(errors).toEqual([])
})

test('every 3D circle leans toward the pointer anywhere in the window, no click needed', async ({ page }) => {
  await page.goto('/')
  await seedClients(page, 3)
  await page.reload()
  await page.getByTestId('agency-circle').click()
  await expect(page.locator(ON)).toHaveCount(4)
  const sel = '[data-testid="client-circle"]:nth-child(2)'
  const rest = []
  for (const [x, y] of [[8, 8], [1270, 700], [640, 780], [8, 700]]) {
    await page.mouse.move(x, y, { steps: 4 })
    await page.waitForTimeout(700)
    rest.push(await picture(page, sel))
  }
  expect(new Set(rest).size, 'a different picture for each place the pointer rests').toBe(4)
  // still following after a press elsewhere and a release, and far from any circle
  await page.mouse.move(1270, 20)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(500)
  expect(await ink(page, sel)).toBeGreaterThan(500)
})

test('a press is seen before the page moves on; a drag to play still goes on at the release', async ({ page }) => {
  await page.goto('/')
  await seedClients(page, 2)
  await page.reload()
  await expect(page.locator(ON)).toHaveCount(1)
  const door = page.getByTestId('agency-circle')

  // a tap: the squish and ripple start, and the next screen follows
  const box = (await door.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 100)
  const before = await picture(page, '[data-testid="agency-circle"]')
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(60)
  await expect(page).toHaveURL(/#agency$/) // not yet
  expect(await picture(page, '[data-testid="agency-circle"]')).not.toBe(before) // the ripple has started
  await expect(page).toHaveURL(/#clients$/, { timeout: 1500 })

  // press, drag away, play, release anywhere: goes on at the release, not before
  await page.goto('/#clients')
  await expect(page.locator(ON)).toHaveCount(3)
  const c = (await page.getByTestId('client-circle').first().boundingBox())!
  await page.mouse.move(c.x + c.width / 2, c.y + 40)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width + 160, c.y + 200, { steps: 8 })
  await page.waitForTimeout(700)
  await expect(page).toHaveURL(/#clients$/)
  await page.mouse.up()
  await expect(page).toHaveURL(/#client-/, { timeout: 1500 })
})

test('the keyboard is never held up: Enter goes straight on', async ({ page }) => {
  await page.goto('/')
  await seedClients(page, 2)
  await page.reload()
  await expect(page.locator(ON)).toHaveCount(1)
  await page.getByTestId('agency-circle').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#clients$/, { timeout: 120 })
  await page.getByTestId('client-circle').first().focus()
  await page.keyboard.press('Space')
  await expect(page).toHaveURL(/#client-/, { timeout: 120 })
})

test('Flat circles: the flat SVG, plain clicks, and it is remembered', async ({ page }) => {
  await page.goto('/')
  await seedClients(page, 2)
  await page.reload()
  await expect(page.locator(ON)).toHaveCount(1)
  const toggle = page.getByRole('button', { name: 'Flat circles' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'flat')
  await expect(page.locator('html')).toHaveAttribute('data-orbs-why', 'forced flat')
  await expect(page.locator(ON)).toHaveCount(0)
  await expect(page.getByTestId('agency-circle').locator('svg.lc-cir circle').first()).toBeVisible()
  await shot(page, 'p4-04-landing-forced-flat')
  await page.getByTestId('agency-circle').click()
  await expect(page).toHaveURL(/#clients$/, { timeout: 150 }) // no gate when flat
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'flat')
  await page.getByRole('button', { name: 'Flat circles' }).click()
  await expect(page.locator(ON)).toHaveCount(3)
})

test('dark and light read the page tokens', async ({ page }) => {
  await page.goto('/')
  await seedClients(page, 2)
  await page.reload()
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.getByTestId('agency-circle').focus()
  await expect(page.locator(ON)).toHaveCount(1)
  await page.waitForTimeout(400)
  const light = await picture(page, '[data-testid="agency-circle"]')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(800)
  const dark = await picture(page, '[data-testid="agency-circle"]')
  expect(dark).not.toBe(light)
  await shot(page, 'p4-05-landing-dark-3d')
  await page.getByTestId('agency-circle').click()
  await expect(page).toHaveURL(/#clients$/)
  await page.waitForTimeout(500)
  await shot(page, 'p4-06-clients-dark-3d')
})

test('a lost context shows the flat circles; a restored one brings the 3D back', async ({ page }) => {
  await keepGL(page)
  await page.goto('/')
  await seedClients(page, 2)
  await page.reload()
  await expect(page.locator(ON)).toHaveCount(1)
  await page.evaluate(() => {
    const w = window as unknown as { __gl: WebGLRenderingContext; __lose: WEBGL_lose_context }
    w.__lose = w.__gl.getExtension('WEBGL_lose_context')!
    w.__lose.loseContext()
  })
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'flat')
  await expect(page.locator(ON)).toHaveCount(0)
  await shot(page, 'p4-07-context-lost-flat')
  await page.getByTestId('agency-circle').click() // still works, flat, no gate
  await expect(page).toHaveURL(/#clients$/, { timeout: 150 })
  await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext())
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'gl')
  await expect(page.locator(ON)).not.toHaveCount(0)
})

for (const n of [6, 20]) {
  test(`frame budget at 390 px with ${n} clients`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await seedClients(page, n)
    await page.goto('/#clients')
    await page.reload()
    await expect(page.getByTestId('client-circle')).toHaveCount(Math.min(n, 8))
    await expect(page.locator(`[data-testid="client-circle"] ${ON}`).first()).toBeVisible()
    await page.mouse.move(200, 400, { steps: 5 })
    await page.waitForTimeout(500)
    const r = await page.evaluate(() => new Promise<{ fps: number; worst: number }>(done => {
      let last = performance.now(), worst = 0, n = 0
      const t0 = last
      const f = (t: number) => {
        worst = Math.max(worst, t - last); last = t; n++
        if (t - t0 < 2000) requestAnimationFrame(f); else done({ fps: n / ((t - t0) / 1000), worst })
      }
      requestAnimationFrame(f)
    }))
    test.info().annotations.push({ type: 'frames', description: `${n} clients @390: ${r.fps.toFixed(1)} fps, worst frame ${r.worst.toFixed(0)} ms (SwiftShader, no GPU)` })
    expect(r.fps, `fps with ${n} clients`).toBeGreaterThan(8)
    expect(await page.locator(ON).count()).toBeLessThanOrEqual(40)
    await shot(page, `p4-08-phone-${n}`)
    if (n > 8) {
      await page.getByRole('button', { name: /Show all/ }).click()
      await expect(page.getByTestId('client-circle')).toHaveCount(n)
      expect(await page.locator(ON).count()).toBeLessThanOrEqual(40)
      await shot(page, `p4-09-phone-${n}-all`)
    }
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })
  test('the circles are 3D but still, the cross-fade is the only motion, and clicks are not delayed', async ({ page }) => {
    await page.goto('/')
    await seedClients(page, 2)
    await page.reload()
    await expect(page.locator(ON)).toHaveCount(1)
    await page.mouse.move(5, 5)
    await page.waitForTimeout(700)
    const a = await picture(page, '[data-testid="agency-circle"]')
    await page.waitForTimeout(1200)
    expect(await picture(page, '[data-testid="agency-circle"]'), 'nothing moves on its own').toBe(a)
    await shot(page, 'p4-10-landing-reduced-motion')
    await page.getByTestId('agency-circle').click()
    await expect(page).toHaveURL(/#clients$/, { timeout: 150 })
    await expect(page.locator(ON)).toHaveCount(3)
    await shot(page, 'p4-11-clients-reduced-motion')
  })
})
