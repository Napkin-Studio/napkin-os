// e2e 3 and the hidden-mask part of e2e 7 (features/image-editor-masks-layers.clan): taking away with
// nothing to take changes nothing and says so; painting a hidden mask shows it; a mask's Layers row picks it.
import { editRows, expect, lasso, openEditor, overlay, session, stroke, test } from '../fixtures'

test('Subtract, the Eraser and a Subtract lasso with no mask make no edit and say why', async ({ page }) => {
  const seeded = await openEditor(page)
  const strip = page.getByRole('group', { name: 'Brush mask options' })
  await expect(strip.locator('b').first()).toHaveText('New mask')
  await strip.getByRole('button', { name: 'Subtract' }).click()
  await stroke(page, [0.2, 0.3], [0.4, 0.3])
  await expect(page.locator('.ie-hint')).toHaveText('Nothing to take away yet: paint an area first')
  await page.keyboard.press('e')
  await stroke(page, [0.2, 0.5], [0.4, 0.5])
  await page.keyboard.press('l')
  await lasso(page, [[0.5, 0.5], [0.7, 0.5], [0.7, 0.7]])
  await expect(page.locator('.ie-hint')).toBeVisible()
  expect((await session(page, seeded.frameId)).edits).toHaveLength(0)
  expect(await editRows(page)).toEqual(['No edits yet. Pick a tool on the left.'])
  expect((await overlay(page)).painted).toBe(0)
  await expect(page.locator('.ie-action').getByRole('button', { name: 'Fill area' })).toBeDisabled()
})

test('painting a hidden mask shows it, and a mask’s Layers row picks it', async ({ page }) => {
  const seeded = await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.4, 0.3])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Hide Mask 1' }).click()
  await expect.poll(async () => (await overlay(page)).painted).toBe(0)
  await stroke(page, [0.2, 0.6], [0.4, 0.6])
  await expect(page.getByRole('button', { name: 'Hide Mask 1' })).toBeVisible()
  await expect.poll(async () => (await overlay(page)).box?.y0 ?? 1).toBeLessThan(0.35)

  // A second mask, then its Layers row picks it.
  await page.evaluate((id) => window.__pt.ui.update((u: { imageEdits: Record<string, { edits: unknown[] }> }) => {
    const s = u.imageEdits[id]
    u.imageEdits = { [id]: { ...s, edits: [...s.edits, { id: 'm2', kind: 'mask', name: 'Mask 2', ops: [{ t: 'brush', mode: 'add', r: 0.03, soft: 0.2, pts: [{ x: 0.8, y: 0.8 }] }] }] } }
  }), seeded.frameId)
  await page.getByRole('button', { name: 'Paint Mask 2' }).click()
  await expect(page.getByRole('group', { name: 'Brush mask options' }).locator('b').first()).toHaveText('Mask 2')
  expect((await session(page, seeded.frameId)).active).toBe('m2')
})
