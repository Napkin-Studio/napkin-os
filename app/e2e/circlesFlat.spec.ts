// The circles with no WebGL at all (the browser is started without it): every
// screen is still the flat SVG circle, everything works, nothing is delayed, and
// the page says so. Clients are placeholders.
//
//   npm run e2e -- circlesFlat

import { expect, test, type Page } from '@playwright/test'
import { seedClients } from './seedClients'

const shots = process.env.NAPKIN_E2E_SHOTS
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }) }

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'] } })

test('without WebGL every screen is the flat circle and nothing waits', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await seedClients(page, 3)
  await page.reload()

  await expect(page.getByTestId('landing')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'flat')
  await expect(page.locator('html')).toHaveAttribute('data-orbs-gl', '0')
  await expect(page.locator('html')).toHaveAttribute('data-orbs-why', /no WebGL/)
  await expect(page.locator('[data-orb="on"]')).toHaveCount(0)
  await expect(page.getByTestId('agency-circle').locator('svg.lc-cir')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Flat circles' })).toBeHidden() // nothing to switch
  await shot(page, 'p4-12-no-webgl-landing')

  await page.getByTestId('agency-circle').click()
  await expect(page).toHaveURL(/#clients$/, { timeout: 150 })
  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await shot(page, 'p4-13-no-webgl-clients')
  await page.getByRole('button', { name: /^Client A,/ }).click()
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await expect(page).toHaveURL(/#client-/, { timeout: 150 })
  await expect(page.getByTestId('tool-deck')).toBeVisible()
  await shot(page, 'p4-14-no-webgl-client')
  await page.getByTestId('tool-brief').click()
  await expect(page).toHaveURL(/#tool-.*-brief$/, { timeout: 150 })
  expect(errors).toEqual([])
})
