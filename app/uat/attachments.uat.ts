// The attachment journeys (features/uat-loop.clan): the client's files going into Brief Maker
// and Research, and the agents reading them. Run by scripts/uat-round with journeys.uat.ts.
// The fixtures (uat/fixtures/, made by make.mjs) are synthetic: "Kestrel Oat", a made-up Irish
// oat drink. Each carries one fact, so a brief or report that repeats it proves the file was read.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { addClient, appFrame, BUDGET, driveRun, measure, newDocApp, openTool, signIn, stamp, TYPED } from './helpers'

const ACCOUNT = 'plu@pluto' as const
// This file's own client for the round. Not a prefix of journeys.uat.ts's client (its dial
// button is matched by a regex on the name), and created here: this file runs first.
const client = (process.env.UAT_CLIENT || `UAT ${stamp()}`).replace(/^UAT\b/, 'UAT files')
const STATE = process.env.UAT_STATE || ''
const readState = (): Record<string, string> => { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} } }
const keep = (k: string, v: string) => { if (STATE) writeFileSync(STATE, JSON.stringify({ ...readState(), [k]: v })) }

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const file = (name: string) => join(FIX, name)
const F = {
  call: 'kestrel-client-call.pdf',
  notes: 'kestrel-brand-notes.docx',
  shelf: 'kestrel-shelf.png',
  txt: 'kestrel-notes.txt',
  zip: 'kestrel-archive.zip',
  empty: 'empty.pdf',
  big: 'kestrel-big.pdf',
} as const

/** The brand is Kestrel Oat here, not the other suite's Oatly. */
const KESTREL: [RegExp, string][] = [[/brand/i, 'Kestrel Oat'], ...TYPED.filter(([re]) => !re.test('brand'))]

// In order on one worker (uat.config.ts), not 'serial': as in journeys.uat.ts, one failure
// (a finding) must not skip the journeys after it. Each journey stands alone, so `-g` runs one.

/** Signed in, with this file's client on the desk (made if a `-g` run starts here). */
async function ready(page: Page) {
  const tenant = await signIn(page, ACCOUNT)
  const r = await page.request.get(`/api/t/${tenant}/clients`)
  const body = await r.json() as { clients?: { name: string }[] } | { name: string }[]
  const list = Array.isArray(body) ? body : body.clients ?? []
  if (!list.some(c => c.name === client)) await addClient(page, client)
  return tenant
}

/** A new, empty brief, its notes box showing. */
async function newBrief(page: Page) {
  await ready(page)
  await openTool(page, client, 'Brief')
  return newDocApp(page, '+ New brief', 'open-new-brief', '#prompt')
}

/** Files into the brief's attach button; waits until each shows as a chip on the desk. */
async function attachToBrief(app: FrameLocator, names: string[], onDesk = names) {
  await app.locator('#addAny').setInputFiles(names.map(file))
  for (const n of onDesk) {
    await expect(app.locator('#chips .chip').filter({ hasText: n }), `${n} shows on the desk once added`).toBeVisible({ timeout: 60_000 })
  }
  await expect(app.locator('#intakeStatus'), 'the box stops saying "Adding…" once the files are in').not.toContainText('Adding', { timeout: 60_000 })
}

/** Write the brief and answer the agents until the finished brief shows. */
async function writeBrief(page: Page, app: FrameLocator, label: string) {
  const t0 = Date.now()
  await app.locator('#genBtn').click()
  await expect(app.getByText(/Step [1-4] of 4/).first(), 'the agents start on the brief').toBeVisible({ timeout: 60_000 })
  const sheet = app.locator('#sheet')
  const questions = await driveRun(page, app, sheet, BUDGET.research, KESTREL)
  await expect(sheet, 'the finished brief shows within budget').toBeVisible({ timeout: 1_000 })
  measure(label, Date.now() - t0, BUDGET.research, { questions })
  return sheet
}

test('a brief from the client\'s files alone, no words (paid)', async ({ page }) => {
  const app = await newBrief(page)
  await attachToBrief(app, [F.call, F.notes])
  await expect(app.locator('#chips .chip'), 'both files are on the desk').toHaveCount(2)
  const sheet = await writeBrief(page, app, 'brief-from-files')
  const text = await sheet.innerText()
  expect(text, 'the brief carries a fact only the call-notes PDF holds (launch 14 March 2027, or €420,000)').toMatch(/14 March|March 14|420,?000|420k|€420/i)
  expect(text, 'the brief carries a fact only the brand-notes DOCX holds (night-shift nurses, or "dry wit, never smug")').toMatch(/night[- ]shift nurses|dry wit|never smug/i)
  keep('briefFilesUrl', page.url())
})

test('a brief from words, a picture, a text file and an unreadable file (paid)', async ({ page }) => {
  const app = await newBrief(page)
  await app.locator('#prompt').fill('Kestrel Oat, an Irish oat drink: a brief for a spring retail push. Use what is in the files.')
  // The zip is kept with the brief, and the person is told the agents can't read it.
  await attachToBrief(app, [F.shelf, F.txt, F.zip], [F.shelf, F.txt])
  // Owner, 2026-11-12: told when it is added, before a run is paid for, in the line under the notes.
  const NAMED = /kestrel-archive|\.zip\b|archive/i
  const CANT = /could ?n[o’']t (be )?(read|open)|can[’']?not (be )?(read|open)|can[’']t (read|open)|unable to (read|open)|not (been )?read|unread|unsupported|not supported/i
  await expect(app.locator('#intakeStatus'), 'an unreadable file is reported to the person when they add it').toHaveText(NAMED, { timeout: 15_000 })
  const told = await app.locator('#intakeStatus').innerText()
  measure('unreadable-file-told', 0, undefined, { lines: [told] })
  expect(CANT.test(told), `the note says the agents can't read it: "${told}"`).toBe(true)
  const sheet = await writeBrief(page, app, 'brief-from-mixed-files')
  const text = await sheet.innerText()
  expect(text, 'the brief carries a fact from the picture (Dunnes Stores, Cork) or the text file (Glenmore Oat)').toMatch(/Dunnes|Cork|Glenmore/i)
})

test('a bad file never leaves the box stuck', async ({ page }) => {
  const app = await newBrief(page)
  const status = app.locator('#intakeStatus')
  const t0 = Date.now()
  await app.locator('#addAny').setInputFiles(file(F.empty))
  await expect(status, 'within 15 s of adding an empty file, the box no longer says "Adding…"').not.toContainText('Adding', { timeout: 15_000 })
  measure('bad-file-settles', Date.now() - t0, 15_000)
  // Either it is on the desk, or the person is told why not.
  const chip = app.locator('#chips .chip').filter({ hasText: F.empty })
  const told = app.locator('#intakeStatus:not(:empty), [role="alert"]').filter({ hasText: /\S/ })
  await expect(chip.or(told).first(), 'an empty file is either on the desk or the person is told it could not be added; it is never dropped silently').toBeVisible({ timeout: 2_000 })
})

test('Write the brief waits while files are still uploading', async ({ page }) => {
  const app = await newBrief(page)
  // A slow line (about 400 KB/s up) so the 4 MB upload takes long enough to look at.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 50, downloadThroughput: -1, uploadThroughput: 400 * 1024 })
  try {
    await app.locator('#addAny').setInputFiles(file(F.big))
    const status = app.locator('#intakeStatus')
    await expect(status, 'the box says it is adding the file').toContainText('Adding', { timeout: 5_000 })
    // Read both at once: is the file still on its way, and can a draft start?
    const now = await app.locator('#genBtn').evaluate((b: HTMLButtonElement) => ({
      disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
      adding: /Adding/.test(document.getElementById('intakeStatus')?.textContent || ''),
    }))
    expect(now.adding, 'still uploading when the button is looked at (the slow line held)').toBe(true)
    // Never clicked: a click would start a paid draft.
    expect(now.disabled, 'Write the brief can start a draft before the files finish uploading').toBe(true)
  } finally {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {})
  }
  await expect(app.locator('#chips .chip').filter({ hasText: F.big }), 'the big file lands on the desk once uploaded').toBeVisible({ timeout: 60_000 })
  await expect(app.locator('#genBtn'), 'Write the brief is offered again once the files are in').toBeEnabled()
})

test('Research reads an attached file (paid)', async ({ page }) => {
  await ready(page)
  await openTool(page, client, 'Research')
  const app = await newDocApp(page, '+ New research question', 'open-new-research', '#cmp-prompt')
  await app.locator('#cmp-prompt').fill('Kestrel Oat, an Irish oat drink: how big is the oat drink market in Ireland, and where does Kestrel Oat stand in it? The client\'s call notes are attached.')
  await app.locator('#cmp-file').setInputFiles(file(F.call))
  await expect(app.locator('.rt-files .att').filter({ hasText: F.call }), 'the attached file shows by the ask before sending').toBeVisible()
  const run0 = Date.now()
  await app.locator('[data-act="cmp-send"]').click()
  const report = app.locator('.rp-band')
  const questions = await driveRun(page, app, report, BUDGET.research, KESTREL)
  await expect(report, 'the report shows within budget').toBeVisible({ timeout: 1_000 })
  measure('research-from-file', Date.now() - run0, BUDGET.research, { questions })
  const shown = await app.locator('body').innerText()
  expect(shown, 'the report names the attached file among what it read, or quotes its fact (1.2 million litres)').toMatch(/kestrel-client-call|1\.2 ?(million|m) litres/i)
})

test('a brief\'s files are still there after leaving and coming back', async ({ page }) => {
  const url = process.env.UAT_BRIEF_FILES_URL || readState().briefFilesUrl || ''
  test.skip(!url, 'needs the brief written from files above')
  await signIn(page, ACCOUNT)
  await page.goto('/')
  const t0 = Date.now()
  await page.goto(url)
  // The finished brief (#briefView); the intake's #prompt is in the page too, hidden, and came first (round 7).
  const app = await appFrame(page, t0, 'reopen-brief-from-files', '#briefView')
  for (const n of [F.call, F.notes]) {
    await expect(app.locator('#chips .chip, #boards .board').filter({ hasText: n }).first(), `${n} is still among the brief's files on coming back`).toBeAttached({ timeout: BUDGET.docOpen })
  }
})

test('tidy: the attachment journeys archive their own client (it can be restored)', async ({ page }) => {
  const tenant = await signIn(page, ACCOUNT)
  const r = await page.request.get(`/api/t/${tenant}/clients`)
  expect(r.status()).toBe(200)
  const body = await r.json() as { clients?: { id: string; name: string }[] } | { id: string; name: string }[]
  const list = Array.isArray(body) ? body : body.clients ?? []
  const mine = list.filter(c => c.name === client)
  for (const c of mine) expect((await page.request.post(`/api/t/${tenant}/clients/${c.id}/archive`)).status()).toBe(200)
  measure('tidy-files', 0, undefined, { archived: mine.length })
})
