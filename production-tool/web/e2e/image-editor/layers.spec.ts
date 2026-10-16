// e2e 7 and 8 (features/image-editor-masks-layers.clan, owner answers IM1-IM3): every eye does what it
// says on the picture; hiding Frame hides only the original picture, so a Fill result stays; hidden
// layers are left out of Apply, which says so, and stay in the editor.
import type { Page } from '@playwright/test'
import { at, expect, openEditor, overlay, picPixel, session, stroke, test } from '../fixtures'

const near = (a: number[], b: number[], tol = 6) => a.slice(0, 4).every((v, i) => Math.abs(v - b[i]) <= tol)

async function fillTopRight(page: Page) {
  await page.keyboard.press('b')
  await stroke(page, [0.62, 0.2], [0.78, 0.2], 12)
  await page.locator('#ie-fill').fill('add drops')
  await page.locator('.ie-action').getByRole('button', { name: 'Fill', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fill', exact: true }).click()
  await expect(page.locator('.ie-elist li', { hasText: 'Fill Mask 1: "' })).toContainText('ready', { timeout: 20_000 })
}

test('each eye shows and hides its layer, Frame stays unless clicked, and hiding Frame keeps the Fill', async ({ page }) => {
  const seeded = await openEditor(page, { mockDelay: 400 })
  const frameOnly = await picPixel(page, 0.7, 0.2)
  await fillTopRight(page)
  await expect.poll(async () => near(await picPixel(page, 0.7, 0.2), frameOnly)).toBe(false)
  const filled = await picPixel(page, 0.7, 0.2)

  // Fill's eye.
  await page.getByRole('button', { name: 'Hide Fill' }).click()
  await expect.poll(async () => near(await picPixel(page, 0.7, 0.2), frameOnly)).toBe(true)
  await page.getByRole('button', { name: 'Show Fill' }).click()
  await expect.poll(async () => near(await picPixel(page, 0.7, 0.2), filled)).toBe(true)

  // Mask's eye.
  expect((await overlay(page)).painted).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Hide Mask 1' }).click()
  await expect.poll(async () => (await overlay(page)).painted).toBe(0)
  await page.getByRole('button', { name: 'Show Mask 1' }).click()
  await expect.poll(async () => (await overlay(page)).painted).toBeGreaterThan(0)

  // Text's eye.
  await page.keyboard.press('t')
  const [tx, ty] = await at(page, 0.3, 0.6)
  await page.mouse.click(tx, ty)
  await expect(page.locator('.ie-text')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Hide Text' }).click()
  await expect(page.locator('.ie-text')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show Text' }).click()
  await expect(page.locator('.ie-text')).toHaveCount(1)

  // Frame's eye: with Frame hidden, only the Fill is left.
  expect((await session(page, seeded.frameId)).hidden).not.toContain('frame')
  await page.getByRole('button', { name: 'Hide Frame' }).click()
  await expect.poll(async () => (await picPixel(page, 0.7, 0.2))[3]).toBe(255) // the Fill result, not transparency
  await expect.poll(async () => (await picPixel(page, 0.2, 0.8))[3]).toBe(0) // outside the mask: nothing
  await page.getByRole('button', { name: 'Show Frame' }).click()
  await expect.poll(async () => near(await picPixel(page, 0.7, 0.2), filled, 10)).toBe(true)
})

test('Apply leaves hidden layers out, says so, and keeps them for the new version', async ({ page }) => {
  const seeded = await openEditor(page)
  // One text shown and one hidden: Apply saves the shown one (a painted mask alone would change nothing,
  // and Apply refuses that rather than save a copy of v1: fix/editor-apply-keeps-edits).
  await page.keyboard.press('t')
  const [sx, sy] = await at(page, 0.3, 0.2)
  await page.mouse.click(sx, sy)
  await page.keyboard.press('Escape')
  const [tx, ty] = await at(page, 0.3, 0.6)
  await page.mouse.click(tx, ty)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Hide Text' }).first().click() // the newest text is first (front)
  await expect(page.locator('.ie-pill .ie-n-long')).toHaveText('1 edit not applied · 1 hidden layer is left out')
  await page.getByRole('button', { name: 'Version 1 of 1' }).click()
  await expect(page.locator('.ie-vfoot')).toContainText('Apply saves your 1 edit as v2. v1 stays. 1 hidden layer is left out.')
  await page.keyboard.press('Escape')

  const v1 = await picPixel(page, 0.32, 0.62)
  await page.getByRole('button', { name: 'Apply as new version' }).click()
  await expect(page.getByRole('button', { name: 'Version 2 of 2' })).toBeVisible()
  // v2 as saved: no text where the hidden text was, and its edits leave the text out.
  const saved = await page.evaluate(async ([shotId, x, y]) => {
    const d = window.__pt.doc.get()
    const f = d.frames[d.shots[shotId].pick.current]
    const path = '/src/lib/blobs.ts'
    const { getBlob } = await import(/* @vite-ignore */ path)
    const b = await createImageBitmap(await getBlob(f.asset))
    const c = new OffscreenCanvas(b.width, b.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(b, 0, 0)
    return { id: f.id, version: f.version, edits: f.edits.map((e: { op: string }) => e.op), px: [...ctx.getImageData(Math.floor(x * (b.width - 1)), Math.floor(y * (b.height - 1)), 1, 1).data] }
  }, [seeded.shotId, 0.32, 0.62] as const)
  expect(saved.version).toBe(2)
  expect(saved.edits).toEqual(['text'])
  expect(near(saved.px, v1)).toBe(true)
  // The hidden text stays in the editor, still hidden, on v2 (IM3).
  const kept = await session(page, saved.id)
  expect(kept.edits.map((e: { kind: string }) => e.kind)).toEqual(['text'])
  expect(kept.hidden).toEqual([kept.edits[0].id])
  await expect(page.getByRole('button', { name: 'Show Text' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hide Text' })).toHaveCount(0)
  await expect(page.locator('.ie-pill .ie-n-long')).toHaveText('1 hidden layer is left out')
})

test('when the picture cannot be drawn, the last good one stays and Rhea says why', async ({ page }) => {
  const seeded = await openEditor(page)
  const before = await picPixel(page, 0.7, 0.2)
  // A Change whole frame whose result is not in this browser: a finished job with an output no browser has.
  await page.evaluate(async (id) => {
    const lost = `sha256:${'f'.repeat(64)}`
    const jobId = `job_01K7A${'0'.repeat(17)}ZZZZ`
    const store = window.__pt.doc
    const sb = Object.keys(store.get().storyboards)[0]
    const path = '/src/doc/store.ts'
    const { systemUpdate } = await import(/* @vite-ignore */ path)
    await systemUpdate(store, (x: { jobs: Record<string, unknown> }) => {
      x.jobs[jobId] = { id: jobId, v: 1, field_v: {}, op: 'region_edit', state: 'completed', node: { kind: 'storyboard', id: sb },
        started_by: 'human:p_maya01', tenant_id: '5b6f3c1e-9d2a-5c4b-8e7f-0a1b2c3d4e5f', nonce: `n_01K7A${'0'.repeat(17)}ZZZZ`, crew: 'rhea',
        parent_ids: [], input_hashes: [], outputs: [lost], created_at: '2026-10-16T10:00:00Z' }
    }, 'a lost result')
    window.__pt.ui.update((u: { imageEdits?: Record<string, unknown> }) => {
      u.imageEdits = { ...(u.imageEdits ?? {}), [id]: { edits: [{ id: 'cx', kind: 'whole', words: 'warmer', jobId }], hidden: [] } }
    })
  }, seeded.frameId)
  await expect(page.locator('.ie-said')).toContainText('the picture could not be drawn: That picture is not in this browser yet.')
  await expect(page.locator('canvas.ie-pic')).toBeVisible()
  expect(near(await picPixel(page, 0.7, 0.2), before)).toBe(true)
})
