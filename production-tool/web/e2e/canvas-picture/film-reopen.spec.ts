// UAT walkthrough 2026-11-21 (bug 2): Make clips on a storyboard with no Film node makes one and opens the Film room;
// opening that Film node from the canvas again showed "No film here yet". Mock relay only: nothing is paid.
import { expect, test } from '../fixtures'

test('the film Make clips made opens again from its canvas node', async ({ page }) => {
  await page.goto('/?engine=own')
  await page.waitForFunction(() => !!(window as unknown as { __seed?: unknown }).__seed, null, { timeout: 30_000 })
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 36
    const x = c.getContext('2d')!; x.fillStyle = '#C8553D'; x.fillRect(0, 0, 64, 36)
    return c.toDataURL('image/png')
  })
  await page.evaluate((pic) => (window as unknown as { __seed: { market: (o: unknown) => Promise<void> } }).__seed.market({
    title: 'Let them sleep', shots: [{ pic, action: 'She lifts the kettle.', s: 5 }, { pic, action: 'Steam.', s: 5 }, { pic, action: 'The door.', s: 5 }],
  }), png)
  // The blank-canvas start: the storyboard has no Film node (owner 2026-11-03), so take the seeded one away.
  await page.evaluate(() => (window as unknown as { __seed: { noFilm: () => Promise<void>; nodes: () => Promise<void> } }).__seed.noFilm().then(() => (window as unknown as { __seed: { nodes: () => Promise<void> } }).__seed.nodes()))
  await page.evaluate(() => (window as unknown as { __seed: { storyboard: () => void } }).__seed.storyboard())
  await page.getByRole('button', { name: 'Make clips', exact: true }).click()
  await expect(page.getByText('Boxes')).toBeVisible()
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/film-room-first.png` : 'test-results/film-room-first.png' })
  await page.getByRole('button', { name: /Canvas/ }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/canvas-after-make-clips.png` : 'test-results/canvas-after-make-clips.png' })
  const films = await page.evaluate(() => Object.keys((window as unknown as { __pt: { doc: { get: () => { videos: Record<string, unknown> } } } }).__pt.doc.get().videos as object))
  expect(films.length).toBe(1)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText('No film here yet')).toHaveCount(0)
  await expect(page.getByText('Boxes')).toBeVisible()
})

test('a Film node whose film is gone from the document does not dead-end', async ({ page }) => {
  await page.goto('/?engine=own')
  await page.waitForFunction(() => !!(window as unknown as { __seed?: unknown }).__seed, null, { timeout: 30_000 })
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; c.getContext('2d')!.fillRect(0, 0, 64, 36); return c.toDataURL('image/png') })
  const seed = (fn: string, arg?: unknown) => page.evaluate(([f, a]) => (window as unknown as { __seed: Record<string, (x?: unknown) => Promise<void>> }).__seed[f as string](a), [fn, arg] as const)
  await seed('market', { title: 'Let them sleep', shots: [{ pic: png, action: 'The kettle.', s: 5 }, { pic: png, action: 'Steam.', s: 5 }] })
  await seed('noFilm')
  await seed('nodes')
  await page.evaluate(() => (window as unknown as { __seed: { storyboard: () => void } }).__seed.storyboard())
  await page.getByRole('button', { name: 'Make clips', exact: true }).click()
  await expect(page.getByText('Boxes')).toBeVisible()
  await page.getByRole('button', { name: /Canvas/ }).first().click()
  // The film's record is lost (a save that did not land): the node stays on the canvas.
  await page.evaluate(() => (window as unknown as { __seed: { noFilm: () => Promise<void> } }).__seed.noFilm())
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByText('No film here yet')).toBeVisible()
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/film-gone-after.png` : 'test-results/film-gone-after.png' })
  await page.getByRole('button', { name: 'Make the film from the storyboard' }).click()
  await expect(page.getByText('Boxes')).toBeVisible()
})
