// The client-review journey (features/uat-loop.clan): a finished brief is settled, locked, sent as
// the client copy, answered by the client, and reopened for the change they asked for.
//
// How client review works in the code (read before writing this; not guessed):
// - Needs you (#lockList, "Needs you · n") is the host's lock list (GET /decisions `attention` with
//   blocks_lock) plus the open questions nobody has answered. A row selects its part; the part view's
//   Your call settles it: an open question by Yes / No / Answer…, a Review agent "no" by
//   "Keep it as it is, and say why" (POST /verdict, polarity good). Lock the brief (#lockBtn) waits on
//   the host's can_lock and says "Settle n first" (#lockWhy).
// - Lock is POST /approve (os-layer §7.1): "Locked for handoff · v1" (#lockedBadge), Unlock and
//   Reopen a part… in the OS bar, every part's Edit gone (a part shows "Reopen this part…").
// - There is no client link and no client account: a client is data, never an actor (os-layer §7.5
//   item 5). What the client gets is the client copy, a PDF from the brief's "Client copy · PDF"
//   (the document menu, and Share's "Send the client copy" on a locked brief): the whole locked
//   sheet. Confidential keeps a part from Napkin's systems, never from the client (owner,
//   2026-11-13), so the client copy prints the confidential part too.
// - The client's answer is recorded by the agency person it reached (POST /client-review): the
//   brief's "Record the client's answer" (#crOpen) or the OS bar's Client review. The shell shows it
//   above the brief (section.cr-band); a part the client said no to is offered under Reopen a part…
//   (POST /client-review/reopen), which opens that one part for an edit with a reason, and the
//   brief locks again with "Lock the brief again".

import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type FrameLocator, type Page } from '@playwright/test'
import { addClient, appFrame, BUDGET, driveRun, measure, newDocApp, openTool, signIn, stamp } from './helpers'

const ACCOUNT = 'plu@pluto' as const
// This file's own client for the round; not a prefix of the other files' clients (the dial is matched by a regex on the name).
const client = (process.env.UAT_CLIENT || `UAT ${stamp()}`).replace(/^UAT\b/, 'UAT review')
const STATE = process.env.UAT_STATE || ''
const readState = (): Record<string, string> => { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} } }
const keep = (k: string, v: string) => { if (STATE) writeFileSync(STATE, JSON.stringify({ ...readState(), [k]: v })) }
const got = (k: string) => readState()[k] || ''

const SMP = 'Single-minded proposition'
/** The client, as the agency person types them: data on the record, not an account. */
const CLIENT_NAME = 'Jane Murphy'
const CLIENT_SAID = 'The proposition does not feel like us: too playful for the barista range. Can it be about the coffee first?'

// In order on one worker (uat.config.ts), not 'serial': one failure (a finding) must not skip the rest.

async function ready(page: Page) {
  const tenant = await signIn(page, ACCOUNT)
  const r = await page.request.get(`/api/t/${tenant}/clients`)
  const body = await r.json() as { clients?: { name: string }[] } | { name: string }[]
  const list = Array.isArray(body) ? body : body.clients ?? []
  if (!list.some(c => c.name === client)) await addClient(page, client)
  return tenant
}

/** The finished brief of this round, open, with the host's lock state read. */
async function openBrief(page: Page, label: string) {
  const url = process.env.UAT_REVIEW_URL || got('reviewUrl')
  test.skip(!url, 'needs the brief written at the start of this file')
  await signIn(page, ACCOUNT)
  const t0 = Date.now()
  await page.goto(url)
  const app = await appFrame(page, t0, label, '#briefView')
  // The lock slot is drawn from the host's /decisions, read after the page: the button is on in the
  // page as served, so wait until the slot has held still for 3 s before reading it.
  const sig = () => app.locator('#briefView').evaluate(() => ['lockBtn', 'lockWhy', 'lockedBadge', 'lockList'].map(id => {
    const e = document.getElementById(id) as HTMLButtonElement | null
    return e ? `${e.hidden}|${e.disabled}|${e.textContent}` : '-'
  }).join('#')).catch(() => '')
  let last = await sig(), since = Date.now()
  const until = Date.now() + 30_000
  while (Date.now() - since < 3_000 && Date.now() < until) {
    await page.waitForTimeout(500)
    const now = await sig()
    if (now !== last) { last = now; since = Date.now() }
  }
  measure(`${label}-settled`, Date.now() - t0, BUDGET.docOpen + 3_000)
  return app
}

/** "Needs you · n" as the brief shows it; 0 when the list is gone. */
async function needsCount(app: FrameLocator) {
  const h = app.locator('#lockList:not([hidden]) .b-gate-h')
  if (!await h.isVisible().catch(() => false)) return 0
  return Number((/·\s*(\d+)/.exec(await h.innerText()) || [])[1] ?? NaN)
}

/** What is left to settle: one per Needs you row, except the open questions' row, which counts each question
 *  ("Open questions · 8 open questions" is eight to answer; round 10: answering one leaves the row). */
async function needsLeft(app: FrameLocator) {
  if (!await needsCount(app)) return 0
  const rows = await app.locator('#lockList:not([hidden]) .lkitem').allInnerTexts()
  return rows.reduce((n, t) => n + (Number((/(\d+)\s+open questions/i.exec(t) || [])[1]) || 1), 0)
}

/** A part of the sheet, by the heading it carries (Single-minded proposition, Budget & scope). */
const partRow = (app: FrameLocator, head: string) =>
  app.locator('#fields .row').filter({ has: app.locator('.lab > span:first-child', { hasText: new RegExp(`^${head.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}$`) }) }).first()

/** The audience part, by whichever heading this brief carries (round 12: "Who we are talking to", not "Audience"). */
async function audienceHead(app: FrameLocator) {
  for (const h of ['Audience', 'Who we are talking to', 'The audience']) {
    if (await partRow(app, h).isVisible().catch(() => false)) return h
  }
  throw new Error('no audience part on this brief (looked for Audience, Who we are talking to)')
}

async function selectPart(app: FrameLocator, head: string) {
  await partRow(app, head).locator('.lab > span:first-child').click()
  await expect(app.locator('#selPart'), `selecting ${head} shows its part view`).toBeVisible()
}

async function backToBrief(app: FrameLocator, page: Page) {
  const back = app.locator('#selPart [data-sp="back"]').first()
  if (await back.isVisible().catch(() => false)) await back.click()
  else await page.keyboard.press('Escape')
  await expect(app.locator('#briefView'), 'back from a part, the brief view shows').toBeVisible()
}

/** Settle the first Needs you row with the part's own controls. Returns what was done, in words. */
async function settleFirst(app: FrameLocator, page: Page) {
  const row = app.locator('#lockList .lkitem').first()
  const what = (await row.innerText()).replace(/\s+/g, ' ').trim()
  await row.click()
  const part = app.locator('#selPart')
  const yes = part.locator('.nb-act button[data-v="Yes"]').first()
  const keepIt = part.locator('.act-override').first()
  // An item that is not a part of this brief (a finding or fact carried from research) opens in the fields panel.
  const looks = app.locator('[data-clf="ack"], [data-clf="good"]').first()
  const shown = await yes.or(keepIt).or(looks).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
  if (!shown) throw new Error(`Needs you row "${what}" opened nothing a person can settle it with`)
  if (await yes.isVisible()) {
    await yes.click()
    await backToBrief(app, page)
    return `${what}: answered Yes`
  }
  if (await keepIt.isVisible()) {
    await keepIt.click()
    await part.locator('.ovr textarea.rat').fill('Checked against the client call: this is what they asked for.')
    await part.locator('.ovr .save').click()
    await expect(part.locator('.ovr .err'), 'keeping a part with a reason is accepted').toBeHidden({ timeout: 15_000 })
    await backToBrief(app, page)
    return `${what}: kept with a reason`
  }
  await looks.click()
  await page.keyboard.press('Escape')
  await backToBrief(app, page)
  return `${what}: looks right`
}

test('review: a finished brief to review (paid)', async ({ page }) => {
  await ready(page)
  await openTool(page, client, 'Brief')
  const app = await newDocApp(page, '+ New brief', 'open-new-brief', '#prompt')
  await app.locator('#prompt').fill('Client call, oat drinks, Ireland: spring campaign to win lapsed buyers back to the barista range. Urban coffee drinkers 25-40. Social and out-of-home, Dublin and Cork. Playful, no knocking dairy. Budget €300k. March launch, judged on repeat purchase.')
  const t0 = Date.now()
  await app.locator('#genBtn').click()
  const sheet = app.locator('#sheet')
  const questions = await driveRun(page, app, sheet, BUDGET.research)
  await expect(sheet, 'the finished brief shows within budget').toBeVisible({ timeout: 1_000 })
  measure('review-brief', Date.now() - t0, BUDGET.research, { questions })
  keep('reviewUrl', page.url())
})

test('review: Needs you is settled part by part, and only then can the brief lock', async ({ page }) => {
  const app = await openBrief(page, 'open-review-brief')
  const lock = app.locator('#lockBtn')
  const done: string[] = []
  // Round 11: Needs you first showed only the open questions; the host's lock list (Review agent items) arrived
  // seconds later. Count once it holds steady for 3 s.
  let prev = -1, still = 0
  for (let i = 0; i < 20 && still < 2; i++) {
    const now = await needsLeft(app)
    still = now === prev ? still + 1 : 0
    prev = now
    if (still < 2) await page.waitForTimeout(1500)
  }
  let n = await needsCount(app)
  measure('needs-you', 0, undefined, { count: n, items: prev })
  for (let round = 0; n > 0 && round < 40; round++) {
    expect.soft(await lock.isDisabled(), `Lock the brief stays off while Needs you holds ${n}`).toBe(true)
    if (await lock.isDisabled()) {
      await expect.soft(app.locator('#lockWhy'), 'the lock says why it waits').toHaveText(/Settle \d+ first|has to be settled first/)
    }
    const t0 = Date.now()
    const before = await needsLeft(app) || n
    done.push(await settleFirst(app, page))
    await expect.poll(() => needsLeft(app), { timeout: 60_000, message: `settling "${done[done.length - 1]}" takes one off what Needs you holds (was ${before})` }).toBeLessThan(before)
    n = await needsCount(app)
    measure('settle-needs-item', Date.now() - t0, 15_000, { item: done[done.length - 1], left: n })
  }
  expect(n, 'every Needs you item can be settled at its part').toBe(0)
  await expect(app.locator('#lockList'), 'with nothing left, Needs you is gone').toBeHidden()
  await expect(lock, 'with nothing left in Needs you, Lock the brief turns on').toBeEnabled({ timeout: 30_000 })
  await expect(lock).toHaveText('Lock the brief')
  measure('needs-you-settled', 0, undefined, { settled: done.length, items: done })
})

test('review: lock: the brief says it is locked and its parts cannot be edited', async ({ page }) => {
  const app = await openBrief(page, 'open-review-brief')
  // One part confidential before the lock, so the client copy can be checked for keeping it.
  for (const head of ['Budget & scope', 'Mandatories', 'Competitor context']) {
    const val = partRow(app, head).locator('.val:not(.empty)')
    if (!await val.isVisible().catch(() => false)) continue
    keep('confHead', head)
    keep('confText', (await val.innerText()).trim().slice(0, 40))
    await selectPart(app, head)
    await app.locator('#selPart [data-sp="conf"]').click()
    await expect(app.locator('#selPart [data-sp="conf"]'), `${head} is marked Confidential`).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
    await backToBrief(app, page)
    break
  }
  keep('smpText', (await partRow(app, SMP).locator('.val').innerText()).trim().slice(0, 40))

  const lock = app.locator('#lockBtn')
  await expect(lock, 'Lock the brief is on once Needs you is settled').toBeEnabled({ timeout: 30_000 })
  const t0 = Date.now()
  await lock.click()
  const badge = app.locator('#lockedBadge')
  await expect(badge, 'a locked brief says so: "Locked for handoff"').toBeVisible({ timeout: 30_000 })
  measure('lock', Date.now() - t0, 10_000)
  await expect(badge, 'the lock names the version it locked').toHaveText(/Locked for handoff · v\d+/)
  await expect(lock, 'Lock the brief is gone once it is locked (Unlock is the OS bar\'s)').toBeHidden()
  await expect(app.locator('#stateLine'), 'the state line says who locked it').toContainText(/locked by/)
  const bar = page.getByTestId('os-bar')
  await expect(bar.getByRole('button', { name: 'Unlock' }), 'the OS bar offers Unlock on a locked brief').toBeVisible()
  await expect(bar.getByRole('button', { name: /^(Client review|New client answer)$/ }), 'the OS bar offers Client review on a locked brief').toBeVisible()

  // No part can be edited: the part view offers "Reopen this part…" in place of Edit and Redraft.
  const AUD = await audienceHead(app)
  await selectPart(app, AUD)
  await expect(app.locator('#selPart [data-sp="reopen"]'), 'a locked part offers only Reopen this part…').toBeVisible()
  await expect(app.locator('#selPart [data-sp="edit"]'), 'a locked part has no Edit').toHaveCount(0)
  await expect(app.locator('#selPart [data-sp="regen"]'), 'a locked part has no Redraft').toHaveCount(0)
  await partRow(app, AUD).locator('.val').dblclick()
  await page.waitForTimeout(1_000)
  await expect(app.locator('#fields .ined'), 'a double-click does not open the editor on a locked part').toHaveCount(0)
  await backToBrief(app, page)

  // The lock is the document's, not the page's: it is there on opening the brief again.
  const t1 = Date.now()
  await page.goto('/')
  await page.goto(got('reviewUrl'))
  const again = await appFrame(page, t1, 'reopen-locked-brief', '#briefView')
  await expect(again.locator('#lockedBadge'), 'the brief is still locked when opened again').toBeVisible({ timeout: 30_000 })
})

test('review: the client copy leaves out the agency\'s chrome and keeps the confidential part', async ({ page, browser }) => {
  const app = await openBrief(page, 'open-review-brief')
  await expect(app.locator('#lockedBadge'), 'the client copy is made from the locked brief').toBeVisible({ timeout: 30_000 })

  // The brief's own client copy is in the document menu: "Client copy · PDF".
  await page.getByTestId('doc-name').click()
  await expect(page.getByRole('menuitem', { name: /^Client copy · PDF/ }), 'a locked brief offers its client copy in the document menu').toBeVisible()
  await page.keyboard.press('Escape')

  // Share, as a person would look for it: "Send the client copy" runs that same export.
  await page.locator('[data-p36-share]').click()
  const send = page.getByTestId('share-menu').getByRole('menuitem', { name: /Send the client copy/ })
  await expect(send, 'Share lists the client copy').toBeVisible()
  const sendOff = await send.getAttribute('aria-disabled')
  measure('share-client-copy', 0, undefined, { disabled: sendOff === 'true', says: (await send.innerText()).replace(/\s+/g, ' ') })
  expect(sendOff, 'on a locked brief, Share offers "Send the client copy"').not.toBe('true')
  const t0 = Date.now()
  const pushed = page.waitForRequest(r => r.method() === 'POST' && /\/export$/.test(new URL(r.url()).pathname), { timeout: 60_000 })
  const download = page.waitForEvent('download', { timeout: 90_000 })
  await send.click()
  const req = await pushed.catch(async () => { throw new Error('no client copy was made; the brief said: ' + await app.locator('#toast').textContent()) })
  const sent = req.postDataJSON() as { kind: string; filename: string; html: string }
  const file = await download
  measure('client-copy', Date.now() - t0, 30_000, { file: file.suggestedFilename() })
  expect(sent.kind, 'the client copy is a PDF').toBe('pdf')
  expect(file.suggestedFilename(), 'the client copy downloads as <brief>-client-copy.pdf').toMatch(/-client-copy\.pdf$/)
  const path = await file.path()
  expect(readFileSync(path).subarray(0, 5).toString(), 'the client copy is a real PDF').toBe('%PDF-')

  // The client has no account: the copy is opened in a fresh browser, signed in as nobody.
  const ctx = await browser.newContext()
  try {
    const p = await ctx.newPage()
    await p.setContent(sent.html, { waitUntil: 'domcontentloaded' })
    const text = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
    const smp = got('smpText').replace(/\s+/g, ' ')
    measure('client-copy-read', 0, undefined, { chars: text.length })
    expect(text, 'the client copy says it is the client copy').toMatch(/client copy/i)
    if (smp) expect(text, 'the client sees the locked proposition').toContain(smp.slice(0, 25))
    for (const chrome of ['Needs you', 'Lock the brief', 'Your call', 'Reopen', 'Record the client', 'Redraft', 'Unlock']) {
      expect.soft(text, `the client copy carries none of the agency's controls ("${chrome}")`).not.toContain(chrome)
    }
    const confHead = got('confHead'), confText = got('confText').replace(/\s+/g, ' ')
    if (confHead) {
      // Confidential means Napkin never learns from it; the client gave it, and sees it.
      expect(text, `the part marked Confidential (${confHead}) is in the client copy`).toContain(confText.slice(0, 25))
      expect.soft(text, 'nothing in the client copy is labelled Confidential').not.toMatch(/\bConfidential\b/)
    }
  } finally {
    await ctx.close()
  }
})

test('review: the client\'s answer is recorded on the locked brief', async ({ page }) => {
  // The client is not a user (os-layer §7.5 item 5): the agency person their answer reached records it.
  const app = await openBrief(page, 'open-review-brief')
  await expect(app.locator('#lockedBadge'), 'a client answers the locked version').toBeVisible({ timeout: 30_000 })
  await app.locator('#crOpen').click()
  const form = app.locator('#clientAnswer')
  await expect(form, 'Record the client\'s answer opens its form').toBeVisible()
  await form.locator('input[name="crv"][value="rejected"]').check()
  await form.locator('input[name="crr"][value="tone"]').check()
  await form.locator('input[name="crp"][value="single_minded_proposition"]').check()
  await form.locator('textarea[name="said"]').fill(CLIENT_SAID)
  await form.locator('input[name="crcall"]').check()
  await form.locator('input[name="who"]').fill(CLIENT_NAME)
  const t0 = Date.now()
  await form.locator('[data-cr="save"]').click()
  await expect(form, 'the form closes once the answer is saved').toBeHidden({ timeout: 30_000 })
  measure('record-client-answer', Date.now() - t0, 10_000)
  await expect(form.locator('.cr-err')).toHaveCount(0)
})

test('review: back at the agency, the answer is on the brief and the part reopens for the change', async ({ page }) => {
  const app = await openBrief(page, 'open-review-brief')
  // Above the brief: the client's answer, who, why.
  const band = page.locator('section.cr-band')
  const t0 = Date.now()
  await expect(band, 'the client\'s answer shows above the locked brief').toBeVisible({ timeout: 30_000 })
  measure('client-answer-shown', Date.now() - t0, BUDGET.docOpen)
  await expect(band, 'the band says the client rejected it').toContainText(/Client rejected/)
  await expect(band, 'the band names the client').toContainText(CLIENT_NAME)
  await expect(band, 'the band gives the client\'s reason').toContainText(/tone/i)
  await expect(page.getByTestId('os-bar').getByRole('button', { name: 'New client answer' }), 'once the client has answered, the OS bar offers a new client answer').toBeVisible()

  // The part they said no to is offered for reopening, and only that part opens.
  await app.locator('#reopenBtn').click()
  const offer = app.locator('#reopenList .lkitem').filter({ hasText: SMP })
  await expect(offer, `Reopen a part… offers ${SMP}, the part the client said no to`).toBeVisible({ timeout: 15_000 })
  await expect(offer, 'the reopen says the client said no').toContainText('The client said no')
  const t1 = Date.now()
  await offer.click()
  const again = app.locator('#lockBtn')
  await expect(again, 'with a part reopened, the brief offers Lock the brief again').toHaveText('Lock the brief again', { timeout: 30_000 })
  await expect(again).toBeVisible()
  measure('reopen-part', Date.now() - t1, 10_000)
  await expect(app.locator('#lockedBadge'), 'a brief with a part reopened is no longer shown as locked for handoff').toBeHidden()

  // The reopened part can be edited, with the reason needed; the rest stays locked.
  await selectPart(app, SMP)
  await expect(app.locator('#selPart'), 'the reopened part says it is open for the client\'s change').toContainText('Open for the client’s change')
  const edit = app.locator('#selPart [data-sp="edit"]')
  await expect(edit, 'the reopened part can be edited again').toBeVisible()
  await edit.click()
  await expect(app.locator('#fields .ined'), 'Edit opens the editor on the reopened part').toBeVisible()
  await expect(app.locator('#spRat'), 'a change to a reopened part asks why').toBeVisible()
  await app.locator('#selPart [data-sp="cancel"]').click()
  await backToBrief(app, page)
  const AUD = await audienceHead(app)
  await selectPart(app, AUD)
  await expect(app.locator('#selPart [data-sp="edit"]'), 'every other part stays locked').toHaveCount(0)
  await expect(app.locator('#selPart [data-sp="reopen"]')).toBeVisible()
})

test('tidy: the review journey archives its own client (it can be restored)', async ({ page }) => {
  const tenant = await signIn(page, ACCOUNT)
  const r = await page.request.get(`/api/t/${tenant}/clients`)
  expect(r.status()).toBe(200)
  const body = await r.json() as { clients?: { id: string; name: string }[] } | { id: string; name: string }[]
  const list = Array.isArray(body) ? body : body.clients ?? []
  const mine = list.filter(c => c.name === client)
  for (const c of mine) expect((await page.request.post(`/api/t/${tenant}/clients/${c.id}/archive`)).status()).toBe(200)
  measure('tidy-review', 0, undefined, { archived: mine.length })
})
