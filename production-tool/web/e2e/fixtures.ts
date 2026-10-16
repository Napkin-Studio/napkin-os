// Shared fixtures for the e2e specs (e2e/README.md): open the app on the in-browser mock, seed a
// project through window.__seed (src/dev/seed.ts), drive the pointer with page.mouse (real pointer
// events, never synthetic dispatches), and read canvases, long tasks and the document back.
// Other UI items add specs here; they do not add harnesses.

import { expect, test as base, type Page } from '@playwright/test'

export { expect }

export interface Seeded { projectId: string; shotIds: string[]; shotId: string; frameId: string; sha: string; w: number; h: number }
export interface OpenOpts {
  ratio?: string
  /** Hold every mock job this long (ms), so a test can act while one runs. */
  mockDelay?: number
  shots?: number
}
type P = [number, number]

/** The app's dev hooks, as the specs see them. */
declare global {
  interface Window {
    __seed: { frame: (o?: object) => Promise<Seeded>; storyboard: () => void; canvas: () => Promise<void> }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __pt: any
    __longTasks?: number[]
  }
}

/** Runs `fn` again when the dev server reloads the page under it (its first dependency scan does). */
async function settled<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      await page.waitForFunction(() => !!window.__seed, null, { timeout: 30_000 })
      return await fn()
    } catch (e) {
      if (i >= 3 || !/context was destroyed|navigation|Target closed/i.test(String(e))) throw e
      await page.waitForLoadState('load')
    }
  }
}

/** Opens the app, seeds a project with a drawn frame and opens it in the Image editor. */
export async function openEditor(page: Page, opts: OpenOpts = {}): Promise<Seeded> {
  const q = new URLSearchParams({ engine: 'own', ...(opts.mockDelay ? { mockDelay: String(opts.mockDelay) } : {}) })
  await page.addInitScript(() => {
    // Long tasks from the start, for the performance checks.
    window.__longTasks = []
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks!.push(e.duration) }).observe({ type: 'longtask', buffered: true })
    } catch { /* no long-task timing here */ }
  })
  await page.goto(`/?${q}`)
  const seeded = await settled(page, () => page.evaluate((o) => window.__seed.frame(o), { ratio: opts.ratio, shots: opts.shots }))
  await page.evaluate(() => window.__seed.storyboard())
  await page.getByRole('button', { name: 'Open in image editor' }).first().click()
  await page.locator('.ie-frame').waitFor()
  // The composed picture is drawn (the canvas replaces the <img>).
  await page.locator('canvas.ie-pic:not([hidden])').waitFor()
  return seeded
}

/** The stage's frame on screen. */
export async function frameBox(page: Page) {
  const b = await page.locator('.ie-frame').boundingBox()
  if (!b) throw new Error('no stage')
  return b
}

/** A point at (fx, fy) of the frame (0-1), in page pixels. */
export async function at(page: Page, fx: number, fy: number): Promise<P> {
  const b = await frameBox(page)
  return [b.x + fx * b.width, b.y + fy * b.height]
}

/** A drag through the points (page pixels): down at the first, a move to each next, up at the last. */
export async function drag(page: Page, pts: P[], opts: { up?: boolean } = {}) {
  await page.mouse.move(pts[0][0], pts[0][1])
  await page.mouse.down()
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y)
  if (opts.up !== false) await page.mouse.up()
}

/** `n` points on a line between two frame points (0-1), in page pixels. */
export async function line(page: Page, from: P, to: P, n = 20): Promise<P[]> {
  const b = await frameBox(page)
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1)
    return [b.x + (from[0] + (to[0] - from[0]) * t) * b.width, b.y + (from[1] + (to[1] - from[1]) * t) * b.height] as P
  })
}

/** A stroke between two frame points (0-1). */
export async function stroke(page: Page, from: P, to: P, n = 20) {
  await drag(page, await line(page, from, to, n))
}

/** A closed lasso through frame points (0-1), with `per` moves along each side. */
export async function lasso(page: Page, corners: P[], per = 6) {
  const b = await frameBox(page)
  const pts: P[] = []
  const ring = [...corners, corners[0]]
  for (let i = 0; i + 1 < ring.length; i++) for (let k = 0; k < per; k++) {
    const t = k / per
    pts.push([b.x + (ring[i][0] + (ring[i + 1][0] - ring[i][0]) * t) * b.width, b.y + (ring[i][1] + (ring[i + 1][1] - ring[i][1]) * t) * b.height])
  }
  await drag(page, pts)
}

export interface OverlayStats { w: number; h: number; painted: number; rim: number; box: { x0: number; y0: number; x1: number; y1: number } | null }

/** The committed mask overlay (canvas.ie-mask): painted pixels, rim (opaque) pixels and the box, 0-1. */
export function overlay(page: Page, selector = 'canvas.ie-mask'): Promise<OverlayStats> {
  return page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)
    if (!c) throw new Error(`no ${sel}`)
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let painted = 0, rim = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    for (let i = 0; i < c.width * c.height; i++) {
      const a = d[i * 4 + 3]
      if (!a) continue
      painted++
      if (a === 255) rim++
      const x = i % c.width, y = (i / c.width) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return { w: c.width, h: c.height, painted, rim, box: x1 < 0 ? null : { x0: x0 / c.width, y0: y0 / c.height, x1: (x1 + 1) / c.width, y1: (y1 + 1) / c.height } }
  }, selector)
}

/** The composed picture's pixel at (fx, fy), 0-1 (canvas.ie-pic): [r, g, b, a]. */
export function picPixel(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.ie-pic')!
    return [...c.getContext('2d')!.getImageData(Math.floor(x * (c.width - 1)), Math.floor(y * (c.height - 1)), 1, 1).data]
  }, [fx, fy] as P)
}

/** The Image editor's session for the open frame (ProjectUi.imageEdits). */
export function session(page: Page, frameId: string) {
  return page.evaluate((id) => window.__pt.ui.get().imageEdits?.[id] ?? { edits: [], hidden: [] }, frameId)
}

/** A job's state as the app sees it (the runner's live state, else the document's). */
export function jobState(page: Page, jobId: string): Promise<string | undefined> {
  return page.evaluate((id) => window.__pt.runner.liveInfo(id)?.state ?? window.__pt.doc.get().jobs[id]?.state, jobId)
}

/** Long tasks (ms) seen since `from` (an index into the list), and the list's length now. */
export async function longTasksSince(page: Page, from = 0): Promise<{ tasks: number[]; next: number }> {
  return page.evaluate((f) => ({ tasks: (window.__longTasks ?? []).slice(f), next: (window.__longTasks ?? []).length }), from)
}

/** The edits list as text, one row per entry. */
export async function editRows(page: Page): Promise<string[]> {
  return (await page.locator('.ie-elist > li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
}

export const test = base
