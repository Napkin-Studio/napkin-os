// e2e 5 (features/image-editor-masks-layers.clan): the stroke belongs to its pointer. pointercancel
// drops it, hover moves add nothing, a second pointer during a stroke adds nothing, a brush can start on
// the margin when zoomed out, and a Text press on the margin adds nothing.
import type { Page } from '@playwright/test'
import { at, expect, openEditor, overlay, session, stroke, test, editRows } from '../fixtures'

test.use({ hasTouch: true })

/** A touch through the browser's input pipeline (CDP): its pointer events are real ones. */
async function touch(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', pts: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 7 })) })
  return { send }
}

test('pointercancel drops the stroke and hover moves add nothing', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touches go through CDP, which only Chromium has')
  const seeded = await openEditor(page)
  await page.keyboard.press('b')
  const t = await touch(page)
  const [x, y] = await at(page, 0.3, 0.3)
  await t.send('touchStart', [[x, y]])
  for (let i = 1; i <= 5; i++) await t.send('touchMove', [[x + i * 15, y + i * 5]])
  await t.send('touchCancel', [])
  // Ten hovers with the mouse, no button.
  const [hx, hy] = await at(page, 0.6, 0.6)
  for (let i = 0; i < 10; i++) await page.mouse.move(hx + i * 10, hy)
  await page.waitForTimeout(200)
  expect((await overlay(page)).painted).toBe(0)
  expect((await overlay(page, 'canvas.ie-live')).painted).toBe(0)
  expect((await session(page, seeded.frameId)).edits).toHaveLength(0)
})

test('a second pointer during a stroke adds nothing', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touches go through CDP, which only Chromium has')
  const seeded = await openEditor(page)
  await page.keyboard.press('b')
  const [x, y] = await at(page, 0.2, 0.25)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(x + i * 10, y)
  // A finger lands on the bottom right and moves while the mouse stroke goes on.
  const t = await touch(page)
  const [tx, ty] = await at(page, 0.8, 0.8)
  await t.send('touchStart', [[tx, ty]])
  for (let i = 1; i <= 5; i++) await t.send('touchMove', [[tx - i * 10, ty]])
  await t.send('touchEnd', [])
  for (let i = 6; i <= 10; i++) await page.mouse.move(x + i * 10, y)
  await page.mouse.up()
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const o = await overlay(page)
  expect(o.box!.y1).toBeLessThan(0.5)
  const masks = (await session(page, seeded.frameId)).edits.filter((e: { kind: string }) => e.kind === 'mask')
  expect(masks).toHaveLength(1)
  expect(masks[0].ops).toHaveLength(1)
})

test('zoomed out, a brush starts on the margin, and a Text press there adds nothing', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(page.locator('.ie-zoom')).toContainText('50%')
  const v = (await page.locator('.ie-viewport').boundingBox())!
  const f = (await page.locator('.ie-frame').boundingBox())!
  expect(f.x).toBeGreaterThan(v.x + 20)

  await page.keyboard.press('t')
  await page.mouse.click(v.x + 8, v.y + v.height / 2)
  await page.waitForTimeout(300)
  await expect(page.locator('.ie-text')).toHaveCount(0)
  await expect(page.locator('.ie-error')).toHaveCount(0)

  await page.keyboard.press('b')
  await stroke(page, [-0.1, 0.5], [0.3, 0.5], 16)
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  expect((await overlay(page)).box!.x0).toBeLessThan(0.02)
  expect(await editRows(page)).toContainEqual(expect.stringContaining('Mask 1'))
})
