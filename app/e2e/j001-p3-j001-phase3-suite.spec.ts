// Phase 3 acceptance, record `j001-phase3-suite` (features/j001-phase3-suite.clan): tests 108 to 111 of docs/design/phase3-acceptance.md, run at 390 and 1440 px.
// Test 111 is live: the dashboard's Judge tile counts J001's pieces from fixture verdicts (the stand-in middleware is Judge's fixture backend).
// Test 108 is fixme until the first record that builds a Phase 3 page lists it in its own j001-p3-<slug>.pages.ts; the suite's owner turns it on then.
// No paid provider and no model: the mock provider and the stand-in middleware answer from files, keys unset, the spend cap 0.

import { type Page, expect, test } from '@playwright/test'
import { MODES, type Person, SIZES, control, open, signIn } from './pilot'
import { PEOPLE, seedJ001 } from './seed/j001'
import { type Job, VERDICT_VARIANT, startJ001, title } from './phase3/support'
import { RADIO_SCRIPT, SCRIPT_EDITOR_APP, TV_SCRIPT } from './seed/j001/p2/script-editor.mjs'

for (const size of SIZES) {
  const t = (n: number) => title(n, size)

  test.fixme(t(108), async ({ browser }) => {
    // Every Phase 3 page of every record that has turned on, in all three modes. Each record lists its pages in its own
    // j001-p3-<slug>.pages.ts, as Phase 2's records do (name, who reads it, how to show it); this test reads every such file.
    const { glob } = await import('node:fs/promises')
    const files: string[] = []
    for await (const f of glob(new URL('./j001-p3-*.pages.ts', import.meta.url).pathname)) files.push(f)
    expect(files.length, 'at least one record has listed its pages').toBeGreaterThan(0)
    const AxeBuilder = (await import('@axe-core/playwright')).default // ADJUST(j001-phase3-suite): the same axe the Phase 2 suite uses
    for (const file of files) {
      const { PAGES } = (await import(file)) as { PAGES: { name: string; as: Person; show: (page: Page, ctx: { job: Job; mode: string }) => Promise<void> }[] }
      for (const mode of MODES) {
        for (const p of PAGES) {
          const { ctx, page, job } = await startJ001(browser, size, p.as)
          await page.addInitScript(m => { try { localStorage.setItem('napkin.theme', m) } catch { /* not kept */ } }, mode)
          await p.show(page, { job, mode })
          const serious = (await new AxeBuilder({ page }).analyze()).violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
          expect(serious.map(v => v.id), `${p.name} in ${mode}`).toEqual([])
          if (size.width < 500) {
            for (const b of await page.locator('[data-primary]').all()) expect((await b.boundingBox())!.height, `${p.name} primary button`).toBeGreaterThanOrEqual(44)
          }
          expect(await page.locator('body').innerText(), `${p.name} holds no em dash`).not.toContain('\u2014')
          await ctx.close()
        }
      }
    }
  })

  test(t(111), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning) // a job is opened by planning, then the copywriter writes in it
    const job = await seedJ001(page, { ready: true, fresh: true })
    await signIn(page, PEOPLE.copywriter)
    // Five J001 pieces, each scored by the fixture backend (the stand-in middleware): the Judge tile counts them. Until judge-media-rubrics
    // gives Judge the five media kinds, the pieces are the five J001 drafts Judge can read today (each a Script editor document that holds one
    // piece's words); that record swaps the five for the still, film, radio spot, poster and format pack and keeps this test.
    const pieces = [
      { title: 'J001 still line', data: RADIO_SCRIPT },
      { title: 'J001 film script', data: TV_SCRIPT },
      { title: 'J001 radio spot', data: RADIO_SCRIPT },
      { title: 'J001 poster line', data: RADIO_SCRIPT },
      { title: 'J001 pack line', data: TV_SCRIPT },
    ]
    for (const p of pieces) {
      const made = await page.request.post(`${job.api}/documents`, { data: { app_id: SCRIPT_EDITOR_APP, title: p.title, client_id: job.client, job: job.job } })
      expect(made.status(), 'the Script editor app is installed').toBe(200)
      const doc = (await made.json()) as { token: string }
      expect((await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: p.data, agent: 'j001-seed', action: `seed: ${p.title}` } })).status()).toBe(200)
      await control(page, { variant: { judge_work: VERDICT_VARIANT } })
      expect((await page.request.post(`/s/${doc.token}/judge`, { data: { target: 'script' } })).status()).toBe(200)
    }
    // The dashboard's Judge tile counts the five pieces, within 10 seconds.
    await signIn(page, PEOPLE.management)
    await page.goto('/#door-agency-dashboard'); await page.reload()
    await expect(page.getByTestId('tile-scores')).toContainText(/of \d+ pieces/, { timeout: 10_000 }) // the tile counts the agency's pieces, so the job's own count is read below
    const tile = (await (await page.request.get(`${job.api}/dashboard`)).json()) as { scores: { scored: number; jobs: { number: string; scored: number }[] } }
    expect(tile.scores.jobs.find(j => j.number === job.job)?.scored).toBe(5)
    // The tile counts pieces, never people.
    expect(JSON.stringify(tile)).not.toMatch(/per_person|by_person|per_writer|by_author/i)
    await ctx.close()
  })
}
