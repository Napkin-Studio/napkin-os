// S1-12: an edit followed at once by a reload is not lost (UAT round 6: an edit + reload within about 0.4 s
// was lost silently). The browser's working copy is flushed first, then pushed on open.
import { at, createProject, expect, renameProject, signIn, toolUrl } from './support'

at(1)('S1-12 an edit and a reload within 300 ms keeps the edit', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Reload fast')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await renameProject(page, 'Edited just before reload')
  await page.waitForTimeout(250)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Edited just before reload').first()).toBeVisible({ timeout: 30_000 })
})
