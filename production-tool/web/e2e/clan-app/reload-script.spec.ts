// S1-12 (lane B): a Script added with + Node, then a reload 250 ms later: the Script is still there, and it reaches
// the host at once (the host's data has `scripts`) without Ctrl+S and without waiting for the minute's save.
import { at, createProject, dataOf, expect, signIn, toolUrl } from './support'

at(1)('S1-12 a node added and a reload at 250 ms keeps the node and sends it up', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Reload script')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '+ Node' }).click()
  await page.getByRole('menuitem', { name: /Script/ }).first().click()
  await page.waitForTimeout(250)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => Object.keys(((await dataOf(page.request, tenant, doc)).scripts ?? {}) as object).length, { timeout: 20_000, message: 'the host has the script without a manual save' }).toBeGreaterThan(0)
})

at(1)('S1-12 a rename and a reload at 250 ms keeps the name, here and on the host', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Reload fast')
  await page.goto(toolUrl(doc))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: /^Reload fast/ }).click() // the film's ▾ menu (ui/chrome/DocMenu)
  await page.getByRole('menuitem', { name: /Rename/ }).click()
  await page.getByLabel("The project's name").fill('Edited just before reload')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.waitForTimeout(250)
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Edited just before reload').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await page.request.get(`/api/t/${tenant}/library`).then((r) => r.json())).items.find((i: { path: string }) => i.path === doc)?.title, { timeout: 20_000 }).toBe('Edited just before reload')
})
