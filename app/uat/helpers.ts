// Shared steps for the UAT suite (features/uat-loop.clan). Only the mock rows of
// infra/scripts/accounts.uat.tsv: a real person's workspace is never touched.

import { appendFileSync } from 'node:fs'
import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test'

export const MOCKS = ['plu@pluto', 'bo@boysandgirls', 'tia@tbwa', 'sam@wk', 'oli@ogilvy', 'hal@harbour', 'dee@droga', 'ann@napkin', 'cat@catapult'] as const
export type Mock = (typeof MOCKS)[number]

/** Timing budgets, in ms. Over budget is a finding, not a flake: it fails the journey. */
export const BUDGET = {
  signIn: 5_000,
  desk: 5_000,
  /** From clicking a document to its app drawing something. */
  docOpen: 5_000,
  /** A whole Research run, questions answered at once. */
  research: 6 * 60_000,
}

/** One line per measured step, picked up by scripts/uat-round for the round report. */
export function measure(step: string, ms: number, budget?: number, extra: Record<string, unknown> = {}) {
  const row = { step, ms: Math.round(ms), budget, over: budget !== undefined && ms > budget, ...extra }
  console.log('uat-measure ' + JSON.stringify(row))
  if (process.env.UAT_MEASURES) appendFileSync(process.env.UAT_MEASURES, JSON.stringify(row) + '\n')
  return row
}

export const stamp = () => new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')

export async function signIn(page: Page, account: Mock) {
  if (!MOCKS.includes(account)) throw new Error(`not a UAT mock account: ${account}`)
  await page.goto('/')
  const t0 = Date.now()
  const box = page.getByPlaceholder('name@agency')
  await expect(box).toBeVisible({ timeout: 20_000 })
  await box.fill(account)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The beta notice is accepted for mock accounts (owner, 2026-11-12).
  const notice = page.getByRole('button', { name: 'I understand' })
  const desk = page.getByRole('heading', { name: /^Clients/ })
  await expect(desk.or(notice).first()).toBeVisible({ timeout: 30_000 })
  measure('sign-in', Date.now() - t0, BUDGET.signIn, { account })
  if (await notice.isVisible()) await notice.click()
  await expect(desk).toBeVisible()
  const r = await page.request.get('/api/session')
  expect(r.status()).toBe(200)
  const s = await r.json() as { tenant: string; user: { username: string } }
  expect(s.user.username).toBe(account)
  return s.tenant
}

/** A new client through the UI, named so a round's leftovers are easy to find and archive. */
export async function addClient(page: Page, name: string) {
  // The circle's own button (round 4: a text match hit another element and the form never opened).
  const add = page.getByRole('button', { name: /^(Add your first client|New client)\b/ }).first()
  await add.click()
  await expect(page.getByPlaceholder('e.g. Kerrygold'), 'the add-client form opens').toBeVisible({ timeout: 10_000 })
  await page.getByPlaceholder('e.g. Kerrygold').fill(name)
  await page.getByPlaceholder('e.g. Dairy · Export').fill('Dairy alternatives · FMCG')
  await page.getByRole('button', { name: 'Add client' }).click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
}

export const TOOLS = { Brief: 'Brief Maker', Research: 'Research Tool', Deck: 'Deck Maker', Production: 'Production Tool' } as const
export type Tool = keyof typeof TOOLS

/** The tool's button on a client's dial (opening the dial first). */
export async function dialButton(page: Page, client: string, tool: Tool) {
  await page.getByRole('button', { name: new RegExp(`^(Open )?${client}\\b`) }).first().click()
  return page.getByRole('button', { name: new RegExp(`^${TOOLS[tool]} for ${client}`) })
}

/** Open a tool from the client's dial. */
export async function openTool(page: Page, client: string, tool: Tool) {
  await (await dialButton(page, client, tool)).click()
}

/** The app frame, and how long it took to draw anything after `t0`. */
export async function appFrame(page: Page, t0: number, label: string, ready: string) {
  const app = page.frameLocator('iframe').first()
  await expect(app.locator(ready).first()).toBeVisible({ timeout: 60_000 })
  // Visible is not ready: a page still downloading shows its controls before its script wires them (round 5).
  await expect.poll(() => app.locator('html').evaluate(() => document.readyState), { timeout: 60_000 }).toBe('complete')
  measure(label, Date.now() - t0, BUDGET.docOpen)
  return app
}

/** What the suite types when an agent asks in words (round 2: "Which brand is this campaign for? Type its name."). */
export const TYPED: [RegExp, string][] = [
  [/brand/i, 'Oatly'],
  [/market|country|where/i, 'Ireland'],
  [/category/i, 'Plant-based drinks'],
  [/audience|who/i, 'Urban coffee drinkers aged 25-40'],
  [/name/i, 'UAT test'],
]

/**
 * Answer whatever the run asks (an offered option, else typed words) until `done` shows or the
 * budget runs out. Returns how many questions were answered. Fails at once on an error banner.
 */
export async function driveRun(page: Page, app: FrameLocator, done: Locator, budget: number, typed: [RegExp, string][] = TYPED) {
  const t0 = Date.now()
  let questions = 0
  const failed = app.locator('.rs-err, [role="alert"]')
  while (Date.now() - t0 < budget) {
    if (await done.first().isVisible()) return questions
    if (await failed.first().isVisible()) throw new Error('run shows an error: ' + await failed.first().innerText())
    const card = app.locator('#qcard')
    if (await card.isVisible()) {
      const opt = card.locator('[data-act="q-opt"]:not(.escape):not([disabled])').first()
      const box = card.locator('input[type="text"], textarea').first()
      if (await opt.isVisible()) { await opt.click(); questions++; continue }
      if (await box.isVisible() && await box.isEnabled()) {
        const q = await card.locator('.qtext, .aq-q').first().innerText().catch(() => '')
        await box.fill(typed.find(([re]) => re.test(q))?.[1] ?? typed[0][1])
        await card.getByRole('button', { name: /^Send$/ }).click()
        questions++
        await page.waitForTimeout(1_000)
        continue
      }
    }
    await page.waitForTimeout(2_000)
  }
  return questions
}
