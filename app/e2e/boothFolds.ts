// The Booth's shared folds (features/align-booth.clan), as the e2e specs read them: inside the tool's frame, in the Booth.
import { expect, type FrameLocator, type Page } from '@playwright/test'

/** The open document's frame, and its Booth (the shared snippet marks its column data-booth-panel). */
export function boothIn(page: Page): { app: FrameLocator; booth: ReturnType<FrameLocator['locator']> } {
  const app = page.frameLocator('iframe').first()
  return { app, booth: app.locator('[data-booth-panel]') }
}

/** Two versions compared at 1440 px: the Booth widens to 744 px and sits beside the document, never over it. */
export async function wideBeside(app: FrameLocator, doc: string) {
  const booth = app.locator('[data-booth-panel]')
  // The column opens with the page's own push (a grid transition): measured once it has settled.
  await expect.poll(async () => booth.evaluate(el => { const r = el.getBoundingClientRect(); return Math.round(r.width) === 744 && r.right <= innerWidth + 0.5 }), { timeout: 10_000 }).toBe(true)
  const [d, b] = await Promise.all([app.locator(doc).first().evaluate(el => el.getBoundingClientRect().toJSON()), booth.evaluate(el => el.getBoundingClientRect().toJSON())])
  expect(d.right, 'the document ends before the Booth begins').toBeLessThanOrEqual(b.left)
  expect(b.right, 'the Booth stays on screen').toBeLessThanOrEqual(1440)
  expect(d.width, 'the document keeps room').toBeGreaterThan(360)
}

/**
 * A tool's page for a client, and the work item with this title on it, opened. The shell may correct a tool
 * route to the client's page while its tool list is still being read (LandingHome.tsx, correctRoute): the
 * address is asked again until the tool's own page is the one on screen, so the click lands on the tool page.
 */
export async function openWork(page: Page, client: string, tool: string, title: string) {
  const toolPage = page.locator(`[data-testid="tool-page"][data-tool="${tool}"]`)
  await page.goto(`/#tool-${client}-${tool}`); await page.reload()
  await expect(async () => {
    if (!(await toolPage.count())) await page.goto(`/#tool-${client}-${tool}`)
    await expect(toolPage.getByTestId('work-item').filter({ hasText: title }).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await toolPage.getByTestId('work-item').filter({ hasText: title }).first().click()
}
