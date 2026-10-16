// The region tools after the owner's Firefox round (features/image-editor-masks-layers.clan, 2026-10-16):
// Brush and Lasso with real Add and Subtract (X swaps, Alt flips one stroke), a selection on the page
// that no longer cancels a stroke, Before that toggles on every press, Layers rows that pick, and
// Remove: the masked area taken out with no words, as one result layer like Fill.
import type { Page } from '@playwright/test'
import { at, editRows, expect, lasso, openEditor, overlay, session, stroke, test } from '../fixtures'

const strip = (page: Page) => page.getByRole('group', { name: 'Brush mask options' })

test('Subtract takes paint out with the brush and the lasso; X swaps the mode; Alt flips one stroke', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.1, 0.5], [0.9, 0.5], 24)
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const full = (await overlay(page)).painted

  // Subtract (the strip): a brush stroke across the middle takes paint out.
  await strip(page).getByRole('button', { name: 'Subtract' }).click()
  await expect(strip(page).getByRole('button', { name: 'Subtract' })).toHaveAttribute('aria-pressed', 'true')
  const [x, y] = await at(page, 0.3, 0.3)
  await page.mouse.move(x, y)
  await expect(page.locator('.ie-cursor')).toHaveAttribute('data-mode', 'sub') // the red dashed ring
  await stroke(page, [0.45, 0.3], [0.45, 0.7], 12)
  await expect.poll(async () => (await overlay(page)).painted).toBeLessThan(full)
  const afterBrush = (await overlay(page)).painted

  // A Subtract lasso over the right end takes that out too.
  await page.keyboard.press('l')
  await lasso(page, [[0.7, 0.35], [0.95, 0.35], [0.95, 0.65], [0.7, 0.65]])
  await expect.poll(async () => (await overlay(page)).painted).toBeLessThan(afterBrush)
  expect((await overlay(page)).box!.x1).toBeLessThan(0.72)

  // X swaps back to Add; Alt held makes one stroke subtract.
  await page.keyboard.press('x')
  await expect(strip(page).getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('b')
  const before = (await overlay(page)).painted
  await page.keyboard.down('Alt')
  await stroke(page, [0.2, 0.3], [0.2, 0.7], 12)
  await page.keyboard.up('Alt')
  await expect.poll(async () => (await overlay(page)).painted).toBeLessThan(before)
  await expect(strip(page).getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'true')
  const ops = await page.evaluate(() => (Object.values(window.__pt.ui.get().imageEdits)[0] as { edits: { ops: { t: string; mode: string }[] }[] }).edits[0].ops)
  expect(ops.map((o: { t: string; mode: string }) => `${o.t}:${o.mode}`)).toEqual(['brush:add', 'brush:sub', 'lasso:sub', 'brush:sub'])
})

test('a text selection on the page does not cancel a stroke', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => getSelection()!.selectAllChildren(document.body))
  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.5, 0.3])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  expect(await page.evaluate(() => getSelection()!.isCollapsed || getSelection()!.rangeCount === 0)).toBe(true)
})

test('Before toggles on every press, and a press on the stage in Before paints and shows After', async ({ page }) => {
  await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.5, 0.3])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const compare = page.getByRole('group', { name: 'Compare' })
  for (let i = 0; i < 5; i++) {
    await compare.getByRole('button', { name: 'Before' }).click()
    await expect(page.locator('.ie-before')).toBeVisible()
    await expect.poll(async () => (await overlay(page)).painted).toBe(0)
    await compare.getByRole('button', { name: 'Before' }).click() // the pressed half again: back to After
    await expect(page.locator('.ie-before')).toHaveCount(0)
    await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  }
  await compare.getByRole('button', { name: 'Before' }).click()
  await stroke(page, [0.2, 0.7], [0.5, 0.7])
  await expect(page.locator('.ie-before')).toHaveCount(0)
  await expect(compare.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await overlay(page)).box?.y1 ?? 0).toBeGreaterThan(0.68)
})

test('a Layers row picks its layer: a mask is painted next; Frame says why it cannot be, and a stroke starts a new mask', async ({ page }) => {
  const seeded = await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.4, 0.3])
  await page.getByRole('button', { name: 'Pick Frame' }).click()
  await expect(page.locator('.ie-layer.on')).toContainText('Locked: the version you opened. Brush or lasso makes a new mask over it.')
  await expect(strip(page).locator('b').first()).toHaveText('New mask')
  await stroke(page, [0.6, 0.7], [0.8, 0.7])
  await expect(page.locator('.ie-layer.on')).toContainText('Mask 2')
  await page.getByRole('button', { name: 'Paint Mask 1' }).click()
  await expect(page.locator('.ie-layer.on')).toContainText('Mask 1')
  await expect(page.locator('.ie-action.on .ie-mtag')).toHaveText('Mask 1')
  await page.keyboard.press('l')
  await lasso(page, [[0.1, 0.1], [0.3, 0.1], [0.3, 0.2]])
  const s = await session(page, seeded.frameId)
  expect(s.edits.map((e: { name: string; ops: unknown[] }) => `${e.name}:${e.ops.length}`)).toEqual(['Mask 1:2', 'Mask 2:1'])
})

test('Remove takes out what the mask covers with no words: one result layer, like Fill', async ({ page }) => {
  const seeded = await openEditor(page, { mockDelay: 300 })
  await page.evaluate(() => {
    const r = window.__pt.runner
    const submit = r.submit.bind(r)
    ;(window as unknown as { __sent: unknown[] }).__sent = []
    r.submit = (op: string, input: unknown, ...rest: unknown[]) => {
      ;(window as unknown as { __sent: unknown[] }).__sent.push({ op, input })
      return submit(op, input, ...rest)
    }
  })
  const remove = page.locator('.ie-action').getByRole('button', { name: 'Remove what the mask covers' })
  await expect(remove).toBeDisabled()
  await page.keyboard.press('b')
  await stroke(page, [0.3, 0.4], [0.5, 0.4], 12)
  await expect(remove).toBeEnabled()
  await expect(page.locator('.ie-action').getByRole('button', { name: 'Fill', exact: true })).toBeDisabled() // Fill needs words
  await remove.click()
  const tray = page.getByRole('dialog')
  await expect(tray).toContainText('What Rhea will send to remove what is in the area')
  await tray.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('.ie-elist li', { hasText: 'Remove Mask 1' })).toContainText('ready', { timeout: 20_000 })
  const sent = await page.evaluate(() => (window as unknown as { __sent: { op: string; input: Record<string, unknown> }[] }).__sent)
  expect(sent).toHaveLength(1)
  expect(sent[0].op).toBe('region_edit')
  expect(sent[0].input).toMatchObject({ remove: true })
  expect(sent[0].input.text).toBeUndefined()
  expect(Object.keys(sent[0].input)).toEqual(expect.arrayContaining(['image', 'mask', 'region']))
  await expect(page.locator('.ie-layer', { hasText: 'Remove' })).toHaveCount(1)
  const s = await session(page, seeded.frameId)
  expect(s.edits.find((e: { kind: string }) => e.kind === 'fill')).toMatchObject({ remove: true, keepOutside: true, words: '' })
  expect(await editRows(page)).toContainEqual(expect.stringContaining('Remove Mask 1'))
})
