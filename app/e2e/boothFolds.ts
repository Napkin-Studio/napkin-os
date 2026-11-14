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
  await expect.poll(async () => Math.round(await booth.evaluate(el => el.getBoundingClientRect().width)), { timeout: 10_000 }).toBe(744)
  const [d, b] = await Promise.all([app.locator(doc).first().evaluate(el => el.getBoundingClientRect().toJSON()), booth.evaluate(el => el.getBoundingClientRect().toJSON())])
  expect(d.right, 'the document ends before the Booth begins').toBeLessThanOrEqual(b.left)
  expect(b.right, 'the Booth stays on screen').toBeLessThanOrEqual(1440)
  expect(d.width, 'the document keeps room').toBeGreaterThan(360)
}
