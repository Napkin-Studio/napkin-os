// S1-17: importing an export re-homes every picture by its hash (LESSONS #8: 3 of 23). FX-EXPORT opened in
// a second workspace: a fresh browser context (empty IndexedDB, empty media cache). 23 of 23 resolve; if one
// cannot, the person is told how many and which, never silently.
import { at, EXPORT_ZIP, expect, haveFixture, signIn, test } from './support'

at(1)('S1-17 an import resolves every picture by hash', async ({ browser }) => {
  test.skip(!haveFixture(EXPORT_ZIP), `no FX-EXPORT at ${EXPORT_ZIP} (set PRODUCTION_FIXTURES)`)
  const page = await (await browser.newContext()).newPage()
  await signIn(page.request)
  await page.goto('/production/')
  await page.locator('input[type=file][aria-label="Open a .clan file"]').setInputFiles(EXPORT_ZIP)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90_000 })
  // every <img>/<canvas> picture decoded: none broken, and no "missing" note
  await expect.poll(async () => page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length), { timeout: 60_000 }).toBe(0)
  await expect(page.getByText(/\d+ pictures? (are|is) missing/i)).toHaveCount(0)
})
