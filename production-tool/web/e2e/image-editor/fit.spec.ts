// e2e 10 (features/image-editor-masks-layers.clan): a 9:16 frame fits the visible stage at Fit, and a
// stroke near its bottom paints without scrolling.
import { at, expect, openEditor, overlay, stroke, test } from '../fixtures'

test('a 9:16 frame fits at Fit and paints at 95% of its height', async ({ page }) => {
  await openEditor(page, { ratio: '9:16' })
  const v = (await page.locator('.ie-viewport').boundingBox())!
  const inner = await page.evaluate(() => window.innerHeight)
  expect(v.y + v.height).toBeLessThanOrEqual(inner)
  expect(v.height / v.width).toBeCloseTo(16 / 9, 1)
  const scroll = () => page.evaluate(() => document.querySelector('.ie-body')!.scrollTop)
  expect(await scroll()).toBe(0)
  await page.keyboard.press('b')
  const [, y] = await at(page, 0.5, 0.95)
  expect(y).toBeLessThan(inner)
  await stroke(page, [0.2, 0.95], [0.8, 0.95], 12)
  await expect.poll(async () => (await overlay(page)).box?.y1 ?? 0).toBeGreaterThan(0.9)
  expect(await scroll()).toBe(0)
})

test('a 16:9 frame still fills the column', async ({ page }) => {
  await openEditor(page)
  const v = (await page.locator('.ie-viewport').boundingBox())!
  const col = (await page.locator('.ie-center').boundingBox())!
  expect(Math.abs(v.width - col.width)).toBeLessThanOrEqual(1)
})
