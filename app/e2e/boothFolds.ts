// The Booth's shared folds (features/align-booth.clan), as the e2e specs read them: inside the tool's frame, in the Booth.
import { expect, type FrameLocator, type Page } from '@playwright/test'

/** The open document's frame, and its Booth (the shared snippet marks its column data-booth-panel). */
export function boothIn(page: Page): { app: FrameLocator; booth: ReturnType<FrameLocator['locator']> } {
  const app = page.frameLocator('iframe').first()
  return { app, booth: app.locator('[data-booth-panel]') }
}

/** Two versions compared at 1440 px: the Booth widens to 744 px and sits beside the document, never over it. */
export async function wideBeside(app: FrameLocator, doc: string) {
  const booth = app.locator('[data-booth-panel]')
  // The column opens with the page's own push (a grid transition): measured once it has settled.
  await expect.poll(async () => booth.evaluate(el => { const r = el.getBoundingClientRect(); return Math.round(r.width) === 744 && r.right <= innerWidth + 0.5 }), { timeout: 10_000 }).toBe(true)
  const [d, b] = await Promise.all([app.locator(doc).first().evaluate(el => el.getBoundingClientRect().toJSON()), booth.evaluate(el => el.getBoundingClientRect().toJSON())])
  expect(d.right, 'the document ends before the Booth begins').toBeLessThanOrEqual(b.left)
  expect(b.right, 'the Booth stays on screen').toBeLessThanOrEqual(1440)
  expect(d.width, 'the document keeps room').toBeGreaterThan(360)
}

/**
 * A tool's page for a client, and the work item with this title on it, opened. The shell may correct a tool
 * route to the client's page while its tool list is still being read (LandingHome.tsx, correctRoute): the
 * address is asked again until the tool's own page is the one on screen, so the click lands on the tool page.
 */
export async function openWork(page: Page, client: string, tool: string, title: string) {
  const toolPage = page.locator(`[data-testid="tool-page"][data-tool="${tool}"]`)
  await page.goto(`/#tool-${client}-${tool}`); await page.reload()
  await expect(async () => {
    if (!(await toolPage.count())) await page.goto(`/#tool-${client}-${tool}`)
    await expect(toolPage.getByTestId('work-item').filter({ hasText: title }).first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await toolPage.getByTestId('work-item').filter({ hasText: title }).first().click()
}

/** A command of the OS bar (Undo, Redo), by its title: the bar's search field lists it and Enter runs it. Cmd Z does the same. */
export async function barCommand(page: Page, title: 'Undo' | 'Redo') {
  await page.getByTestId('bar-search-input').click()
  await page.getByTestId('bar-search-input').fill(title)
  await page.locator('[data-testid="bar-result"][data-kind="command"]').filter({ has: page.locator('b', { hasText: new RegExp(`^${title}$`) }) }).first().click()
}

/** Whether the bar offers a command now (it lists only the ones that can run). */
export async function barOffers(page: Page, title: 'Undo' | 'Redo'): Promise<boolean> {
  await page.getByTestId('bar-search-input').click()
  await page.getByTestId('bar-search-input').fill(title)
  const n = await page.locator('[data-testid="bar-result"][data-kind="command"]').filter({ has: page.locator('b', { hasText: new RegExp(`^${title}$`) }) }).count()
  await page.keyboard.press('Escape')
  return n > 0
}

/**
 * Nothing is drawn between the OS bar and an open document (features/align-booth.clan): the frame's top edge meets the
 * bar's bottom edge. With NAPKIN_E2E_SHOTS set, the screen is kept as bands-<tool>-<width>.png.
 */
export async function nothingBetweenBarAndDocument(page: Page, tool: string) {
  await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('os-bar')).toBeVisible()
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="os-bar"]')?.getBoundingClientRect()
    const frame = document.querySelector('iframe')?.getBoundingClientRect()
    return bar && frame ? Math.round(frame.top - bar.bottom) : null
  })
  expect(gap, `the frame's top edge meets the bar's bottom edge on ${tool}`).not.toBeNull()
  expect(Math.abs(gap!), `nothing between the bar and the ${tool}`).toBeLessThanOrEqual(1)
  expect(await page.locator('[data-testid="gate-band"], [data-testid="version-band"], [data-testid="judge-band"]').count()).toBe(0)
  const dir = process.env.NAPKIN_E2E_SHOTS
  if (dir) {
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${dir}/bands-${tool}-${page.viewportSize()?.width ?? 0}.png`, mask: [page.getByTestId('agency-pill')], maskColor: '#C8CBFF' })
  }
}

/**
 * The shell's alert line (Failed save, Update, an undo's note) covers no control of the page: at the top of the page and at its end,
 * no visible button, link, field or summary in the frame, and nothing of the Booth's header, lies under it.
 */
export async function alertCoversNoControl(page: Page) {
  const alert = page.locator('.tb-alert').first()
  await expect(alert).toBeVisible()
  const check = async (where: string) => {
    const a = (await alert.boundingBox())!
    const frame = (await page.locator('iframe').first().boundingBox())!
    const rects = await page.frameLocator('iframe').first().locator('body').evaluate(() => [...document.querySelectorAll('button,a[href],input,textarea,select,summary,[role="button"]')]
      .filter(e => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => { const r = e.getBoundingClientRect(); return { n: `${e.tagName}:${(e.getAttribute('data-testid') || e.id || (e.textContent || '').trim()).slice(0, 30)}`, x: r.x, y: r.y, w: r.width, h: r.height } }).filter(r => r.w > 0 && r.h > 0))
    const hit = rects.filter(r => r.x + frame.x < a.x + a.width && r.x + frame.x + r.w > a.x && r.y + frame.y < a.y + a.height && r.y + frame.y + r.h > a.y).map(r => r.n)
    expect(hit, `${where}: nothing the alert lies over is a control`).toEqual([])
  }
  await check('top')
  await page.frameLocator('iframe').first().locator('body').evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(300)
  await check('end')
  await page.frameLocator('iframe').first().locator('body').evaluate(() => scrollTo(0, 0))
}
