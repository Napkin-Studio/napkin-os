// A run that fails (features/screen-states.clan, pilot test 15 without its credit line): the shell shows
// the Run failed state as one plain line with Try again, the inputs stay, and Try again runs it again.
// The stand-in middleware (stack.mjs) is told to fail the run; no model and no provider is called.
// The credit line ("the credits come back") is pilot 15 in j001-pilot.spec.ts: the meter returns the charge.

import { expect, test } from '@playwright/test'
import { seedJ001 } from './seed/j001'

const mw = `http://127.0.0.1:${process.env.NAPKIN_E2E_MW_PORT || '18081'}/control`

for (const [tag, width, height] of [['390', 390, 844], ['1440', 1440, 900]] as const) {
  test(`a failed run shows one plain line, keeps the inputs, and Try again runs it again, ${tag} px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height } })
    const page = await ctx.newPage()
    const job = await seedJ001(page)
    expect((await page.request.post(`${job.api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title: 'J001 blank brief', client_id: job.client } })).status()).toBe(200)
    await page.request.post(mw, { data: { state: 'failed', stage: 'provider error' } })
    try {
      await page.goto(`/#tool-${job.client}-brief`)
      await page.getByTestId('work-item').filter({ hasText: 'J001 blank brief' }).click()
      const app = page.frameLocator('iframe').first()
      const ask = 'Client A, an Irish whiskey, wants to reach drinkers aged 25 to 34.'
      await app.locator('#prompt').fill(ask)
      await app.getByRole('button', { name: 'Write the brief' }).click()
      const failed = page.locator('[data-state="run-failed"]')
      await expect(failed).toBeVisible()
      expect((await failed.locator('.ns-line').allInnerTexts()).filter(Boolean)).toHaveLength(1) // one plain line
      await expect(failed).not.toContainText(/exception|stack|[{}]/i)
      await expect(app.locator('body')).toContainText(ask) // the inputs stay
      // The provider is back: Try again sends the same ask and the state goes.
      await page.request.post(mw, { data: { state: 'running', stage: 'research' } })
      await failed.getByRole('button', { name: 'Try again' }).click()
      await expect(failed).toHaveCount(0)
      await expect(app.locator('body')).toContainText(ask)
    } finally {
      await page.request.post(mw, { data: { state: 'running', stage: 'research' } })
    }
    await ctx.close()
  })
}
