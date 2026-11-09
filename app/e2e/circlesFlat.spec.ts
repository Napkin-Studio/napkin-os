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

  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-orbs', 'flat')
  await expect(page.locator('html')).toHaveAttribute('data-orbs-gl', '0')
  await expect(page.locator('html')).toHaveAttribute('data-orbs-why', /no WebGL/)
  await expect(page.locator('[data-orb="on"]')).toHaveCount(0)
  await expect(page.getByTestId('client-circle').first().locator('.cl-disc > b')).toBeVisible() // the flat colour disc
  expect(await page.locator('canvas').count()).toBe(0)
  // nothing to switch: the account menu has no Flat circles
  await page.getByTestId('agency-pill').click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Flat circles' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await shot(page, 'p4-12-no-webgl-desk')

  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await page.getByRole('button', { name: /^Client A:/ }).click()
  await expect(page.getByTestId('dial')).toBeVisible({ timeout: 150 }) // no gate when flat
  await shot(page, 'p4-13-no-webgl-dial')
  await page.getByTestId('dial-hub').click() // the dial's hub: the client's page
  await expect(page).toHaveURL(/#client-/, { timeout: 150 })
  await expect(page.getByTestId('tool-research')).toBeVisible()
  await shot(page, 'p4-14-no-webgl-client')
  await page.getByTestId('tool-brief').click()
  await expect(page).toHaveURL(/#tool-.*-brief$/, { timeout: 150 })
  expect(errors).toEqual([])
})
