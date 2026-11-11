// The circles are always flat (owner, 2026-11-11): the desk's colour discs and
// the client page, with no canvas, no 3D switch, and nothing delayed. Run with
// no WebGL at all, so nothing could draw a sphere if it tried. Clients are
// placeholders.
//
//   npm run e2e -- circlesFlat

import { expect, test, type Page } from '@playwright/test'
import { seedClients } from './seedClients'

const shots = process.env.NAPKIN_E2E_SHOTS
const shot = async (page: Page, name: string) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }) }

test.use({ launchOptions: { args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis', '--disable-gpu'] } })

test('every screen is the flat circle and nothing waits', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto('/')
  await seedClients(page, 3)
  await page.reload()

  await expect(page.getByTestId('desk')).toBeVisible()
  await expect(page.locator('[data-orb-host], [data-orb]')).toHaveCount(0)
  await expect(page.getByTestId('client-circle').first().locator('.cl-disc > b')).toBeVisible() // the flat colour disc
  expect(await page.locator('canvas').count()).toBe(0)
  // nothing to switch: the account menu has no Flat circles
  await page.getByTestId('account-button').click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Flat circles' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('account-button')).toBeFocused()
  await shot(page, 'p4-12-no-webgl-desk')

  await expect(page.getByTestId('client-circle')).toHaveCount(3)
  await page.getByRole('button', { description: /^Client A:/ }).click()
  await expect(page.getByTestId('dial')).toBeVisible({ timeout: 150 }) // no gate when flat
  await shot(page, 'p4-13-no-webgl-dial')
  await page.getByTestId('dial-hub').click() // the dial's hub: the client's page
  await expect(page).toHaveURL(/#client-/, { timeout: 150 })
  await expect(page.getByTestId('tool-research')).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
  await shot(page, 'p4-14-no-webgl-client')
  await page.getByTestId('tool-brief').click()
  await expect(page).toHaveURL(/#tool-.*-brief$/, { timeout: 150 })
  expect(errors).toEqual([])
})
