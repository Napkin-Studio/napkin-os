// Brief Maker on the new UI (features/brief-new-ui.clan), on the real shell and the real server:
// the A4 sheet, its page-break guides, selecting a part, Confidential, moving and resizing a part,
// and all of it still there after a reload; then the same brief at 390 px. No model is called:
// the brief is written into the document with patch-data. Clients are placeholders.

import { expect, test, type Page } from '@playwright/test'
import { seedClients } from './seedClients'

const BRIEF = {
  project_name: 'Summer Spoons', client: 'Client A', job: 'Make the summer treat the one people share.',
  background: 'Volume has been flat for two summers while frozen drinks and delivery desserts grew. The product is loved but invisible between May and September.',
  barrier: 'Frozen drinks own refreshment; delivery apps own indulgence at home.',
  objectives: { commercial: 'Grow units 12% June to August with no price promotion.', behavioural: 'Make 16 to 24s order one on warm-day visits.', attitudinal: 'Move it from the thing I get to the thing that makes it summer.' },
  audience: '16 to 24s on a warm day out with friends, deciding in the moment.', competitor_context: 'Frozen drinks and delivery desserts.',
  insight: 'The best summer moments are not planned. They happen in the twenty minutes after someone says will we just.',
  single_minded_proposition: 'The best summers are measured in spoons.', objection: 'It is just a dessert.', reasons_to_believe: ['Two spoons on request', 'Made fresh in store'],
  desired_response: { think: 'This is the summer one.', feel: 'Spontaneous.', do: 'Order one to share.' },
  tone_and_world: ['Warm', 'Light'], budget_and_scope: '140k production; OOH, social, film.', mandatories: ['Show the product'], open_questions: ['Can staff offer two spoons?'],
}

async function openBrief(page: Page) {
  await page.goto('/')
  const { api, ids } = await seedClients(page, 1)
  const r = await page.request.post(`${api}/documents`, { data: { app_id: 'ie.napkin.brief-maker', title: 'Summer Spoons', client_id: ids[0] } })
  expect(r.status()).toBe(200)
  const { token } = await r.json() as { token: string }
  expect((await page.request.post(`/s/${token}/patch-data`, { data: { patch: BRIEF } })).status()).toBe(200)
  await page.goto(`/#tool-${ids[0]}-brief`)
  await page.reload()
  await page.getByTestId('work-item').first().click()
  const app = page.frameLocator('iframe').first()
  // 21 parts. The meta row's Version cell (the mock's fourth meta cell) is a row on the
  // grid too, but it is read-only and no part: count the rows that carry a part.
  await expect(app.locator('#fields .row[data-clan-part]')).toHaveCount(21, { timeout: 30_000 })
  await expect(app.locator('#fields .row.meta-version')).toHaveCount(1)
  return app
}

const order = (page: Page) => page.frames().find(f => f.url().includes('/s/'))!
  .evaluate(() => (window as unknown as { __CLAN__: { data: Record<string, unknown> } }).__CLAN__.data)

test('the brief sits on an A4 sheet: guides where the PDF breaks, select, Confidential, move and resize persist', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const app = await openBrief(page)
  // The page-break guides come from the sheet as it prints.
  await expect(app.locator('.pbreak').first()).toContainText(/Page 2 of \d/, { timeout: 15_000 })

  // Click selects; the Selected part panel offers Keep as is and, beside it, Confidential.
  const budget = app.locator('#fields .row[data-clan-part="budget_and_scope"]')
  await budget.locator('.lab > span').first().click()
  await expect(budget).toHaveClass(/\bsel\b/)
  const panel = app.locator('#selPart')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-sp="keep"] + [data-sp="conf"]')).toBeVisible()
  await panel.locator('[data-sp="conf"]').click()
  await expect(budget).toHaveClass(/\bconf\b/)
  await expect(budget.locator('.conftag')).toHaveText('Confidential')
  await expect(panel.locator('[data-sp="conf"]')).toHaveAttribute('aria-pressed', 'true')

  // Built from: compact rows (the mock), each opening the OS source card.
  await expect(panel.locator('#spBuilt .bf-row').first()).toBeVisible({ timeout: 15_000 })

  // Place on page: full width, then one place earlier; the keyboard on the grip moves it too.
  await panel.locator('.sp-l summary').click()
  await panel.locator('.sp-l [data-w="12"]').click()
  await expect(budget).toHaveAttribute('data-w', '12')
  await panel.locator('[data-sp="up"]').click()
  await expect.poll(async () => {
    const d = await order(page) as { layout?: { parts?: Record<string, { order: number; w: number }> } }
    const p = d.layout?.parts ?? {}
    return p.budget_and_scope && p.tone_and_world ? [p.budget_and_scope.w, p.budget_and_scope.order < p.tone_and_world.order] : null
  }).toEqual([12, true])

  // A reload keeps all of it: the layout, the width and the confidential part.
  await page.reload()
  // The shell reopens on the tool's page; the brief is opened again from its list.
  await page.getByTestId('work-item').first().click()
  const again = page.frameLocator('iframe').first()
  await expect(again.locator('#fields .row[data-clan-part]')).toHaveCount(21, { timeout: 30_000 })
  const b2 = again.locator('#fields .row[data-clan-part="budget_and_scope"]')
  await expect(b2).toHaveAttribute('data-w', '12')
  await expect(b2).toHaveClass(/\bconf\b/)
  const keys = await again.locator('#fields .row').evaluateAll(rs => rs.map(r => r.getAttribute('data-clan-part')))
  expect(keys.indexOf('budget_and_scope')).toBeLessThan(keys.indexOf('tone_and_world'))
  // Save · PDF and the menu's other ways to save are all there.
  for (const id of ['exPdf', 'exClient', 'exHtml', 'exGridPdf', 'exGridHtml', 'exHtmlPlain', 'exPdfPlain', 'saveBtn']) await expect(again.locator(`#${id}`)).toHaveCount(1)
})

test('at 390 px the sheet is one column and a selected part opens as a bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await openBrief(page)
  const job = app.locator('#fields .row[data-clan-part="job"]')
  await job.locator('.lab > span').first().click()
  const panel = app.locator('#selPart')
  await expect(panel).toBeVisible()
  expect(await panel.evaluate(el => getComputedStyle(el).position)).toBe('fixed')
  const box = await panel.boundingBox()
  expect(box && box.y + box.height).toBeGreaterThan(600)
  // One column: every part spans the sheet's width.
  const widths = await app.locator('#fields .row').evaluateAll(rs => [...new Set(rs.map(r => Math.round(r.getBoundingClientRect().width)))])
  expect(widths.length).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await panel.locator('[data-sp="done"]').click()
  await expect(panel).toBeHidden()
})
