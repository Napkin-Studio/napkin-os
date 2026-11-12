// The UAT journeys (features/uat-loop.clan). Run by scripts/uat-round against a deployed stack.
// Each journey asserts what a person must see and how long they wait; over a budget fails it.

import { expect, test } from '@playwright/test'
import { addClient, appFrame, BUDGET, dialButton, measure, openTool, signIn, stamp } from './helpers'

const ACCOUNT = 'plu@pluto' as const
const client = `UAT ${stamp()}`
/** The finished Research document, for the journeys that read it after the run. */
let researchUrl = ''

test.describe.configure({ mode: 'serial' })

test('sign in, the desk, a new client', async ({ page }) => {
  await signIn(page, ACCOUNT)
  const t0 = Date.now()
  await addClient(page, client)
  measure('add-client', Date.now() - t0, BUDGET.desk)
})

test('every tool on the dial opens, or says it is coming', async ({ page }) => {
  await signIn(page, ACCOUNT)
  for (const tool of ['Research', 'Brief'] as const) {
    await page.goto('/')
    const t0 = Date.now()
    await openTool(page, client, tool)
    // Each tool's landing names itself in its heading.
    await expect(page.getByRole('heading').filter({ hasText: new RegExp(tool) }).first()).toBeVisible({ timeout: 30_000 })
    measure(`open-${tool.toLowerCase()}`, Date.now() - t0, BUDGET.docOpen)
  }
  // Deck and Production are not built yet: their buttons must be there and disabled, not broken.
  await page.goto('/')
  for (const tool of ['Deck', 'Production'] as const) {
    const b = await dialButton(page, client, tool)
    await expect(b).toBeDisabled()
    await expect(b).toHaveAccessibleName(/coming soon/)
    await page.keyboard.press('Escape')
  }
})

test('a Research run reaches a report with sources and pins (paid)', async ({ page }) => {
  await signIn(page, ACCOUNT)
  await openTool(page, client, 'Research')
  const t0 = Date.now()
  await page.getByText('+ New research question').click()
  const app = await appFrame(page, t0, 'open-new-research', '#cmp-prompt')

  await app.locator('#cmp-prompt').fill('Oat drinks in Ireland and the UK: how big is the category in 2024-2025, who are the main brands, and what share does the leader hold?')
  const run0 = Date.now()
  await app.locator('[data-act="cmp-send"]').click()

  // Answer every question with its first offered option until the report is drawn.
  const report = app.locator('.rp-band')
  const failed = app.locator('.rs-err, [role="alert"]')
  let questions = 0
  while (Date.now() - run0 < BUDGET.research) {
    if (await report.isVisible()) break
    if (await failed.first().isVisible()) throw new Error('run shows an error: ' + await failed.first().innerText())
    const opt = app.locator('#qcard [data-act="q-opt"]:not(.escape):not([disabled])').first()
    if (await opt.isVisible()) { await opt.click(); questions++; continue }
    await page.waitForTimeout(2_000)
  }
  await expect(report, 'report drawn within budget').toBeVisible({ timeout: 1_000 })
  measure('research-run', Date.now() - run0, BUDGET.research, { questions })

  const stats = await app.locator('.rp-stats').innerText()
  const n = (label: string) => Number((stats.match(new RegExp(`(\\d+)\\s+${label}`)) || [])[1] || 0)
  measure('research-yield', 0, undefined, { sources: n('sources'), pins: n('pins'), findings: n('findings') })
  expect(n('sources'), 'sources read').toBeGreaterThan(0)
  expect(n('pins'), 'facts pinned').toBeGreaterThan(0)

  // Reopening the finished document is a separate open: it must be fast too.
  const href = page.url()
  researchUrl = href
  await page.goto('/')
  const t1 = Date.now()
  await page.goto(href)
  await appFrame(page, t1, 'reopen-research', '.rp-band')
})

/** The finished Research report, open. */
async function openReport(page: import('@playwright/test').Page) {
  test.skip(!researchUrl, 'needs the Research run above')
  await signIn(page, ACCOUNT)
  const t0 = Date.now()
  await page.goto(researchUrl)
  return appFrame(page, t0, 'open-report', '.rp-band')
}

test('evidence map: open it, follow a finding, switch to the report and back', async ({ page }) => {
  const app = await openReport(page)
  const t0 = Date.now()
  await app.locator('[data-view="map"]').click()
  await expect(app.locator('#mapview svg')).toBeVisible()
  measure('open-map', Date.now() - t0, 3_000)
  // A finding on the map opens in the inspector with what it rests on.
  const finding = app.locator('#mapview [data-map^="fi"], #mapview [data-map*="fi_"]').first()
  await finding.click()
  await app.locator('[data-act="pv-mapopen"]').click()
  await expect(app.locator('#insp-sel .crumbs [data-crumb]').first()).toBeVisible()
  // Away to the report: the map goes, the report is whole.
  await app.locator('[data-view="report"]').click()
  await expect(app.locator('#mapview svg')).toBeHidden()
  await expect(app.locator('.rp-band')).toBeVisible()
  // And back: the map draws again.
  await app.locator('[data-view="map"]').click()
  await expect(app.locator('#mapview svg')).toBeVisible()
})

test('a read-only look at the map writes nothing to the document', async ({ page }) => {
  const app = await openReport(page)
  const saved = page.getByText(/saved .* ago|saved just now/).first()
  const before = await saved.innerText()
  await app.locator('[data-view="map"]').click()
  await app.locator('#mapview [data-map]').first().click()
  await page.waitForTimeout(3_000)
  // Round 1: looking at the map turned "saved 19m ago" into "saved just now".
  await expect(saved).toHaveText(before)
})

test('ask the research: the answer appears in the report (paid)', async ({ page }) => {
  const app = await openReport(page)
  const box = app.locator('#rqin-_new')
  await box.fill('Which oat drink brands other than Oatly are named in this research, and in which market?')
  const t0 = Date.now()
  await app.locator('[data-act="rq-send"][data-k="_new"]').click()
  await expect(app.locator('.rq-a.busy').first()).toBeVisible({ timeout: 10_000 })
  await expect(app.locator('.rq-a:not(.busy)').filter({ hasText: /Oatly|brand/i }).first()).toBeVisible({ timeout: 120_000 })
  measure('ask-research', Date.now() - t0, 60_000)
})

test('ask about a fact: the answer shows where it was asked, about that fact (paid)', async ({ page }) => {
  const app = await openReport(page)
  await app.locator('[data-view="map"]').click()
  await app.locator('#mapview [data-map^="fi"], #mapview [data-map*="fi_"]').first().click()
  await app.locator('[data-act="pv-mapopen"]').click()
  // The first fact the finding rests on.
  await app.locator('#insp-sel [data-sel^="f_"]').first().click()
  const q = app.locator('#pv-askq')
  await expect(q).toBeVisible()
  await q.fill('What year is this from, and how sure are we of it?')
  const t0 = Date.now()
  await app.locator('[data-act="pv-ask"]').click()
  // Round 1: the answer went to a report section out of sight, and the ask did not carry the fact.
  await expect(app.locator('#insp .rq-a:not(.busy)').first(), 'answer shown in the inspector where it was asked').toBeVisible({ timeout: 120_000 })
  measure('ask-fact', Date.now() - t0, 60_000)
})

test('leave a Research run mid-way and come back: it carries on and finishes (paid)', async ({ page }) => {
  await signIn(page, ACCOUNT)
  await openTool(page, client, 'Research')
  await page.getByText('+ New research question').click()
  const app = await appFrame(page, Date.now(), 'open-new-research', '#cmp-prompt')
  await app.locator('#cmp-prompt').fill('Plant-based yoghurt in Ireland in 2025: market size and the top three brands.')
  await app.locator('[data-act="cmp-send"]').click()
  const href = page.url().includes('open=') ? page.url() : ''
  // Answer the first question if one comes, then leave while it works.
  const opt = app.locator('#qcard [data-act="q-opt"]:not(.escape):not([disabled])').first()
  await opt.click({ timeout: 90_000 }).catch(() => {})
  await expect(app.getByText(/Step [2-4] of 4/).first()).toBeVisible({ timeout: 120_000 })
  const url = href || page.url()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /^Clients/ })).toBeVisible()
  await page.waitForTimeout(45_000)
  // Back: it shows where the run is (or the report), never the empty ask.
  const t0 = Date.now()
  await page.goto(url)
  const back = page.frameLocator('iframe').first()
  await expect(back.locator('.rp-band').or(back.getByText(/Step [1-4] of 4/)).first()).toBeVisible({ timeout: 60_000 })
  await expect(back.locator('#cmp-prompt')).toBeHidden()
  measure('return-to-run', Date.now() - t0, BUDGET.docOpen)
  // And it finishes without anyone watching.
  while (!(await back.locator('.rp-band').isVisible())) {
    const o = back.locator('#qcard [data-act="q-opt"]:not(.escape):not([disabled])').first()
    if (await o.isVisible()) await o.click()
    if (Date.now() - t0 > BUDGET.research) break
    await page.waitForTimeout(3_000)
  }
  await expect(back.locator('.rp-band')).toBeVisible({ timeout: 1_000 })
})

test('leave a Brief mid-way and come back: it carries on and finishes (paid)', async ({ page }) => {
  await signIn(page, ACCOUNT)
  await openTool(page, client, 'Brief')
  await page.getByText('+ New brief').click()
  const app = await appFrame(page, Date.now(), 'open-new-brief', '#prompt')
  await app.locator('#prompt').fill('Client call, oat drinks, Ireland: spring campaign to win lapsed buyers back to the barista range. Urban coffee drinkers 25-40. Social and out-of-home, Dublin and Cork. Playful, no knocking dairy. March launch, judged on repeat purchase.')
  await app.locator('#genBtn').click()
  await expect(app.getByText(/Step [2-4] of 4/).first()).toBeVisible({ timeout: 120_000 })
  const url = page.url()
  await page.goto('/')
  await page.waitForTimeout(30_000)
  const t0 = Date.now()
  await page.goto(url)
  const back = page.frameLocator('iframe').first()
  await expect(back.locator('#sheet').or(back.getByText(/Step [1-4] of 4/)).first()).toBeVisible({ timeout: 60_000 })
  measure('return-to-brief', Date.now() - t0, BUDGET.docOpen)
  await expect(back.locator('#sheet')).toBeVisible({ timeout: BUDGET.research })
})
