// A canvas picture in the Image editor (features/edit-canvas-pictures.clan): Edit in the picture's bar
// and the double-click rule, with real pointer events on our own engine; Apply puts v2 in place with v1
// in its versions; the document's Undo takes the Apply back and the canvas shows v1 again.
import type { Page } from '@playwright/test'
import { expect, stroke, test } from '../fixtures'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __canvas?: any
  }
}

interface OnCanvas { id: string; node: string; sha: string; x: number; y: number; w: number; h: number }

async function openCanvas(page: Page) {
  await page.goto('/?engine=own&mockDelay=300')
  await page.waitForFunction(() => !!window.__seed, null, { timeout: 30_000 })
  await page.evaluate(() => window.__seed.canvas())
  await page.waitForFunction(() => !!window.__canvas)
}

/** Drops pictures (a file drop: the one synthetic event here) at a page point. */
async function dropPictures(page: Page, x: number, y: number, colours: string[]) {
  await page.evaluate(async ({ x, y, colours }) => {
    const dt = new DataTransfer()
    for (const [i, c] of colours.entries()) {
      const o = new OffscreenCanvas(400, 500)
      const g = o.getContext('2d')!
      g.fillStyle = c
      g.fillRect(0, 0, 400, 500)
      g.fillStyle = '#fff'
      g.fillRect(150, 200, 100, 100)
      dt.items.add(new File([await o.convertToBlob({ type: 'image/png' })], `p${i}.png`, { type: 'image/png' }))
    }
    const t = document.elementFromPoint(x, y)!
    t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
  }, { x, y, colours })
}

/** The pictures on the canvas, with their boxes in page pixels. */
function pictures(page: Page): Promise<OnCanvas[]> {
  return page.evaluate(() => {
    const c = window.__canvas
    const v = c.view()
    return c.elements().filter((e: { customData?: { kind?: string } }) => e.customData?.kind === 'pic').map((e: { id: string; x: number; y: number; width: number; height: number; customData: { id: string; asset: string } }) => {
      const a = c.sceneToViewport({ x: e.x, y: e.y }, v)
      const b = c.sceneToViewport({ x: e.x + e.width, y: e.y + e.height }, v)
      return { id: e.id, node: e.customData.id, sha: e.customData.asset, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
    })
  })
}

const centre = (p: OnCanvas): [number, number] => [p.x + p.w / 2, p.y + p.h / 2]
const selected = (page: Page) => page.evaluate(() => window.__canvas.view().selectedIds as string[])

async function oneDropped(page: Page, colours = ['#C8553D']): Promise<OnCanvas[]> {
  await openCanvas(page)
  await dropPictures(page, 720, 420, colours)
  await expect.poll(async () => (await pictures(page)).length, { timeout: 15_000 }).toBe(colours.length)
  return pictures(page)
}

test('Edit opens the picture; Apply puts v2 in place with v1 in its versions; Undo takes it back', async ({ page }) => {
  const [p] = await oneDropped(page)
  await page.mouse.click(...centre(p))
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.locator('.image-editor .ptbar')).toContainText('Picture')
  await page.locator('canvas.ie-pic:not([hidden])').waitFor()

  // A Fill on the mock, then Apply.
  await page.keyboard.press('b')
  await stroke(page, [0.3, 0.3], [0.6, 0.3], 12)
  await page.locator('#ie-fill').fill('add drops')
  await page.locator('.ie-action').getByRole('button', { name: 'Fill area' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fill area' }).click()
  await expect(page.locator('.ie-elist li', { hasText: 'Fill Mask 1: "' })).toContainText('ready', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Apply as new version' }).click()
  await expect(page.locator('.ie-vbtn')).toContainText('v2 of 2')

  // Back on the canvas: the same spot and width, the new picture, and its v2 chip with v1 in it.
  await page.getByRole('button', { name: 'Canvas' }).click()
  await expect(page.locator('.image-editor')).toHaveCount(0)
  await expect.poll(async () => (await pictures(page))[0].sha).not.toBe(p.sha)
  const [after] = await pictures(page)
  expect([after.x, after.y, after.w]).toEqual([p.x, p.y, p.w])
  const v2 = await page.evaluate((n) => Object.values(window.__pt.doc.get().frames as Record<string, { node?: string; version: number; asset: string; kind: string }>)
    .filter((f) => f.node === n).sort((a, b) => a.version - b.version).map((f) => [f.version, f.kind, f.asset]), p.node)
  expect(v2).toEqual([[1, 'original', p.sha], [2, 'edited', after.sha]])
  await page.locator('.vchip').click()
  await expect(page.locator('.ie-vrow').first()).toContainText('v1 · as it was on the canvas')
  await page.keyboard.press('Escape')

  // The document's Undo (the zoom pill's): v1 is back on the canvas and the chip goes.
  await page.getByRole('button', { name: /^Undo: apply edits to the picture as v2/ }).click()
  await expect.poll(async () => (await pictures(page))[0].sha).toBe(p.sha)
  await expect(page.locator('.vchip')).toHaveCount(0)
})

test('a double-click opens a picture on its own; in a group the first picks it out and the next opens it', async ({ page }) => {
  const [a, b] = await oneDropped(page, ['#C8553D', '#2A9D8F'])
  // On its own: one double-click opens it.
  await page.mouse.dblclick(...centre(a))
  await expect(page.locator('.image-editor')).toHaveCount(1)
  await page.getByRole('button', { name: 'Canvas' }).click()
  await expect(page.locator('.image-editor')).toHaveCount(0)

  // Group the two (shift-click, Ctrl+G); a click selects the group.
  await page.mouse.click(...centre(a))
  await page.keyboard.down('Shift')
  await page.mouse.click(...centre(b))
  await page.keyboard.up('Shift')
  await page.keyboard.press('Control+g')
  await page.mouse.click(30, 860)
  await page.mouse.click(...centre(b))
  expect((await selected(page)).sort()).toEqual([a.id, b.id].sort())

  // First double-click: that picture alone, no editor. Second: the editor.
  await page.mouse.dblclick(...centre(b))
  await expect.poll(() => selected(page)).toEqual([b.id])
  await expect(page.locator('.image-editor')).toHaveCount(0)
  await page.mouse.dblclick(...centre(b))
  await expect(page.locator('.image-editor')).toHaveCount(1)
})
