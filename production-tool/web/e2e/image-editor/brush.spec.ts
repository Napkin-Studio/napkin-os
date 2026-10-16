// e2e 1 (features/image-editor-masks-layers.clan): Brush paints visibly with real pointer events, and
// ] grows the brush.
import { editRows, expect, openEditor, overlay, stroke, test } from '../fixtures'

test('B paints a blue mask with a rim, and ] makes the brush wider', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.45, 0.35], 20)
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const one = await overlay(page)
  expect(one.rim).toBeGreaterThan(0)
  expect(await editRows(page)).toContainEqual(expect.stringContaining('Mask 1 · painting'))
  const h1 = one.box!.y1 - one.box!.y0

  for (let i = 0; i < 3; i++) await page.keyboard.press(']')
  await stroke(page, [0.2, 0.7], [0.45, 0.7], 20)
  await expect.poll(async () => (await overlay(page)).box!.y1).toBeGreaterThan(0.7)
  const two = await overlay(page)
  // The second stroke is horizontal: its height is the brush's width, larger than the first's.
  expect(two.box!.y1 - 0.7).toBeGreaterThan(h1 / 2 - (0.35 - 0.3) / 2)
})
