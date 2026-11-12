// The Phase 2 seed (features/j001-phase2-suite.clan): written through the tenant's own API, as seedJ001 writes the Phase 1 job. It adds
// to the J001 job the Phase 2 documents whose apps are installed on this branch, and says which it skipped.
import { expect, type Page } from '@playwright/test'
import { assertDeIdentified } from '../denyList.mjs'
import { P2_DOCS } from './documents.mjs'
import type { SeededJob } from '../index'

export { CLIENT_REVIEWERS } from './reviewers.mjs'
export { CANARY_SENTENCE, plantCanary, AGENCY_ONLY } from './wall.mjs'

export type P2Doc = { slug: string; title: string; token: string; id: string; path: string }

/**
 * Write the Phase 2 documents for `job`, as the signed-in person. A document whose app is not installed is skipped (`skipped`
 * names it); one that is installed is made and patched with agent j001-seed and an action, so its chain is attributed from the start.
 */
export async function seedPhase2(page: Page, job: Pick<SeededJob, 'api' | 'client' | 'job'>): Promise<{ written: P2Doc[]; skipped: string[]; deIdentified: { checked: boolean; note: string } }> {
  const deIdentified = assertDeIdentified()
  const apps = ((await (await page.request.get(`${job.api}/apps`)).json()) as { app_id: string }[]).map(a => a.app_id)
  const written: P2Doc[] = []
  const skipped: string[] = []
  for (const d of P2_DOCS) {
    if (!apps.includes(d.app)) { skipped.push(`${d.slug}: ${d.title} (app ${d.app} is not installed yet)`); continue }
    const r = await page.request.post(`${job.api}/documents`, { data: { app_id: d.app, title: d.title, client_id: job.client, job: job.job } })
    expect(r.status(), `create ${d.title}`).toBe(200)
    const body = await r.json() as { token: string; path: string; manifest: { id: string } }
    const p = await page.request.post(`/s/${body.token}/patch-data`, { data: { patch: d.data, agent: 'j001-seed', action: `seed: ${d.title}` } })
    expect(p.status(), `patch ${d.title}`).toBe(200)
    written.push({ slug: d.slug, title: d.title, token: body.token, id: body.manifest.id, path: body.path })
  }
  return { written, skipped, deIdentified }
}
