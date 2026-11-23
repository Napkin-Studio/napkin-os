// Shared helpers for the clan-app specs: stage gating, sign-in and the library API through the page's own
// cookie jar, and the saved document read back from the host (the one place every stage can look).
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'

export { expect, test }
export const here = dirname(fileURLToPath(import.meta.url))

/** The stage this run covers (E2E_STAGE, default 1). A spec for a later stage is `test.fixme`. */
export const stage = Number(process.env.E2E_STAGE ?? 1)
export const at = (n: number) => (stage >= n ? test : test.fixme)

export const USER = process.env.PC_USER || 'dev@napkin'
export const FIXTURES = process.env.PRODUCTION_FIXTURES || '/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/downloads'
export const EXPORT_ZIP = join(FIXTURES, 'napkin-hollow-oak-still-production.zip')
const briefCandidates = [
  join(here, '../../../../crates/napkin-web/tests/fixtures/hollow-oak-brief.clan'),
  '/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/spinoff-upstream/brief.clan',
]
export const BRIEF_CLAN = briefCandidates.find((p) => existsSync(p)) ?? briefCandidates[0]
export const haveFixture = (p: string) => existsSync(p)

export async function signIn(request: APIRequestContext): Promise<string> {
  const r = await request.post('/api/auth/sign-in', { data: { username: USER } })
  expect(r.ok(), `sign-in as ${USER}`).toBeTruthy()
  const s = await request.get('/api/session')
  return (await s.json()).tenant as string
}

export async function createProject(request: APIRequestContext, tenant: string, title: string, client_id?: string): Promise<string> {
  const r = await request.post(`/api/t/${tenant}/documents`, { data: { app_id: 'ie.napkin.production', title, client_id } })
  expect(r.ok(), 'POST /documents').toBeTruthy()
  return (await r.json()).path as string
}

export interface Downloaded { bytes: Buffer; version: string }
export async function download(request: APIRequestContext, tenant: string, doc: string): Promise<Downloaded> {
  const r = await request.get(`/api/t/${tenant}/d/${doc}/download`)
  expect(r.ok(), 'download').toBeTruthy()
  return { bytes: Buffer.from(await r.body()), version: (r.headers()['etag'] ?? '').replace(/"/g, '') }
}

/** The document's data as the host holds it (GET .../data). */
export async function dataOf(request: APIRequestContext, tenant: string, doc: string): Promise<Record<string, unknown[]>> {
  const r = await request.get(`/api/t/${tenant}/d/${doc}/data`)
  expect(r.ok(), 'data').toBeTruthy()
  return (await r.json()).data
}

/** Entity kinds of a Production document that hold something: the canvas nodes, by kind. */
export const nodeKinds = (d: Record<string, unknown>) =>
  ['scripts', 'storyboards', 'videos', 'briefs', 'boards', 'frames', 'shots'].filter((k) => Array.isArray(d[k]) && (d[k] as unknown[]).length > 0)

export const toolUrl = (doc: string) => `/production/?doc=${encodeURIComponent(doc)}`

/** Reads manifest.yaml's title out of a .clan (zip) without the SDK. */
export function manifestTitle(bytes: Uint8Array): string | null {
  const m = strFromU8(unzipSync(bytes)['manifest.yaml'] ?? new Uint8Array())
  return /^title:\s*(.*)$/m.exec(m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null
}

/** A page that fails the test when it calls anything but this origin and the media base (S3-1). */
export function watchOrigins(page: Page): { foreign: string[] } {
  const seen = { foreign: [] as string[] }
  const own = new URL(page.context().browser() ? (process.env.E2E_BASE_URL || 'http://127.0.0.1:20420') : 'http://127.0.0.1:20420').origin
  page.on('request', (rq) => {
    const u = new URL(rq.url())
    if (u.protocol.startsWith('http') && u.origin !== own) seen.foreign.push(`${rq.method()} ${u.origin}`)
  })
  return seen
}



/** The film's ▾ menu: More, then Rename (ui/chrome/DocMenu): the one edit every stage has. */
export async function renameProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'More' }).first().click()
  await page.getByRole('menuitem', { name: /Rename/ }).click()
  await page.getByLabel("The project's name").fill(name)
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
}

/** Waits until the host's copy of the project has this title (a save landed). */
export async function waitSavedTitle(request: APIRequestContext, tenant: string, doc: string, title: string, timeout = 30_000) {
  await expect.poll(async () => manifestTitle((await download(request, tenant, doc)).bytes), { timeout }).toBe(title)
}
