// Stage 2 (record production-app-page): the tool is a page on napkin-web's own origin. fixme until stage 2.
import { at, createProject, expect, signIn } from './support'

at(2)('S2-1 clicking a Production project opens /production/d/<doc> on the same origin, no second sign-in', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Open from the library')
  await page.goto('/')
  await page.getByText('Open from the library').first().click()
  await expect(page).toHaveURL(new RegExp(`/production/d/${doc}$`))
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel(/sign in/i)).toHaveCount(0)
})

at(2)('S2-4 the page keeps Worker, wasm, IndexedDB and fonts', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Browser features')
  await page.goto(`/production/d/${doc}`)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  const caps = await page.evaluate(async () => ({
    worker: typeof Worker === 'function',
    wasm: typeof WebAssembly === 'object',
    idb: await new Promise<boolean>((ok) => { const r = indexedDB.open('probe'); r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('probe'); ok(true) }; r.onerror = () => ok(false) }),
    fonts: document.fonts.size > 0,
  }))
  expect(caps).toEqual({ worker: true, wasm: true, idb: true, fonts: true })
})

at(2)('S2-6 a session that ends mid-edit keeps the working copy and asks to sign in again', async ({ page }) => {
  const tenant = await signIn(page.request)
  const doc = await createProject(page.request, tenant, 'Session ends')
  await page.goto(`/production/d/${doc}`)
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 })
  await page.context().clearCookies()
  await page.keyboard.press('Control+s')
  await expect(page.getByText(/sign in/i).first()).toBeVisible({ timeout: 30_000 })
})
