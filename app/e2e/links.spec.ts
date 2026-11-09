// Links (features/spinoff-and-links.clan, os-layer §5.7) against the real
// stack: an existing brief linked into an existing deck from Continue in ▾,
// the lineage chips on both sides, the update notice when the brief changes,
// taking its newer version, and letting go. Clients are placeholders; no
// model is called.

import { expect, test, type Page } from '@playwright/test'

import { seedClients } from './seedClients'

async function seed(page: Page) {
  await page.goto('/')
  const { api, ids } = await seedClients(page, 1)
  const make = async (app: string, title: string) => {
    const r = await page.request.post(`${api}/documents`, { data: { app_id: app, title, client_id: ids[0] } })
    expect(r.status(), title).toBe(200)
    return (await r.json() as { token: string }).token
  }
  const brief = await make('ie.napkin.brief-maker', 'Summer Spoons')
  expect((await page.request.post(`/s/${brief}/patch-data`, { data: { patch: { client: 'Client A', single_minded_proposition: 'Spoons.' } } })).status()).toBe(200)
  await make('ie.napkin.deck-maker', 'Pitch deck')
  return { client: ids[0], brief }
}

async function openWork(page: Page, client: string, tool: string, title: string) {
  await page.goto(`/#tool-${client}-${tool}`)
  await page.reload()
  await page.getByTestId('work-item').filter({ hasText: title }).first().click()
  await expect(page.locator('[data-where="document"]')).toBeVisible({ timeout: 30_000 })
}

test('a brief links into a deck, shows on both sides, updates when it changes, and lets go', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { client, brief } = await seed(page)
  await openWork(page, client, 'deck', 'Pitch deck')

  const cont = page.getByRole('button', { name: /^Continue in/ })
  await cont.click()
  const link = page.getByRole('menuitem', { name: /↔ Summer Spoons/ })
  await expect(link).toBeVisible()
  await link.click()
  const chip = page.getByTestId('lineage-linked')
  await expect(chip).toContainText('Summer Spoons', { timeout: 15_000 })
  await expect(chip).toContainText('v1')
  await expect(page.getByTestId('link-changed')).toHaveCount(0)
  const shots = process.env.NAPKIN_E2E_SHOTS
  if (shots) await page.screenshot({ path: `${shots}/links-linked.png` })

  // The brief changes: the deck says so, and takes the newer version.
  expect((await page.request.post(`/s/${brief}/patch-data`, { data: { patch: { single_minded_proposition: 'Two spoons.' } } })).status()).toBe(200)
  await openWork(page, client, 'deck', 'Pitch deck')
  const notice = page.getByTestId('link-changed')
  await expect(notice).toContainText('Summer Spoons', { timeout: 15_000 })
  await expect(page.getByTestId('lineage-linked').locator('.ch-line-dot')).toHaveCount(1)
  if (shots) await page.screenshot({ path: `${shots}/links-changed.png` })
  await notice.getByRole('button', { name: 'Update' }).click()
  await expect(notice).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByTestId('lineage-linked')).toContainText('v2')

  // The brief says where it is used.
  await openWork(page, client, 'brief', 'Summer Spoons')
  await expect(page.getByTestId('lineage-linked-in')).toContainText('Pitch deck', { timeout: 15_000 })

  // Let go of it from the deck.
  await openWork(page, client, 'deck', 'Pitch deck')
  await expect(page.getByTestId('lineage-linked')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Continue in/ }).click()
  if (shots) await page.screenshot({ path: `${shots}/links-menu.png` })
  await page.getByRole('menuitem', { name: /Unlink Summer Spoons/ }).click()
  await expect(page.getByTestId('lineage-linked')).toHaveCount(0, { timeout: 15_000 })
})
