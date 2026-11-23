// Stage 3 (record production-jobs-via-host): the browser talks to napkin-web only. fixme until stage 3.
import { at, createProject, expect, signIn, toolUrl, watchOrigins } from './support'

at(3)('S3-1 a mock-mode walk makes no request to the relay origin', async ({ page }) => {
  const seen = watchOrigins(page)
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'One origin')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  // the only other origin allowed is the public media base (GET)
  expect(seen.foreign.filter((r) => !r.startsWith('GET '))).toEqual([])
})
