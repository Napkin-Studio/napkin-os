// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The brand question and its background build (features/brand-clan.clan, lane B; mocks a1, a2): the flow with its ports replaced by
// recorded replies of the two middleware tasks. No network, no model.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BrandError, BrandFlow, fileFrom, takesBrandFiles, words,
  type BuildAnswer, type ClanRef, type Identified, type JobView, type Ports, type Question, type Store,
} from '../src/shell/brand/brandFlow.ts'
import { unwrap } from '../src/shell/brand/proxyReply.ts'

const CLIENT = { id: 'tidewell', name: 'Tidewell' }
const FILE = { name: 'document-173-0.pdf', label: 'Tidewell-brand-book-2026.pdf' }
const ORIGINAL: ClanRef = { document_id: 'bc-1', path: 'a/original.clan', name: 'Original', default: true }
const ZERO: ClanRef = { document_id: 'bc-2', path: 'a/zero.clan', name: 'Zero', default: false }
const Q_CHOOSE: Question = { mode: 'choose', options: ['update', 'new', 'not_bible'], update: { document_id: 'bc-1', name: 'Original' }, pages: 48, over_cap: false, page_cap: 120 }
const Q_NEW: Question = { mode: 'new', options: ['build', 'not_bible'], update: null, pages: 48, over_cap: false, page_cap: 120 }
const yes = (question: Question): Identified => ({ ask: true, reason: null, question, pages: question.pages })
const no = (reason: string): Identified => ({ ask: false, reason, question: null, pages: 3 })
const done = (over: Partial<JobView['result']> = {}): JobView => ({ state: 'done', error: null, result: { summary: 's', mode: 'update', name: 'Original', pending: true, path: 'a/original.clan', gaps: [], ...over } })

function memory(): Store & { m: Map<string, string> } {
  const m = new Map<string, string>()
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: k => { m.delete(k) }, get length() { return m.size }, key: i => [...m.keys()][i] ?? null }
}

interface Calls { identify: unknown[]; build: { answer: BuildAnswer }[]; status: string[] }
function ports(over: Partial<Ports> & { clans?: ClanRef[]; ident?: Identified | Error; statuses?: (JobView | Error)[]; buildErr?: Error } = {}): Ports & { calls: Calls } {
  const calls: Calls = { identify: [], build: [], status: [] }
  const statuses = [...(over.statuses ?? [done()])]
  return {
    calls,
    clans: async () => over.clans ?? [],
    identify: async (f, c, clans) => { calls.identify.push({ f, c, clans }); const r = over.ident ?? yes(Q_NEW); if (r instanceof Error) throw r; return r },
    build: async (f, c, answer) => { calls.build.push({ answer }); if (over.buildErr) throw over.buildErr; return { job: 'job_1' } },
    status: async job => { calls.status.push(job); const s = statuses.length > 1 ? statuses.shift()! : statuses[0]; if (s instanceof Error) throw s; return s },
    sleep: async () => {},
  } as Ports & { calls: Calls }
}
const flowOf = (p: Ports, store: Store | null = null) => new BrandFlow(p, { client: CLIENT, doc: 'brief-1', store, pollMs: 0 })
const phase = (f: BrandFlow, id = FILE.name) => f.snapshot().find(e => e.id === id)?.phase

test('a message from an app is a file only when it says so, and carries the persons name for it', () => {
  assert.deepEqual(fileFrom({ type: 'clan:file-added', name: 'document-1.pdf', label: 'Book.pdf' }), { name: 'document-1.pdf', label: 'Book.pdf' })
  assert.deepEqual(fileFrom({ type: 'clan:file-added', name: 'document-1.pdf' }), { name: 'document-1.pdf', label: 'document-1.pdf' })
  for (const bad of [null, {}, { type: 'clan:file-added' }, { type: 'clan:file-added', name: '' }, { type: 'clan:file-added', name: 'a/b.pdf' }, { type: 'other', name: 'a.pdf' }, 'x']) assert.equal(fileFrom(bad), null)
})

test('only Brief Maker, Research and Production take files that may be a brand bible', () => {
  assert.equal(takesBrandFiles('ie.napkin.brief-maker'), true)
  assert.equal(takesBrandFiles('ie.napkin.campaign-research'), true)
  assert.equal(takesBrandFiles('ie.napkin.production'), true)
  assert.equal(takesBrandFiles('ie.napkin.deck-maker'), false)
  assert.equal(takesBrandFiles(undefined), false)
})

test('a brand book asks once, with the clans the client has and the file named as the person named it', async () => {
  const p = ports({ clans: [ORIGINAL, ZERO], ident: yes(Q_CHOOSE) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  const ph = phase(f)
  assert.equal(ph?.kind, 'ask')
  assert.equal(f.snapshot()[0].label, 'Tidewell-brand-book-2026.pdf')
  assert.deepEqual((p.calls.identify[0] as { clans: ClanRef[] }).clans.map(c => c.name), ['Original', 'Zero'])
  await f.fileAdded(FILE)                                  // the same file again: not asked twice
  assert.equal(p.calls.identify.length, 1)
})

test('a file that is not a brand bible shows nothing at all', async () => {
  for (const reason of ['not_a_bible_by_rules', 'not_a_bible']) {
    const f = flowOf(ports({ ident: no(reason) }))
    await f.fileAdded(FILE)
    assert.deepEqual(f.snapshot(), [])
  }
})

test('detection that fails or times out asks nothing and leaves the small Build a Brand Clan action', async () => {
  for (const ident of [no('detection_failed'), new Error('timeout')]) {
    const f = flowOf(ports({ ident }))
    await f.fileAdded(FILE)
    assert.equal(phase(f)?.kind, 'offer')
  }
  const p = ports({ ident: new Error('down'), clans: [ORIGINAL] })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.offerBuild(FILE.name)
  const ph = phase(f)
  assert.equal(ph?.kind, 'ask')
  assert.equal(ph?.kind === 'ask' && ph.question.update?.name, 'Original')
  assert.equal(p.calls.identify.length, 1, 'the action asks the question without another model call')
})

test('Update starts a background build on the clan and the person carries on', async () => {
  const p = ports({ clans: [ORIGINAL, ZERO], ident: yes(Q_CHOOSE) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'update')
  assert.deepEqual(p.calls.build[0].answer, { mode: 'update', clan: { document_id: 'bc-1', path: 'a/original.clan', name: 'Original' }, confirmed: false })
  const ph = phase(f)
  assert.equal(ph?.kind, 'done')
  assert.equal(ph?.kind === 'done' && ph.result.pending, true)
})

test('the preselected clan is the one asked about, even when it is not the default', async () => {
  const q: Question = { ...Q_CHOOSE, update: { document_id: 'bc-2', name: 'Zero' } }
  const p = ports({ clans: [ORIGINAL, ZERO], ident: yes(q) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'update')
  assert.equal((p.calls.build[0].answer as { clan: { name: string } }).clan.name, 'Zero')
})

test('Make a new Brand Clan asks for its name first, and nothing is built until it is given', async () => {
  const p = ports({ clans: [ORIGINAL], ident: yes(Q_CHOOSE) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'new')
  assert.equal(phase(f)?.kind, 'naming')
  assert.equal(p.calls.build.length, 0)
  await f.make(FILE.name, '   ')
  assert.equal(p.calls.build.length, 0, 'an empty name builds nothing')
  await f.make(FILE.name, 'x'.repeat(61))
  assert.equal(p.calls.build.length, 0, 'a name over 60 characters builds nothing')
  await f.make(FILE.name, ' Summer 26 ')
  assert.deepEqual(p.calls.build[0].answer, { mode: 'new', name: 'Summer 26', confirmed: false })
})

test('a client with no Brand Clan is offered Build, which makes Original', async () => {
  const p = ports({ ident: yes(Q_NEW) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  assert.deepEqual(p.calls.build[0].answer, { mode: 'new', name: 'Original', confirmed: false })
})

test('Not a brand bible makes the card go and builds nothing', async () => {
  const p = ports({ ident: yes(Q_NEW) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'not_bible')
  assert.deepEqual(f.snapshot(), [])
  assert.equal(p.calls.build.length, 0)
})

test('the build is a background job: working while it runs, done when it ends, polled by its id', async () => {
  const running: JobView = { state: 'running', error: null, result: null }
  const p = ports({ ident: yes(Q_NEW), statuses: [running, running, done({ mode: 'new', pending: false })] })
  const f = flowOf(p)
  const seen: string[] = []
  f.subscribe(() => seen.push(f.snapshot()[0]?.phase.kind ?? '-'))
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  assert.deepEqual(p.calls.status, ['job_1', 'job_1', 'job_1'])
  assert.ok(seen.includes('working') && seen.at(-1) === 'done')
})

test('a failed build says why, that the file is untouched, and Retry builds again', async () => {
  const p = ports({ ident: yes(Q_NEW), statuses: [{ state: 'failed', error: { type: 'no_content', message: 'The file held no brand rules Napkin could read.' }, result: null }] })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  const ph = phase(f)
  assert.equal(ph?.kind, 'failed')
  assert.match(ph?.kind === 'failed' ? ph.reason : '', /no brand rules/)
  assert.match(words.untouched, /untouched/)
  await f.retry(FILE.name)
  assert.equal(p.calls.build.length, 2)
})

test('the start itself failing (no host, a refused call) is shown as a failure with its reason', async () => {
  const p = ports({ ident: yes(Q_NEW), buildErr: new BrandError('host_unavailable', 'no host') })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  const ph = phase(f)
  assert.ok(ph?.kind === 'failed' && /not set up to keep Brand Clans/.test(ph.reason))
})

test('a file over 120 pages asks before spending more; yes reads all of it, no leaves it', async () => {
  const p = ports({ ident: yes({ ...Q_NEW, pages: 130, over_cap: true }), buildErr: new BrandError('over_cap', 'the file has 130 pages; Napkin reads 120 without asking', 409) })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  const big = phase(f)
  assert.ok(big?.kind === 'big' && big.pages === 130)
  assert.equal(words.bigYes(130), 'Read all 130 pages')
  const ok = ports({ ident: yes({ ...Q_NEW, pages: 130 }) })
  const g = flowOf(ok)
  await g.fileAdded(FILE)
  ;(g as unknown as { put(e: unknown): void }).put({ id: FILE.name, label: FILE.label, phase: { kind: 'big', pages: 130, answer: { mode: 'new', name: 'Original', confirmed: false } } })
  await g.confirmBig(FILE.name, true)
  assert.equal(ok.calls.build[0].answer.confirmed, true)
  await f.confirmBig(FILE.name, false)
  assert.deepEqual(f.snapshot(), [])
})

test('a job the service no longer knows is a restart: said plainly and offered again', async () => {
  const p = ports({ ident: yes(Q_NEW), statuses: [new BrandError('unknown_job', 'no such job', 404)] })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  const ph = phase(f)
  assert.ok(ph?.kind === 'failed' && /restarted/.test(ph.reason) && ph.answer !== null)
})

test('a poll that did not get through is tried again', async () => {
  const p = ports({ ident: yes(Q_NEW), statuses: [new Error('network'), done({ mode: 'new', pending: false })] })
  const f = flowOf(p)
  await f.fileAdded(FILE)
  await f.answer(FILE.name, 'build')
  assert.equal(phase(f)?.kind, 'done')
})

test('a build in flight survives a reload: the job is picked up again from this tab', async () => {
  const store = memory()
  const running: JobView = { state: 'running', error: null, result: null }
  const first = ports({ ident: yes(Q_NEW), statuses: [running] })
  const f1 = flowOf(first, store)
  const pending = (async () => { await f1.fileAdded(FILE); void f1.answer(FILE.name, 'build') })()
  await pending
  await new Promise(r => setTimeout(r, 5))
  f1.dispose()
  assert.equal(store.m.size, 1, 'the running job is kept')
  const second = ports({ statuses: [done({ mode: 'new', pending: false })] })
  const f2 = flowOf(second, store)
  f2.resumeAll()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(phase(f2)?.kind, 'done')
  assert.equal(second.calls.status[0], 'job_1')
  assert.equal(store.m.size, 0, 'and forgotten once it ends')
  assert.equal(f2.snapshot()[0].label, FILE.label)
})

test('with no client there is no Brand Clan to make: nothing is asked', async () => {
  const f = new BrandFlow(ports(), { client: null, doc: 'd', pollMs: 0 })
  await f.fileAdded(FILE)
  assert.deepEqual(f.snapshot(), [])
})

test('the words are the mocks', () => {
  assert.equal(words.title('Tidewell-brand-book-2026.pdf'), 'Tidewell-brand-book-2026.pdf looks like a brand bible.')
  assert.equal(words.askChoose('Tidewell'), 'Tidewell has Brand Clans already. What should we do with it?')
  assert.equal(words.update('Original'), 'Update “Original”')
  assert.equal(words.makeNew, 'Make a new Brand Clan')
  assert.equal(words.notBible, 'Not a brand bible')
  assert.equal(words.working({ mode: 'update', clan: { document_id: 'x', path: 'p', name: 'Original' }, confirmed: false }), 'Updating “Original” from the brand book')
  assert.match(words.workingSub({ mode: 'update', clan: { document_id: 'x', path: 'p', name: 'O' }, confirmed: false }), /Carry on; we will tell you when its changes are ready to review\./)
})

test('the host proxy reply is read the way the apps read it: data on success, the services own type and words on failure', () => {
  assert.deepEqual(unwrap(200, { ok: true, status: 200, data: { job: { id: 'j' } }, error: null }), { job: { id: 'j' } })
  assert.throws(() => unwrap(200, { ok: false, status: 409, data: null, error: { type: 'over_cap', message: 'the file has 130 pages' } }),
    (e: unknown) => e instanceof BrandError && e.type === 'over_cap' && e.status === 409 && /130 pages/.test(e.message))
  assert.throws(() => unwrap(200, { ok: false, status: 0, error: 'could not reach' }), (e: unknown) => e instanceof BrandError && e.type === 'unreachable')
  assert.throws(() => unwrap(502, 'bad gateway'), (e: unknown) => e instanceof BrandError)
})
