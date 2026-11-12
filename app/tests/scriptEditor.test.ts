// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/* eslint-disable @typescript-eslint/no-explicit-any -- the page runs in jsdom, another realm: what it returns and what it is given is untyped */

// The Script editor (features/script-editor.clan), the part that needs no model. The page is run as it ships, in
// jsdom, against the host's own shapes (the decisions view, the upstream view), and its core is read through
// `window.__script`. Each `done_when` line has its test here or beside the code it proves:
//
//  - beats with stable ids across editing, splitting, joining and reordering; a TV script is an Advertising Studio
//    script revision (the schema test below, and crates/clan-sdk/tests/script_editor.rs);
//  - radio notation read as typed, read time against the slot, the live check: house-style.cases.json is the one
//    cases file, run here by the page's reader and (with the rewrite handlers) by the middleware's;
//  - the page lists findings and never returns a changed string; it never blocks typing;
//  - tracked changes: the page's calls, and crates/napkin-host/tests/script_editor.rs for the chain and the 409;
//  - versions and the lock; the hand-offs; the nine states' words; no em dash in the interface.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const RULES_TEXT = read('templates/script-editor/house-style.json')
const HTML = read('templates/script-editor/index.html').replace('@napkin:house-style', RULES_TEXT.replace(/<\//g, '<\\/'))
const CASES = JSON.parse(read('templates/script-editor/house-style.cases.json'))

type Json = Record<string, any>

const SIGNERS = [{ role: 'planner', person: 'aoife@wk' }, { role: 'creative_director', person: 'dara@wk' }]
const BRIEF = { mandatories: ['Drink responsibly line', 'Age 18 plus only'], signers: SIGNERS }
const RADIO: Json = {
  format: 'radio', slot_s: 30, proposition: 'The whiskey that waits for you.',
  script: { beats: [
    { id: 'b1', kind: 'voice', role: 'FVO', text: 'The room goes quiet.' },
    { id: 'b2', kind: 'sfx', text: 'A glass set down on old wood.' },
    { id: 'b3', kind: 'voice', role: 'MVO', text: 'Take your time. Client A does.' },
  ], proposals: [], seq: 3 },
  checks: { mandatory: [], banned: [{ text: 'cheap', source: 'document' }] },
  handoffs: {},
  upstream: { doc_brief: BRIEF },
}

const here = (extra: Json = {}) => ({ targets: [{ here: true, path: '', address: 'doc#', label: '', kind: 'document' }], ...extra })
const approve = (id: string) => ({ decision: { id, kind: 'approve', agent: 'human', action: 'approve' }, superseded: false, ...here() })
const view = (decisions: unknown[], locked: boolean) => ({ document_id: 'doc', version: 'v', decisions, attention: [], lock: { can_lock: true, blockers: 0, locked, reopened: [] } })
const UP = { document_id: 'doc', carried: { document_id: 'brief' }, upstream: [{ document_id: 'brief', direct: true, in_store: true, title: 'J001 brief', path: '/b.clan', how: 'made_from', locked: true, status: 'current' }] }

/** The page's objects come from another realm, so what they return is copied before it is compared. */
const plainCore = (core: Json): Json => new Proxy(core, {
  get: (t, k) => typeof t[k as string] === 'function'
    ? (...a: unknown[]) => { const r = t[k as string](...a); return r instanceof Promise ? r : r === undefined ? r : JSON.parse(JSON.stringify(r)) }
    : t[k as string],
})

interface Opts { data?: Json; decisions?: unknown; up?: unknown; me?: string | null; reply?: (url: string, body: Json) => Json }

/** Run the page with the host's answers; resolves once it has read them. */
async function page(opts: Opts = {}) {
  const writes: { path: unknown; value: unknown; opts: Json }[] = []
  const posts: { url: string; body: Json }[] = []
  const parent: Json[] = []
  const html = HTML.replace(/<link[^>]*>/g, '').replace('<!-- @napkin:clan-fields -->', '')
  const dom = new JSDOM(html, {
    url: 'https://napkin.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, any>
      win.__CLAN__ = { data: structuredClone(opts.data ?? RADIO) }
      win.clan = {
        patchData: (path: unknown, value: unknown, o: Json) => {
          const isObj = path !== null && typeof path === 'object'
          writes.push({ path: isObj ? path : path, value: isObj ? undefined : value, opts: isObj ? (value as Json) : o })
          const d = win.__CLAN__.data
          if (isObj) Object.assign(d, path)
          else { const parts = String(path).split('.'); let cur = d; parts.slice(0, -1).forEach(k => { cur = cur[k] ??= {} }); cur[parts[parts.length - 1]] = value }
          win.dispatchEvent(new win.CustomEvent('clan:dataupdated', { detail: {} }))
          return Promise.resolve({ ok: true })
        },
        me: () => Promise.resolve(opts.me === null ? null : { actor: `human:${opts.me ?? 'dara@wk'}`, id: opts.me ?? 'dara@wk', name: 'Dara' }),
      }
      Object.defineProperty(win, 'parent', { value: { postMessage: (m: Json) => parent.push(m) } })
      win.fetch = (url: string, init?: { method?: string; body?: string }) => {
        const u = String(url).replace(/^.*localhost/, '')
        if (init?.method === 'POST') {
          const body = init.body ? JSON.parse(init.body) : {}
          posts.push({ url: u, body })
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(opts.reply?.(u, body) ?? { ok: true }) })
        }
        const b = u.endsWith('/decisions') ? (opts.decisions ?? view([], false)) : u.endsWith('/upstream') ? (opts.up ?? UP) : null
        return Promise.resolve({ ok: b != null, status: b != null ? 200 : 404, json: () => Promise.resolve(b) })
      }
    },
  })
  await new Promise(r => setTimeout(r, 30))
  const d = dom.window.document
  const win = dom.window as unknown as Record<string, any>
  return {
    dom, d, win, writes, posts, parent, core: plainCore(win.__script),
    text: (sel: string) => d.querySelector(sel)?.textContent?.trim() ?? null,
    all: (sel: string) => [...d.querySelectorAll(sel)] as any[],
    type: (sel: string, value: string) => { const el = d.querySelector(sel) as any; el.value = value; el.dispatchEvent(new win.Event('input', { bubbles: true })) },
    click: (sel: string) => (d.querySelector(sel) as any).click(),
    settle: () => new Promise(r => setTimeout(r, 30)),
  }
}

// ── the cases file: one file, run by this reader (and later by the middleware's) ──────────────────────

test('radio notation is read as napkin-radio reads it: the cases written from its tag table', async () => {
  const p = await page()
  for (const c of CASES.parse) assert.deepEqual(p.core.parseScript(c.text), c.expect, c.name)
})

test('read time: 78 words at 2.6 a second is 30 seconds, and cues are not counted', async () => {
  const p = await page()
  for (const c of CASES.read) {
    assert.equal(p.core.spokenWords(c.beats, c.format), c.words, c.name)
    assert.equal(Math.round(p.core.readSeconds(c.beats, c.format) * 10) / 10, c.seconds, c.name)
  }
})

test('the live check runs every case of the shared file, and lists findings only', async () => {
  const p = await page()
  const key = (f: Json) => `${f.rule}@${f.beat ?? ''}@${f.text ?? ''}`
  for (const c of CASES.check) {
    const before = JSON.stringify(c.doc)
    const got = p.core.findingsOf(c.doc)
    assert.deepEqual(got.map(key).sort(), c.expect.map((e: Json) => key({ beat: null, text: undefined, ...e })).sort(), c.name)
    for (const f of got) assert.equal(typeof f.advice, 'string')
    assert.equal(JSON.stringify(c.doc), before, `${c.name}: the check changed the document`)
  }
})

test('the findings carry advice and no field of a changed string: nothing in a finding is a rewrite', async () => {
  const p = await page()
  const f = p.core.findingsOf({ format: 'radio', slot_s: 10, beats: [{ id: 'b1', kind: 'voice', role: 'VO', text: 'We leverage — it' }], mandatory: [], banned: [] })
  assert.ok(f.length >= 2)
  for (const x of f) assert.deepEqual(Object.keys(x).filter(k => !['rule', 'beat', 'advice', 'text', 'words', 'target', 'over', 'ratio', 'voices', 'cast'].includes(k)), [])
})

test('the length line says which way the words miss the slot: too many, or well short with time to spare', async () => {
  const line = (p: Awaited<ReturnType<typeof page>>) => p.all('[data-testid="finding"]').find(f => f.getAttribute('data-rule') === 'length_off')?.textContent ?? ''
  // 18 spoken words in a 30 second slot: about 78 fill it, and the read time has time to spare
  const short = await page({ data: { ...RADIO, script: { ...RADIO.script, beats: [{ id: 'b1', kind: 'voice', role: 'VO', text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen.' }] } } })
  assert.match(line(short), /Well short of the slot/)
  assert.match(line(short), /18 words, about 78 fill it\./)
  assert.doesNotMatch(line(short), /do not fit|Too many/)
  // 120 spoken words in the same slot: too many
  const long = await page({ data: { ...RADIO, script: { ...RADIO.script, beats: [{ id: 'b1', kind: 'voice', role: 'VO', text: Array.from({ length: 120 }, () => 'word').join(' ') + '.' }] } } })
  assert.match(line(long), /Too many words for the slot/)
  assert.match(line(long), /120 words, about 78 fit\./)
  assert.doesNotMatch(line(long), /short/)
  for (const t of [line(short), line(long)]) assert.ok(!t.includes('\u2014'), 'no em dash')
})

// ── beats keep their ids ─────────────────────────────────────────────────────────────────────────────

test('editing, splitting, joining and reordering keep the beats’ ids, and a new beat gets a new one', async () => {
  const p = await page()
  const c = p.core, base = { beats: RADIO.script.beats }
  const edited = c.typed(base.beats[0], 'radio', 'The room goes very quiet.')
  assert.equal(edited.id, 'b1')
  const s = c.split(base, 'radio', 'b1', 8)
  assert.deepEqual(s.script.beats.map((b: Json) => b.id), ['b1', 'b4', 'b2', 'b3'], 'the first half keeps its id, the second is new')
  assert.equal(s.script.beats[0].text, 'The room')
  assert.equal(s.script.beats[1].text, 'goes quiet.')
  assert.equal(s.focus, 'b4')
  const j = c.join(s.script, 'b4')
  assert.deepEqual(j.script.beats.map((b: Json) => b.id), ['b1', 'b2', 'b3'], 'a join keeps the earlier id')
  assert.equal(j.script.beats[0].text, 'The room goes quiet.')
  assert.deepEqual(c.move(base, 'b3', -1).beats.map((b: Json) => b.id), ['b1', 'b3', 'b2'])
  const r = c.remove(base, 'radio', 'b3')
  assert.deepEqual(r.beats.map((b: Json) => b.id), ['b1', 'b2'])
  const again = c.split({ beats: r.beats, proposals: [], seq: 3 }, 'radio', 'b1', 3)
  assert.equal(again.focus, 'b4', 'a removed beat’s id (b3) is not given again while its number is on record')
})

test('typing a tag sets the voice and keeps the words; pasting several lines makes several beats', async () => {
  const p = await page()
  const t = p.core.typed({ id: 'b9', kind: 'voice', role: 'VO', text: '' }, 'radio', 'MVO: Hello there')
  assert.deepEqual([t.kind, t.role, t.text], ['voice', 'MVO', 'Hello there'])
  const sfx = p.core.typed({ id: 'b9', kind: 'voice', role: 'VO', text: '' }, 'radio', 'SFX: rain')
  assert.deepEqual([sfx.kind, sfx.role, sfx.text], ['sfx', undefined, 'rain'])
  const pasted = p.core.pasted({ beats: [{ id: 'b1', kind: 'voice', role: 'VO', text: '' }] }, 'radio', 'b1', 'FVO: One\nMVO: Two\nSFX: door')
  assert.deepEqual(pasted.script.beats.map((b: Json) => [b.id, b.kind, b.role, b.text]), [['b2', 'voice', 'FVO', 'One'], ['b3', 'voice', 'MVO', 'Two'], ['b4', 'sfx', undefined, 'door']], 'the empty line is replaced and ids are new')
})

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────

test('the page shows the lines, the read time against the slot, and the check from the brief', async () => {
  const p = await page()
  assert.equal(p.all('.beat').length, 3)
  assert.equal(p.text('#eyebrow'), 'Radio script · 30 seconds')
  assert.match(p.text('#sub')!, /whiskey that waits/)
  assert.equal(p.text('[data-testid="read-seconds"]'), '4 s')
  assert.match(p.text('[data-testid="read-time"]')!, /of 30 s/)
  assert.deepEqual(p.all('[data-testid="mandatory"]').map(x => x.getAttribute('data-state')), ['missing', 'missing'])
  assert.match(p.text('[data-testid="mandatory"]')!, /Drink responsibly line/)
  assert.ok(p.all('[data-testid="finding"]').some(f => f.getAttribute('data-rule') === 'length_off'))
})

test('typing a mandatory line into a beat turns it present, a banned word is listed with its line, and nothing blocks typing', async () => {
  const p = await page()
  p.type('textarea[data-id="b3"][data-field="text"]', 'Take your time. Cheap, it is not. Age 18 plus only')
  assert.equal(p.all('[data-testid="mandatory"]')[1].getAttribute('data-state'), 'present')
  assert.equal(p.all('[data-testid="mandatory"]')[0].getAttribute('data-state'), 'missing')
  assert.match(p.text('[data-hints="b3"]')!, /Banned: cheap/)
  assert.equal((p.d.querySelector('textarea[data-id="b3"]') as any).value, 'Take your time. Cheap, it is not. Age 18 plus only', 'the person’s words are as they typed them')
})

test('a typed change is saved as one attributed write of the beats, and a failed save keeps the text', async () => {
  const p = await page()
  p.type('textarea[data-id="b1"][data-field="text"]', 'The room goes still.')
  assert.equal(p.writes.length, 0, 'typing waits a moment')
  await p.core.flush()
  assert.equal(p.writes.length, 1)
  assert.equal(p.writes[0].path, 'script.beats')
  assert.equal(p.writes[0].opts.action, 'edit the script')
  assert.equal((p.writes[0].value as Json[])[0].text, 'The room goes still.')
  assert.equal((p.writes[0].value as Json[])[0].id, 'b1')
})

test('Enter in a line splits it, Backspace at the start joins it, and each is saved at once', async () => {
  const p = await page()
  const ta = p.d.querySelector('textarea[data-id="b1"][data-field="text"]') as any
  ta.focus(); ta.setSelectionRange(8, 8)
  ta.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await p.settle()
  assert.equal(p.all('.beat').length, 4)
  assert.deepEqual(p.writes.map(w => w.path), ['script.beats'])
  assert.deepEqual([...(p.writes[0].value as Json[])].map(b => b.id), ['b1', 'b4', 'b2', 'b3'])
})

test('Cmd Z with nothing unsaved hands the key to the shell’s undo; with unsaved text the field keeps its own', async () => {
  const p = await page()
  const ta = p.d.querySelector('textarea[data-id="b1"][data-field="text"]') as any
  const press = () => ta.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))
  press()
  assert.deepEqual(JSON.parse(JSON.stringify(p.parent)), [{ type: 'clan:undo-key', dir: 'undo' }])
  p.type('textarea[data-id="b1"][data-field="text"]', 'typed, not saved')
  p.parent.length = 0
  press()
  assert.deepEqual(JSON.parse(JSON.stringify(p.parent)), [])
})

test('the voice chip is a select that follows a tag typed at the start of the line', async () => {
  const p = await page()
  p.type('textarea[data-id="b3"][data-field="text"]', 'FVO: Now a woman says it')
  assert.equal((p.d.querySelector('select[data-role="b3"]') as any).value, 'FVO')
})

// ── tracked changes, as the page sends them ──────────────────────────────────────────────────────────

const MARKED: Json = { ...RADIO, script: { ...RADIO.script, proposals: [
  { id: 'p1', beat: 'b1', was: 'The room goes quiet.', text: 'The room goes still.', kind: 'markup', note: 'Still is the sound we want.', by: 'human:dara@wk', at: '2026-11-12T10:00:00Z', status: 'open' },
  { id: 'p2', beat: 'b3', was: 'Take your time. Client A does.', text: 'Take your time.', kind: 'markup', by: 'human:dara@wk', at: '2026-11-12T10:01:00Z', status: 'accepted', answered_by: 'human:sam@wk', answered_at: '2026-11-12T11:00:00Z' },
] } }

test('a mark-up shows who proposed, the words struck and the new ones, and who answered one already', async () => {
  const p = await page({ data: MARKED, me: 'sam@wk' })
  const [open, done] = p.all('[data-testid="mark"]')
  assert.match(open.textContent, /Dara suggests/)
  assert.equal(open.querySelector('del')!.textContent, 'The room goes quiet.')
  assert.equal(open.querySelector('ins')!.textContent, 'The room goes still.')
  assert.match(open.textContent, /Still is the sound we want/)
  assert.ok(open.querySelector('[data-accept="p1"]') && open.querySelector('[data-reject="p1"]'))
  assert.match(done.textContent, /Accepted by Sam/)
  assert.equal(done.querySelector('[data-accept]'), null)
})

test('the one who marked it up does not answer it; the page says it waits for the writer', async () => {
  const p = await page({ data: MARKED, me: 'dara@wk' })
  assert.equal(p.d.querySelector('[data-accept="p1"]'), null)
  assert.match(p.text('[data-proposal="p1"]')!, /Waiting for the writer/)
})

test('Accept and Keep mine call the host and never write a beat from the page', async () => {
  const p = await page({ data: MARKED, me: 'sam@wk' })
  p.click('[data-accept="p1"]')
  await p.settle()
  assert.deepEqual(p.posts.filter(x => x.url.startsWith('/script')).map(x => [x.url, x.body]), [['/script/answer', { proposal: 'p1', answer: 'accept' }]])
  assert.equal(p.writes.length, 0, 'the page itself wrote nothing to the beats')
})

test('a refused accept says so on the mark-up and the mark-up stays open', async () => {
  const p = await page({
    data: MARKED, me: 'sam@wk',
    reply: (u) => u === '/script/answer' ? { ok: false, error: 'that line changed after it was marked up, so the change was not made; the mark-up stays open' } : { ok: true },
  })
  p.click('[data-accept="p1"]')
  await p.settle()
  assert.match(p.text('[data-proposal="p1"] [role="alert"]')!, /changed after it was marked up/)
  assert.equal(p.d.querySelector('[data-proposal="p1"]')!.getAttribute('data-status'), 'open')
})

test('Mark up opens a form with the line’s words, and Send posts the beat, the words and the note', async () => {
  const p = await page({ me: 'dara@wk' })
  p.click('[data-markup="b1"]')
  assert.equal((p.d.querySelector('#mt') as any).value, 'The room goes quiet.')
  p.type('#mt', 'The room goes still.'); p.type('#mn', 'Still is the sound.')
  p.click('[data-sendmark="b1"]')
  await p.settle()
  assert.deepEqual(p.posts.filter(x => x.url === '/script/propose').map(x => x.body), [{ beat: 'b1', text: 'The room goes still.', note: 'Still is the sound.' }])
})

// ── versions, the lock and the hand-offs ─────────────────────────────────────────────────────────────

test('open: Approve version 1 for the creative director on the brief; anyone else is told who approves', async () => {
  const dara = await page({ me: 'dara@wk' })
  assert.equal(dara.text('#vnum'), '1')
  assert.equal(dara.d.querySelector('#approve')!.getAttribute('aria-disabled'), 'false')
  const sam = await page({ me: 'sam@wk' })
  assert.equal(sam.d.querySelector('#approve')!.getAttribute('aria-disabled'), 'true')
  assert.match(sam.text('#approveReason')!, /Only dara@wk/)
})

test('approved: the page is locked, every line read only, and Start version 2 reopens it', async () => {
  const p = await page({ decisions: view([approve('a1')], true) })
  assert.equal(p.text('[data-testid="locked-stamp"]'), 'Locked · version 1')
  assert.ok(p.all('textarea.line').every(t => t.hasAttribute('readonly')))
  assert.equal(p.all('[data-markup],[data-remove],[data-up],[data-down]').length, 0)
  p.click('#newv')
  await p.settle()
  assert.deepEqual(p.posts.map(x => x.url).filter(u => u === '/unapprove'), ['/unapprove'])
})

test('Send to Radio records the exact version with a content hash and says so in one line', async () => {
  const p = await page({ decisions: view([approve('a1')], true) })
  p.click('[data-send="radio"]')
  await p.settle()
  const w = p.writes.find(x => (x.path as Json).handoffs)!
  const ref = ((w.path as Json).handoffs as Json).radio
  assert.deepEqual([ref.kind, ref.revision, ref.content_hash.length], ['script', '1', 64])
  assert.equal(p.text('[data-testid="send-line"]'), 'Radio comes in Phase 3. This script, version 1, is waiting for it.')
  assert.equal(p.posts.filter(x => x.url === '/spinoff').length, 0)
})

test('Send to Film writes the Advertising Studio revision with the same ids, then spins off into Film', async () => {
  const p = await page()
  p.click('[data-send="film"]')
  await p.settle()
  const w = p.writes.find(x => (x.path as Json).film)!
  const film = ((w.path as Json).film as Json).script
  assert.equal(film.current, 'r1')
  assert.deepEqual(film.revisions[0].beats.map((b: Json) => b.id), ['b1', 'b2', 'b3'])
  assert.equal(film.revisions[0].beats[1].sound_intention, 'A glass set down on old wood.')
  assert.equal(film.revisions[0].beats[0].voiceover, 'The room goes quiet.')
  assert.deepEqual(p.posts.filter(x => x.url === '/spinoff').map(x => x.body), [{ app_id: 'ie.napkin.film' }])
})

test('Send to Judge records the draft, asks the host to score it and shows the total', async () => {
  const p = await page({ reply: (url) => (url === '/judge' ? { ok: true, score: { total: 24 } } : { ok: true }) })
  p.click('[data-send="judge"]')
  await p.settle()
  assert.deepEqual(p.posts.filter(x => x.url === '/judge').map(x => x.body), [{ target: 'script' }])
  assert.equal(p.text('[data-testid="send-line"]'), 'Judge scored version 1: 24 of 30. The card is above the page.')
  assert.match(p.text('[data-testid="judge-score"]')!, /24 of 30/)
  assert.ok(p.writes.some(w => (w.opts as Json).action === 'send version 1 to Judge'), 'the version sent is recorded')
})

test('Send to Judge says in the host\'s words when Judge will not score it, and shows no score', async () => {
  const p = await page({ reply: (url) => (url === '/judge' ? { ok: false, error: 'not_configured: Judge is not set up here.' } : { ok: true }) })
  p.click('[data-send="judge"]')
  await p.settle()
  assert.equal(p.text('[data-testid="send-line"]'), 'Judge did not score it. Judge is not set up here.')
  assert.equal(p.text('[data-testid="judge-score"]'), null)
})

test('the content hash is a real SHA-256 and a handed-off version says when it has changed since', async () => {
  const p = await page()
  for (const s of ['', 'abc', 'The room goes quiet.', 'café']) assert.equal(p.core.sha256(s), createHash('sha256').update(s).digest('hex'), s)
  const beats = RADIO.script.beats
  const ref = p.core.handoffRef(beats, 2)
  const sent = await page({ data: { ...RADIO, handoffs: { radio: ref } } })
  assert.match(sent.text('[data-testid="sent-radio"]')!, /version 2, is waiting/)
  const moved = await page({ data: { ...RADIO, handoffs: { radio: { ...ref, content_hash: 'x' } } } })
  assert.match(moved.text('[data-testid="sent-radio"]')!, /changed since/)
})

// ── formats, the empty page, and what the interface says ─────────────────────────────────────────────

test('a new script asks for a format, and choosing one writes the first line and the slot', async () => {
  const p = await page({ data: { upstream: { doc_brief: BRIEF }, proposition: 'x' } })
  assert.equal(p.all('[data-testid="script-empty"] [data-format]').length, 5)
  p.click('[data-format="radio"]')
  await p.settle()
  const w = JSON.parse(JSON.stringify(p.writes[0].path)) as Json
  assert.equal(w.format, 'radio'); assert.equal(w.slot_s, 30)
  assert.deepEqual(w.script.beats, [{ id: 'b1', kind: 'voice', role: 'VO', text: '' }])
  assert.equal(p.all('.beat').length, 1)
})

test('a TV script is two columns, picture and sound, and its rows keep their ids into Film', async () => {
  const data = { ...RADIO, format: 'tv', script: { beats: [
    { id: 'b1', kind: 'voice', role: 'VO', text: 'Take your time.', visual_action: 'A bar after closing. One glass.' },
    { id: 'b2', kind: 'music', text: 'Slow strings', visual_action: 'The door swings shut.' },
  ], proposals: [] } }
  const p = await page({ data })
  assert.equal(p.all('.beat.tv').length, 2)
  assert.equal(p.all('textarea.pic').length, 2)
  const fb = p.core.filmBeats('tv', data.script.beats)
  assert.deepEqual(fb.map((b: Json) => b.id), ['b1', 'b2'])
  assert.equal(fb[0].visual_action, 'A bar after closing. One glass.')
  assert.equal(fb[1].sound_intention, 'Slow strings')
})

test('headline, body copy and social are lines with no read time, only a word count', async () => {
  for (const f of ['headline', 'body', 'social']) {
    const p = await page({ data: { ...RADIO, format: f, script: { beats: [{ id: 'b1', kind: 'line', text: 'Take your time.' }], proposals: [] } } })
    assert.equal(p.d.querySelector('[data-testid="read-seconds"]'), null, f)
    assert.equal(p.d.querySelector('select.role'), null, f)
    assert.match(p.text('#time')!, /3\s*words/, f)
  }
})

test('a Film revision built from a script validates as an Advertising Studio script revision', async () => {
  const p = await page()
  const schema = JSON.parse(read('templates/advertising-studio/schema.json'))
  const rev = schema.properties.script.properties.revisions.items
  const beatSchema = rev.properties.beats.items
  const film = p.core.filmScript('radio', RADIO.script.beats, 1, 'human:sam@wk', '2026-11-12T10:00:00Z')
  const r = film.revisions[0]
  for (const k of rev.required) assert.ok(k in r, `revision needs ${k}`)
  assert.ok(rev.properties.status.enum.includes(r.status))
  for (const b of r.beats) {
    for (const k of beatSchema.required) assert.ok(k in b, `beat needs ${k}`)
    for (const [k, v] of Object.entries(b)) {
      const s = beatSchema.properties[k]
      if (!s) continue // additionalProperties is true
      assert.equal(typeof v, s.type === 'number' ? 'number' : s.type === 'array' ? 'object' : 'string', k)
    }
  }
})

test('no interface string holds an em dash, and every primary button is a pill', () => {
  const visible = HTML.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')
  // the house list holds the dash on purpose (it is what the check looks for), written as an escape in JSON and a code point in the page
  const lines = visible.split('\n').filter(l => /[—–]/.test(l))
  assert.deepEqual(lines, [], 'an em or en dash in the page’s own text')
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)![1]
  assert.match(css, /\.btn\{[^}]*border-radius:999px/)
  assert.match(css, /@media \(max-width:640px\)\{[^\n]*\.btn\.primary\{width:100%\}/)
  assert.match(css, /min-height:44px/)
})

// ── the seed holds every field of the schema ─────────────────────────────────────────────────────────

test('the e2e seed carries every key of the schema, so a test never runs on a minimal document', async () => {
  const seed = await import('../e2e/seed/j001/p2/script-editor.mjs') as { FULL_SCRIPT: Json; RADIO_SCRIPT: Json }
  const schema = JSON.parse(read('templates/script-editor/schema.json')) as Json
  const props = schema.properties as Json
  for (const k of Object.keys(props)) assert.ok(k in seed.FULL_SCRIPT, `the seed lacks ${k}`)
  const s = props.script.properties as Json
  for (const k of Object.keys(s)) assert.ok(k in seed.FULL_SCRIPT.script, `script.${k}`)
  for (const k of Object.keys(s.beats.items.properties)) assert.ok(k in seed.FULL_SCRIPT.script.beats[0], `a beat lacks ${k}`)
  for (const k of Object.keys(s.proposals.items.properties)) assert.ok(k in seed.FULL_SCRIPT.script.proposals[0], `a proposal lacks ${k}`)
  for (const k of Object.keys(props.handoffs.properties)) assert.ok(k in seed.FULL_SCRIPT.handoffs, `handoffs.${k}`)
  for (const k of Object.keys(props.checks.properties)) assert.ok(k in seed.FULL_SCRIPT.checks, `checks.${k}`)
  // and the page opens it
  const p = await page({ data: seed.FULL_SCRIPT })
  assert.equal(p.all('.beat').length, 1)
  assert.match(p.text('[data-testid="sent-judge"]')!, /Sent to Judge at version/)
})
