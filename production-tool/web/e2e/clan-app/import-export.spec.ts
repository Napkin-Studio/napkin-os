// S1-17: importing an export re-homes every picture by its hash (LESSONS #8: 3 of 23). FX-EXPORT opened in
// a second workspace: a fresh browser context (empty IndexedDB, empty media cache). 23 of 23 resolve; if one
// cannot, the person is told how many and which, never silently.
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { at, createProject, EXPORT_ZIP, expect, haveFixture, signIn, test, toolUrl } from './support'

at(1)('S1-17 an import resolves every picture by hash', async ({ browser }) => {
  test.skip(!haveFixture(EXPORT_ZIP), `no FX-EXPORT at ${EXPORT_ZIP} (set PRODUCTION_FIXTURES)`)
  const page = await (await browser.newContext()).newPage()
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Import walk')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('banner').getByRole('button', { name: /saved|not saved|saving/i }).first().click()
  await page.locator('input[type=file][aria-label="Open a .clan file"]').setInputFiles(EXPORT_ZIP)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90_000 })
  // every asset of the zip is in this browser by its hash: the blob store holds at least as many as the zip has
  // (23 pictures and 8 clips for FX-EXPORT), and nothing says a picture is missing
  const inZip = Object.keys(unzipSync(new Uint8Array(readFileSync(EXPORT_ZIP)))).filter((n) => /^assets\/.+\.(png|jpe?g|webp|mp4)$/.test(n)).length
  expect(inZip, 'the fixture is the 23-picture export').toBeGreaterThanOrEqual(23)
  const blobs = () => page.evaluate(() => new Promise<number>((ok) => {
    const r = indexedDB.open('napkin-production-tool')
    r.onsuccess = () => { const q = r.result.transaction('blobs').objectStore('blobs').count(); q.onsuccess = () => ok(q.result) }
  }))
  await expect.poll(blobs, { timeout: 60_000 }).toBeGreaterThanOrEqual(inZip)
  await expect(page.getByText(/\d+ pictures? (are|is) missing|could not be found/i)).toHaveCount(0)
})
