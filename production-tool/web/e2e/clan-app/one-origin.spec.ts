// Stage 3 (record production-jobs-via-host): the browser talks to napkin-web only. fixme until stage 3.
import { addNode, at, createProject, enforceCsp, expect, signIn, toolUrl, waitSavedKind, watchOrigins } from './support'

at(3)('S3-1 a mock-mode walk makes no request to the relay origin', async ({ page }) => {
  const seen = watchOrigins(page)
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'One origin')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  // the only other origins allowed: the public media base (GET) and the S3 upload origin (PUT on the relay's
  // presigned link: bytes go straight to S3, owner 2026-11-23). E2E_UPLOAD_ORIGIN names it; unset, no PUT leaves.
  const upload = process.env.E2E_UPLOAD_ORIGIN ? new URL(process.env.E2E_UPLOAD_ORIGIN).origin : null
  expect(seen.foreign.filter((r) => !r.startsWith('GET ') && r !== `PUT ${upload}`)).toEqual([])
})

at(3)('S3-1 the page works under the ENFORCED policy: no eval, the validators are precompiled (owner, 2026-11-24)', async ({ page }) => {
  const csp = await enforceCsp(page)
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Strict policy')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  // a real edit: the patch batch and the whole document are validated (page and store Worker), then saved
  await addNode(page, 'Script')
  await page.keyboard.press('Control+s')
  await waitSavedKind(page.request, tenant, doc, 'scripts', 30_000)
  expect(csp.enforced.length, 'the policy was enforced on the tool page').toBeGreaterThan(0)
  expect(csp.violations).toEqual([])
  expect(csp.evalErrors).toEqual([])
})
