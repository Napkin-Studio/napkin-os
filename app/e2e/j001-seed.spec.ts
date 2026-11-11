// The J001 seed itself (features/j001-pilot-suite.clan): it builds the job's documents through the
// tenant's own API, calls no model, and its de-identification check fails on a deny-list hit.
// The check is exercised here with a throwaway list made for the test (a made-up word, in a
// temp folder outside the repo); the real list stays outside the repo and is never read here.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { assertDeIdentified } from './seed/j001/denyList.mjs'
import { JOB, MESSY_BRIEF, seedJ001 } from './seed/j001'

test('the J001 seed writes the job through the tenant API and calls no model', async ({ page }) => {
  const job = await seedJ001(page)
  expect(JOB.client).toBe('Client A')
  for (const doc of [job.brief, job.research, job.deck]) {
    expect((await page.request.get(`/s/${doc.token}/chain`)).status()).toBe(200)
  }
  const listed = await (await page.request.get(`${job.api}/library?client=${job.client}`)).json() as unknown
  expect(JSON.stringify(listed)).toContain('J001 brief')
  const data = await (await page.request.get(`/s/${job.brief.token}/chain`)).text()
  expect(data).not.toContain('error')
  // The brief is the messy one: it names no measurable objective and no baseline.
  expect(Object.keys(MESSY_BRIEF)).not.toContain('objectives')
  expect(Object.keys(MESSY_BRIEF)).not.toContain('measurement')
  // No model event: the metered route was never called, so the quota is untouched.
  const session = await (await page.request.get('/api/session')).json() as { quota: { used: number } }
  expect(session.quota.used).toBe(0)
})

test('the de-identification check passes with a note when no list is supplied', () => {
  const r = assertDeIdentified({ listPath: '' })
  expect(r.checked).toBe(false)
  expect(r.note).toContain('NAPKIN_DENY_LIST')
})

test('the de-identification check fails when a deny-list string is in the seed, and not otherwise', () => {
  const work = mkdtempSync(join(tmpdir(), 'j001-deny-'))
  try {
    const seed = join(work, 'seed')
    mkdirSync(seed)
    writeFileSync(join(seed, 'brief.ts'), 'export const x = "Client A, an Irish whiskey"\n')
    const list = join(work, 'deny.txt')
    writeFileSync(list, '# made up for this test\nzzqx-brand\n')
    expect(assertDeIdentified({ listPath: list, paths: [seed] }).checked).toBe(true)
    writeFileSync(join(seed, 'leak.ts'), 'export const y = "the ZZQX-Brand launch"\n') // any case
    expect(() => assertDeIdentified({ listPath: list, paths: [seed] })).toThrow(/1 string/)
    // The seed folder in the repo is clean against the same kind of list.
    expect(assertDeIdentified({ listPath: list }).checked).toBe(true)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

test('a deny list kept inside the repo is refused', () => {
  expect(() => assertDeIdentified({ listPath: new URL('./README.md', import.meta.url).pathname })).toThrow(/inside the repo/)
})
