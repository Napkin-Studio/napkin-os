// Looking after the client registry from the screen, end to end: Adopt clients
// from free-text names, rename (and a name in use is refused), archive, restore.
// Every client name is a placeholder (Client A, Client B...).

import { expect, test, type Page } from '@playwright/test'

const BRIEF = 'ie.napkin.brief-maker'

async function legacyDoc(page: Page, api: string, title: string, name: string) {
  const r = await page.request.post(`${api}/documents`, { data: { app_id: BRIEF, title } })
  expect(r.status(), title).toBe(200)
  const { token } = await r.json() as { token: string }
  expect((await page.request.post(`/s/${token}/patch-data`, { data: { patch: { client: name } } })).status()).toBe(200)
}

test('adopt clients from free-text names, then rename, archive and restore one', async ({ page }) => {
  await page.goto('/')
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  expect((await page.request.post(`${api}/clients`, { data: { name: 'Client A' } })).status()).toBe(201)
  await legacyDoc(page, api, 'Old brief one', 'Client D')
  await legacyDoc(page, api, 'Old brief two', 'client  d')
  await legacyDoc(page, api, 'Old brief three', 'Client E')

  await page.goto('/#clients')
  await expect(page.getByTestId('client-circle')).toHaveCount(1)
  await page.getByTestId('adopt-button').click()
  await expect(page.getByTestId('adopt-panel')).toBeVisible()
  await expect(page.getByLabel(/Client D/)).toBeChecked()
  // Leave Client E out: only the chosen name becomes a client.
  await page.getByLabel(/Client E/).uncheck()
  await page.getByRole('button', { name: 'Adopt 1 name' }).click()
  await expect(page.getByTestId('adopt-done')).toContainText('Added 1 client, linked 2 documents.')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('client-circle')).toHaveCount(2)
  // Client E stays on offer, with one document.
  await expect(page.getByTestId('adopt-button')).toContainText('Adopt clients (1)')

  // Rename: a name in use is refused in the host's words; a free one lands.
  await page.getByRole('button', { name: /^Client D,/ }).click()
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await expect(page.getByTestId('work-item')).toHaveCount(2)
  await page.getByRole('button', { name: 'Rename Client D' }).click()
  await page.getByLabel('New name').fill('client a')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('already a client called')
  await page.getByLabel('New name').fill('Client F')
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Client F' })).toBeVisible()
  await expect(page.getByTestId('work-item')).toHaveCount(2)

  // Archive asks first, keeps the work, and leaves the circles.
  await page.getByRole('button', { name: 'Archive Client F' }).click()
  await expect(page.getByTestId('archive-confirm')).toContainText('Its work is kept')
  await page.getByRole('button', { name: 'Keep it' }).click()
  await expect(page.getByTestId('client-page')).toBeVisible()
  await page.getByRole('button', { name: 'Archive Client F' }).click()
  await page.getByRole('button', { name: 'Archive Client F', exact: true }).last().click()
  await expect(page).toHaveURL(/#clients$/)
  await expect(page.getByTestId('client-circle')).toHaveCount(1)
  await page.getByText('Archived clients (1)').click()

  // Restore brings it, and its work, back.
  await page.getByRole('button', { name: 'Restore Client F' }).click()
  await expect(page.getByTestId('client-circle')).toHaveCount(2)
  await page.getByRole('button', { name: /^Client F,/ }).click()
  await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
  await expect(page.getByTestId('work-item')).toHaveCount(2)
})

for (const width of [320, 390]) {
  test(`the registry controls fit a ${width}px phone, in dark mode, with reduced motion`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce', baseURL: `http://127.0.0.1:${process.env.NAPKIN_E2E_PORT || '18080'}` })
    const page = await ctx.newPage()
    await page.goto('/')
    const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
    const api = `/api/t/${tenant}`
    expect((await page.request.post(`${api}/clients`, { data: { name: 'Client A' } })).status()).toBe(201)
    await legacyDoc(page, api, 'Old brief', 'Client D')
    await page.goto('/#clients')
    await page.getByTestId('adopt-button').click()
    await expect(page.getByTestId('adopt-panel')).toBeVisible()
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    expect(await noScroll(), 'adopt panel').toBe(true)
    // 44px targets for the checkbox row and the buttons.
    for (const loc of [page.getByTestId('adopt-panel').locator('label').first(), page.getByRole('button', { name: /^Adopt 1 name/ })]) {
      expect((await loc.boundingBox())!.height).toBeGreaterThanOrEqual(43.5)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('adopt-panel')).toHaveCount(0)
    await page.getByRole('button', { name: /^Client A,/ }).click()
    await page.getByTestId('dial-open-client').click() // the dial's hub: the client's page
    await expect(page.getByRole('button', { name: 'Rename Client A' })).toBeVisible()
    await page.getByRole('button', { name: 'Archive Client A' }).click()
    expect(await noScroll(), 'archive confirm').toBe(true)
    // Escape closes the confirm and does not leave the client page.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('archive-confirm')).toHaveCount(0)
    await expect(page.getByTestId('client-page')).toBeVisible()
    await ctx.close()
  })
}
