// Placeholder clients for the smoke specs: Client A, Client B ... through the
// tenant's own API. Never a real client name (features/landing-circles.clan).

import { expect, type Page } from '@playwright/test'

export async function seedClients(page: Page, n: number): Promise<{ api: string; ids: string[] }> {
  const { tenant } = await (await page.request.get('/api/session')).json() as { tenant: string }
  const api = `/api/t/${tenant}`
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const name = `Client ${i < 26 ? String.fromCharCode(65 + i) : `A${i - 25}`}`
    const r = await page.request.post(`${api}/clients`, { data: { name } })
    expect(r.status(), `create ${name}`).toBe(201)
    ids.push((await r.json() as { id: string }).id)
  }
  return { api, ids }
}

/** How many pixels of a circle's canvas are drawn (not transparent). */
export const ink = (page: Page, selector: string): Promise<number> =>
  page.evaluate(sel => {
    const c = document.querySelector<HTMLCanvasElement>(`${sel} canvas`)
    const x = c?.getContext('2d')
    if (!c || !x || !c.width) return 0
    const d = x.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++
    return n
  }, selector)

/** A fingerprint of a circle's canvas, to see whether it changed. */
export const picture = (page: Page, selector: string): Promise<string> =>
  page.evaluate(sel => {
    const c = document.querySelector<HTMLCanvasElement>(`${sel} canvas`)
    if (!c || !c.width) return ''
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let h = 2166136261
    for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11), 16777619)
    return String(h >>> 0)
  }, selector)
