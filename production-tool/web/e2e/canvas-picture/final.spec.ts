// The Final marker, its version strip and the rights asked on Final (features/pt-final-and-fit.clan): a picture marked Final
// on v1 and then edited to v2 shows v1 as the Final one, not v2; un-marking it takes the final out of the project.
// With SHOTS=<dir> the spec also saves screenshots at 1280 and 1440 (the build half of the mock-vs-build pairs).
import type { Page } from '@playwright/test'
import { expect, stroke, test } from '../fixtures'

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __canvas?: any
  }
}

async function drop(page: Page, x: number, y: number) {
  await page.evaluate(async ({ x, y }) => {
    const dt = new DataTransfer()
    const o = new OffscreenCanvas(400, 500)
    const g = o.getContext('2d')!
    const sky = g.createLinearGradient(0, 0, 400, 500)
    sky.addColorStop(0, '#d9c8a8'); sky.addColorStop(1, '#b99f78')
    g.fillStyle = sky; g.fillRect(0, 0, 400, 500)
    g.fillStyle = '#1f7a58'; g.fillRect(150, 150, 100, 200)
    dt.items.add(new File([await o.convertToBlob({ type: 'image/png' })], 'can.png', { type: 'image/png' }))
    const t = document.elementFromPoint(x, y)!
    t.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
  }, { x, y })
}

const pics = (page: Page) => page.evaluate(() => window.__canvas.elements().filter((e: { customData?: { kind?: string } }) => e.customData?.kind === 'pic')
  .map((e: { x: number; y: number; width: number; height: number; customData: { asset: string } }) => {
    const v = window.__canvas.view()
    const a = window.__canvas.sceneToViewport({ x: e.x, y: e.y }, v)
    const b = window.__canvas.sceneToViewport({ x: e.x + e.width, y: e.y + e.height }, v)
    return { sha: e.customData.asset, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
  }))

const finals = (page: Page) => page.evaluate(() => Object.values(window.__pt.doc.get().finals ?? {}).map((f) => (f as { asset: string }).asset))

async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS
  if (!dir) return
  for (const [w, h] of [[1280, 800], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${dir}/${name}-${w}.png` })
  }
}

test('Final on v1, then edited to v2: the strip says v1 is the Final; un-marking removes it from the project', async ({ page }) => {
  await page.goto('/?engine=own&mockDelay=300')
  await page.waitForFunction(() => !!window.__seed, null, { timeout: 30_000 })
  await page.evaluate(() => window.__seed.canvas())
  await page.waitForFunction(() => !!window.__canvas)
  await drop(page, 720, 420)
  await expect.poll(async () => (await pics(page)).length, { timeout: 15_000 }).toBe(1)
  const [p] = await pics(page)
  await page.mouse.click(p.x + p.w / 2, p.y + p.h / 2)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('canvas.ie-pic:not([hidden])').waitFor()

  // Marking Final asks for rights: an upload starts on "Don't know yet".
  await page.locator('.final-toggle').click()
  await expect(page.locator('.final-rights [role="radio"][aria-checked="true"] b')).toHaveText("Don't know yet")
  await shot(page, 'rights-menu-upload')
  await page.locator('.final-rights [role="radio"]', { hasText: 'Licensed' }).click()
  await page.locator('.final-rights').getByRole('button', { name: 'Mark Final' }).click()
  await expect.poll(() => finals(page)).toEqual([p.sha])
  expect(await page.evaluate((s) => window.__pt.doc.get().assets[s].rights, p.sha)).toBe('licensed')

  // An edit applied as v2: v2 is not Final.
  await page.keyboard.press('b')
  await stroke(page, [0.3, 0.3], [0.6, 0.3], 12)
  await page.locator('#ie-fill').fill('add drops')
  await page.locator('.ie-action').getByRole('button', { name: 'Fill', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fill', exact: true }).click()
  await expect(page.locator('.ie-elist li', { hasText: 'Fill Mask 1: "' })).toContainText('ready', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Apply as new version' }).click()
  await expect(page.locator('.ie-vbtn')).toContainText('v2 of 2')
  await page.locator('.image-editor .tba-crumb').getByRole('button', { name: 'Canvas' }).click()
  await expect(page.locator('.image-editor')).toHaveCount(0)

  const strip = page.locator('.vstrip')
  await expect(strip.locator('.ver')).toHaveCount(2)
  await expect(strip.locator('.ver.fin')).toHaveText('v1 Final')
  await expect(strip.locator('.ver.sel')).toHaveText('v2')
  await expect(page.locator('.final-badge')).toHaveCount(0) // the picture shown (v2) is not the Final
  await shot(page, 'canvas-v2-open-v1-final')

  // Open v1 from the strip: the pill is on the picture.
  await strip.locator('.ver', { hasText: 'v1' }).click()
  await expect(page.locator('.final-badge')).toHaveCount(1)
  await expect(page.locator('.rights-chip')).toHaveText('Licensed')
  await shot(page, 'canvas-v1-final')

  // Un-mark in the editor on v1: the project's finals are empty, the pill and the strip tick go.
  const [q] = await pics(page)
  await page.mouse.dblclick(q.x + q.w / 2, q.y + q.h / 2)
  await page.locator('canvas.ie-pic:not([hidden])').waitFor()
  await expect(page.locator('.final-toggle')).toHaveText('Final ✓')
  await shot(page, 'editor-final-on')
  await page.locator('.final-toggle').click()
  await expect.poll(() => finals(page)).toEqual([])
  await page.locator('.image-editor .tba-crumb').getByRole('button', { name: 'Canvas' }).click()
  await expect(page.locator('.final-badge')).toHaveCount(0)
  await expect(page.locator('.vstrip .ver.fin')).toHaveCount(0)
})
