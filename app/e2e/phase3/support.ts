// Helpers shared by the Phase 3 spec files (features/j001-phase3-suite.clan). Plain exports, not a spec, so importing it registers no test.
// The Phase 1 and 2 helpers stay in ../pilot.ts; this file adds what media work needs: the media fixtures of the seed, the Production
// document of a job, an asset upload, a run on the mock provider, the ledger, and a duration read with ffprobe.
//
// Routes marked ADJUST(<slug>) are guesses from the owning record's design. The record that turns a test on changes the guess to what it
// builds and says so in its log; facts read through a document's chain and the host's API do not move with a screen.
// No paid provider and no model: the mock provider answers, keys are unset and the spend cap is 0 unless a test says otherwise.

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, type Browser, type Page } from '@playwright/test'
import { open, signIn, type Person, type Size } from '../pilot'
import { PEOPLE, seedJ001, type SeededJob } from '../seed/j001'
import { mediaBytes } from '../seed/j001/media/index.mjs'
import { PHASE3 } from './tests.mjs'

export { MEDIA, SITES, mediaBytes, mediaJson } from '../seed/j001/media/index.mjs'

const short = (n: number) => PHASE3.find(x => x.n === n)!.short
/** The test name: number, short title, width. The counter reads `t(N)` as the first argument of test or test.fixme. */
export const title = (n: number, size: Size) => `${n} ${short(n)}, ${size.tag} px`

export type Job = SeededJob
export type Doc = { token: string; id: string; path: string }

/**
 * A roster context at `size`: planning opens J001 (a ready brief, a fresh client), then `who` is signed in. Leaves `who` signed in.
 * The mock provider is the only provider the stack has, and its cap is 0 (`NAPKIN_SPEND_CAP_EUR` unset), so nothing here is paid.
 */
export async function startJ001(browser: Browser, size: Size, who: Person = PEOPLE.producer) {
  const { ctx, page } = await open(browser, size, 'white', { roster: true })
  await signIn(page, PEOPLE.planning)
  const job = await seedJ001(page, { ready: true, fresh: true })
  await signIn(page, who)
  return { ctx, page, job }
}

/** The job's Production document, as its job page lists it. ADJUST(production-line-merge, phase3-doors): the route and the field names. */
export async function productionDoc(page: Page, job: Job): Promise<Doc> {
  const r = await page.request.get(`${job.api}/jobs/${job.job}`)
  expect(r.status(), 'the job page answers').toBe(200)
  const docs = ((await r.json()) as { documents: { app_id: string; token: string; id: string; path: string }[] }).documents
  const d = docs.find(x => x.app_id === 'ie.napkin.production')
  expect(d, 'the job lists its Production document').toBeTruthy()
  return d as Doc
}

/** Put a seed fixture into the job's Production document as an asset, and return the asset's id and hash. ADJUST(production-line-merge). */
export async function addAsset(page: Page, doc: Doc, file: string, role = 'input') {
  const r = await page.request.post(`/production/api/assets`, {
    multipart: { document: doc.id, role, file: { name: file, mimeType: file.endsWith('.png') ? 'image/png' : 'application/json', buffer: mediaBytes(file) } },
  })
  expect(r.status(), `add ${file}`).toBe(200)
  return (await r.json()) as { id: string; sha256: string }
}

/** One run on the mock provider: an op at a tier over inputs. The answer is the job record. ADJUST(production-line-merge, media-tiers). */
export async function runOp(page: Page, doc: Doc, body: { op: string; provider?: string; tier?: 'sketch' | 'standard' | 'hero'; inputs?: readonly string[]; params?: object }) {
  const r = await page.request.post(`/production/api/jobs`, { data: { document: doc.id, provider: 'mock', ...body } })
  return { status: r.status(), job: (await r.json()) as { id: string; state: string; reason?: string; message?: string; outputs?: { id: string; kind: string; sha256: string }[]; ledger_lines?: string[]; reused?: boolean; router?: { tier: string; candidates: string[]; tried: { provider: string; model: string; outcome: string }[]; used: string } } }
}

export type LedgerLine = { id: string; job: string; run: string; provider: string; model: string; tier: string; list: { amount: number; currency: string }; charged: { amount: number; currency: string }; state: string; reason?: string; decision?: string; person: string; agent: string }

/** The ledger lines of the job. ADJUST(spend-ledger): the route. */
export async function ledgerOf(page: Page, job: Job): Promise<LedgerLine[]> {
  const r = await page.request.get(`${job.api}/ledger?job=${job.job}`)
  expect(r.status(), 'the ledger answers').toBe(200)
  return ((await r.json()) as { lines: LedgerLine[] }).lines
}

/** A fixture verdict from the stand-in middleware for the next Judge request: its answer file, as phase 2's `control` picks one. */
export const VERDICT_VARIANT = 'score24'

/** The seconds a media file runs, read with ffprobe (the film and the spot). Skips cleanly when ffprobe is missing. */
export async function secondsOf(bytes: Buffer, ext: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'j001-p3-'))
  try {
    const file = join(dir, `piece.${ext}`)
    writeFileSync(file, bytes)
    const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
    return Number(stdout.trim())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Every string a response holds, for the walls ("no digit", "no key"): the body as text. */
export const bodyText = async (page: Page, url: string) => await (await page.request.get(url)).text()
