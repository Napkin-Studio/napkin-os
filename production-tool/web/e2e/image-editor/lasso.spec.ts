// e2e 2 (features/image-editor-masks-layers.clan): Lasso at 200% zoom, panned with the Hand, lands
// exactly where it was drawn, and Subtract takes part of it away.
import { at, expect, lasso, openEditor, overlay, test } from '../fixtures'

test('a lasso drawn zoomed in and panned lands where it was drawn, and Subtract shrinks it', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.locator('.ie-zoom')).toContainText('200%')
  // Pan with the Hand: 120 px to the right.
  await page.keyboard.press('h')
  const [cx, cy] = await at(page, 0.5, 0.5)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 20, cy)
  await page.mouse.up()

  await page.keyboard.press('l')
  await lasso(page, [[0.35, 0.4], [0.5, 0.4], [0.5, 0.55], [0.35, 0.55]])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const o = await overlay(page)
  const px = 2 / o.w, py = 2 / o.h
  expect(Math.abs(o.box!.x0 - 0.35)).toBeLessThanOrEqual(px)
  expect(Math.abs(o.box!.x1 - 0.5)).toBeLessThanOrEqual(px)
  expect(Math.abs(o.box!.y0 - 0.4)).toBeLessThanOrEqual(py)
  expect(Math.abs(o.box!.y1 - 0.55)).toBeLessThanOrEqual(py)

  await page.getByRole('group', { name: 'Brush mode' }).getByRole('button', { name: 'Subtract' }).click()
  await lasso(page, [[0.43, 0.35], [0.6, 0.35], [0.6, 0.6], [0.43, 0.6]])
  await expect.poll(async () => (await overlay(page)).box!.x1).toBeLessThan(0.44 + px)
  const after = await overlay(page)
  expect(after.painted).toBeLessThan(o.painted)
})
