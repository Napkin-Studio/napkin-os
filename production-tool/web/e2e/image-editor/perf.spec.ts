// e2e 9 (features/image-editor-masks-layers.clan): strokes stay fast. With a size-200 brush and 120-move
// strokes, the 15th stroke appears within 100 ms of pointerup (150 ms in CI; it was 1,209 ms), each
// move is handled in 4 ms or less at the median (it was about 16.7 ms), and hiding Frame, Before/After
// and idling with a mask make no long task.
import type { Page } from '@playwright/test'
import { at, expect, longTasksSince, openEditor, test } from '../fixtures'

const COMMIT_BUDGET = process.env.CI ? 150 : 100

test('the 15th long stroke appears within budget, moves stay cheap, and idle work makes no long task', async ({ page }) => {
  test.setTimeout(120_000)
  await openEditor(page)
  await page.keyboard.press('b')
  await page.getByLabel('Brush size').fill('200')
  // Timing in the page: pointerup to the overlay's next drawing (the frame after it), and each move's handling.
  await page.evaluate(() => {
    const w = window as unknown as { __commits: number[]; __moves: number[] }
    w.__commits = []
    w.__moves = []
    const c = document.querySelector<HTMLCanvasElement>('canvas.ie-mask')!
    let start = 0
    window.addEventListener('pointermove', (e) => { start = e.buttons ? performance.now() : 0 }, true)
    window.addEventListener('pointermove', () => { if (start) w.__moves.push(performance.now() - start) })
    window.addEventListener('pointerup', () => {
      const t0 = performance.now()
      const was = c.dataset.drawn
      const look = () => (c.dataset.drawn !== was ? w.__commits.push(performance.now() - t0) : requestAnimationFrame(look))
      requestAnimationFrame(look)
    }, true)
  })
  for (let s = 0; s < 15; s++) {
    const y = 0.08 + s * 0.06
    const [x0, yy] = await at(page, 0.05, y)
    const [x1] = await at(page, 0.95, y)
    await page.mouse.move(x0, yy)
    await page.mouse.down()
    for (let i = 1; i <= 120; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 120, yy + Math.sin(i / 8) * 6)
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __commits: number[] }).__commits.length)).toBe(s + 1)
  }
  const { commits, moves } = await page.evaluate(() => {
    const w = window as unknown as { __commits: number[]; __moves: number[] }
    return { commits: w.__commits, moves: w.__moves }
  })
  const sorted = [...moves].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  console.log(`commit ms: ${commits.map((c) => c.toFixed(0)).join(' ')} · move median ${median.toFixed(2)} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)].toFixed(2)} ms`)
  expect(commits[14]).toBeLessThanOrEqual(COMMIT_BUDGET)
  expect(median).toBeLessThanOrEqual(4)

  // No long task after hiding Frame, after Before / After, or idle for 3 s with a mask. A shared CI runner can stall once
  // for reasons that are not the page's (the 2026-11-22 run failed "after hiding Frame" on one such stall), so each step
  // is tried up to three times, each try measured alone: a real regression makes a long task on every try and still fails.
  await quietStep(page, 'long tasks after hiding Frame', async () => {
    await page.getByRole('button', { name: 'Hide Frame' }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Show Frame' }).click()
    await page.waitForTimeout(800)
  })
  await quietStep(page, 'long tasks after Before / After', async () => {
    await page.getByRole('group', { name: 'Compare' }).getByRole('button', { name: 'Before' }).click()
    await page.waitForTimeout(500)
    await page.getByRole('group', { name: 'Compare' }).getByRole('button', { name: 'After' }).click()
    await page.waitForTimeout(800)
  })
  await quietStep(page, 'long tasks while idle', async () => {
    await page.mouse.move(5, 5)
    await page.waitForTimeout(3000)
  })
})

/** Run `step` and expect it to make no long task; tried up to QUIET_TRIES times, passing on the first clean try. */
const QUIET_TRIES = 3
async function quietStep(page: Page, label: string, step: () => Promise<void>): Promise<void> {
  let tasks: number[] = []
  for (let n = 0; n < QUIET_TRIES; n++) {
    const mark = (await longTasksSince(page)).next
    await step()
    tasks = (await longTasksSince(page, mark)).tasks
    if (!tasks.length) return
  }
  expect(tasks, label).toEqual([])
}
