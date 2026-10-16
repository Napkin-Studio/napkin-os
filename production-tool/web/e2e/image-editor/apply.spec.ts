// Apply keeps the edits (fix/editor-apply-keeps-edits; features/image-editor-masks-layers.clan). The
// owner, 2026-10-16: "I edit it, it gives me a new picture. I save it, the new pic disappears. I click on
// show before, the new pic never comes back." The mock paints a fill's area with bold stripes and a
// removal's in cyan, so a lost result is plain in the pixels: v2 must carry it, Before must show v1 and
// After v2, press after press, and clearing the mask once the result came must not lose it.
import type { Page } from '@playwright/test'
import { expect, openEditor, picPixel, session, stroke, test } from '../fixtures'

const near = (a: number[], b: number[], tol = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol)
/** The mock's stripes: magenta and yellow for a fill, cyan and navy for a removal (src/relay/mockRender.ts). */
const STRIPES = { fill: [[230, 0, 160], [255, 230, 0]], remove: [[0, 200, 220], [10, 40, 60]] }
const striped = (px: number[], kind: 'fill' | 'remove') => STRIPES[kind].some((c) => near(px, c))

/** The pixel at (fx, fy) of the picture v(n) as saved, read from its blob. */
async function savedPixel(page: Page, shotId: string, fx: number, fy: number) {
  return page.evaluate(async ([id, x, y]) => {
    const d = window.__pt.doc.get()
    const f = d.frames[d.shots[id].pick.current]
    const path = '/src/lib/blobs.ts'
    const { getBlob } = await import(/* @vite-ignore */ path)
    const b = await createImageBitmap(await getBlob(f.asset))
    const c = new OffscreenCanvas(b.width, b.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(b, 0, 0)
    return { version: f.version as number, edits: (f.edits ?? []).map((e: { op: string }) => e.op) as string[], px: [...ctx.getImageData(Math.floor(x * (b.width - 1)), Math.floor(y * (b.height - 1)), 1, 1).data] }
  }, [shotId, fx, fy] as const)
}

/** The picture the stage shows at (fx, fy): the Before <img> while Before is pressed, else the composed canvas. */
async function shownPixel(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(async ([x, y]) => {
    const img = document.querySelector<HTMLImageElement>('img.ie-pic')
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.ie-pic:not([hidden])')
    const src: CanvasImageSource | null = img && !canvas ? img : canvas
    if (!src) return [-1, -1, -1, -1]
    if (src instanceof HTMLImageElement) await src.decode().catch(() => undefined)
    const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width
    const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d')!
    ctx.drawImage(src, 0, 0)
    return [...ctx.getImageData(Math.floor(x * (w - 1)), Math.floor(y * (h - 1)), 1, 1).data]
  }, [fx, fy] as const)
}

async function runOnMask(page: Page, kind: 'fill' | 'remove') {
  await page.keyboard.press('b')
  await stroke(page, [0.6, 0.45], [0.8, 0.45], 16)
  if (kind === 'fill') {
    await page.locator('#ie-fill').fill('a red balloon')
    await page.locator('.ie-action').getByRole('button', { name: 'Fill', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Fill', exact: true }).click()
  } else {
    await page.getByRole('button', { name: 'Remove what the mask covers' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  }
  await expect(page.locator('.ie-elist li', { hasText: kind === 'fill' ? 'Fill Mask 1' : 'Remove Mask 1' })).toContainText('ready', { timeout: 20_000 })
  // The stage shows the result.
  await expect.poll(async () => striped(await picPixel(page, 0.7, 0.45), kind)).toBe(true)
}

for (const kind of ['fill', 'remove'] as const) {
  test(`${kind}, clear the mask, Apply: v2 has the result, Before shows v1 and After v2, five times over`, async ({ page }, info) => {
    const shotAs = (n: string) => page.screenshot({ path: `test-results/editor-apply-${info.project.name}-${kind}-${n}.png` })
    const seeded = await openEditor(page, { mockDelay: 300 })
    const v1 = await picPixel(page, 0.7, 0.45)
    expect(striped(v1, kind)).toBe(false)
    await runOnMask(page, kind)
    await shotAs('1-result')

    // The owner's step: the blue taken away once the result came (Clear mask), then Apply.
    await page.getByRole('button', { name: 'Clear mask' }).click()
    await expect.poll(async () => striped(await picPixel(page, 0.7, 0.45), kind)).toBe(true)
    await page.getByRole('button', { name: 'Apply as new version' }).click()
    await expect(page.getByRole('button', { name: /v2 of 2/ })).toBeVisible()
    await expect(page.locator('[role="alert"]')).toHaveCount(0)

    const saved = await savedPixel(page, seeded.shotId, 0.7, 0.45)
    expect(saved.version).toBe(2)
    expect(saved.edits).toContain(kind)
    expect(striped(saved.px, kind), `v2 at the mask: ${saved.px}`).toBe(true)
    expect((await session(page, (await page.evaluate((id) => window.__pt.doc.get().shots[id].pick.current, seeded.shotId)))).edits).toEqual([])
    await expect.poll(async () => striped(await shownPixel(page, 0.7, 0.45), kind)).toBe(true)
    await shotAs('2-v2')

    const before = page.getByRole('button', { name: 'Before', exact: true })
    const after = page.getByRole('button', { name: 'After', exact: true })
    for (let i = 0; i < 5; i++) {
      await before.click()
      await expect(before).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.ie-before')).toHaveText('Before · v1 as saved')
      await expect.poll(async () => near(await shownPixel(page, 0.7, 0.45), v1), `Before ${i + 1} shows v1`).toBe(true)
      if (i === 0) await shotAs('3-before')
      await after.click()
      await expect(after).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.ie-before')).toHaveCount(0)
      await expect.poll(async () => striped(await shownPixel(page, 0.7, 0.45), kind), `After ${i + 1} shows v2`).toBe(true)
    }
    await shotAs('4-after')
  })
}

test('Apply refuses a painted mask with nothing filled, and says so', async ({ page }) => {
  const seeded = await openEditor(page)
  await page.keyboard.press('b')
  await stroke(page, [0.6, 0.45], [0.8, 0.45], 12)
  await page.getByRole('button', { name: 'Apply as new version' }).click()
  await expect(page.locator('[role="alert"]')).toContainText('Mask 1 is painted but not filled or removed')
  expect((await savedPixel(page, seeded.shotId, 0.5, 0.5)).version).toBe(1)
})

test('there is no Remove background', async ({ page }) => {
  await openEditor(page)
  await expect(page.locator('[aria-label="Actions"]')).not.toContainText(/background/i)
})
