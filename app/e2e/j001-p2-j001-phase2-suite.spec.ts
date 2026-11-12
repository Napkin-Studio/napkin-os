// The suite's own three tests, 71 to 73 (features/j001-phase2-suite.clan): the rules that run across every Phase 2 page and document.
// They run from the first day, over the Phase 1 pages and documents, and widen by themselves as each record lists its pages in its
// own j001-p2-<slug>.pages.ts and seeds its documents (seed/j001/p2/documents.mjs).
// No model, no paid provider: the stack unsets every provider key (stack.mjs) and the stand-in middleware answers from fixture files.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { CANARY } from './seed/j001/canary.mjs'
import { answerFor, answeredTasks } from './seed/j001/p2/answers.mjs'
import { PHASE2 } from './phase2/tests.mjs'
import { chainOf, MODES, middlewareLog, open, SIZES, signIn } from './pilot'
import type { Phase2Page } from './phase2/pages'
import { PEOPLE, READY_BRIEF, seedJ001, type SeededJob } from './seed/j001'
import { seedPhase2 } from './seed/j001/p2'

const HERE = dirname(fileURLToPath(import.meta.url))
const short = (n: number) => PHASE2.find(t => t.n === n)!.short

/** Every record's pages files, j001-p2-<slug>.pages.ts, read by a glob when the suite is collected. */
const PAGE_FILES = readdirSync(HERE).filter(f => /^j001-p2-.+\.pages\.ts$/.test(f)).sort()
if (PAGE_FILES.length === 0) throw new Error('the suite lists at least the Phase 1 pages (j001-p2-j001-phase2-suite.pages.ts)')

/** The pages one record lists. */
async function pagesOf(file: string): Promise<Phase2Page[]> {
  return ((await import(`./${file}`)) as { PAGES?: Phase2Page[] }).PAGES ?? []
}

/** Every record's pages. */
async function allPages(): Promise<Phase2Page[]> {
  return (await Promise.all(PAGE_FILES.map(pagesOf))).flat()
}

/**
 * What a primary button is: the shell's `ch-btn-primary` and `ns-primary`, or anything a record marks `data-primary`. A record
 * whose primary button uses another class adds `data-primary` to it, so the check sees it.
 */
const PRIMARY = '.ch-btn-primary, .ns-primary, [data-primary]'

/**
 * The job test 72's pages are drawn over: one per width and mode, seeded by the first record's test that needs it and read by
 * the others, as the single test did. Seeding one per record would add about sixty jobs to the shared stack each run.
 */
const JOBS = new Map<string, Promise<SeededJob>>()
function jobFor(page: Page, key: string): Promise<SeededJob> {
  if (!JOBS.has(key)) JOBS.set(key, seedJ001(page, { ready: true, fresh: true }))
  return JOBS.get(key)!
}

/** One record's pages in three modes: about half a minute to two minutes on a quiet machine (12 Nov 2026), so four is ample. */
const TIMEOUT_72 = 240_000

for (const size of SIZES) {
  const t = (n: number) => `${n} ${short(n)}, ${size.tag} px`

  test(t(71), async ({ browser }) => {
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const p2 = await seedPhase2(page, job)
    test.info().annotations.push({ type: 'phase 2 documents', description: `${p2.written.length} written, ${p2.skipped.length} skipped until their app lands` })
    const docs = [job.brief, job.research, job.deck, ...p2.written]
    for (const doc of docs) {
      for (const d of await chainOf(page, doc.token)) {
        expect(d.agent, 'a write with no agent').toBeTruthy()
        expect(d.action, 'a write with no action').toBeTruthy()
        // A human edit is marked as a person's: agent `human` and the person's own name as its actor (Phase 1 test 11 checks the same).
        if (d.agent === 'human') expect(d.actor ?? '', 'a human edit names the person').toBeTruthy()
      }
    }
    // A human edit to each document is attributed and marked, and a write with no agent or no action is refused.
    for (const doc of [job.brief, ...p2.written]) {
      const edit = await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: { title: 'edited by a person' }, agent: 'human', action: 'edit the title' } })
      if (edit.status() === 200) {
        const top = (await chainOf(page, doc.token))[0] // newest first
        expect(top.agent).toBe('human')
        expect(top.action).toBe('edit the title')
        expect(top.actor ?? '').toContain(PEOPLE.planning.username)
      }
      for (const bad of [{ agent: '', action: 'x' }, { agent: 'human', action: '' }, { agent: 'human' }]) {
        const r = await page.request.post(`/s/${doc.token}/patch-data`, { data: { patch: { title: 'x' }, ...bad } })
        expect(r.status(), 'the host refuses an unattributed write').toBe(400)
      }
    }
    await ctx.close()
  })

  // Test 72 is one acceptance test, run as one Playwright test per record's pages file, so no single test grows with every
  // record that lands: each reads that record's pages in the three modes. The registry and the counter count 72 once.
  for (const file of PAGE_FILES) test(t(72) + ` · ${file.replace(/^j001-p2-|\.pages\.ts$/g, '')} pages`, async ({ browser }) => {
    test.setTimeout(TIMEOUT_72)
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    const pages = await pagesOf(file)
    expect(pages.length, `${file} lists at least one page`).toBeGreaterThan(0)
    const problems: string[] = []
    for (const mode of MODES) {
      const { ctx, page } = await open(browser, size, mode, { roster: true })
      await signIn(page, PEOPLE.planning)
      const job = await jobFor(page, `${size.tag} ${mode}`)
      for (const p of pages) {
        await signIn(page, p.as)
        await page.goto('/'); await page.reload() // the page is loaded again as this person: its tenant is read at load
        await p.show(page, { job, mode })
        await page.waitForTimeout(700) // the page's own entrance finishes before it is read
        const found = (await new AxeBuilder({ page }).exclude('iframe').analyze()).violations
          .filter(v => v.impact === 'serious' || v.impact === 'critical')
        problems.push(...found.map(v => `${p.name} ${mode}: axe ${v.id} ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`))
        // At 390 px each primary button is 44 px tall.
        if (size.width === 390) {
          for (const b of await page.locator(PRIMARY).all()) {
            if (!(await b.isVisible())) continue
            const box = await b.boundingBox()
            if (box && box.height < 43.5) problems.push(`${p.name} ${mode}: a primary button is ${Math.round(box.height)} px tall (${(await b.innerText()).trim().slice(0, 30)})`)
          }
        }
        // No interface text holds an em dash (suite_copy checks the source, this reads what is drawn).
        const text = await page.evaluate(() => document.body.innerText)
        if (text.includes('—')) problems.push(`${p.name} ${mode}: an em dash is on the page`)
      }
      await ctx.close()
    }
    expect(problems).toEqual([])
  })

  test(t(73), async ({ browser }) => {
    test.setTimeout(120_000)
    // 1. The canary key set on the server reaches no response of any Phase 2 page, nor the document and job routes.
    const { ctx, page } = await open(browser, size, 'white', { roster: true })
    const bodies: string[] = []
    page.on('response', async r => {
      try { if (/text|json|javascript|css|xml|html/.test(r.headers()['content-type'] ?? '')) bodies.push(await r.text()) } catch { /* a body that is gone is not a leak */ }
    })
    await signIn(page, PEOPLE.planning)
    const job = await seedJ001(page, { ready: true, fresh: true })
    const p2 = await seedPhase2(page, job)
    const pages = await allPages()
    for (const p of pages) { await signIn(page, p.as); await page.goto('/'); await page.reload(); await p.show(page, { job, mode: 'white' }) }
    await signIn(page, PEOPLE.planning)
    for (const url of ['/api/session', `${job.api}/home`, `${job.api}/apps`, `${job.api}/clients`, `${job.api}/jobs`, `${job.api}/needs`, ...[job.brief, job.research, job.deck, ...p2.written].map(d => `/s/${d.token}/chain`)]) {
      bodies.push(await (await page.request.get(url)).text())
    }
    expect(bodies.length, 'the pages loaded their data').toBeGreaterThan(10)
    expect(bodies.filter(b => b.includes(CANARY))).toHaveLength(0)
    // 2. The run log shows no model event: the stand-in middleware logs the task of every request and nothing a model would add,
    //    and no fixture answer names a model.
    const log = await middlewareLog(page)
    expect(log.filter(e => 'model' in e), 'a model event in the run log').toEqual([])
    for (const task of answeredTasks()) {
      const result = (answerFor(task)?.result ?? {}) as { model?: unknown }
      expect(result.model ?? null, `the ${task} fixture names no model`).toBeNull()
    }
    // 3. No retrieval trace holds a hit from Cannes, Effie or WARC. The trace is the engine's (engine/rag/brief_context.py), run over
    //    stand-in rows (seed/j001/retrievalTrace.py): four rows tagged cannes, no corpus text, no model, no network.
    const dir = mkdtempSync(join(tmpdir(), 'j001-p2-trace-'))
    try {
      const brief = join(dir, 'brief.json')
      writeFileSync(brief, JSON.stringify(READY_BRIEF))
      const trace = (...extra: string[]) => JSON.parse(execFileSync('uv', [
        'run', '-q', '--no-project', '--python', '3.12', ...['numpy', 'requests', 'httpx', 'pypdf', 'pdfplumber', 'python-docx', 'PyYAML', 'python-dotenv'].flatMap(d => ['--with', d]),
        'python', join(HERE, 'seed/j001/retrievalTrace.py'), brief, ...extra,
      ], { cwd: join(HERE, '../../engine/rag'), encoding: 'utf8', env: { ...process.env, BRIEF_TESTS_OFFLINE: '1' } })) as { source_of: Record<string, Record<string, string>> }
      const served = (x: ReturnType<typeof trace>) => Object.values(x.source_of).flatMap(f => Object.values(f))
      const award = /^(cannes|effie|warc)$/i
      expect(served(trace()).filter(s => award.test(s))).toEqual([])
      expect(served(trace('--ignore-filter')).filter(s => award.test(s))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    await ctx.close()
  })
}
