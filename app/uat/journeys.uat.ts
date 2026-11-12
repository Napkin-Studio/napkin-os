// The UAT journeys (features/uat-loop.clan). Run by scripts/uat-round against a deployed stack.
// Each journey asserts what a person must see and how long they wait; over a budget fails it.

import { expect, test } from '@playwright/test'
import { addClient, appFrame, BUDGET, dialButton, driveRun, measure, openTool, signIn, stamp } from './helpers'

const ACCOUNT = 'plu@pluto' as const
const client = `UAT ${stamp()}`
/** The finished Research document, for the journeys that read it after the run. */
let researchUrl = process.env.UAT_RESEARCH_URL || ''

// In order on one worker (uat.config.ts), but not 'serial': one failure must not skip the rest.

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

  await app.locator('#cmp-prompt').fill('Oatly in Ireland and the UK: how big is the oat drink category in 2024-2025, who are the main brands, and what share does Oatly hold?')
  const run0 = Date.now()
  await app.locator('[data-act="cmp-send"]').click()

  // Answer whatever the run asks until the report is drawn.
  const report = app.locator('.rp-band')
  const questions = await driveRun(page, app, report, BUDGET.research)
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
  measure('research-doc', 0, undefined, { url: href.replace(/^https?:\/\/[^/]+/, '') })
  await page.goto('/')
  const t1 = Date.now()
  await page.goto(href)
  await appFrame(page, t1, 'reopen-research', '.rp-band')
})

/** Select the first finding on the map and open it. The map remembers its selection, so a
 *  click on an already-selected finding deselects it: click again when Open did not appear. */
async function openFindingFromMap(app: import('@playwright/test').FrameLocator) {
  await app.locator('[data-view="map"]').click()
  const node = app.locator('#mapview [data-node*="fi_"]').first()
  const open = app.locator('[data-act="pv-mapopen"]').first()
  await node.click()
  const shown = await open.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)
  if (!shown) await node.click()
  await open.click()
  await expect(app.locator('.pv-crumb .cur').first()).toContainText(/Finding/)
}

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
  await expect(app.locator('#mapview .pv-canvas')).toBeVisible()
  measure('open-map', Date.now() - t0, 3_000)
  // A finding on the map opens in the inspector with what it rests on.
  await openFindingFromMap(app)
  await expect(app.locator('button.pv-row[data-pv^="f_"]').first()).toBeVisible()
  // Away to the report: the map goes, the report is whole (owner's round-3 question).
  await app.locator('[data-view="report"]').click()
  await expect(app.locator('#mapview .pv-canvas')).toBeHidden()
  await expect(app.locator('.rp-band')).toBeVisible()
  // And back: the map draws again, with the finding it had open (each tab remembers, PR #177).
  await app.locator('[data-view="map"]').click()
  await expect(app.locator('.pv-crumb .cur').first(), 'the map tab comes back to its open finding').toContainText(/Finding/)
  // A finding opened on the Report tab is still open after a visit to the map.
  await app.locator('.pv-crumb [data-pv-pop="0"]').first().click()
  await app.locator('[data-view="report"]').click()
  await app.locator('#mapview .pv-canvas').waitFor({ state: 'hidden' })
  const call = app.locator('#pv [data-pv^="fi_"]').first()
  if (await call.isVisible().catch(() => false)) {
    await call.click()
    await expect(app.locator('.pv-crumb .cur').first()).toContainText(/Finding/)
    await app.locator('[data-view="map"]').click()
    await app.locator('[data-view="report"]').click()
    await expect(app.locator('.pv-crumb .cur').first(), 'the report tab comes back to its open finding').toContainText(/Finding/)
  }
})

test('a read-only look at the map writes nothing to the document', async ({ page }) => {
  const app = await openReport(page)
  const saved = page.getByText(/saved .* ago|saved just now/).first()
  const before = await saved.innerText()
  await app.locator('[data-view="map"]').click()
  await app.locator('#mapview [data-node]').first().click()
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
  await openFindingFromMap(app)
  // The first fact the finding rests on.
  await app.locator('button.pv-row[data-pv^="f_"]').first().click()
  const q = app.locator('#pv-askq')
  await expect(q).toBeVisible()
  await q.fill('What year is this from, and how sure are we of it?')
  const t0 = Date.now()
  await app.locator('[data-act="pv-ask"]').click()
  // Round 1: the answer went to a report section out of sight, and the ask did not carry the fact.
  const card = app.locator('.pv-answers .rq-a.pv-fa:not(.busy)').first()
  await expect(card, 'answer shown under the fact where it was asked').toBeVisible({ timeout: 120_000 })
  measure('ask-fact', Date.now() - t0, 60_000)
  // The approved mock (research-fact-answer-v1): not in the report until added; Add, then Take out.
  await card.locator('[data-act="pvq-add"]').click()
  await expect(card.locator('[data-act="pvq-out"]')).toBeVisible({ timeout: 15_000 })
  await card.locator('[data-act="pvq-out"]').click()
  await expect(card.locator('[data-act="pvq-add"]')).toBeVisible({ timeout: 15_000 })
})

test('leave a Research run mid-way and come back: it carries on and finishes (paid)', async ({ page }) => {
  await signIn(page, ACCOUNT)
  await openTool(page, client, 'Research')
  await page.getByText('+ New research question').click()
  const app = await appFrame(page, Date.now(), 'open-new-research', '#cmp-prompt')
  await app.locator('#cmp-prompt').fill('Alpro plant-based yoghurt in Ireland in 2025: market size, and Alpro against the top two rival brands.')
  await app.locator('[data-act="cmp-send"]').click()
  const href = page.url().includes('open=') ? page.url() : ''
  // Answer what it asks until it is past step 1, then leave while it works.
  await driveRun(page, app, app.getByText(/Step [2-4] of 4/), 180_000)
  await expect(app.getByText(/Step [2-4] of 4/).first()).toBeVisible({ timeout: 1_000 })
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
  await driveRun(page, back, back.locator('.rp-band'), BUDGET.research)
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
  await driveRun(page, back, back.locator('#sheet'), BUDGET.research)
  await expect(back.locator('#sheet')).toBeVisible({ timeout: 1_000 })
})

test('ask about a fact, click away, come back: it kept going and the answer is there (paid)', async ({ page }) => {
  // Owner, 2026-11-12: clicking away must not stop the ask; the agent on top shows it working,
  // or the answer shows when the fact is opened again.
  const app = await openReport(page)
  await openFindingFromMap(app)
  const fact = app.locator('button.pv-row[data-pv^="f_"]').first()
  const ref = await fact.getAttribute('data-pv')
  await fact.click()
  await app.locator('#pv-askq').fill('Which source says this, and how recent is it?')
  await app.locator('[data-act="pv-ask"]').click()
  // Away at once: another fact, then the report.
  await app.locator('.pv-crumb [data-pv-pop="0"]').first().click()
  await app.locator('[data-view="report"]').click()
  await expect(app.locator('#sideAgent'), 'the agent on top shows the ask working').toContainText(/answering|asking|Research agent/i, { timeout: 10_000 })
  // Back to the same fact: the answer is there (or still coming, then lands).
  await openFindingFromMap(app)
  await app.locator(`button.pv-row[data-pv="${ref}"]`).first().click()
  await expect(app.locator('.pv-answers .rq-a.pv-fa:not(.busy)').first(), 'answer shown on returning to the fact').toBeVisible({ timeout: 120_000 })
})

test('tidy: the round archives its own client (it can be restored)', async ({ page }) => {
  // Round 4: nine rounds of 'UAT …' clients filled the desk past its first page. Archiving is
  // reversible (POST …/clients/{id}/restore); only this round's client is touched.
  const tenant = await signIn(page, ACCOUNT)
  const r = await page.request.get(`/api/t/${tenant}/clients`)
  expect(r.status()).toBe(200)
  const body = await r.json() as { clients?: { id: string; name: string }[] } | { id: string; name: string }[]
  const list = Array.isArray(body) ? body : body.clients ?? []
  const mine = list.filter(c => c.name === client)
  for (const c of mine) expect((await page.request.post(`/api/t/${tenant}/clients/${c.id}/archive`)).status()).toBe(200)
  measure('tidy', 0, undefined, { archived: mine.length })
})
