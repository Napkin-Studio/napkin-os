// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Brief gate and the client link in the brief's Booth (features/align-booth.clan, done_when "The Brief
// gate lives in the brief's Booth" and "The client link and the round live in the brief's Booth"). The host
// lists the gate as attention items that block the lock (os-layer 7.2: gate:<item>, signoff:<role>); the
// page draws each as a row of Needs you (#lockList) that opens its part, and the pill and Lock read the same
// rows. The functions are lifted from the page as it ships and run on stand-ins (no DOM).

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'


function templates(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const t = join(dir, 'templates')
    if (existsSync(join(t, 'shared', 'clan-fields.html'))) return t
    dir = dirname(dir)
  }
  return join(process.cwd(), 'templates')
}
const page = (rel: string) => readFileSync(join(templates(), rel), 'utf8')
const BM = page('brief-maker/index.html').replace('<!-- @napkin:booth -->', page('shared/booth.html').trimEnd())

function balanced(src: string, start: number): number {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue }
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  throw new Error('unbalanced')
}
function fn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `function ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at)))
}
function obj(src: string, name: string): string {
  const at = src.indexOf(`var ${name}={`)
  assert.ok(at >= 0, `var ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at))) + ';'
}
function lift<T>(src: string, names: string[], vars: string[], env: Record<string, unknown>): T {
  const body = `${vars.map(v => obj(src, v)).join('\n')}\n${names.map(n => fn(src, n)).join('\n')}\nreturn {${names.join(',')}};`
  return new Function(...Object.keys(env), body)(...Object.values(env)) as T
}

const arr = (x: unknown) => (Array.isArray(x) ? x : [])
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const FIELDS = new Function(`${BM.slice(BM.indexOf('var FIELDS=['), BM.indexOf('];', BM.indexOf('var FIELDS=[')) + 2)} return FIELDS;`)() as { key: string; label: string }[]
const fieldOf = (k: string) => FIELDS.find(f => f.key === k) ?? null

type Row = { code: string; key?: string; field?: { key: string } | null; open?: string; say?: string; tag?: string; ask?: string }
type Attn = { code: string; text: string; blocks_lock: boolean; for?: { person?: string; role?: string }; address?: string; label?: string; decision?: string }

const SIGNERS = [{ role: 'planner', person: 'aoife@wk' }, { role: 'creative_director', person: 'dara@wk' }]
const Q_OBJ = 'What number should it reach, and by when?'
const Q_BASE = 'What is the figure today, so we can measure against it?'
const ITEMS: Record<string, Attn> = {
  'gate:proposition': { code: 'gate:proposition', text: 'Brief gate, one proposition: there is no single-minded proposition yet.', blocks_lock: true },
  'gate:insight': { code: 'gate:insight', text: 'Brief gate, one insight: the brief has no insight yet.', blocks_lock: true },
  'gate:objective': { code: 'gate:objective', text: `Brief gate, one measurable objective: no number and no date. Ask the client: ${Q_OBJ}`, blocks_lock: true },
  'gate:feel_or_do': { code: 'gate:feel_or_do', text: 'Brief gate, feel or do: nothing they should feel or do.', blocks_lock: true },
  'gate:famous': { code: 'gate:famous', text: 'Brief gate, what would make this famous: nothing yet.', blocks_lock: true },
  'gate:baseline': { code: 'gate:baseline', text: `Brief gate, how we will know: no figure for today. Ask the client: ${Q_BASE}`, blocks_lock: true },
}

/** The page's gate rows and Needs you, on a brief whose data is `data`, signed in as `me`, with the host's attention list. */
function rowsOf(attention: Attn[], data: Record<string, unknown> = { signers: SIGNERS }, me: string | null = 'aoife@wk') {
  const env = {
    arr, esc, fieldOf, get: (k: string) => data[k], ME: me ? { id: me } : null,
    osView: () => ({ attention, lock: { can_lock: false, reopened: [] } }),
    refOfAddress: () => '', fieldOfAddress: () => null, docLocked: () => false, openQsLeft: () => [],
    headOf: (f: { label: string }) => f.label, kindWord: () => 'Needs you',
  }
  return lift<{ lockItems(): Row[]; needsRows(): Row[]; gateRow(a: Attn): Row | null; lkItemHtml(x: Row): string }>(
    BM, ['signerOf', 'forWords', 'gateRow', 'lockItems', 'needsRows', 'lkItemHtml'], ['GATE_PART', 'GATE_SAY', 'SIGNOFF_SAY'], env)
}

test('each gate code is a row of Needs you that opens its part', () => {
  const f = rowsOf(Object.values(ITEMS))
  const rows = f.needsRows()
  assert.equal(rows.length, 6, 'one row per item the host lists, nothing added, nothing computed')
  const by = Object.fromEntries(rows.map(r => [r.code, r]))
  assert.equal(by['gate:proposition'].key, 'single_minded_proposition')
  assert.equal(by['gate:insight'].key, 'insight')
  assert.equal(by['gate:objective'].key, 'objectives.commercial')
  assert.equal(by['gate:feel_or_do'].key, 'desired_response.feel')
  assert.equal(by['gate:baseline'].key, 'measurement')
  for (const c of ['gate:proposition', 'gate:insight', 'gate:objective', 'gate:feel_or_do', 'gate:baseline']) {
    assert.ok(by[c].field && by[c].field!.key === by[c].key, `${c} opens a part the brief has`)
    assert.ok(!by[c].open, `${c} opens its part, not a box`)
  }
  // The brief has no part for "famous": its row opens the line in the Booth, where it is written.
  assert.equal(by['gate:famous'].key || '', '')
  assert.equal(by['gate:famous'].open, 'famous')
  assert.equal(by['gate:famous'].say, 'What would make this famous')
  // The rows say the part and a tag, never the host's whole sentence.
  const said = rows.map(f.lkItemHtml).join('').replace(/<[^>]*>/g, ' ')
  assert.doesNotMatch(said, /Brief gate, one insight/)
  assert.match(f.lkItemHtml(by['gate:insight']), /data-code="gate:insight"/)
  assert.match(f.lkItemHtml(by['gate:insight']), /data-key="insight"/)
  assert.match(f.lkItemHtml(by['gate:famous']), /data-open="famous"/)
})

test('the questions the client is owed are rows, with the question as the host words it', () => {
  const f = rowsOf([ITEMS['gate:objective'], ITEMS['gate:baseline'], ITEMS['gate:insight']])
  const rows = f.needsRows()
  const asks = rows.filter(r => r.tag === 'Ask the client')
  assert.deepEqual(asks.map(r => r.say), [Q_OBJ, Q_BASE])
  assert.deepEqual(asks.map(r => r.ask), [Q_OBJ, Q_BASE])
  assert.match(f.lkItemHtml(asks[0]), new RegExp(Q_OBJ.replace(/[?,]/g, '.')))
  assert.match(f.lkItemHtml(asks[0]), /Ask the client/)
  assert.equal(rows.find(r => r.code === 'gate:insight')!.tag, 'Brief gate')
})

test('the two sign-offs are rows addressed to the person who gives them', () => {
  // Both named, the planner not signed: the planner's row, to the planner, opens Sign this version.
  const planner: Attn = { code: 'signoff:planner', text: 'Brief gate, signing: the planner, aoife@wk, has not signed this version.', blocks_lock: true, for: { person: 'aoife@wk' } }
  const mine = rowsOf([planner]).needsRows()[0]
  assert.equal(mine.say, 'The planner’s sign-off')
  assert.equal(mine.tag, 'For you')
  assert.equal(mine.open, 'sign')
  const theirs = rowsOf([planner], { signers: SIGNERS }, 'dara@wk').needsRows()[0]
  assert.equal(theirs.tag, 'For aoife@wk')
  // A brief filed under no job: the host gives no `for`, the brief's own signer is named.
  const noJob = rowsOf([{ ...planner, for: undefined }], { signers: SIGNERS }, 'dara@wk').needsRows()[0]
  assert.equal(noJob.tag, 'For aoife@wk')
  // Nobody named: both rows ask for a name, and open the form that names them.
  const none = rowsOf([
    { code: 'signoff:planner', text: 'Brief gate, who signs: name the planner who signs this brief.', blocks_lock: true, for: { role: 'planning' } },
    { code: 'signoff:creative_director', text: 'Brief gate, who signs: name the creative director who signs this brief.', blocks_lock: true, for: { role: 'creative-director' } },
  ], {}).needsRows()
  assert.deepEqual(none.map(r => [r.say, r.tag, r.open]), [
    ['The planner’s sign-off', 'Name who signs', 'signers'],
    ['The creative director’s sign-off', 'Name who signs', 'signers'],
  ])
})

test('Needs you keeps the host’s other items and the open questions beside the gate rows', () => {
  const other: Attn = { code: 'open_contest', text: 'Sources disagree on the audience.', blocks_lock: true, address: 'doc#selection.contested[c1]' }
  const quiet: Attn = { code: 'gate:insight', text: 'x', blocks_lock: false }
  const rows = rowsOf([ITEMS['gate:insight'], other, quiet]).needsRows()
  assert.deepEqual(rows.map(r => r.code), ['gate:insight', 'open_contest'], 'an item that does not block is not a row')
})

// The pill and Lock both read Needs you and the host's can_lock: for every combination they agree.
test('the status pill and Lock agree for every combination of gate rows, can_lock and a live draft', () => {
  const sets: Attn[][] = [[], [ITEMS['gate:insight']], [{ code: 'signoff:planner', text: 'x', blocks_lock: true }],
    [ITEMS['gate:objective'], ITEMS['gate:famous']], [ITEMS['gate:baseline'], { code: 'signoff:creative_director', text: 'x', blocks_lock: true }]]
  let seen = 0
  for (const attention of sets) for (const canLock of [true, false]) for (const live of [false, true]) {
    const els: Record<string, Record<string, unknown>> = {}
    const el = (id: string) => els[id] ||= { hidden: false, disabled: false, textContent: '', title: '', innerHTML: '', classList: { toggle() {} }, setAttribute() {}, querySelectorAll: () => [] }
    const lock = { can_lock: canLock, reopened: [] }
    const env = {
      $: el, arr, esc, fieldOf, get: (k: string) => (k === 'signers' ? SIGNERS : undefined), ME: { id: 'aoife@wk' },
      osView: () => ({ attention, lock }), lockState: () => lock, approveLocked: () => false, docLocked: () => false,
      refOfAddress: () => '', fieldOfAddress: () => null, openQsLeft: () => [], headOf: (f: { label: string }) => f.label, kindWord: () => 'Needs you',
      draftLive: () => live, DRAFT: live ? { state: 'running' } : null, hasContent: () => true,
      renderStateLine() {}, docVersion: () => 'v1', SEL: null, NEEDS_N: null, READY_NUDGE: false, bindLkItems() {},
    }
    const f = lift<{ renderLockBtn(): void; statusNow(): { label: string } }>(BM,
      ['signerOf', 'forWords', 'gateRow', 'lockItems', 'needsRows', 'lkItemHtml', 'lockListHtml', 'lockWhy', 'renderLockBtn', 'briefStatus', 'statusNow'],
      ['GATE_PART', 'GATE_SAY', 'SIGNOFF_SAY'], env)
    f.renderLockBtn()
    const pill = f.statusNow().label
    const ready = !el('lockBtn').disabled
    const what = `${attention.map(a => a.code).join('+') || 'nothing'}, can_lock ${canLock}, draft ${live}`
    assert.equal(pill === 'Ready to lock', ready, `pill "${pill}" and Lock ${ready ? 'on' : 'off'} agree: ${what}`)
    assert.equal(ready, attention.length === 0 && canLock && !live, `Lock is on only with nothing listed: ${what}`)
    if (attention.length && !live) assert.equal(el('lockWhy').textContent, `Settle ${attention.length} first`, what)
    assert.equal(el('lockList').hidden, attention.length === 0, `the list shows the rows: ${what}`)
    seen++
  }
  assert.equal(seen, 20)
})

test('there is one Lock: the Booth’s, and no "Sign and lock this version" in the brief', () => {
  assert.doesNotMatch(BM, /Sign and lock this version/)
  assert.equal((BM.match(/id="lockBtn"/g) ?? []).length, 1)
  // The gate box and the client links sit in the Booth's brief view, beside Needs you and under Record the client's answer.
  const booth = BM.slice(BM.indexOf('<aside class="stab" id="stab"'), BM.indexOf('</aside>', BM.indexOf('<aside class="stab" id="stab"')))
  assert.match(booth, /id="lockList"[\s\S]*id="gateBox"[\s\S]*id="lockBtn"/)
  assert.match(booth, /id="crOpen"[\s\S]*id="clientAnswer"[\s\S]*id="clientLinks"/)
  // Send the client copy (OS bar, Share) is the brief's `client` bar button; the shell answers it with its own form.
  assert.match(fn(BM, 'barItems'), /id:'client', label:'Send the client copy'/)
})

// The Booth shows the links and the round the host lists for this document (the frame's own token routes), in words;
// in client review mode it is not drawn.
test('the Booth says each link and the round in words, and is not drawn in client review', () => {
  const rows = [
    { id: 'l1', state: 'open', answer: null, client: { name: 'Client A contact', email: 'c@x.example' }, expires: '2026-12-14T00:00:00Z' },
    { id: 'l2', state: 'answered', answer: 'accepted', client: { name: 'Pat', email: 'p@x.example' }, expires: '2026-12-14T00:00:00Z' },
    { id: 'l3', state: 'withdrawn', answer: null, client: { name: 'Sam', email: 's@x.example' }, expires: '2026-12-14T00:00:00Z' },
  ]
  const els: Record<string, Record<string, unknown>> = {}
  const el = (id: string) => els[id] ||= { hidden: false, innerHTML: '', querySelector: () => null, querySelectorAll: () => [] }
  const run = (clientOn: boolean) => {
    els.clientLinks = { hidden: false, innerHTML: '', querySelector: () => null, querySelectorAll: () => [] }
    const f = lift<{ renderClientLinks(): void }>(BM, ['linkWords', 'linkDay', 'linksRoundHtml', 'renderClientLinks', 'linksShown'], ['LINK_STATE', 'LINK_ANSWER'],
      { $: el, arr, esc, approveLocked: () => true, lockState: () => ({ reopened: [] }), CLIENT: { on: clientOn },
        LINKS: { rows, round: { round: 1, rounds_in_scope: null, current: true, reviewers: [], comments: [], pieces: [] }, open: false, at: 1 }, loadLinks() {} })
    f.renderClientLinks()
    return els.clientLinks
  }
  const shown = run(false)
  assert.equal(shown.hidden, false)
  const text = String(shown.innerHTML).replace(/<[^>]*>/g, ' ')
  assert.match(text, /Client A contact\s*: Waiting for the client/)
  assert.match(text, /Pat\s*: confirmed/)
  assert.match(text, /Sam\s*: Withdrawn/)
  assert.match(text, /Round 1/)
  assert.doesNotMatch(String(shown.innerHTML), /c@x\.example|Withdraw<\/button>|Make the link/, 'no address shown, and nothing here makes or withdraws a link')
  assert.equal(run(true).hidden, true, 'not drawn in client review mode')
})
