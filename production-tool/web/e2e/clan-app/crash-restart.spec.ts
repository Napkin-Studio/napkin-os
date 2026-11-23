// S1-14 in the real page: edit, wait for the save, kill -9 napkin-web, start it again, open from the
// library: the edit is there. Uses scripts/e2e-production-clan kill9 and up (the lane's own stack).
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { at, here, createProject, expect, renameProject, signIn, toolUrl, waitSavedTitle } from './support'

const script = join(here, '../../../../scripts/e2e-production-clan')

at(1)('S1-14 a save answered 200 survives kill -9 of the host', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Crash walk')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await renameProject(page, 'Survives the crash')
  await page.keyboard.press('Control+s')
  await waitSavedTitle(page.request, tenant, doc, 'Survives the crash')
  execFileSync(script, ['kill9'], { stdio: 'inherit' })
  execFileSync(script, ['up'], { stdio: 'inherit' })
  await signIn(page.request)
  await page.goto(toolUrl(doc))
  await expect(page.getByText('Survives the crash').first()).toBeVisible({ timeout: 60_000 })
})
