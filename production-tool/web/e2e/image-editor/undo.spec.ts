// e2e 6 (features/image-editor-masks-layers.clan): ⌘Z in the Image editor takes back the last stroke and
// ⇧⌘Z puts it back; the document's undo is not touched.
import { expect, openEditor, overlay, session, stroke, test } from '../fixtures'

test('⌘Z takes back a stroke, ⇧⌘Z puts it back, and the document undo is untouched', async ({ page }) => {
  const seeded = await openEditor(page)
  // A document step of the person's, which a stray ⌘Z would undo.
  await page.evaluate(async (shotId) => {
    const path = '/src/doc/store.ts' // the dev server's module, the app's own updateDoc
    const m = await import(/* @vite-ignore */ path)
    await m.updateDoc(window.__pt.doc, (d: { shots: Record<string, { duration_s: number }> }) => { d.shots[shotId].duration_s = 4 }, 'e2e step')
  }, seeded.shotIds[1])
  const docUndo = () => page.evaluate(() => JSON.stringify(window.__pt.doc.undoLabels?.() ?? null))
  await expect.poll(docUndo).toContain('e2e step')
  const before = await docUndo()

  await page.keyboard.press('b')
  await stroke(page, [0.2, 0.3], [0.4, 0.3])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)
  const one = await overlay(page)
  await stroke(page, [0.2, 0.7], [0.4, 0.7])
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(one.painted)
  const two = await overlay(page)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await overlay(page)).painted).toBe(one.painted)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await overlay(page)).painted).toBe(two.painted)
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+y')
  await expect.poll(async () => (await overlay(page)).painted).toBe(two.painted)

  expect(await docUndo()).toBe(before)
  expect(await page.evaluate((id) => window.__pt.doc.get().shots[id].duration_s, seeded.shotIds[1])).toBe(4)
  const masks = (await session(page, seeded.frameId)).edits.filter((e: { kind: string }) => e.kind === 'mask')
  expect(masks[0].ops).toHaveLength(2)
})
