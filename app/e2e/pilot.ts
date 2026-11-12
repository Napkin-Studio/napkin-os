// Helpers shared by the Phase 2 spec files (features/j001-phase2-suite.clan). They are the Phase 1 helpers of
// j001-pilot.spec.ts as plain exports, so a spec imports them and does not copy them. j001-pilot.spec.ts is left
// unedited and keeps its own copies until a later tidy; if you change one here, the Phase 1 copy is not affected.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { asMe, lockBrief, PEOPLE, signBrief, type SeededJob } from './seed/j001'

export type Size = { tag: string; width: number; height: number }
export const SIZES: Size[] = [{ tag: '390', width: 390, height: 844 }, { tag: '1440', width: 1440, height: 900 }]
export const MODES = ['white', 'grey', 'black'] as const

export type Decision = { id?: string; kind?: string; agent?: string; action?: string; edited_by?: string; version?: string; actor?: string; source?: string }
export type Person = { username: string; name?: string; roles?: string[] }

/** The roster server of the stack (stack.mjs): the people sign in here, one auth mode per process. */
export const rosterURL = `http://127.0.0.1:${process.env.NAPKIN_E2E_ROSTER_PORT || '18082'}`
/** The stand-in middleware's control address: POST {state, stage, fail, variant}, GET /log. */
export const mwControl = `http://127.0.0.1:${process.env.NAPKIN_E2E_MW_PORT || '18081'}/control`

export async function open(browser: Browser, size: Size, mode: string = 'white', opts: { roster?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, ...(opts.roster ? { baseURL: rosterURL } : {}) })
  await ctx.addInitScript(m => { try { localStorage.setItem('napkin.theme', m) } catch { /* not kept */ } }, mode)
  return { ctx, page: await ctx.newPage() }
}

/** Sign in as a placeholder person (the context must be the roster server's: `open(..., { roster: true })`). */
export async function signIn(page: Page, who: { username: string }) {
  const r = await page.request.post('/api/auth/sign-in', { data: { username: who.username } })
  expect(r.status(), `sign in as ${who.username}`).toBe(200)
}

/** The planner signs, then the creative director locks (the Brief gate). Leaves the creative director signed in. */
export async function signOff(page: Page, job: SeededJob) {
  await signIn(page, PEOPLE.planning)
  expect((await signBrief(page, job.brief)).status()).toBe(200)
  await signIn(page, PEOPLE.creativeDirector)
  expect((await lockBrief(page, await asMe(page, job.api, job.brief))).status()).toBe(200)
}

export const chainOf = async (page: Page, token: string): Promise<Decision[]> =>
  ((await (await page.request.get(`/s/${token}/chain`)).json()) as { decisions: Decision[] }).decisions

export const sessionOf = async (page: Page) =>
  (await (await page.request.get('/api/session')).json()) as { tenant: string; quota: { used: number; cap: number } }

export const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

/** WCAG contrast of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The three papers the page really draws, as #rrggbb: what --desk, --paper and --card resolve to. */
export async function papers(page: Page): Promise<string[]> {
  const rgb = await page.evaluate(() => ['--desk', '--paper', '--card'].map(v => {
    const probe = document.createElement('div')
    probe.style.background = `var(${v})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    const n = (c.match(/-?[\d.]+/g) ?? []).slice(0, 3).map(Number)
    return c.startsWith('color(') ? n.map(x => Math.round(x * 255)) : n
  }))
  return rgb.map(c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''))
}

/** Tell the stand-in middleware something: `{ fail: 'judge_work' }` fails that task once, `{ variant: { judge_work: 'score22-idea7' } }` picks an answer file. */
export async function control(page: Page, body: object) {
  const r = await page.request.post(mwControl, { data: body })
  expect(r.status(), 'the stand-in middleware took the control message').toBe(200)
}

/** What the stand-in middleware was asked, newest last: `{ task, at }` for every request, and nothing else. */
export async function middlewareLog(page: Page): Promise<{ task: string; at: string; model?: unknown }[]> {
  return (await (await page.request.get(`${mwControl}/log`)).json()) as { task: string; at: string }[]
}
