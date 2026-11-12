// Shared steps for the UAT suite (features/uat-loop.clan). Only the mock rows of
// infra/scripts/accounts.uat.tsv: a real person's workspace is never touched.

import { appendFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

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
  const add = page.getByText(/Add your first client|New client/).first()
  await add.click()
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
  measure(label, Date.now() - t0, BUDGET.docOpen)
  return app
}
