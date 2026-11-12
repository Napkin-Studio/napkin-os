// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The apps' own rules, read out of their HTML as they ship: the functions
// are lifted from the page's script and run against stand-ins for what they
// read (no DOM here). Client review's part words and aliases in the shared
// fields snippet; the Research Tool's title and a locked report; the brief's
// aliases, its name for the research it started from, and the override
// offered on a part the Judge failed, empty or not.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/** app/templates, found from wherever the runner put this bundle. */
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

/** From `start` (an opening brace) to its closing brace, skipping strings and comments. */
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

/** The source of `function <name>(…){…}` in the page. */
function fn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `function ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at)))
}

/** The source of `var <name>={…};`. */
function obj(src: string, name: string): string {
  const at = src.indexOf(`var ${name}={`)
  assert.ok(at >= 0, `var ${name} is in the page`)
  return src.slice(at, balanced(src, src.indexOf('{', at))) + ';'
}

/** Run the named functions with `env` as the names they read. */
function lift<T>(src: string, names: string[], env: Record<string, unknown>): T {
  const body = `${names.map(n => fn(src, n)).join('\n')}\nreturn {${names.join(',')}};`
  return new Function(...Object.keys(env), body)(...Object.values(env)) as T
}

const arr = (x: unknown) => (Array.isArray(x) ? x : [])
const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x)
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const listJoin = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)

// ── the shared fields snippet: client review ───────────────────────────────

const CLF = page('shared/clan-fields.html')

test('a part declares its aliases, and they go up with the part', () => {
  type F = { aliasesOf(el: unknown): string[]; partRef(p: unknown): unknown }
  const f = lift<F>(CLF, ['aliasesOf', 'partRef'], {})
  const el = (v: string | null) => ({ getAttribute: (a: string) => (a === 'data-clan-part-aliases' ? v : null) })
  assert.deepEqual(f.aliasesOf(el(' budget,  Cost ,, spend , BUDGET,scope ')), ['budget', 'Cost', 'spend', 'scope'])
  assert.deepEqual(f.aliasesOf(el('the   line')), ['the line'])
  assert.deepEqual(f.aliasesOf(el(null)), [])
  assert.deepEqual(f.partRef({ address: 'audience', label: 'Audience', aliases: ['target', 'who'], el: {} }),
    { address: 'audience', label: 'Audience', aliases: ['target', 'who'] })
  assert.deepEqual(f.partRef({ address: 'insight', label: 'Insight', aliases: [], el: {} }), { address: 'insight', label: 'Insight' })
  // Collected from the page, and a change to them is seen.
  assert.match(fn(CLF, 'declaredParts'), /aliases:aliasesOf\(el\)/)
  assert.match(CLF, /attributeFilter:\['data-clan-part','data-clan-part-label','data-clan-part-aliases'\]/)
  assert.match(fn(CLF, 'postParts'), /declaredParts\(\)\.map\(partRef\)/)
})

const partEnv = (parts: unknown[], answers: unknown[], blocks: Record<string, unknown> = {}) => {
  const clientPart = (path: string) => parts.find(p => (p as { address: string }).address === path) ?? null
  const clientAnswerOf = (id: string) => answers.find(a => (a as { decision: string }).decision === id) ?? null
  const clientName = (c: { name?: string } | null) => (c?.name ?? '').trim() || 'the client'
  const blockOf = (id: string) => blocks[id] ?? null
  return { clientPart, clientAnswerOf, clientName, blockOf }
}

test('a part’s own words are shown as typed, and start the reason for its change', () => {
  type F = { partSaid(p: unknown): string; askedReason(path: string): string }
  const words = '  Too young,\n\n  and too urban.  '
  const parts = [
    { address: 'audience', review: 'd_A', decision: 'd_P1', said: words, client: { name: 'Mary Kelly' } },
    { address: 'insight', review: 'd_A', decision: 'd_P2', client: { name: 'Mary Kelly' } },
    { address: 'tone_and_world', review: 'd_A', decision: 'd_P3', quote: 'It feels flat.', client: { name: 'Mary Kelly' } },
    { address: 'budget_and_scope', review: 'd_A', decision: 'd_P4', said: ' \n ', client: { name: 'Mary Kelly' } },
  ]
  const answers = [{ decision: 'd_A', said: 'Honestly, not the brief\nwe talked about.', client: { name: 'Mary Kelly' } }]
  // An older view without `said` on the part: its decision holds it.
  const blocks = { d_P2: { decision: { said: 'The insight is a platitude.' } } }
  const f = lift<F>(CLF, ['partSaid', 'askedReason'], partEnv(parts, answers, blocks))
  assert.equal(f.partSaid(parts[0]), words) // verbatim: not trimmed inside or out
  assert.equal(f.partSaid(parts[1]), 'The insight is a platitude.')
  assert.equal(f.partSaid(parts[3]), '')
  assert.equal(f.askedReason('audience'), 'Mary Kelly asked: Too young, and too urban.')
  assert.equal(f.askedReason('insight'), 'Mary Kelly asked: The insight is a platitude.')
  // A quote is not the part's own words: the document's words.
  assert.equal(f.askedReason('tone_and_world'), 'Mary Kelly asked: Honestly, not the brief we talked about.')
  // Only whitespace under the part: the document's words.
  assert.equal(f.askedReason('budget_and_scope'), 'Mary Kelly asked: Honestly, not the brief we talked about.')
  assert.equal(f.askedReason('nowhere'), '')
  // The popover shows them before the quote and the document's words.
  const pop = fn(CLF, 'popOf')
  assert.ok(pop.indexOf('partSaid(p)') < pop.indexOf('p.quote') && pop.indexOf('p.quote') < pop.indexOf('an.said'))
  assert.match(fn(CLF, 'makeChange'), /res\.reason\|\|askedReason\(path\)/)
  // Shown as typed: the quoted words keep their line breaks and spaces.
  assert.match(CLF, /\.clf-q\.said\{white-space:pre-wrap;overflow-wrap:anywhere\}/)
})

test('a suggestion by the host’s matcher is the Knowledge agent’s', () => {
  type F = { crewKey(d: unknown): string | null }
  const crew = () => ({ forWork: (w: string) => (w === 'read' ? 'knowledge' : ''), ofDecision: () => 'review' })
  const f = lift<F>(CLF, ['ellisKey', 'crewKey'], { crew }) as F & { ellisKey(): string }
  assert.equal(f.crewKey({ handler: 'client_parts_match@1', actor: 'process:host', action: 'suggest_part' }), 'knowledge')
  assert.equal(f.crewKey({ handler: 'client_parts_match@1' }), 'knowledge')
  assert.equal(f.crewKey({ handler: 'find_client_parts@1.0' }), 'knowledge') // an older chain
  assert.equal(f.crewKey({ handler: 'judge_brief@1' }), 'review')
})

test('a carried item nothing here can settle is set aside, with a reason', () => {
  type F = {
    carriedAt(ref: string): { address: string }[]
    setAsideOf(ref: string): unknown
    carriedName(a: unknown): string
    carriedBlock(items: unknown[]): string
    asideForm(target: string): string
  }
  const UP = '3f2a9c1e'
  const attention = [
    { code: 'unmerged_branch', blocks_lock: true, can_set_aside: true, address: `${UP}#agents[u.drafter.t]`, label: 'Agent branch · u.drafter.t' },
    { code: 'open_contest', blocks_lock: true, can_set_aside: true, address: `${UP}#merge-report[campaign.objective]` },
    { code: 'flagged_field', blocks_lock: true, can_set_aside: true, address: `${UP}#campaign.in_market`, label: 'Campaign › In market' },
    // Settled here, so not offered: a carried contest, the brief's own field.
    { code: 'open_contest', blocks_lock: true, address: `${UP}#selection.contested[ct_abv]` },
    { code: 'flagged_field', blocks_lock: true, address: 'brief#insight' },
  ]
  const decisions = [{ decision: { action: 'set_aside', rationale: 'The research settles it' },
    targets: [{ address: `${UP}#merge-report[campaign.objective]`, here: false, label: 'Merge conflict · campaign.objective' }] }]
  let locked = false
  const CARRIED_WHY = new Function(`${obj(CLF, 'CARRIED_WHY')} return CARRIED_WHY;`)()
  const env = {
    VIEW: { attention, decisions }, arr, esc, CARRIED_WHY, TICK: '', upTitle: () => '“Lúnasa launch”',
    trayNoun: () => 'brief', locked: () => locked, whoDid: () => 'You', dayMonth: (d: string) => d,
  }
  const f = lift<F>(CLF, ['refOfAddress', 'words', 'carriedAt', 'setAsideOf', 'carriedFrom', 'carriedName', 'carriedBlock', 'asideForm'], env)

  // Found by the ref a tray or a view passes: the path, or the whole address.
  assert.equal(f.carriedAt('agents[u.drafter.t]').length, 1)
  assert.equal(f.carriedAt(`${UP}#campaign.in_market`).length, 1)
  assert.equal(f.carriedAt('campaign.in_market').length, 1)
  assert.equal(f.carriedAt('ct_abv').length, 0, 'a carried contest is picked, not set aside')
  assert.equal(f.carriedAt('insight').length, 0, 'the brief’s own field is changed, not set aside')
  assert.ok(f.setAsideOf('merge-report[campaign.objective]'))
  assert.equal(f.setAsideOf('agents[u.drafter.t]'), null)

  // In plain words.
  assert.equal(f.carriedName(attention[0]), 'Work not brought back into “Lúnasa launch”')
  assert.equal(f.carriedName(attention[1]), 'Agents disagree on objective')
  assert.equal(f.carriedName({ code: 'open_contest', address: `${UP}#merge-report[decisions[d_x]]` }), 'Agents disagree on a call')
  assert.equal(f.carriedName(attention[2]), 'Campaign › In market')

  // One big button, naming the item; the reason is asked for, and required.
  const block = f.carriedBlock([attention[0]])
  assert.match(block, /<button type="button" class="clf-btn big primary" data-clf="aside" data-target="3f2a9c1e#agents\[u\.drafter\.t\]">Set aside, with a reason<\/button>/)
  assert.match(block, /Carried over from “Lúnasa launch”/)
  assert.match(block, /Nothing in “Lúnasa launch” changes/)
  const form = f.asideForm(attention[0].address)
  assert.match(form, /data-clf-form="aside" data-target="3f2a9c1e#agents\[u\.drafter\.t\]"/)
  assert.match(form, /<textarea name="why" required><\/textarea>/)
  assert.match(form, /<span class="req">needed<\/span>/)
  locked = true
  assert.doesNotMatch(f.carriedBlock([attention[0]]), /data-clf="aside"/, 'a locked brief sets nothing aside')

  // It is sent as the item's address with the person's words, never without.
  const submit = fn(CLF, 'onDrawerSubmit')
  assert.ok(submit.indexOf("kind==='aside'?'Say why this can go ahead without it.'") < submit.indexOf("act('/acknowledge',{target:form.getAttribute('data-target'),rationale:why}"))
  assert.match(fn(CLF, 'draw'), /carriedAt\(ref\)/)

  // A carried contest with no value this copy can take is offered (the host
  // marks it can_set_aside), in words about its sources, and its drawer
  // offers the set-aside in place of a pick.
  locked = false
  const pinless = { code: 'open_contest', blocks_lock: true, can_set_aside: true, address: `${UP}#selection.contested[ct_nopin]`, label: 'Sources disagree on abv' }
  attention.push(pinless)
  assert.equal(f.carriedAt('ct_nopin').length, 1)
  assert.equal(f.carriedName({ ...pinless, label: 'Contest · brand/orchard-hill:product.abv@IE' }), 'Sources disagree on abv')
  assert.equal(f.carriedName({ ...pinless, label: 'Contest · Export value · IE' }), 'Sources disagree on export value')
  assert.match(f.carriedBlock([pinless]), /The sources “Lúnasa launch” used disagree here, and this copy holds none of their values to pick from\./)
  assert.match(f.carriedBlock([attention[1]]), /Two agents working on/)
  assert.match(fn(CLF, 'draw'), /c\.status==='open'&&\(ca\.length\|\|sa\)/)
})

// ── the shared fields snippet: report wording keyed per part ───────────────

// The same page and hashes are pinned in server/tests/test_reconsider.py: the
// middleware splits the report page into these parts and hashes each as here,
// to know which part holds a person's wording.
test('report wording is keyed per top-level part, as the middleware splits and hashes it', () => {
  const env = {
    TAGS: new Function(`${obj(CLF, 'TAGS')} return TAGS;`)(),
    ATTRS: new Function(`${obj(CLF, 'ATTRS')} return ATTRS;`)(),
  }
  const f = lift<{ layoutParts(h: string): string[]; hash(s: string): string }>(CLF, ['layoutParts', 'hash'], env)
  const page = '<header class="cl-hero"><h1>Frozen grows</h1><p class="cl-dek">Value &amp; volume, “both”</p></header>\n'
    + '<section class="cl-band"><h2>Media</h2><p>Spend leans on one channel.<br>'
    + '<clan-cite refs="f_01JA0B3P4Q"></clan-cite></p></section>'
  const parts = f.layoutParts(page)
  assert.equal(parts.join(''), page)
  assert.deepEqual(parts.map(f.hash), ['kcamkm', '3t0v', 'v4mvo'])
  assert.equal(parts[1], '\n')
  for (const odd of ['<P>Upper</P><p>x</p>', '<p>a</p><p>b', '<p>a &copy;</p><p>b</p>', "<p title='x'>a</p><p>b</p>",
    '<p class="big">a</p><p>b</p>', '<p>a</p><!-- c --><p>b</p>', '<p>a<br/></p><p>b</p>'])
    assert.deepEqual(f.layoutParts(odd), [odd], odd)
  assert.equal(f.hash('abc'), '3772q3')
})

// ── the Research Tool ──────────────────────────────────────────────────────

const RT = page('campaign-research/index.html')
const MARKET = { IE: 'Ireland', GB: 'Great Britain' }

function researchEnv(campaign: Record<string, unknown>, manifest: Record<string, unknown>) {
  const calls: string[] = []
  const TITLE = { done: '', last: '' }
  const window = { __CLAN__: { manifest }, clan: { setTitle: (t: string) => { calls.push(t); return Promise.resolve({ ok: true }) } } }
  const document = { title: '' }
  const camp = () => campaign
  const marketNames = () => arr((campaign.markets as { value?: unknown })?.value).map(m => MARKET[m as keyof typeof MARKET] ?? m)
  return { calls, document, env: { camp, marketNames, listJoin, isObj, TITLE, window, document, MARKET } }
}
type TitleFns = { researchTitle(): string; titleIsOurs(t: string): boolean; syncTitle(): void }
const TITLE_FNS = ['brandName', 'workName', 'isMarketList', 'researchTitle', 'titleIsOurs', 'syncTitle']

test('the research is titled by its brand and markets, else its working name', () => {
  const t = (c: Record<string, unknown>) => lift<TitleFns>(RT, TITLE_FNS, researchEnv(c, {}).env).researchTitle()
  const brand = { value: { name: 'Lunasa', ref: 'b_1' } }
  assert.equal(t({ brand, markets: { value: ['IE', 'GB'] }, name: { value: 'Summer' } }), 'Lunasa · Ireland and Great Britain')
  assert.equal(t({ brand, markets: { value: ['IE'] } }), 'Lunasa · Ireland')
  assert.equal(t({ brand, name: { value: ' Summer push ' } }), 'Summer push')
  assert.equal(t({ brand }), 'Lunasa')
  assert.equal(t({ name: { value: 'Summer push' }, markets: { value: ['IE'] } }), 'Summer push')
  assert.equal(t({}), '')
})

test('the title is set over the tool’s name, never over one a person chose', async () => {
  const c = { brand: { value: { name: 'Lunasa' } }, markets: { value: ['IE'] }, name: { value: 'Summer push' } }
  for (const [title, set] of [
    ['Research Tool', true], ['Untitled research', true], ['', true], ['Summer push', true],
    ['Lunasa · Great Britain', true], ['Lunasa', true], ['Our pitch for Lunasa', false],
    ['Lunasa · Ireland and Great Britain', true], ['Lunasa · Great Britain, PL and Ireland', true],
    // A person's title that only starts like ours is theirs.
    ['Lunasa · Summer push', false], ['Lunasa · Ireland launch', false], ['Lunasa · Ireland and more', false],
  ] as const) {
    const r = researchEnv(c, { title })
    lift<TitleFns>(RT, TITLE_FNS, r.env).syncTitle()
    assert.deepEqual(r.calls, set ? ['Lunasa · Ireland'] : [], `over ${JSON.stringify(title)}`)
    assert.equal(r.document.title, 'Lunasa · Ireland · Research')
  }
})

test('a research that finished with nothing to cite says there is no report, never that it is ready', () => {
  const { doneWords } = lift<{ doneWords(rep: boolean, gaps: unknown[]): string }>(RT, ['doneWords', 'notRun'], { arr })
  const found = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `gap_${i}`, note: 'searched, nothing' }))
  const failed = { id: 'gap_f', note: 'research failed: research unreachable (ConnectError)' }
  const notRun = { id: 'gap_n', note: 'research did not run: it ran out of time (x)' }
  assert.equal(doneWords(true, found(3)), 'We’re done. Your report is ready.')
  assert.equal(doneWords(false, found(2)), 'We’re done, but there’s no report: nothing we found can be cited. What we couldn’t find is under Selection (2 gaps).')
  assert.equal(doneWords(false, found(1)), 'We’re done, but there’s no report: nothing we found can be cited. What we couldn’t find is under Selection (1 gap).')
  assert.equal(doneWords(false, []), 'We’re done, but there’s no report: nothing we found can be cited.')
  // A look-up that never ran is not something we "couldn't find".
  assert.equal(doneWords(false, [failed, notRun]), 'We’re done, but there’s no report: we couldn’t look it up, so there’s nothing to cite yet. What’s missing is under Selection (2 gaps).')
  assert.equal(doneWords(false, [failed, ...found(1)]), 'We’re done, but there’s no report: we couldn’t look some of it up, so there’s nothing to cite yet. What’s missing is under Selection (2 gaps).')
  assert.equal(doneWords(true, [failed]), 'We’re done. Your report is ready. We couldn’t look some of it up, so the report says less than it could. What’s missing is under Selection (1 gap).')
  assert.doesNotMatch(doneWords(false, [failed]), /couldn’t find/)
  assert.match(fn(RT, 'speech'), /sp\.text=doneWords\(rep, sel\(\)\.gaps\)/)
})

test('a step the job went on without reads Skipped, never Done', () => {
  const STAGES = ['extract', 'identify', 'select', 'research', 'synthesise', 'report'].map((k, i) => ({ k, i }))
  const STAGE = Object.fromEntries(STAGES.map(s => [s.k, s]))
  const run = (job: unknown, S: unknown) => lift<{ stageStates(): Record<string, string> }>(RT, ['stageStates', 'skippedStages', 'notRun'], {
    arr, isObj, STAGES, STAGE, CHAT: { job }, thread: () => [], D: () => ({}), sel: () => S,
  }).stageStates()
  // The job's reply names the gap.
  let st = run({ state: 'done', gaps: [{ stage: 'synthesise', reason: 'timeout' }, { stage: 'identify', reason: 'unanswered' }] }, {})
  assert.equal(st.synthesise, 'skip')
  assert.equal(st.identify, 'done', 'an unanswered question went on with a default: the step finished')
  assert.equal(st.report, 'done')
  // No reply at hand (a reload): every look-up failed, so the look-up step was skipped.
  st = run({ state: 'done' }, { lenses_run: [{ lens: 'consumer', market: 'IE' }], gaps: [{ lens: 'consumer', market: 'IE', note: 'research failed: research unreachable (ConnectError)' }] })
  assert.equal(st.research, 'skip')
  st = run({ state: 'done' }, { lenses_run: [{ lens: 'consumer', market: 'IE' }, { lens: 'media', market: 'IE' }], gaps: [{ lens: 'consumer', market: 'IE', note: 'research failed: x' }] })
  assert.equal(st.research, 'done', 'one look-up ran')
  assert.match(fn(RT, 'stepsHtml'), /skip:'Skipped'/)
})

// A question the agents ask during a run can be skipped (features/research-skip-question, middleware-api §8.3).
test('the question card has Skip this one; a skip is the person’s write, then answer_question with skip: true', async () => {
  const q = { id: 'q_brand1', text: 'Which brand is this campaign for? Type its name.', options: [], allow_text: true, address: 'd1#campaign.brand' }
  const CHAT: Record<string, unknown> = { answering: null, qdraft: {}, job: { id: 'job_1', state: 'needs_input', stage: 'identify', question: q } }
  const thread: unknown[] = []
  const card = (busy = false) => { CHAT.answering = busy ? q.id : null; return lift<{ questionCard(Q: unknown, T: unknown): string }>(RT, ['questionCard'], {
    arr, isObj, esc, CHAT, answerTo: () => null, slug: (x: string) => x, runRole: () => 'strategy', qField: () => 'brand', FIELD: { brand: { label: 'Brand' } },
    NUM: {}, PLAN: [], agentLine: () => '', TheAgent: () => 'The Strategy agent', optNote: () => '',
  }).questionCard({ q, stage: 'identify' }, thread) }
  const html = card()
  assert.match(html, /<button type="button" class="aq-skip" data-act="q-skip" data-q="q_brand1">Skip this one<\/button><\/div>$/)
  assert.match(card(true), /class="aq-skip" data-act="q-skip" data-q="q_brand1" disabled>Skip this one</, 'not while an answer is saving')
  assert.match(RT, /case 'q-skip': doSkip\(b\.getAttribute\('data-q'\)\); break;/)
  assert.match(RT, /\.p33-askcard \.aq-skip\{[^}]*text-decoration:underline/, 'Brief Maker’s link style')

  const writes: { patch: Record<string, Record<string, Record<string, Record<string, unknown>>>>; rationale: string }[] = []
  const sent: { task: string; input: Record<string, unknown> }[] = []
  const replies: unknown[] = []
  const f = lift<{ doSkip(qid: string): void }>(RT, ['doSkip', 'sendAnswer'], {
    CHAT, liveQuestion: () => q, toast: (m: string) => { throw new Error(m) }, me: () => 'u_aoife', WHO: {}, doWho: () => {},
    ulid: () => 'SKIP0001', mintDecisionId: () => 'd_SKIP0001', nowIso: () => '2026-11-12T10:00:00Z', addr: (p: string) => `d1#${p}`,
    renderChat: () => {}, POLL: { delay: 0 }, hostErr: () => null, onJobReply: (r: unknown) => { replies.push(r) }, pollNow: () => {}, unreachable: () => {},
    humanWrite: (patch: never, _a: string, rationale: string) => { writes.push({ patch, rationale }); return Promise.resolve({ ok: true }) },
    window: { clan: { apiProxy: (_: string, body: { task: string; input: Record<string, unknown> }) => { sent.push(body); return Promise.resolve({ job: { state: 'running' } }) } } },
  })
  CHAT.answering = null
  f.doSkip('q_brand1')
  for (let i = 0; i < 4; i++) await Promise.resolve()
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].patch.intake.messages.msg_SKIP0001, { role: 'user', by: 'human:u_aoife', at: '2026-11-12T10:00:00Z', text: 'Skipped', job_id: 'job_1', answer: { question_id: 'q_brand1', skipped: true } })
  assert.equal(Object.keys(writes[0].patch).join(), 'intake', 'a skip writes no field')
  assert.match(writes[0].rationale, /^d_SKIP0001 · answer_question · d1#intake\.messages\[msg_SKIP0001\] · q_brand1 skipped by human:u_aoife; the field stays open$/)
  assert.deepEqual(sent, [{ task: 'answer_question', input: { job_id: 'job_1', question_id: 'q_brand1', skip: true } }])
  assert.equal(replies.length, 1)
  // a skip that did not reach the job is sent again as a skip
  assert.match(fn(RT, 'doResend'), /x\.skipped\?\{skip:true\}/)
})

test('a skipped question is not a skipped step, and the request sheet says Skipped', () => {
  const STAGES = ['extract', 'identify', 'select', 'research', 'synthesise', 'report'].map((k, i) => ({ k, i }))
  const STAGE = Object.fromEntries(STAGES.map(s => [s.k, s]))
  const st = lift<{ stageStates(): Record<string, string> }>(RT, ['stageStates', 'skippedStages', 'notRun'], {
    arr, isObj, STAGES, STAGE, CHAT: { job: { state: 'done', gaps: [{ stage: 'identify', reason: 'skipped' }, { stage: 'research', reason: 'no_market' }] } }, thread: () => [], D: () => ({}), sel: () => ({}),
  }).stageStates()
  assert.equal(st.identify, 'done', 'the person skipped a question; the step finished')
  assert.equal(st.research, 'skip')
  const row = lift<{ answerRow(Q: unknown, ans: unknown, earlier: string[]): string }>(RT, ['answerRow'], {
    arr, isObj, esc, qField: () => 'markets', FIELD: { markets: { label: 'Markets' } }, whoLabel: () => 'you', askerOf: () => 'The Strategy agent', ICON: {},
  }).answerRow({ q: { id: 'q_mk', text: 'Which markets is it for?' }, stage: 'identify' }, { m: { text: 'Skipped', by: 'human:u', answer: { question_id: 'q_mk', skipped: true } } }, [])
  assert.match(row, /<dt>Markets<\/dt><dd><span class="aval"><span class="none">Skipped<\/span><span class="pill">skipped by you<\/span><\/span>/)
})

type ReportFns = { reportStale(r: unknown): string[]; refreshBtn(stale: string[], title: string): string }
function reportEnv(locked: boolean, chain: unknown[]) {
  const pathOf = (a: unknown) => { const s = String(a), i = s.indexOf('#'); return i < 0 ? s : s.slice(i + 1) }
  return {
    arr, isObj, esc, pathOf, proj: () => ({ built_from: {} }), decs: () => chain, human: (a: unknown) => String(a),
    CHAT: { reportBusy: false }, ...((CF: unknown) => ({ ClanFields: CF, window: { ClanFields: CF } }))({ locked: () => (locked ? { decision: {} } : null) }),
  }
}
const REPORT_FNS = ['touchesAsk', 'reportWriter', 'reportLocked', 'touchesExcluded', 'touchesCampaign', 'reportStale', 'staleText', 'refreshBtn']
const STALE_BY = new Function(`${obj(RT, 'STALE_BY')} return STALE_BY;`)() as Record<string, string>
type StaleFns = ReportFns & { staleText(kinds: string[]): string }

test('a report is out of date by what came after it in the chain, never by the clock', () => {
  // Newest first. The edit after the report carries an older stamp: the chain says it came after.
  const chain = [
    { action: 'edit', actor: 'human:aoife', targets: ['doc#campaign.objective'], timestamp: '2020-01-01T00:00:00Z' },
    // A person's check and a question asked of the research are shown live: neither dates the report.
    { action: 'verified', actor: 'human:aoife', targets: ['doc#findings[fi_A]', 'doc#campaign.audience'] },
    { action: 'research_merge', actor: 'process:middleware', targets: ['doc#facts[f_NEW]', 'doc#asks[ask_1]'] },
    { action: 'compose_report', actor: 'process:middleware', targets: ['doc#report'], timestamp: '2026-09-30T10:00:00Z' },
    { action: 'edit', actor: 'human:aoife', targets: ['doc#campaign.problem'], timestamp: '2030-01-01T00:00:00Z' },
  ]
  const f = lift<StaleFns>(RT, REPORT_FNS, { ...reportEnv(false, chain), STALE_BY })
  const r = { built_at: '2026-09-30T10:00:00Z', based_on: {} }
  const stale = f.reportStale(r)
  assert.deepEqual(stale, ['the ask changed'])
  assert.equal(f.staleText(stale), 'Since this report: the ask changed.')
  // Research the report has not taken in does date it.
  const more = lift<StaleFns>(RT, REPORT_FNS, { ...reportEnv(false, [{ action: 'research_run', targets: ['doc#selection.lenses_run[media_spend/IE]'] }, ...chain]), STALE_BY })
  assert.equal(more.staleText(more.reportStale(r)), 'Since this report: new research and the ask changed.')
  // No decision wrote the report: nothing is said to be newer than it.
  const none = { ...reportEnv(false, [chain[0], chain[4]]), STALE_BY }
  assert.deepEqual(lift<ReportFns>(RT, REPORT_FNS, none).reportStale(r), [])
  assert.doesNotMatch(fn(RT, 'reportStale'), /Date\.parse|timestamp|built_at/)
  // Out of date and open: Refresh report is the thing to press.
  assert.match(f.refreshBtn(stale, ''), /class="btn sm primary"/)
  assert.doesNotMatch(f.refreshBtn(stale, ''), / disabled/)
})

test('a locked report is the version agreed to: never out of date, Refresh not offered', () => {
  const chain = [
    { action: 'edit', actor: 'human:aoife', targets: ['doc#campaign.objective'] },
    { action: 'compose_report', targets: ['doc#report'] },
  ]
  const env = { ...reportEnv(true, chain), STALE_BY }
  const f = lift<ReportFns>(RT, REPORT_FNS, env)
  assert.deepEqual(f.reportStale({ based_on: { facts_sha256: 'a' } }), [])
  const b = f.refreshBtn(['anything'], 'compose_report: re-compose')
  assert.doesNotMatch(b, /primary/)
  assert.match(b, / disabled/)
  assert.match(b, /title="The report is locked: this version is the one agreed to\."/)
  // And what came since is said only of a stale report, which a locked one never is.
  assert.match(fn(RT, 'renderReport'), /stale\.length\?'<span style="color:var\(--create-ink\)">'\+esc\(staleText\(stale\)\)/)
  assert.match(fn(RT, 'doRefreshReport'), /if\(reportLocked\(\)\)\{ toast\(/)
})

// A review changes only the document; the crew then brings what rests on it
// in step with one reconsider job at a time, holding reviews made meanwhile.
const RECON_FNS = ['reviewEvent', 'reviewed', 'keepRecon', 'walk', 'sideAgent', 'reconsider', 'roles', 'agentName', 'theAgent', 'TheAgent', 'sphereTag']
/** The one agent engine's front door (agent-sphere/roles.js), loaded into a window of its own. */
function rolesWindow(): Record<string, unknown> {
  const w: Record<string, unknown> = {}
  new Function('window', page('shared/agent-sphere/roles.js'))(w)
  return w
}
type Job = { task: string; input: { events: { kind: string; id: string; decision: string; replaced_by?: string }[] }; then: ((j: Job) => void) | null; error?: string; jobId?: string; quiet?: boolean }
function reconEnv(locked = false) {
  const runs: Job[] = []
  const kept: (string | null)[] = []
  const RECON = { queue: [] as unknown[], job: null as Job | null }
  const classes = new Set<string>()
  const walker = { innerHTML: '', classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) } } }
  // The agent at work, at the top of the side panel (owner: the agent stays in the main screen or moves to the side panel).
  const sattr: Record<string, string> = {}
  const side = { innerHTML: '', hidden: true, getAttribute: (k: string) => sattr[k] ?? null, setAttribute: (k: string, v: string) => { sattr[k] = v } }
  const env = {
    RECON, arr, walker, esc, ROLE_NM: {},
    $: (id: string) => (id === 'walker' ? walker : id === 'sideAgent' ? side : null),
    document: { body: { classList: { contains: () => false } } },
    isObj: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v), D: () => ({ report: {} }),
    ASK: { jobs: [] }, JOBS: [], CHAT: {}, LENS: {}, lensName: (l: string) => l, clipT: (t: string) => t,
    calm: () => false,
    setTimeout: () => 0, clearTimeout: () => {},
    pathOf: (a: string) => (a.includes('#') ? a.slice(a.indexOf('#') + 1) : a),
    store: (_k: string, v: string | null) => { kept.push(v) },
    docId: () => 'doc1',
    reportLocked: () => locked,
    window: { ...rolesWindow(), clan: { apiProxy: () => Promise.resolve() } },
    runTask: (task: string, input: Job['input'], then: Job['then'], quiet?: boolean) => { const j = { task, input, then, quiet }; runs.push(j); return j },
  }
  type F = { reviewed(route: string, body: unknown, res: unknown): void; reviewEvent(route: string, body: unknown, res: unknown): unknown }
  return { f: lift<F>(RT, RECON_FNS, env), runs, kept, RECON, walker, side }
}
/** The job is over: the view tells whoever started it, once. */
const finish = (j: Job, how: Partial<Job> = { jobId: 'job_1' }) => { Object.assign(j, how); const t = j.then; j.then = null; t?.(j) }

test('each review the host accepted is one reconsider event', () => {
  const { f } = reconEnv()
  const reply = (decision: string, ...targets: string[]) => ({ ok: true, decision, targets })
  assert.deepEqual(f.reviewEvent('/verify', { finding: 'fi_01A' }, reply('d_1', 'doc1#findings[fi_01A]')),
    { kind: 'finding_verified', id: 'fi_01A', decision: 'd_1' })
  assert.deepEqual(f.reviewEvent('/verdict', { target: 'findings[fi_01A]', polarity: 'bad' }, reply('d_2', 'doc1#findings[fi_01A]')),
    { kind: 'finding_rejected', id: 'fi_01A', decision: 'd_2' })
  assert.deepEqual(f.reviewEvent('/verdict', { target: 'facts[f_01B]', polarity: 'good' }, reply('d_3', 'doc1#facts[f_01B]')),
    { kind: 'fact_verified', id: 'f_01B', decision: 'd_3' })
  assert.deepEqual(f.reviewEvent('/verdict', { target: 'doc1#facts[f_01B]', polarity: 'bad' }, reply('d_4', 'doc1#facts[f_01B]')),
    { kind: 'fact_rejected', id: 'f_01B', decision: 'd_4' })
  assert.deepEqual(f.reviewEvent('/correct', { fact: 'f_01B', value: '31%' }, reply('d_5', 'doc1#facts[f_01B]', 'doc1#facts[f_01NEW]')),
    { kind: 'fact_corrected', id: 'f_01B', decision: 'd_5', replaced_by: 'f_01NEW' })
  // Not a review of a fact or a finding: nothing to reconsider.
  assert.equal(f.reviewEvent('/verdict', { target: 'campaign.objective', polarity: 'bad' }, reply('d_6', 'doc1#campaign.objective')), null)
  assert.equal(f.reviewEvent('/resolve', { contest: 'ct_a' }, reply('d_7', 'doc1#selection.contested[ct_a]')), null)
  assert.equal(f.reviewEvent('/verify', { finding: 'fi_01A' }, { ok: false }), null)
  // Every place a review is given reaches it: the OS's drawer, and the view's own.
  assert.match(fn(CLF, 'act'), /if\(res&&res\.ok\) window\.dispatchEvent\(new CustomEvent\('clan:reviewed',\{detail:\{route:route,body:body,reply:res\}\}\)\)/)
  assert.match(RT, /addEventListener\('clan:reviewed', function\(e\)\{ var d=e\.detail\|\|\{\}; reviewed\(d\.route, d\.body, d\.reply\); \}\)/)
  assert.match(fn(RT, 'hostDecide'), /if\(res&&res\.ok\) reviewed\(route, body, res\)/)
  assert.doesNotMatch(RT, /reconsider_fact/)
})

test('a review made while a reconsider job runs is held and sent with the next run', () => {
  const { f, runs, kept, RECON } = reconEnv()
  const res = (d: string, t: string) => ({ ok: true, decision: d, targets: [`doc1#${t}`] })
  f.reviewed('/verdict', { polarity: 'bad' }, res('d_1', 'facts[f_01A]'))
  assert.equal(runs.length, 1)
  assert.equal(runs[0].task, 'reconsider')
  assert.deepEqual(runs[0].input.events.map(e => e.decision), ['d_1'])

  // Two more while it runs: no second job, both held.
  f.reviewed('/verify', { finding: 'fi_01B' }, res('d_2', 'findings[fi_01B]'))
  f.reviewed('/verdict', { polarity: 'good' }, res('d_3', 'facts[f_01C]'))
  assert.equal(runs.length, 1, 'one job per document at a time')
  assert.deepEqual(RECON.queue.map(e => (e as { decision: string }).decision), ['d_2', 'd_3'])
  assert.ok(kept.at(-1)?.includes('d_3'), 'the held reviews outlive a reload')

  // It finishes: the next run takes both, together.
  finish(runs[0])
  assert.equal(runs.length, 2)
  assert.deepEqual(runs[1].input.events.map(e => e.kind), ['finding_verified', 'fact_verified'])
  assert.equal(RECON.queue.length, 0)
  finish(runs[1])
  assert.equal(runs.length, 2, 'nothing left to send')
  assert.equal(RECON.job, null)
  assert.equal(kept.at(-1), null)
})

test('reviews a reconsider job never started wait for the next one', () => {
  const { f, runs, RECON } = reconEnv()
  const res = (d: string) => ({ ok: true, decision: d, targets: ['doc1#facts[f_01A]'] })
  f.reviewed('/verdict', { polarity: 'bad' }, res('d_1'))
  // The middleware could not be reached: no job id.
  finish(runs[0], { error: 'unreachable' })
  assert.equal(runs.length, 1, 'not retried at once')
  assert.deepEqual(RECON.queue.map(e => (e as { decision: string }).decision), ['d_1'])
  f.reviewed('/verdict', { polarity: 'good' }, res('d_2'))
  assert.deepEqual(runs[1].input.events.map(e => e.decision), ['d_1', 'd_2'])
  // A job that ran and failed, or whose change was refused because a review
  // landed meanwhile, goes once more with what waited.
  f.reviewed('/verdict', { polarity: 'bad' }, res('d_3'))
  finish(runs[1], { jobId: 'job_2', error: 'finding fi_01A changed since the job read it; rerun' })
  assert.deepEqual(runs[2].input.events.map(e => e.decision), ['d_1', 'd_2', 'd_3'])
  assert.ok(runs[2].input.events.every(e => !('tries' in e)), 'the count stays in the view')
  // Never a third time: a job that keeps failing does not loop.
  finish(runs[2], { jobId: 'job_3', error: 'failed' })
  assert.deepEqual(runs[3].input.events.map(e => e.decision), ['d_3'])
  finish(runs[3], { jobId: 'job_4', error: 'failed' })
  assert.equal(runs.length, 4)
  assert.equal(RECON.queue.length, 0)
})

test('a review leaves the page where it is, and the Strategy agent works in the side panel while the agents do', () => {
  const { f, runs, walker, side } = reconEnv()
  const on = () => walker.classList.contains('on')
  assert.ok(side.hidden)
  f.reviewed('/verdict', { polarity: 'good' }, { ok: true, decision: 'd_1', targets: ['doc1#facts[f_01A]'] })
  assert.equal(runs[0].quiet, true, 'the reconsider job does not scroll the page')
  assert.ok(!side.hidden, 'the Strategy agent shows in the side panel while the job runs')
  assert.ok(!on(), 'not on the bottom edge: the agent has moved to the side panel')
  assert.match(side.innerHTML, /<span class="nk-ag nk-side" data-nk-agent="strategy" data-nk-state="working" data-nk-size="110" data-nk-fit="1"[^>]*aria-hidden="true"><svg class="nk-still"/, 'its sphere, working, at the shared size, filling its box (the static frame until it is hydrated)')
  assert.match(side.innerHTML, /<span class="nk-job-role">STRATEGY AGENT<\/span><span class="nk-job-do">Bringing the report in step with your review<\/span>/)
  assert.doesNotMatch(side.innerHTML, /agent-figure|walking/)
  finish(runs[0])
  assert.ok(side.hidden, 'and leaves when nothing is pending')
  assert.equal(side.innerHTML, '')
  // A job a person starts still brings the jobs panel into view.
  assert.match(fn(RT, 'runTask'), /if\(!quiet&&el&&el\.scrollIntoView\) el\.scrollIntoView/)
  assert.match(RT, /<div class="walker" id="walker" role="status" aria-live="polite"><\/div>/)
  assert.match(RT, /@media \(prefers-reduced-motion: reduce\)\{\.walker\{transition:none\}\}/)
  assert.doesNotMatch(RT, /wk-pace|wk-turn/, 'the sphere stands; nothing walks')
  assert.match(RT, /<div class="side-agent" id="sideAgent" role="status" aria-live="polite" hidden><\/div>/, 'the side panel holds the agent at work')
})

// The agents are named by role and drawn as their sphere (owner, 2026-11-09): no figure, no crew name.
test('the research names its agents by role, draws them as spheres, and asks on the desk', () => {
  assert.doesNotMatch(RT, /agentFigure|agent-figure|NapkinAgents|AGENT_FIGURES|@napkin:agent-figures|CREW_OK/)
  assert.doesNotMatch(RT, /\b(Ellis|Dara|Jude|Sam|Dex|Max|Bo|Cam|Cody|Remy|Mo|Lex|Eden)\b/)
  // the brief and the shared fields, too: no crew name and no figure, only the one engine's spheres
  for (const src of [BM, CLF]) {
    assert.doesNotMatch(src, /\b(Ellis|Dara|Jude|Sam|Dex)\b|agentFigure|agent-figure|NapkinAgents/)
  }
  assert.match(BM, /<div class="sstage" id="meet" data-nk-stage>/, 'the brief stage is a thread and ask stage')
  assert.match(fn(BM, 'askInStage'), /ROLES\.ask\(stage, true\)/)
  assert.match(fn(BM, 'askInStage'), /ROLES\.ask\(stage, false\)/)
  assert.match(BM, /\.sstage\.nk-asking \.aglbox\{height:/, 'asking lifts the sphere inside the stage')
  assert.match(RT, /if\(window\.NapkinRoles\)\{ NapkinRoles\.auto\(\); NapkinRoles\.thread\(\); \}/)
  // The run's stage follows PLAN, the engine's stages for research; the words about a stage's work name its role.
  const { runRole, TheAgent } = lift<{ runRole(s: string): string; TheAgent(r: string): string }>(RT, ['roles', 'agentName', 'theAgent', 'TheAgent', 'runRole'], { window: rolesWindow(), ROLE_NM: {}, PLAN: [] })
  // Finding the points is the Synthesis agent's (the mock's "Synthesis agent found 3 points").
  assert.deepEqual(['extract', 'identify', 'select', 'research', 'synthesise', 'report'].map(runRole), ['strategy', 'strategy', 'strategy', 'research', 'synthesis', 'review'])
  assert.equal(TheAgent('synthesis'), 'The Synthesis agent')
  assert.equal(TheAgent('knowledge'), 'The Knowledge agent')
  assert.match(fn(RT, 'stageLabel'), /extract:TheAgent\('knowledge'\)\+' reads what you sent'.*select:TheAgent\('strategy'\)\+' picks what to look into'/s)
  assert.match(fn(RT, 'stageLabel'), /synthesise:TheAgent\('synthesis'\)\+' finds the points', report:TheAgent\('synthesis'\)\+' writes the report'/)
  // Step 1's sub-questions are picked by the agent at work then: select runs as the Strategy agent (runRole above).
  assert.match(fn(RT, 'railsFor'), /'Sub-questions queued', right, \['Not picked yet', TheAgent\('strategy'\)\+' picks what to look into, one question per lens\.'\]/)
  assert.match(fn(RT, 'rpBand'), /' by '\+theAgent\('synthesis'\)/, 'the report is written by the Synthesis agent')
  assert.match(fn(RT, 'questionCard'), /k=runRole\(Q\.stage\)/)
  // The stage: a thread from each rail card to the sphere; the question under the caption, inside the stage.
  const work = fn(RT, 'workHtml')
  assert.match(work, /<div class="sstage'\+\(ASKING\?' nk-asking':''\)\+'" id="rt-stage" data-nk-stage>/)
  assert.ok(work.indexOf('class="scap"') < work.indexOf('rt-askwrap') && work.indexOf('rt-askwrap') < work.indexOf("'<div class=\"rail\">'+R[1]"), 'the card sits in the score column, under the caption')
  assert.doesNotMatch(RT, /rt-qrow/)
  const chat = fn(RT, 'renderChat')
  assert.match(chat, /if\(stg&&asking!==ASKING\)\{ void stg\.offsetHeight; if\(window\.NapkinRoles\) NapkinRoles\.ask\(stg, asking\);/, 'only a change moves the sphere')
  assert.doesNotMatch(chat, /scrollIntoView/, 'a question never scrolls the page')
  assert.match(fn(RT, 'placeSphere'), /kind:asking&&i===at\?'human':p\.kind/, 'the sphere needs the person while it asks')
  assert.match(RT, /\.rt-work \.nk-asking \.aglbox\{height:calc\(min\(340px,40vh\) \* \.46\)\}/)
  assert.match(RT, /\.rt-work \.wcard:hover\{transform:translateY\(-1\.5px\);border-color:var\(--ink\)\}/)
  assert.match(RT, /@media \(prefers-reduced-motion:reduce\)\{[^\n]*\.rt-work \.aglbox,\.rt-work \.rt-askwrap,\.rt-work \.rt-askin > \.p33-askcard,\.rt-work \.wcard\{transition:none\}/)
})

test('a locked report starts no reconsider job', () => {
  const { f, runs, RECON } = reconEnv(true)
  f.reviewed('/verify', { finding: 'fi_01A' }, { ok: true, decision: 'd_1', targets: ['doc1#findings[fi_01A]'] })
  assert.equal(runs.length, 0)
  assert.equal(RECON.queue.length, 1)
})

// A research started from a brief, or with one linked (features/spinoff-and-links):
// with nothing else to read, the brief's ask is read once, on open.
function askEnv(over: { data?: Record<string, unknown>; chain?: unknown[]; thread?: unknown[]; jobs?: unknown[]; asked?: boolean; bridge?: boolean } = {}) {
  const runs: { task: string; input: unknown; quiet?: boolean }[] = []
  const toasts: string[] = []
  const kept: Record<string, string> = over.asked ? { 'clan.research.askedFromBrief.doc1': '1' } : {}
  const data = over.data ?? { upstream: { b1: { client: 'Orchard Hill Cider', audience: 'Irish adults' } }, campaign: {} }
  const env = {
    ASK_FIELDS: ['client', 'audience', 'background', 'objectives'],
    CHAIN: { state: 'ok', decisions: over.chain ?? [] },
    window: over.bridge === false ? {} : { clan: { apiProxy: () => Promise.resolve() } },
    isObj, D: () => data,
    camp: () => (isObj(data.campaign) ? data.campaign : {}),
    mats: () => (isObj(data.materials) ? data.materials : {}),
    thread: () => over.thread ?? [], JOBS: over.jobs ?? [],
    decs: () => over.chain ?? [],
    docId: () => 'doc1',
    stored: (k: string) => kept[k] ?? null,
    store: (k: string, v: string) => { kept[k] = v },
    runTask: (task: string, input: unknown, _then: unknown, quiet?: boolean) => { runs.push({ task, input, quiet }) },
    toast: (t: string) => { toasts.push(t) },
  }
  return { f: lift<{ askFromBrief(): void; briefUpstream(): string | null }>(RT, ['briefUpstream', 'askFromBrief'], env), runs, toasts, kept }
}

test('a research from a brief reads the brief’s ask once on open, and never over anything already there', () => {
  const { f, runs, toasts } = askEnv()
  assert.equal(f.briefUpstream(), 'b1')
  f.askFromBrief()
  assert.deepEqual(runs, [{ task: 'extract_ask', input: { prompt: '', attachments: [] }, quiet: true }])
  assert.match(toasts[0], /brief/)
  f.askFromBrief()
  assert.equal(runs.length, 1, 'once per document')
  const none = (over: Parameters<typeof askEnv>[0]) => { const e = askEnv(over); e.f.askFromBrief(); return e.runs.length }
  assert.equal(none({ data: { upstream: { r1: { campaign: {} } }, campaign: {} } }), 0, 'a research upstream is not a brief')
  assert.equal(none({ data: { campaign: {} } }), 0, 'made from nothing')
  assert.equal(none({ data: { upstream: { b1: { client: 'A' } }, campaign: { client_org: { value: 'A', origin: 'stated' } } } }), 0, 'the ask is begun')
  assert.equal(none({ data: { upstream: { b1: { client: 'A' } }, campaign: {}, materials: { mat_0001: {} } } }), 0, 'material to read: the person runs it')
  assert.equal(none({ chain: [{ handler: 'extract_ask@1.0', action: 'extract_ask' }] }), 0, 'the ask was read already')
  assert.equal(none({ thread: [{ id: 'm1' }] }), 0, 'the intake has begun')
  assert.equal(none({ jobs: [{ task: 'research_lens' }] }), 0, 'a job is running')
  assert.equal(none({ asked: true }), 0, 'asked already in this session')
  assert.equal(none({ bridge: false }), 0, 'no bridge yet: it waits for it')
})

test('the Research Tool’s parts declare their aliases', () => {
  const PART_ALIASES = new Function(`${obj(RT, 'PART_ALIASES')} return PART_ALIASES;`)() as Record<string, string>
  assert.equal(PART_ALIASES.audience_stated, 'audience, target, who')
  assert.match(fn(RT, 'partAttrs'), /data-clan-part-aliases=/)
})

// ── Brief Maker ────────────────────────────────────────────────────────────

const BM = page('brief-maker/index.html')

test('the brief’s parts declare the words a client calls them by', () => {
  const A = new Function(`${obj(BM, 'PART_ALIASES')} return PART_ALIASES;`)() as Record<string, string>
  assert.equal(A.audience, 'audience, target, who')
  assert.equal(A.budget_and_scope, 'budget, cost, spend, scope')
  assert.equal(A.tone_and_world, 'tone, voice, feel')
  assert.equal(A.single_minded_proposition, 'proposition, line, idea, smp')
  // Every field the brief declares as a part has some; each list is words.
  const keys = [...BM.matchAll(/\{sec:'[^']+',key:'([^']+)'/g)].map(m => m[1])
  assert.ok(keys.length > 10)
  for (const k of keys) {
    assert.ok(A[k], `aliases for ${k}`)
    assert.ok(A[k].split(',').every(w => w.trim().length > 0 && w.trim().length <= 60), k)
  }
  assert.match(fn(BM, 'fieldRow'), /row\.setAttribute\('data-clan-part-aliases', PART_ALIASES\[f\.key\]\)/)
})

test('the Review agent says nothing needs you only when the review agrees', () => {
  type F = { scoreGaps(): { dimension: string }[]; holdsLine(passed: number, others: boolean, gaps: number): string }
  const W = ['none', 'one', 'two', 'three', 'four', 'five']
  const num = (n: number) => W[n] ?? String(n)
  const parts = (n: number) => `${num(n)} ${n === 1 ? 'part' : 'parts'}`
  const f = (review: unknown) => lift<F>(BM, ['scoreGaps', 'holdsLine'], { get: () => review, arr, num, parts })
  const dims = (...v: string[]) => ({ scorecard: { dimensions: v.map((verdict, i) => ({ dimension: `d${i}`, verdict })) } })
  // Every check passes and the review has no complaint: the old line stands.
  assert.equal(f(dims('pass', 'pass')).scoreGaps().length, 0)
  assert.equal(f(dims('pass')).holdsLine(3, false, 0), 'I checked three parts and they hold up. Nothing needs you.')
  // A dimension rated Too vague or Missing is a gap, and the line says so instead.
  const g = f(dims('pass', 'vague', 'missing', 'vague'))
  assert.deepEqual(g.scoreGaps().map(x => x.dimension), ['d1', 'd2', 'd3'])
  assert.equal(g.holdsLine(3, false, 3), 'I checked three parts and they hold up. The review still rates three things short of good.')
  assert.equal(g.holdsLine(1, false, 1), 'I checked one part and it holds up. The review still rates one thing short of good.')
  assert.doesNotMatch(g.holdsLine(3, false, 3), /Nothing needs you/)
  // Lock items waiting never read as "nothing needs you" either.
  assert.doesNotMatch(f(dims('pass')).holdsLine(3, true, 0), /Nothing needs you/)
  // No review yet: no gaps.
  assert.deepEqual(f(null).scoreGaps(), [])
  assert.deepEqual(f({}).scoreGaps(), [])
  // The page asks it of the review, in place of the old fixed sentence.
  assert.match(fn(BM, 'renderCrewline'), /holdsLine\(passed,jOthers,jGaps\?gaps:0\)/)
  assert.doesNotMatch(fn(BM, 'renderCrewline'), /' Nothing needs you\.'/)
})

test('a brief from research names the research by the title the research gave itself', () => {
  type F = { upTitle(): string }
  const UP_MARKET = { IE: 'Ireland', GB: 'Great Britain' }
  const envVal = (v: unknown) => (isObj(v) && 'value' in (v as object) ? (v as { value: unknown }).value : v)
  const listWords = listJoin
  const t = (store: string, campaign: Record<string, unknown>) =>
    lift<F>(BM, ['upTitle'], { upData: () => ({ campaign }), upStoreTitle: () => store, envVal, arr, listWords, UP_MARKET }).upTitle()
  const c = { brand: { value: { name: 'Lunasa' } }, markets: { value: ['IE', 'GB'] }, name: { value: 'Summer push' } }
  assert.equal(t('Lunasa · Ireland and Great Britain', c), 'Lunasa · Ireland and Great Britain')
  assert.equal(t('Our pitch', c), 'Our pitch')
  // The store only knows the tool's name: the research's own rule, from its frozen copy.
  assert.equal(t('Research Tool', c), 'Lunasa · Ireland and Great Britain')
  assert.equal(t('Untitled research', c), 'Lunasa · Ireland and Great Britain')
  assert.equal(t('', { name: { value: 'Summer push' } }), 'Summer push')
  assert.equal(t('', { brand: { value: { name: 'Lunasa' } } }), 'Lunasa research')
})

test('a part the Judge failed can be kept with a reason, empty or not', () => {
  const notes = fn(BM, 'notesHtml')
  assert.match(notes, /act-override/)
  assert.match(notes, /'Leave it empty, and say why'/)
  assert.match(notes, /'Keep it as it is, and say why'/)
  // It is answered where it was asked: a reason box in place, recorded as the
  // drawer's override is (a reasoned good verdict on the part), never the drawer.
  assert.match(fn(BM, 'bindNotes'), /\.act-override'\)\.forEach\(function\(o\)\{ o\.addEventListener\('click'/)
  assert.match(fn(BM, 'bindNotes'), /overrideHere\(o, f, ks\.length\?ks:null\)/)
  const here = fn(BM, 'overrideHere')
  assert.match(here, /var ks=keys&&keys\.length\?keys:\[f\.key\]/)
  assert.match(here, /hostPost\('\/verdict',\{target:left\.shift\(\), polarity:'good', rationale:why\}\)/)
  assert.match(here, /if\(!why\)/, 'a reason is needed')
  assert.doesNotMatch(here, /type="submit"/, 'an app frame has no allow-forms: Save acts on its click')
  // The drawer offers the override on a path whatever its value.
  const vb = fn(CLF, 'verdictBlock')
  assert.match(vb, /data-clf="override"/)
  assert.doesNotMatch(vb.slice(0, vb.indexOf('data-clf="override"')), /editableValue|textOf/)
})

// One check across parts, answered on one of them already (the Judge passed
// that part's redraft): the card sits on a part that still waits on it, and
// the note on every other part points there (final retest, HIGH 1).
test('a check across parts shows its card on a part it still waits on', () => {
  const D = 'doc1'
  const FIELDS = [
    { key: 'budget_and_scope', label: 'Budget & scope', sec: 'Budget' },
    { key: 'mandatories', label: 'Mandatories', sec: 'Budget' },
    { key: 'open_questions', label: 'Open questions', sec: 'Budget' },
  ]
  const cross = { id: 'd_x', kind: 'verdict', polarity: 'bad', agent: 'judge_brief', targets: FIELDS.map(f => `${D}#${f.key}`), rationale: 'Legal asks are split across three parts.' }
  // newest first: a later reasoned pass of another check that names budget_and_scope
  const pass = { id: 'd_g', kind: 'verdict', polarity: 'good', agent: 'judge_brief', targets: [`${D}#audience`, `${D}#budget_and_scope`], rationale: 'Holds.' }
  const CHAIN = { state: 'ok', decisions: [pass, cross] }
  type F = {
    homeOf(d: unknown): { key: string } | null; openPartsOf(d: unknown): { key: string }[]
    crossNoteHtml(c: unknown, f: { key: string }): string; crossVerdictsOf(k: string): { d: unknown; open: boolean }[]
  }
  const f = lift<F>(BM, ['pathOf', 'names', 'about', 'isVerdict', 'isHuman', 'isWrite', 'newer', 'reasonedGood', 'verdictState', 'topsOf', 'isCross',
    'crossVerdictsOf', 'partsOf', 'openPartsOf', 'homeOf', 'acrossOf', 'listWords', 'crossNoteHtml'], {
    CHAIN, FIELDS, TOP_LABEL: {}, REV_: 'The Review agent', arr, esc, docId: () => D, hasReasoning: () => false,
    fig: (k: string) => `<fig ${k}>`, fixBtn: (d: { id: string }) => `<fix ${d.id}>`, docLocked: () => false, OSF: () => ({}),
    reasonFix: (d: { rationale: string }) => ({ reason: d.rationale, fix: '', rule: '' }),
  })
  assert.deepEqual(f.openPartsOf(cross).map(x => x.key), ['mandatories', 'open_questions'])
  assert.equal(f.homeOf(cross)?.key, 'mandatories')
  assert.equal(f.crossVerdictsOf('budget_and_scope')[0].open, false, 'answered on budget by the pass')
  const home = f.crossNoteHtml(f.crossVerdictsOf('mandatories')[0], FIELDS[1])
  assert.match(home, /The Review agent found a problem across budget &#38; scope, mandatories and open questions/)
  assert.match(home, /<fix d_x>/)
  assert.match(home, /data-keys="mandatories open_questions">Keep them as they are, and say why/)
  const other = f.crossNoteHtml(f.crossVerdictsOf('open_questions')[0], FIELDS[2])
  assert.match(other, /see <a href="#" class="act-goto" data-k="mandatories">Mandatories<\/a>/)
  // Nothing answered yet: the first part it names carries it, as before.
  CHAIN.decisions = [cross]
  assert.equal(f.homeOf(cross)?.key, 'budget_and_scope')
})

test("a person's verdict on a part is theirs, not the Judge's", () => {
  type F = { provHtml(f: { key: string }): string; notesHtml(f: { key: string }): string }
  const person = { id: 'd_p', kind: 'verdict', polarity: 'bad', agent: 'human:aoife', rationale: 'It needs mandatories.' }
  const judge = { id: 'd_j', kind: 'verdict', polarity: 'bad', agent: 'judge_brief', rationale: 'Too thin.' }
  const make = (v: Record<string, unknown>) => lift<F>(BM, ['provHtml', 'notesHtml'], {
    CHAIN: { state: 'ok' }, OPEN_WHY: {}, AGENT_NAME: { judge: 'Review agent', drafter: 'Brief agent' }, WRITER: 'the Brief agent', YOU: '<you>',
    get: () => '', hasVal: () => false, decisionsFor: () => [], esc: (s: string) => s, arr: (a: unknown) => (Array.isArray(a) ? a : []),
    verdictOf: () => ({ d: v, bad: true, open: true }), ownVerdictOf: () => ({ d: v, bad: true, open: true }),
    crossVerdictsOf: () => [], proposalOf: () => null, docLocked: () => false, OSF: () => ({}),
    hasReasoning: () => false, plainJudge: (s: string) => s, fig: (k: string) => `<fig ${k}>`,
    isHuman: (d: { agent?: string }) => /^human:/.test(String(d && d.agent)),
    whoName: (d: { agent?: string }) => (/^human:/.test(String(d.agent)) ? 'You' : 'Review agent'),
    whoMark: (d: { agent?: string }) => (/^human:/.test(String(d.agent)) ? '<you>' : '<fig judge>'),
    fixBtn: (d: { id: string }) => `<fix ${d.id}>`,
  })
  const p = make(person), j = make(judge)
  assert.match(p.provHtml({ key: 'mandatories' }), /<you>You/)
  assert.match(p.notesHtml({ key: 'mandatories' }), /You said this part needs another look/)
  assert.doesNotMatch(p.notesHtml({ key: 'mandatories' }), /Review agent: this part/)
  assert.match(j.provHtml({ key: 'mandatories' }), /<fig judge>Review agent/)
  assert.match(j.notesHtml({ key: 'mandatories' }), /Review agent: this part needs another look/)
  assert.match(j.notesHtml({ key: 'mandatories' }), /ask the Brief agent to write it again/)
  // either way, the crew can be asked to fix it
  assert.match(p.notesHtml({ key: 'mandatories' }), /<fix d_p>/)
  assert.match(j.notesHtml({ key: 'mandatories' }), /<fix d_j>/)
})

test('a part judged after the page drew it gets its mark when the chain comes', () => {
  const src = fn(BM, 'refreshWhy')
  assert.match(src, /if\(p\) p\.outerHTML=ph; else if\(ph&&lab\) lab\.insertAdjacentHTML\('afterend',ph\)/)
})

// A note on a brief, fixed by the crew: one fix_parts job, the page left where
// it is, and whoever is working walks the bottom edge meanwhile.
test('a note on a brief can be fixed by the crew, and the worker shows in the side panel', () => {
  const FIX_SAY = new Function('STRAT_', 'WRITER_', 'REV_', `${obj(BM, 'FIX_SAY')} return FIX_SAY;`)('The Strategy agent', 'The Brief agent', 'The Review agent')
  const classes = new Set<string>()
  const attrs: Record<string, string> = {}
  const walker = {
    innerHTML: '',
    classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) } },
    getAttribute: (k: string) => attrs[k] ?? null, setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] },
  }
  const sattr: Record<string, string> = {}
  const side = { innerHTML: '', hidden: true, getAttribute: (k: string) => sattr[k] ?? null, setAttribute: (k: string, v: string) => { sattr[k] = v } }
  type J = { task: string; verdict: string; stage?: string; summary?: string; error?: string | null; onUpdate(j: J): void; onEnd(j: J): void }
  const runs: { j: J; input: unknown }[] = []
  const said: string[] = []
  let locked = false
  const env = {
    FIX: null, DRAFT: null, FIX_SAY, walker, renderSideStop: () => {}, STRAT_: 'The Strategy agent', WRITER: 'the Brief agent', REV: 'the Review agent', NO_MW: 'no middleware', phase: 'doc', reduce: false,
    $: (id: string) => (id === 'walker' ? walker : id === 'sideAgent' ? side : null),
    REGEN: {}, fieldOf: () => null, roleOf: (k: string) => k,
    ROLES: { of: (k: string) => k, name: (k: string) => ({ synthesis: 'Strategy agent' } as Record<string, string>)[k] || 'An agent', auto: () => {},
      sideSet: (el: { hidden: boolean; innerHTML: string }, job: { role: string; doing: string } | null) => { el.hidden = !job; el.innerHTML = job ? `<svg data-agent="${job.role}"></svg><span class="nk-side-t"><b>${({ synthesis: 'Strategy agent', drafter: 'Brief agent', judge: 'Review agent' } as Record<string, string>)[job.role]}</b> · ${job.doing}</span>` : '' } },
    AGENT_NAME: { synthesis: 'Strategy agent', drafter: 'Brief agent', judge: 'Review agent' },
    esc: (s: string) => String(s), docLocked: () => locked, noMiddleware: () => false,
    window: { clan: { apiProxy: () => Promise.resolve() } },
    fig: (k: string, o: { walking?: boolean }) => `<svg data-agent="${k}"${o.walking ? ' data-walking="true"' : ''}></svg>`,
    setStatus: (h: string) => { said.push(h) }, renderStructured: () => {}, pollJob: () => {},
    runJob: (j: J, input: unknown) => { runs.push({ j, input }) },
    setTimeout: () => 0, clearTimeout: () => {},
  }
  type F = { fixBtn(d: { id: string } | null): string; fixParts(vid: string, resumeId?: string): void; walk(): void }
  const f = lift<F>(BM, ['fixBtn', 'fixParts', 'walk', 'sideAgent'], env)
  assert.match(f.fixBtn({ id: 'd_note' }), /<button type="button" class="save act-fix" data-v="d_note" title="The Strategy agent looks up what it needs, the Brief agent rewrites the parts, the Review agent checks them">Fix this with the agents<\/button>/)
  locked = true
  assert.equal(f.fixBtn({ id: 'd_note' }), '', 'a locked brief has nothing to fix')
  locked = false
  f.fixParts('d_note')
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].input, { verdict: 'd_note' })
  assert.equal(runs[0].j.task, 'fix_parts')
  assert.ok(!classes.has('on'), 'not on the bottom edge: the worker is in the side panel')
  assert.ok(!side.hidden)
  assert.match(side.innerHTML, /data-agent="synthesis"><\/svg>/, 'the brief\'s synthesis step: the Strategy agent\'s sphere, working')
  assert.match(side.innerHTML, /<b>Strategy agent<\/b> · looking up what the fix needs/)
  assert.match(f.fixBtn({ id: 'd_note' }), / disabled /, 'one fix at a time')
  f.fixParts('d_other')
  assert.equal(runs.length, 1, 'a second fix waits for the first')
  runs[0].j.stage = 'draft'; runs[0].j.onUpdate(runs[0].j)
  assert.match(side.innerHTML, /data-agent="drafter"[^>]*>.*<b>Brief agent<\/b> · rewriting the parts the note names/)
  runs[0].j.stage = 'judge'; runs[0].j.onUpdate(runs[0].j)
  assert.match(side.innerHTML, /<b>Review agent<\/b> · checking the fix/)
  runs[0].j.summary = 'Fixed 3 of 3 part(s), 0 proposed, 4 new fact(s) found.'
  runs[0].j.onEnd(runs[0].j)
  assert.ok(side.hidden, 'gone when the job ends')
  assert.ok(!classes.has('on'))
  assert.equal(said[said.length - 1], 'Fixed 3 of 3 part(s), 0 proposed, 4 new fact(s) found.')
  // The page does not move, both notes offer it, and a reload picks the job up.
  assert.doesNotMatch(fn(BM, 'fixParts'), /scrollIntoView/)
  assert.match(fn(BM, 'crossNoteHtml'), /\+fixBtn\(d\)\+/)
  assert.match(fn(BM, 'notesHtml'), /\(v\.bad&&!locked\?fixBtn\(v\.d\):''\)/)
  assert.match(fn(BM, 'bindNotes'), /\.act-fix'\)\.forEach\(function\(b\)\{ b\.addEventListener\('click',function\(\)\{ fixParts\(b\.getAttribute\('data-v'\)\); \}\); \}\);/)
  assert.match(fn(BM, 'resumeJob'), /else if\(b\.task==='fix_parts'\)\{ if\(!FIX\) fixParts\('', id\); \}/)
  assert.match(BM, /<div class="walker" id="walker" role="status" aria-live="polite"><\/div>/)
  assert.match(BM, /@media \(prefers-reduced-motion: reduce\)\{\.walker \.wk-who,\.walker \.wk-fig\{animation:none\}\}/)
})

// ── Brief Maker: what a part rests on (brief-fact-provenance) ─────────────

// The Lidl brief: the Brief agent worked out that the offer was over in 10 days from two
// facts research found outside the measure list, kept in this brief only.
function provData(extra: Record<string, unknown> = {}) {
  return {
    projection: {
      pins: {
        f_A: { layer: 'category', entity: 'brand/lidl-connect', key: 'offer.start', value: '2026-10-05', sources: ['src_rte'],
          quotes: { src_rte: 'Lidl Connect will be available from 5 October' }, pin_reason: 'kept in this brief only' },
        f_B: { layer: 'category', entity: 'brand/lidl-connect', key: 'offer.end', value: '2026-10-15', sources: ['src_tj'],
          quotes: { src_tj: 'has closed its new €8.99 for life offer from today onwards' }, pin_reason: 'kept in this brief only' },
        f_L: { layer: 'brand', entity: 'brand/lidl', key: 'stores', value: 160, version: 4, sources: ['src_l'],
          quotes: { src_l: 'Lidl runs 160 stores in Ireland' }, pin_reason: 'research' },
      },
      sources: {
        src_rte: { id: 'src_rte', uri: 'https://www.rte.ie/lidl', publisher: 'RTÉ', title: 'Lidl to launch mobile', published_at: '2026-09-28' },
        src_tj: { id: 'src_tj', uri: 'https://www.thejournal.ie/lidl', publisher: 'TheJournal', title: 'Lidl closes offer', published_at: '2026-10-15' },
        src_l: { id: 'src_l', uri: 'https://lidl.ie', publisher: 'Lidl', title: 'About us' },
      },
    },
    materials: { mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect: win back switchers.' } },
    capture: { items: {} },
    ...extra,
  }
}
function provEnv(data: Record<string, unknown>, decisions: unknown[] = []) {
  const get = (p: string) => p.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), data)
  const passage = () => null
  const captureItem = (id: string) => ((data.capture as { items: Record<string, unknown> }).items || {})[id] || null
  const short = (s: unknown, n = 48) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n)}…` : t }
  const citationOf = (p: { citation?: string }) => p.citation || ''
  const citeLabel = (id: string) => id
  type F = {
    sourcesHtml(ids: string[], claims?: unknown[]): string
    claimDecision(d: unknown): { id: string; claims?: unknown[] } | null
    citesOf(ds: unknown[]): string[]
    keptPin(pn: unknown): boolean
  }
  return lift<F>(BM, ['srcLine', 'keptPin', 'wrongPin', 'sourcesHtml', 'citesOf', 'isVerdict', 'isProposal', 'acceptOf', 'claimDecision'], {
    get, arr, esc, short, passage, captureItem, citationOf, citeLabel,
    hasReasoning: (d: { reasoning?: { decided?: string } }) => !!(d && d.reasoning && d.reasoning.decided),
    CHAIN: { state: 'ok', decisions },
  })
}
const count = (h: string, s: string) => h.split(s).length - 1
const derived = { text: 'The €8.99 for-life offer was over in 10 days', kind: 'derived', cites: ['f_A', 'f_B'],
  working: '15 Oct 2026 - 5 Oct 2026 = 10 days', check: 'recomputed', by: 'match' }

test('Sources shows a worked-out claim with its working and the facts it came from', () => {
  const f = provEnv(provData())
  const h = f.sourcesHtml(['f_A', 'f_B', 'mat_p'], [derived])
  assert.match(h, /<blockquote>The €8\.99 for-life offer was over in 10 days<\/blockquote>/)
  assert.match(h, /Worked out: 15 Oct 2026 - 5 Oct 2026 = 10 days/)
  assert.match(h, /Worked out from 2 facts/)
  // both inputs quoted, each linked to where it was read, each once
  assert.equal(count(h, 'Lidl Connect will be available from 5 October'), 1)
  assert.equal(count(h, 'has closed its new €8.99 for life offer from today onwards'), 1)
  assert.match(h, /RTÉ, Lidl to launch mobile · 2026 · <a href="https:\/\/www\.rte\.ie\/lidl"/)
  assert.match(h, /href="https:\/\/www\.thejournal\.ie\/lidl"/)
  assert.equal(count(h, 'kept in this brief only'), 2, 'both facts are document pins')
  // the inputs sit inside the worked-out row, before the prompt's words
  assert.ok(h.indexOf('Worked out from 2 facts') < h.indexOf('Lidl Connect will be available'))
  assert.match(h, /<blockquote>A brief for Lidl Connect: win back switchers\.<\/blockquote><cite>Your request, as typed<\/cite>/)
  // a layer copy is not labelled as kept in the brief
  const l = f.sourcesHtml(['f_L'])
  assert.match(l, /Lidl runs 160 stores in Ireland/)
  assert.doesNotMatch(l, /kept in this brief only/)
  assert.ok(f.keptPin({ kept_in_document: { why: 'outside the measure list' }, version: undefined }))
  assert.ok(!f.keptPin({ pin_reason: 'corrected by Aoife' }), 'a person’s correction is not a kept pin')
  // a recomputed working that does not hold is said
  assert.match(f.sourcesHtml([], [{ ...derived, check: 'false' }]), /the working does not add up, check it/)
  assert.match(f.sourcesHtml([], [{ ...derived, check: 'stated' }]), /not recomputed/)
})

test('a claim nothing supports shows as to confirm, and is not hidden', () => {
  const f = provEnv(provData())
  const h = f.sourcesHtml([], [{ text: 'Lidl has 340 stores in Ireland', kind: 'to_confirm', cites: [], by: 'net' }])
  assert.match(h, /<li class="confirm"><blockquote>Lidl has 340 stores in Ireland<\/blockquote><cite>To confirm/)
  assert.match(h, /^<div class="srcs"><span class="rl">Sources<\/span>/)
})

test('a claim resting on a fact marked wrong is flagged', () => {
  const excluded = provEnv(provData({ selection: { excluded: [{ fact_id: 'f_B' }] } }))
  assert.match(excluded.sourcesHtml(['f_A', 'f_B'], [derived]), /Rests on a fact marked wrong/)
  const d = provData()
  ;(d.projection.pins.f_A as Record<string, unknown>).replaced_by = { fact_id: 'f_C', decision: 'd_c' }
  assert.match(provEnv(d).sourcesHtml(['f_A'], [{ text: 'It opened on 5 October', kind: 'fact', cites: ['f_A'] }]), /Rests on a fact marked wrong/)
  assert.doesNotMatch(provEnv(provData()).sourcesHtml(['f_A', 'f_B'], [derived]), /marked wrong/)
})

test('an accepted proposal keeps the claims it was proposed with', () => {
  const prop = { id: 'd_prop1', kind: 'edit', action: 'propose', cites: ['f_A', 'f_B'], claims: [derived] }
  const acc = { id: 'd_acc', kind: 'edit', actor: 'human', rationale: 'Accepted d_prop1: the Brief agent’s proposal for background.' }
  const f = provEnv(provData(), [prop, acc])
  assert.equal(f.claimDecision(acc)?.id, 'd_prop1')
  assert.equal(f.claimDecision(prop)?.id, 'd_prop1')
  assert.equal(f.claimDecision({ id: 'd_x', rationale: 'Edited by hand.' }), null)
  assert.deepEqual(f.citesOf([acc, f.claimDecision(acc)]), ['f_A', 'f_B'])
  // a claim's cites count even when the decision's own list missed them
  assert.deepEqual(f.citesOf([{ cites: ['mat_p'], claims: [derived] }]), ['mat_p', 'f_A', 'f_B'])
  // whyHtml renders the claims of the decision that carries them
  assert.match(fn(BM, 'whyHtml'), /var cd=claimDecision\(d\);\s*h\+=sourcesHtml\(citesOf\(\[d, cd, v&&v\.d\]\), cd\?cd\.claims:\[\]\);/)
})

// ── one provenance view per part (where-it-came-from, approved 2026-11-10) ──
// ClanFields.partView draws what wrote a part, and what that cites, once, in the research inspector's
// .clf-rv grammar: the brief's panel, the drawer's path view and a list line all read the same markup.

/** partParts over a document and a chain, the crew named as the snippet names them, dates left as stamps. */
function pvEnv(o: {
  decisions: unknown[]; value?: unknown; materials?: Record<string, unknown>; captures?: Record<string, unknown>
  pins?: Record<string, unknown>; sources?: Record<string, unknown>; findings?: Record<string, unknown>; excluded?: string[]
}) {
  type P = {
    partParts(path: string, opts?: { name?: string; also?: { key: string; label: string }[] }): { head: string; body: string }
    partHTML(path: string, opts?: unknown): string
    provenance(path: string): string
    history(path: string): string
    proposalOf(path: string): { decision: { id: string } } | null
    acceptOf(b: unknown): { decision: { id: string } } | null
  }
  const crewKey = (d: { agent?: string }) => (/drafter/.test(String(d.agent)) ? 'drafter' : /judge/.test(String(d.agent)) ? 'judge' : null)
  const givenOf = (k: string | null) => ({ drafter: 'Brief agent', judge: 'Review agent' } as Record<string, string>)[String(k)] || ''
  const DID = new Function(`${obj(CLF, 'DID')} return DID;`)()
  const DID_ACTION = new Function(`${obj(CLF, 'DID_ACTION')} return DID_ACTION;`)()
  const KIND_OF_ACTION = new Function(`${obj(CLF, 'KIND_OF_ACTION')} return KIND_OF_ACTION;`)()
  const P = o.pins ?? {}
  return lift<P>(CLF, ['obj', 'uniq', 'clip', 'plural', 'noIds', 'keyWords', 'partNames', 'lowerWord', 'attnOf', 'askOf', 'kindOf', 'isPath', 'blockOf', 'isEdit', 'qualify', 'wroteKey',
    'writerOf', 'proposalOf', 'isPerson', 'acceptedId', 'acceptOf', 'isAccept', 'drafterKey', 'proposerOf', 'saidWords', 'provenance', 'didWords', 'history',
    'writeOf', 'theName', 'byName', 'pvPill', 'pvMeta', 'pvQuote', 'pvCap', 'matCap', 'pvPinRow', 'pvPins', 'pvDecs', 'partParts', 'partHTML',
    'sec', 'reasonHTML', 'decRow', 'decsSec', 'onTargets', 'blocksOn', 'go', 'fChip', 'sChip', 'dChip', 'pChip', 'citeChip', 'stPill', 'confBars', 'lvOf', 'lvWord', 'pinLv',
    'excludedPin', 'resolvedFor', 'openContestOf', 'tierWord', 'dparts', 'monthYear', 'words', 'fno', 'srcOf'], {
    arr, esc, PATH: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, gap: () => null, VIEW: { document_id: 'brief', decisions: o.decisions }, DID, DID_ACTION, KIND_OF_ACTION, declaredParts: () => [],
    docId: () => 'brief', upstreams: () => ({}), valueAt: () => o.value ?? 'One thing, said once.', envAt: () => null, ORIGIN: {}, personName: () => 'ana',
    crew: () => ({ forWork: (w: string) => (w === 'draft' ? 'drafter' : '') }), crewKey, givenOf,
    whoDid: (b: { who?: { you?: boolean }; decision: { agent?: string } }) => (b.who?.you ? 'You' : givenOf(crewKey(b.decision)) || 'The agents'),
    dayMonth: (d: string) => d, captures: () => o.captures ?? {}, passages: () => ({}), pins: () => P, findings: () => o.findings ?? {}, sources: () => o.sources ?? {},
    contests: () => [], data: () => ({ selection: { excluded: (o.excluded ?? []).map(fact_id => ({ fact_id })) } }),
    materials: () => o.materials ?? { mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect.' } }, andList: listJoin, upTitle: () => 'Irish summer treats',
    trayNoun: () => 'brief', textOf: (v: unknown) => (v == null ? '' : String(v)), label: (p: { label?: string }) => p?.label ?? '', fmt: (p: { value?: unknown }) => (p ? String(p.value ?? '') : ''),
    confidential: () => false, LOCK: '<i class="lock"></i>', country: (c: string) => c, pubName: (n: string) => n, STATUS_WORD: {},
    LV: { high: 3, medium: 2, med: 2, low: 1 }, LV_WORD: { 3: 'High', 2: 'Medium', 1: 'Low' }, MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    PV_OPEN: {},
  })
}

test('the part view quotes the words the planner typed, with a mono caption', () => {
  const dec = { decision: { id: 'd_1', kind: 'edit', action: 'draft', agent: 'draft_brief@1.0/drafter', cites: ['mat_p', 'mat_f'], targets: ['brief#background'], timestamp: '4 Nov',
    reasoning: { decided: 'x' } }, who: dara, targets: [{ path: 'background' }] }
  const f = pvEnv({ decisions: [dec], materials: {
    mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect: win back switchers.' },
    mat_f: { kind: 'client_brief', name: 'Lidl brief.pdf' },
  } })
  const h = f.partHTML('background')
  assert.match(h, /<h5>From your words<em>1<\/em><\/h5><div class="pv-said"><blockquote class="rv-q">A brief for Lidl Connect: win back switchers\.<\/blockquote><button type="button" class="rv-src pv-cap" data-clf-go="mat_p">your prompt<\/button><\/div>/)
  // the attachment is a Files chip, not quoted, and the prompt is not listed twice
  assert.match(h, /<div class="rv-use"><span>Files<\/span><button type="button" class="rv-chip" data-clf-go="mat_f">Lidl brief\.pdf<\/button>/)
  assert.equal(count(h, 'data-clf-go="mat_p"'), 1)
  assert.match(h, /Written by <b>the Brief agent<\/b> · from your words · 4 Nov · <span class="rv-dchip"/)
  // none of the old drawer's pieces for a writer
  assert.doesNotMatch(h, /clf-say|clf-q said|clf-by|clf-row|What you typed/)
})

test('the part view: header, quotes, facts with long values on their own row, why, decisions', () => {
  const pins = {
    f_1: { label: 'HFSS ad restriction, Ireland', value: 'before 9pm', sources: ['src_1'], confidence: 'medium', market: 'IE' },
    f_2: { label: 'Restriction · Ireland', value: 'No promotion of HFSS products to under-18s in any medium they mostly see', sources: ['src_1'] },
    f_3: { label: 'Marked wrong', value: '12', sources: ['src_1'] },
    f_4: { label: 'Replaced', value: '13', replaced_by: { fact_id: 'f_1' } },
  }
  const sources = { src_1: { publisher: 'BAI', tier: 'gov', published_at: '2026-03' } }
  const captures = {
    cap_a: { key: 'mandatories', material_id: 'mat_p', quote: 'No "limited time" language', status: 'fact' },
    cap_b: { key: 'mandatories', material_id: 'mat_n', quote: 'with no price promotion', status: 'assumption' },
    cap_c: { key: 'mandatories', material_id: 'mat_p', quote: 'No "limited time" language', status: 'fact' },
  }
  const materials = { mat_p: { kind: 'prompt', name: 'prompt', text: 'No "limited time" language.' }, mat_n: { kind: 'other', name: 'client-call-notes.pdf' } }
  const draft = { decision: { id: 'd_031', kind: 'edit', action: 'draft', agent: 'draft_brief@1.0/drafter', targets: ['brief#mandatories'], timestamp: '4 Nov',
    cites: ['cap_a', 'cap_b', 'cap_c', 'f_1', 'f_2', 'f_3', 'f_4'],
    reasoning: { decided: 'Keep the client’s three mandatories', because: [{ point: 'Your ask: “Keep it short.”' }, { point: 'The client said no price promotion', cites: ['cap_a'] }],
      certainty: { level: 'medium', why: 'two are inferred' }, attention: '“limited time” is assumed' } }, who: dara, targets: [{ path: 'mandatories' }] }
  const verdict = { decision: { id: 'd_v', kind: 'verdict', polarity: 'good', agent: 'napkin/brief/judge', targets: ['brief#mandatories'], timestamp: '4 Nov', rationale: 'Fine.' }, who: jude, targets: [{ path: 'mandatories' }] }
  const f = pvEnv({ decisions: [verdict, draft], pins, sources, captures, materials, excluded: ['f_3'], value: ['No “limited time” language'] })
  const p = f.partParts('mandatories', { name: 'Mandatories', also: [{ key: 'audience', label: 'Audience' }] })
  // head: the name, the decision's own certainty, who wrote it from what
  assert.match(p.head, /^<div class="rv-head"><span class="rv-pname">Mandatories<\/span><span class="rv-pill warn">Medium · inference<\/span><\/div>/)
  assert.match(p.head, /<p class="rv-meta"><span>Written by <b>the Brief agent<\/b> · from your words and 2 facts · 4 Nov · <span class="rv-dchip"[^>]*>d_031<\/span><\/span><\/p>/)
  const h = p.body
  // From your words: deduped by quote, captions in mono, assumed flagged, the ask as your note
  assert.match(h, /<h5>From your words<em>3<\/em><\/h5>/)
  assert.equal(count(h, 'No &#34;limited time&#34; language</blockquote>'), 1)
  assert.match(h, /data-clf-go="cap_b">client-call-notes\.pdf · assumed, not said<\/button>/)
  assert.match(h, /<blockquote class="rv-q">Keep it short\.<\/blockquote><p class="rv-src">your note for this draft<\/p>/)
  // Facts under it: a short value in its own cell; a long one spans the row and has no value cell
  assert.match(h, /<h5>Facts under it<em>2<\/em><\/h5><table class="rv-pins">/)
  assert.match(h, /<tr data-clf-go="f_1" tabindex="0" role="button" title="[^"]*"><td>HFSS ad restriction, Ireland<small><button type="button" class="rv-schip" data-clf-go="src_1"[^>]*>BAI<\/button> · gov · March 2026 · IE<\/small><\/td><td class="v">before 9pm<\/td><td><span class="rv-conf" data-c="2"/)
  const wide = /<tr data-clf-go="f_2"[^>]*class="pv-wide"[^>]*>(.*?)<\/tr>/.exec(h)
  assert.ok(wide, 'the long value takes the whole row')
  assert.match(wide[1], /^<td colspan="2">Restriction · Ireland<span class="pv-lv">No promotion of HFSS/)
  assert.doesNotMatch(wide[1], /class="v"/)
  assert.doesNotMatch(h, /f_3|f_4/, 'a pin marked wrong or replaced is not under it')
  // Why it says this: the reasons less the ask, signed
  assert.match(h, /<h5>Why it says this<\/h5><div class="rv-reason"><div class="rv-row dec"><span class="rl">Decided<\/span><div>Keep the client’s three mandatories<\/div>/)
  assert.doesNotMatch(/<h5>Why it says this<\/h5>.*?<\/section>/.exec(h)![0], /Your ask|Keep it short/)
  assert.match(h, /<div class="rv-attn"><b>Look at this<\/b>/)
  assert.match(h, /<div class="rv-by">Brief agent · draft · 4 Nov<\/div>/)
  // Also used in, folded; Decisions on the record, newest first
  assert.match(h, /<h5>Also used in<em>1 part<\/em><\/h5><details class="rv-more pv-also">.*data-clf-part="audience">Audience<\/button>/)
  assert.match(h, /<h5>Decisions on the record<em>2<\/em><\/h5><details class="rv-dec">.*Review agent.*<details class="rv-dec">.*Brief agent/)
  // the order of the sections is the design's
  const order = [...h.matchAll(/<h5>([^<]+)/g)].map(m => m[1])
  assert.deepEqual(order, ['From your words', 'Facts under it', 'Why it says this', 'Also used in', 'Decisions on the record'])
  assert.doesNotMatch(p.head + h, /clf-say|clf-q said|clf-by|clf-row/)
})

test('the part view: more than six facts fold under Show all; empty and person-written parts', () => {
  const pins: Record<string, unknown> = {}
  const cites: string[] = []
  for (let i = 1; i <= 9; i++) { pins[`f_${i}`] = { label: `Fact ${i}`, value: String(i) }; cites.push(`f_${i}`) }
  const draft = { decision: { id: 'd_1', kind: 'edit', action: 'draft', agent: 'draft_brief@1.0/drafter', targets: ['brief#background'], cites, reasoning: { decided: 'x' } }, who: dara, targets: [{ path: 'background' }] }
  const h = pvEnv({ decisions: [draft], pins }).partHTML('background')
  assert.equal(count(h, '<tr '), 9)
  assert.match(h, /<\/table><details class="rv-more" data-pv-facts="background"><summary>Show all 9<\/summary><table class="rv-pins"><tbody><tr data-clf-go="f_7"/)
  // nothing written, nothing on the record, a person's own words
  assert.match(pvEnv({ decisions: [draft], value: '' }).partHTML('background'), /<p class="rv-none">Nothing is written here yet\.<\/p>/)
  assert.match(pvEnv({ decisions: [] }).partHTML('background'), /<p class="rv-none">Nothing on the record wrote this yet\.<\/p>/)
  const mine = { decision: { id: 'd_m', kind: 'edit', agent: 'human', actor: 'human:sam', action: 'edit background', fields_changed: ['background'], timestamp: '5 Nov',
    rationale: 'Our client asked for this.' }, who: { kind: 'person', id: 'me', name: 'You', you: true }, targets: [{ path: 'background' }] }
  const m = pvEnv({ decisions: [mine] }).partParts('background')
  assert.match(m.head, /Written by <b>You<\/b> · 5 Nov<\/span><\/p>$/)
  assert.match(m.body, /<span class="rl">Decided<\/span><div>Our client asked for this\.<\/div>/)
  assert.match(m.body, /<div class="rv-by">You · edit · 5 Nov<\/div>/)
})

test('the part view replaces the old writer block in every drawer path', () => {
  assert.doesNotMatch(CLF, /function writerBlock\(|writerBlock\(/)
  assert.match(fn(CLF, 'viewItem'), /partHTML\(it\.path\)/, 'a line opened on its own shows its part’s view')
  assert.doesNotMatch(fn(CLF, 'viewItem'), /Where it came from/)
  const draw = fn(CLF, 'draw')
  assert.match(draw, /if\(!env\) b\+='<div class="clf-rv pv" data-card="'\+esc\(ref\)\+'">'\+partHTML\(ref\)\+'<\/div>';/)
  // the capture and passage quotes read as the inspector's, not the big beige block
  assert.doesNotMatch(draw, /<h3>What your material says<\/h3><blockquote class="clf-q said">|<h3>What it says<\/h3><blockquote class="clf-q said">/)
  assert.match(CLF, /partView:partView/)
})

// ── a redraft of a held part (redraft-provenance) ──────────────────────────
// the Brief agent's first draft, the Review agent's note that sent it back, the Brief agent's second, and the
// person's accept, as the chain holds them (newest first). Every reader
// credits the Brief agent, quotes the ask, and shows no decision's id.

const SMP = 'single_minded_proposition'
const SMP_ADDR = `brief#${SMP}`
const SMP_T = [{ address: SMP_ADDR, path: SMP, label: 'Single-minded proposition', here: true }]
const dara = { kind: 'agent', id: 'draft_brief', name: 'Drafter' }
const jude = { kind: 'agent', id: 'judge', name: 'Judge' }
const firstDraft = { decision: { id: 'd_P1', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', superseded_by: 'd_P2', proposed_value: 'One thing.',
  targets: [SMP_ADDR], timestamp: '2026-10-23T09:00:00+00:00', rationale: 'Wrote the single-minded proposition on your ask.',
  reasoning: { decided: 'One thing.', because: [{ point: 'Your ask: “Make it one thing.”' }] } }, who: dara, targets: SMP_T, superseded: true }
const judeNo = { decision: { id: 'd_V', kind: 'verdict', polarity: 'bad', agent: 'napkin/brief/judge', cites: ['d_P1'], rationale: 'Say one thing, not two.',
  targets: [SMP_ADDR], timestamp: '2026-10-23T09:01:00+00:00' }, who: jude, targets: SMP_T, superseded: false }
const secondDraft = { decision: { id: 'd_P2', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', cites: ['d_V', 'mat_p'], proposed_value: 'One thing, said once.',
  targets: [SMP_ADDR], timestamp: '2026-10-23T09:02:00+00:00', rationale: 'Rewrote the single-minded proposition on the Review agent’s note and your ask.',
  reasoning: { decided: 'One thing, said once.', because: [{ point: 'Your ask: “Make it one thing.”' }, { point: 'It says one thing.' }] } }, who: dara, targets: SMP_T, superseded: false }
const youAccept = { decision: { id: 'd_A', kind: 'edit', agent: 'human', actor: 'human:me', action: `accept proposal ${SMP}`, fields_changed: [SMP],
  timestamp: '2026-10-23T09:05:00+00:00', rationale: 'Accepted the Brief agent’s new version of single-minded proposition.',
  reasoning: { decided: 'Accepted it.', because: [{ point: 'The Brief agent proposed it.', cites: ['d_P2'] }] } }, who: { kind: 'person', id: 'me', name: 'You', you: true }, targets: SMP_T, superseded: false }
const oldAccept = { decision: { id: 'd_O', kind: 'edit', agent: 'human', actor: 'human:me', action: `edit ${SMP}`, fields_changed: [SMP],
  timestamp: '2026-10-23T09:05:00+00:00', rationale: 'Accepted d_P2: the Brief agent’s proposal for single-minded proposition.' },
  who: { kind: 'person', id: 'me', name: 'You', you: true }, targets: SMP_T, superseded: false }

/** The drawer's readers over a chain, the crew named as the snippet names them, dates left as stamps. */
function drawerEnv(decisions: unknown[], value = 'One thing, said once.') {
  type F = {
    provenance(path: string): string
    history(path: string): string
    proposalOf(path: string): { decision: { id: string } } | null
    acceptOf(b: unknown): { decision: { id: string } } | null
  }
  const crewKey = (d: { agent?: string }) => (/drafter/.test(String(d.agent)) ? 'drafter' : /judge/.test(String(d.agent)) ? 'judge' : null)
  const givenOf = (k: string | null) => ({ brief: 'Brief agent', review: 'Review agent', drafter: 'Brief agent', judge: 'Review agent' } as Record<string, string>)[String(k)] || ''
  const DID = new Function(`${obj(CLF, 'DID')} return DID;`)()
  const DID_ACTION = new Function(`${obj(CLF, 'DID_ACTION')} return DID_ACTION;`)()
  return lift<F>(CLF, ['obj', 'uniq', 'clip', 'plural', 'noIds', 'keyWords', 'partNames', 'lowerWord', 'becauseList', 'attnOf', 'askOf', 'kindOf', 'isPath', 'blockOf', 'isEdit', 'qualify', 'wroteKey',
    'writerOf', 'proposalOf', 'isPerson', 'acceptedId', 'acceptOf', 'isAccept', 'drafterKey', 'proposerOf', 'saidWords', 'provenance', 'didWords', 'history'], {
    arr, esc, PATH: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, gap: () => null, VIEW: { document_id: 'brief', decisions }, DID, DID_ACTION, declaredParts: () => [],
    docId: () => 'brief', upstreams: () => ({}), valueAt: () => value, envAt: () => null, ORIGIN: {}, personName: () => 'ana',
    crew: () => ({ forWork: (w: string) => (w === 'draft' ? 'drafter' : '') }), crewKey, givenOf,
    whoDid: (b: { who: { you?: boolean }; decision: { agent?: string } }) => (b.who.you ? 'You' : givenOf(crewKey(b.decision)) || 'The crew'),
    dayMonth: (d: string) => d, captures: () => ({}), passages: () => ({}), pins: () => ({}), findings: () => ({}),
    materials: () => ({ mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect.' } }), say: () => '', andList: listJoin, upTitle: () => '',
    MAT_KIND: { prompt: 'your prompt', other: 'a file' }, textOf: String, SURE: {}, STATUS_WORD: {}, label: () => '', srcOf: () => null, srcShort: () => '',
    confidential: () => false, LOCK: '', fmt: () => '',
  })
}

// B4: the drawer says a part by its label, never its key (final retest).
test('the drawer names a part by its label in the crew’s words, never its key', () => {
  type K = { keyWords(s: string): string; noIds(s: string): string }
  const VIEW = { decisions: [{ targets: [
    { here: true, kind: 'field', path: 'budget_and_scope', label: 'Budget & scope' },
    { here: true, kind: 'field', path: 'competitor_context', label: 'Competitor context' },
    { here: true, kind: 'field', path: 'background', label: 'Background' },
  ] }] }
  const k = lift<K>(CLF, ['keyWords', 'partNames', 'lowerWord', 'noIds'], {
    arr, VIEW, findings: () => ({}),
    declaredParts: () => [{ address: 'single_minded_proposition', label: 'Single-minded proposition' }],
  })
  assert.equal(k.keyWords('Mandatories name Sections 15 and 16, budget_and_scope asks legal which apply.'),
    'Mandatories name Sections 15 and 16, budget & scope asks legal which apply.')
  assert.equal(k.keyWords('Over length: background 99/70, competitor_context 120/70.'),
    'Too long: background (99 words, 70 at most), competitor context (120 words, 70 at most).')
  assert.equal(k.keyWords('It contradicts single_minded_proposition.'), 'It contradicts single-minded proposition.')
  assert.equal(k.keyWords('an unknown_key_here'), 'an unknown key here')
  assert.equal(k.keyWords('Checked the new the barrier: it answers the note.'), 'Checked the new barrier: it answers the note.')
  assert.equal(k.keyWords('Proposed a effectiveness evidence finding, a useful one and a one-off.'), 'Proposed an effectiveness evidence finding, a useful one and a one-off.')
  assert.equal(k.noIds('budget_and_scope (d_01ABCDEFGHJK) holds.'), 'budget & scope holds.')
  // The verdict and the history read through it; a reviewer that is not a person is the crew member.
  assert.match(fn(CLF, 'verdictBlock'), /clip\(noIds\(d\.rationale\),280\)/)
  assert.match(fn(CLF, 'history'), /said=isPerson\(d\)\?saidWords\(d\):noIds\(saidWords\(d\)\)/)
  const rl = lift<{ reviewLine(r: Record<string, string>): string }>(CLF, ['reviewLine'], {
    esc, isYou: () => false, personName: (n: string) => n.replace(/^human:/, ''), plainDate: (d: string) => d,
    VERDICT_WORD: { rejected: 'Marked wrong' }, blockOf: () => ({ decision: { agent: 'judge' } }), whoDid: () => 'Review agent', givenOf: () => 'Review agent', judgeKey: () => 'judge',
  })
  assert.equal(rl.reviewLine({ verdict: 'rejected', by: 'Regenerate field', actor: 'process:middleware', decision: 'd_1' }), 'Marked wrong by Review agent')
  assert.equal(rl.reviewLine({ verdict: 'rejected', by: 'ana', actor: 'human:ana' }), 'Marked wrong by ana')
})

test('the drawer shows a chain’s times in the viewer’s own zone', () => {
  type D = { dayMonth(d: string, time?: boolean): string }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const f = lift<D>(CLF, ['dparts', 'monthYear', 'dayMonth'], { MON, MONTHS })
  const local = (stamp: string) => {
    const at = new Date(stamp)
    const year = at.getFullYear() === new Date().getFullYear() ? '' : ` ${at.getFullYear()}`
    return { day: `${at.getDate()} ${MON[at.getMonth()]}${year}`, time: at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }
  }
  for (const stamp of ['2026-10-23T09:05:00+00:00', '2026-10-23T09:05:00Z', '2026-10-23T09:05:00.944391699+00:00', '2026-10-23T09:05:00+05:30']) {
    const { day, time } = local(stamp)
    assert.equal(f.dayMonth(stamp, true), `${day}, ${time}`, stamp)
    assert.equal(f.dayMonth(stamp), day, stamp)
  }
  // A stamp with no zone, or no time, reads as written: a source's own date.
  const y = new Date().getFullYear() === 2026 ? '' : ' 2026'
  assert.equal(f.dayMonth('2026-10-23T09:05', true), `23 Oct${y}, 09:05`)
  assert.equal(f.dayMonth('2026-10-23', true), `23 Oct${y}`)
  assert.equal(f.dayMonth('2025-03'), 'March 2025')
})

test('the drawer credits an accepted proposal to the Brief agent and quotes the ask', () => {
  const f = drawerEnv([youAccept, secondDraft, judeNo, firstDraft])
  assert.equal(f.acceptOf(youAccept)?.decision.id, 'd_P2')
  assert.equal(f.acceptOf(judeNo), null, 'a verdict cites a draft to judge it')
  assert.equal(f.provenance(SMP), 'drafted by Brief agent · you accepted')
  assert.equal(f.proposalOf(SMP), null, 'the accept answered it')

  const pv = pvEnv({ decisions: [youAccept, secondDraft, judeNo, firstDraft] }).partParts(SMP)
  assert.match(pv.head, /<p class="rv-meta"><span>Written by <b>the Brief agent<\/b> · accepted by <b>You<\/b> · 2026-10-23T09:05:00\+00:00<\/span><\/p>$/)
  const h = pv.body
  assert.match(h, /<h5>From your words<em>2<\/em><\/h5><div class="pv-said"><blockquote class="rv-q">Make it one thing\.<\/blockquote><p class="rv-src">your note for this draft<\/p><\/div><div class="pv-said"><blockquote class="rv-q">A brief for Lidl Connect\.<\/blockquote><button type="button" class="rv-src pv-cap" data-clf-go="mat_p">your prompt<\/button><\/div>/)
  // What the proposal rested on, not the accept; the ask is not listed twice.
  assert.match(h, /<span class="rl">Because<\/span><ul class="rv-bec"><li>It says one thing\.<\/li><\/ul>/)
  assert.match(h, /<div class="rv-by">Brief agent · draft · 2026-10-23T09:02:00\+00:00<\/div>/, 'signed by what wrote the reasons')
  // ids never show outside Decisions on the record, where a decision's chip is inert, as in the research
  assert.doesNotMatch(h.split('<h5>Decisions on the record')[0], /The Brief agent proposed it|d_P2|d_A\b/)

  const lines = [...f.history(SMP).matchAll(/<li><span>(.*?)<\/span><\/li>/g)].map(m => m[1])
  assert.deepEqual(lines, [
    '<b>You</b> accepted the Brief agent’s new version on 2026-10-23T09:05:00+00:00 — “Accepted the Brief agent’s new version of single-minded proposition.”',
    '<b>Brief agent</b> proposed a new version on 2026-10-23T09:02:00+00:00 — “Rewrote the single-minded proposition on the Review agent’s note and your ask.”',
    '<b>Review agent</b> said it is wrong on 2026-10-23T09:01:00+00:00 — “Say one thing, not two.”',
    '<b>Brief agent</b> proposed a first version on 2026-10-23T09:00:00+00:00 — “Wrote the single-minded proposition on your ask.”',
  ])
  assert.doesNotMatch(f.history(SMP), /\bd_[A-Z0-9]/)

  // Another person's accept.
  const ana = { ...youAccept, who: { kind: 'person', id: 'ana', name: 'ana' } }
  assert.equal(drawerEnv([ana, secondDraft, judeNo, firstDraft]).provenance(SMP), 'drafted by Brief agent · accepted')
})

test('an older brief’s accept reads the same, without the id it named', () => {
  const f = drawerEnv([oldAccept, secondDraft, judeNo, firstDraft])
  assert.equal(f.acceptOf(oldAccept)?.decision.id, 'd_P2')
  assert.equal(f.provenance(SMP), 'drafted by Brief agent · you accepted')
  assert.match(pvEnv({ decisions: [oldAccept, secondDraft, judeNo, firstDraft] }).partParts(SMP).head, /Written by <b>the Brief agent<\/b> · accepted by <b>You<\/b> · 2026-10-23T09:05:00\+00:00<\/span><\/p>$/)
  assert.match(f.history(SMP), /<b>You<\/b> accepted the Brief agent’s new version on 2026-10-23T09:05:00\+00:00 — “Accepted the Brief agent’s proposal for single-minded proposition\.”/)
  assert.doesNotMatch(f.history(SMP), /d_P2/)
  // The proposal gone from the chain: still the Brief agent's, by the crew's draft work.
  const gone = drawerEnv([oldAccept])
  assert.equal(gone.provenance(SMP), 'drafted by Brief agent · you accepted')
  assert.match(pvEnv({ decisions: [oldAccept] }).partParts(SMP).head, /Written by <b>the Brief agent<\/b> · accepted by <b>You<\/b> · 2026-10-23T09:05:00\+00:00<\/span><\/p>$/)
})

test('the drawer offers the second draft, never the first the Review agent sent back', () => {
  assert.equal(drawerEnv([secondDraft, judeNo, firstDraft], 'Two things.').proposalOf(SMP)?.decision.id, 'd_P2')
  assert.equal(drawerEnv([judeNo, firstDraft], 'Two things.').proposalOf(SMP), null)
})

test('the brief maker’s proposal is answered by the write that cites it', () => {
  type F = { proposalOf(key: string): { d: { id: string }; value: unknown } | null; actionWords(d: unknown): string; provHtml(f: { key: string }): string }
  const first = { id: 'd_P1', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', superseded_by: 'd_P2', proposed_value: 'One thing.', targets: [SMP_ADDR] }
  const no = { id: 'd_V', kind: 'verdict', polarity: 'bad', agent: 'napkin/brief/judge', cites: ['d_P1'], rationale: 'Say one thing.', targets: [SMP_ADDR] }
  const second = { id: 'd_P2', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', cites: ['d_V'], proposed_value: 'One thing, said once.', targets: [SMP_ADDR] }
  const accept = { id: 'd_A', kind: 'edit', agent: 'human', actor: 'human:me', action: `accept proposal ${SMP}`, rationale: 'Accepted the Brief agent’s new version of single-minded proposition.',
    reasoning: { decided: 'Accepted it.', because: [{ point: 'The Brief agent proposed it.', cites: ['d_P2'] }] } }
  const stillNo = { id: 'd_V2', kind: 'verdict', polarity: 'bad', agent: 'napkin/brief/judge', cites: ['d_P2'], rationale: 'Still two things.', targets: [SMP_ADDR] }
  const old = { id: 'd_O', kind: 'edit', agent: 'human', actor: 'human:me', action: `edit ${SMP}`, rationale: 'Accepted d_P2: the Brief agent’s proposal for single-minded proposition.' }
  const make = (decisions: unknown[], writer: unknown = null) => lift<F>(BM, ['about', 'names', 'pathOf', 'isVerdict', 'isProposal', 'isWrite', 'newer', 'proposalOf', 'citesOf',
    'hasReasoning', 'acceptOf', 'isAccept', 'proposerOf', 'actionWords', 'provHtml', 'isHuman'], {
    CHAIN: { state: 'ok', decisions }, arr, esc, docId: () => 'brief', dismissed: () => [], LAST_PROPOSALS: [], OPEN_WHY: {},
    AGENT_NAME: { drafter: 'Brief agent', judge: 'Review agent' }, agentKeyOf: (d: { agent?: string }) => (/judge/.test(String(d.agent)) ? 'judge' : 'drafter'),
    get: () => 'x', hasVal: () => true, verdictOf: () => null, decisionsFor: () => (writer ? [writer] : []),
    whoName: (d: { agent?: string }) => (/^human/.test(String(d.agent)) ? 'You' : 'Brief agent'), whoMark: () => '<you>', fig: (k: string) => `<fig ${k}>`,
  })
  // Newest first, as the chain is read.
  assert.equal(make([second, no, first]).proposalOf(SMP)?.d.id, 'd_P2')
  assert.equal(make([no, first]).proposalOf(SMP), null, 'a first draft the Review agent sent back is never offered')
  assert.equal(make([accept, second, no, first]).proposalOf(SMP), null, 'the accept cites it')
  assert.equal(make([old, second, no, first]).proposalOf(SMP), null, 'an older accept named it')
  assert.equal(make([stillNo, second, no, first]).proposalOf(SMP)?.d.id, 'd_P2', 'a proposal the Review agent still fails stays offered')

  // The chip and the rows: the Brief agent's figure and name, the accept as a note.
  const f = make([accept, second, no, first], accept)
  assert.equal(f.provHtml({ key: SMP }), '<button type="button" class="prov act-why" aria-expanded="false" title="Where did this come from?"><fig drafter>Brief agent<span class="acc">you accepted</span><span class="q">why?</span></button>')
  assert.equal(f.actionWords(accept), 'accepted the Brief agent’s new version')
  assert.equal(f.actionWords(old), 'accepted the Brief agent’s new version')
  assert.equal(f.actionWords(first), 'proposed a first version')
  assert.equal(f.actionWords(second), 'proposed a new version')
  assert.equal(f.actionWords({ action: 'edit background' }), 'edit background')
  // The accept records the proposal as a cite on its reasoning, and names the Brief agent, not the id.
  const src = fn(BM, 'acceptProposal')
  assert.match(src, /said='Accepted the '\+who\+'’s new version of '\+part\+'\.'/)
  assert.match(src, /reasoning:\{decided:said, because:\[\{point:who\+' proposed it\.', cites:\[p\.d\.id\]\}\]/)
  assert.doesNotMatch(src, /rationale:'Accepted '\+p\.d\.id/)
  assert.match(fn(BM, 'regenField'), /still fails my checks\. It’s there, flagged: use it, change it, or ask again\./)
})

test('the brief’s export cites its sources: one number a publisher, links only for open web sources', () => {
  type Cit = { marks: Record<string, number[]>; notes: { n: number; name: string; items: { text: string; uri: string | null }[] }[] }
  type F = { exportCitations(parts: unknown[], env: unknown): Cit; exportMarkHtml(n?: number[]): string; exportSourcesHtml(c: Cit | null): string }
  const f = lift<F>(BM, ['exportClient', 'exportSource', 'exportNotes', 'exportCitations', 'exportMarkHtml', 'exportSourcesList', 'exportSourcesHtml'], { arr, esc })
  const think = 'https://www.thinkbusiness.ie/articles/ballymaloe-foods-new-generation'
  const env = {
    sources: {
      src_a: { publisher: 'ThinkBusiness', title: 'Ballymaloe Foods: Relishing a challenge | ThinkBusiness', uri: think, licence: 'open', published_at: '2024-05-01' },
      src_b: { publisher: 'ThinkBusiness', title: 'Ballymaloe’s recipe for growth', uri: `${think}-2`, licence: 'open' },
      src_c: { publisher: 'Irish Food & Drink (Bord Bia)', title: 'Suppliers', uri: 'https://www.irishfoodanddrink.com/s', licence: 'licensed-internal' },
      src_d: { publisher: 'Client', title: 'RFT.pdf', uri: 'material:mat_f', licence: 'client-confidential' },
      src_e: { publisher: 'Odd Site', title: '<img src=x onerror=alert(1)>', uri: 'javascript:alert(1)', licence: 'open' },
      src_f: { publisher: 'someone', uri: 'human:ab12', tier: 'reviewer-verified', licence: 'client-confidential' },
      src_g: { publisher: 'No Licence Ltd', title: 'Unmarked', uri: 'https://example.com/x' },
    },
    pins: { f_1: { sources: ['src_a'] }, f_2: { sources: ['src_b'] }, f_3: { sources: ['src_c'] }, f_4: { sources: ['src_d'] },
      f_5: { sources: ['src_e'] }, f_6: { sources: ['src_f'] }, f_7: { sources: [] }, f_8: { sources: ['src_g'] } },
    findings: { fi_1: { cites: ['f_1', 'f_3'] } },
    capture: { items: { cap_1: { material_id: 'mat_p' }, cap_2: { material_id: 'mat_f' } } },
    materials: { mat_p: { kind: 'prompt' }, mat_f: { kind: 'file', name: 'RFT.pdf' } },
    passages: { psg_1: { source: 'Cannes Lions', section: 'Case 12', citation: 'Cannes Lions › Case 12' } },
  }
  const parts = [
    { key: 'background', ids: ['f_1', 'f_3', 'd_9'] },
    { key: 'insight', ids: ['cap_1', 'f_2', 'f_1', 'cap_1'] },
    { key: 'smp', ids: ['d_9', 'f_7'] },
    { key: 'audience', ids: ['fi_1', 'cap_2', 'psg_1', 'f_6', 'f_8', 'f_5'] },
  ]
  const c = f.exportCitations(parts, env)
  // One number a publisher, in the order first cited; the same publisher's other article sits under it.
  assert.deepEqual(c.notes.map(n => [n.n, n.name]), [[1, 'ThinkBusiness'], [2, 'Irish Food & Drink (Bord Bia)'], [3, 'Client material'], [4, 'Cannes Lions'],
    [5, 'Checked by a person'], [6, 'No Licence Ltd'], [7, 'Odd Site']])
  assert.deepEqual(c.notes[0].items.map(i => i.uri), [think, `${think}-2`], 'open https sources link, both articles under the one number')
  assert.equal(c.notes[0].items[0].text, 'Ballymaloe Foods: Relishing a challenge · 2024', 'a title that ends with its publisher’s name loses it')
  assert.deepEqual(c.marks, { background: [1, 2], insight: [1, 3], audience: [1, 2, 3, 4, 5, 6, 7] }, 'a part with nothing citable carries no mark')
  // The licence rule: only an open https source links. Licensed-internal, client material and an unmarked licence are named.
  assert.equal(c.notes[1].items[0].uri, null, 'licensed-internal is named, never linked')
  assert.equal(c.notes[5].items[0].uri, null, 'an unknown licence counts as client-confidential')
  assert.equal(c.notes[6].items[0].uri, null, 'an address that is not http or https is not a link, even on an open source')
  assert.deepEqual(c.notes[2].items.map(i => i.text), ['The client’s request', 'RFT.pdf'], 'the client’s material is named, never linked')
  // A pin with no source record is not cited; the page's own decision ids are not sources.
  assert.ok(!JSON.stringify(c).includes('d_9') && !c.marks.smp)
  // Twice over, the same numbers.
  assert.deepEqual(f.exportCitations(parts, env), c)

  const html = f.exportSourcesHtml(c)
  assert.match(html, /<li value="1"><b>ThinkBusiness<\/b>: Ballymaloe Foods: Relishing a challenge · 2024 — <a href="https:\/\/www\.thinkbusiness\.ie\/articles\/ballymaloe-foods-new-generation">https:\/\/www\.thinkbusiness\.ie\/articles\/ballymaloe-foods-new-generation<\/a>; /)
  // An address that is not http or https never becomes a link, and a title is escaped.
  assert.doesNotMatch(html, /href="javascript:/i)
  assert.doesNotMatch(html, /<img/i)
  assert.match(html, /<b>Odd Site<\/b>: &#60;img src=x onerror=alert\(1\)&#62;<\/li>/)
  // No sources, no section; no marks, no mark.
  assert.equal(f.exportSourcesHtml({ marks: {}, notes: [] }), '')
  assert.equal(f.exportSourcesHtml(null), '')
  assert.equal(f.exportMarkHtml([]), '')
  assert.equal(f.exportMarkHtml(undefined), '')
  assert.equal(f.exportMarkHtml([1, 3]), '<sup class="fn">1,3</sup>')
})

test('a library precedent in the export is named, never quoted and never linked (feature award-in-brief-maker)', () => {
  type Cit = { marks: Record<string, number[]>; notes: { n: number; name: string; items: { text: string; uri: string | null }[] }[] }
  type F = { exportCitations(parts: unknown[], env: unknown): Cit; exportSourcesHtml(c: Cit | null): string }
  const f = lift<F>(BM, ['exportClient', 'exportSource', 'exportNotes', 'exportCitations', 'exportMarkHtml', 'exportSourcesList', 'exportSourcesHtml'], { arr, esc })
  const insight = 'RECONSTRUCTED: music preference changes with the time of day, not just stable taste.'
  const award = 'https://www.oneclub.org/awards/theoneshow/-award/53387/daylist/'
  const env = {
    passages: {
      psg_lib: { pack: 'awardlib', source: 'Award case library', section: 'Spotify — Daylist (2024)', licence: 'licensed-internal', scope: 'house',
        citation: 'Award case library › Spotify — Daylist (2024)',
        text: `Spotify — Daylist (2024): ${insight}\n\n## Sources\n- Official award page: ${award}` },
      psg_ipa: { pack: 'ipa', source: 'ipa_0007.md', section: 'When the chips are down (2024)', citation: 'ipa_0007.md › When the chips are down (2024)', text: 'IPA case text' },
    },
  }
  const c = f.exportCitations([{ key: 'insight', ids: ['psg_lib', 'psg_ipa'] }], env)
  const lib = c.notes.find(n => n.name === 'Award case library')!
  assert.ok(lib, 'the library is named as a source')
  assert.deepEqual(lib.items, [{ text: 'Spotify — Daylist (2024)', uri: null }], 'the case is named by brand and campaign, with no link')
  assert.deepEqual(c.marks.insight, [1, 2], 'the part carries a footnote for each source')
  const html = f.exportSourcesHtml(c)
  assert.match(html, /<b>Award case library<\/b>: Spotify — Daylist \(2024\)<\/li>/)
  // Nothing of the passage's text, and not the award page's address, reaches the printed brief.
  assert.ok(!JSON.stringify(c).includes('RECONSTRUCTED') && !html.includes('RECONSTRUCTED') && !html.includes('music preference'))
  assert.ok(!html.includes('oneclub') && !JSON.stringify(c).includes('oneclub') && !/href=/.test(html))
  assert.ok(!/lib_[0-9a-f]+\.md/.test(html), 'the printed name is the case, never an internal file name')
})

test('the brief’s exports wait for the decision chain and say so when it cannot read it', () => {
  const src = fn(BM, 'chainForExport')
  assert.match(src, /CHAIN\.state==='ok'\|\|CHAIN\.state==='unavailable'\)\s*return Promise\.resolve\(\)/)
  assert.match(src, /CHAIN=\{state:'unavailable'/)
  const plain = fn(BM, 'buildPlainExportHTML')
  assert.match(plain, /Promise\.all\(\[inlineImages\(\), chainForExport\(\), inlineLogos\(\)\]\)/)
  assert.match(plain, /Sources could not be read for this export\./)
  assert.match(plain, /CHAIN\.state==='ok'\?exportCitations/)
  const grid = fn(BM, 'buildGridExportHTML')
  assert.match(grid, /return inlineLogos\(\)\.then\(function\(l\)\{ logos=l; return chainForExport\(\); \}\)\.then/)
  assert.match(grid, /Sources could not be read for this export\./)
  assert.match(grid, /CHAIN\.state==='ok'\?exportCitations\(exportParts\(gridKeys\(\)\)/)
})

// ── the grid export ────────────────────────────────────────────────────────

type GridCell = { num: string; label: string; key: string; kind: string; big: boolean }
type Grid = {
  gridSheets(): { appendix?: boolean; title?: string; rows: GridCell[][] }[]
  gridKeys(): string[]
  gridLimit(key: string): number
  gridWords(v: unknown): number
  gridText(v: unknown): string
  gridItems(v: unknown): string[]
  gridHas(v: unknown): boolean
  gridStep(words: number, limit: number): number
  gridGaps(ctx: unknown): { key: string; label: string }[]
  gridHeld(ctx: unknown): number
  gridGrounded(ctx: unknown): number
  gridHollow(ctx: unknown): boolean
  gridFlag(v: unknown): boolean
  gridHeaderInfo(e: unknown): string[][]
  gridBody(ctx: unknown): { html: string; sheets: number; contentSheets: number; appendixSheets: number; warnings: { key: string; label: string; words: number; limit: number; step: number }[] }
  gridContentSheets(): number
  gridCss(): string
}
const grid = (GRID_MEDIA_ROW = false) => lift<Grid>(BM, ['exportMarkHtml', 'exportSourcesList', 'gridContentSheets', 'gridSheets', 'gridKeys', 'gridLimit', 'gridText', 'gridItems', 'gridHas', 'gridFlag', 'gridWords', 'gridStep', 'gridCell', 'gridChunks', 'gridAppendix', 'gridClientName', 'gridGaps', 'gridHeld', 'gridGrounded', 'gridHollow', 'gridHeaderInfo', 'gridInfo', 'gridSheet', 'gridBody', 'gridCss'], { arr, esc, GRID_MEDIA_ROW })
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const hasVal = (v: unknown) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim() !== '')
const notes = [{ n: 1, name: 'ThinkBusiness', items: [{ text: 'A title · 2024', uri: 'https://example.com/a' }] }]
const ctxOf = (vals: Record<string, unknown>, cit: unknown = { marks: {}, notes: [] }) => ({
  get: (k: string) => vals[k], hasVal, cit, project: 'Better With Ballymaloe', client: 'Ballymaloe Relish', version: '1.2',
  info: [['Client', 'Ballymaloe Relish'], ['Project', 'Better With Ballymaloe'], ['Version', '1.2'], ['Date', '29 October 2026'], ['Reference', ''], ['Prepared by', ''], ['Agency lead', ''], ['Client lead', '']],
})

test('the grid numbers its sections once, in one sequence, and starts with the job', () => {
  const g = grid()
  const nums = g.gridSheets().flatMap(s => s.rows.flat()).map(c => c.num).filter(n => /^\d+$/.test(n))
  assert.deepEqual([...new Set(nums)], ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13'])
  assert.deepEqual(nums.filter(n => n === '05').length, 3, 'the three objectives share one number')
  assert.equal(g.gridKeys()[0], 'job')
  assert.ok(g.gridKeys().includes('objection') && !g.gridKeys().includes('sources'))
  assert.equal(g.gridSheets().at(-1)?.appendix, true, 'the evidence and the questions sit on an appendix sheet')
})

// The media row (feature brief-media-measure): built, and switched off by one constant until Laurence confirms the page rule.
const AT_LIMIT = (g: Grid) => {
  const v: Record<string, unknown> = {}
  const text = (n: number) => Array.from({ length: n }, (_, i) => (['the', 'family', 'brand', 'grows', 'because', 'shoppers', 'rarely', 'reach', 'for', 'relish'])[i % 10]).join(' ')
  const ITEMS: Record<string, number> = { media_roles: 4, measurement: 5, reasons_to_believe: 3 }
  for (const s of g.gridSheets()) for (const r of s.rows) for (const c of r) {
    const lim = g.gridLimit(c.key) || 20, n = c.kind === 'list' ? ITEMS[c.key] || 3 : 0
    // a list's words are shared out over its items so that they add up to the limit exactly
    v[c.key] = n ? Array.from({ length: n }, (_, i) => text(Math.floor(lim / n) + (i < lim % n ? 1 : 0))) : text(lim)
  }
  return v
}

test('the media row is one constant, off: today’s print is unchanged, and the parts are still on the form', () => {
  assert.equal((BM.match(/GRID_MEDIA_ROW\s*=/g) || []).length, 1, 'one place switches the row')
  assert.match(BM, /var GRID_MEDIA_ROW=false;/)
  const g = grid()
  const keys = g.gridSheets().flatMap(s => s.rows.flat()).map(c => c.key)
  assert.ok(!keys.includes('media_roles') && !keys.includes('measurement'), 'neither box is printed')
  assert.ok(!g.gridKeys().includes('media_roles'))
  const rows = g.gridSheets()[0].rows
  assert.equal(rows.length, 5, 'sheet 1 is the five rows it was')
  assert.deepEqual(g.gridSheets()[1].rows.flat().map(c => c.num).filter(n => /^\d+$/.test(n)).slice(0, 2), ['07', '08'], 'the insight is 07 and the single thought 08')
  const out = g.gridBody(ctxOf({ ...AT_LIMIT(g), media_roles: ['x'], measurement: ['y'] }))
  assert.equal(out.contentSheets, 2)
  assert.doesNotMatch(out.html, /Role of each medium|How we will know it worked/)
  // a brief without the parts is not held up by them: the export writes no part the sheet does not print
  assert.ok(!g.gridGaps({ get: () => 'x', hasVal } as never).some(x => x.key === 'media_roles' || x.key === 'measurement'))
  // both are on the form and found by the words a person uses
  assert.match(BM, /key:'budget_and_scope',label:'Budget & scope',type:'text'\},\s*\{sec:'Execution',key:'media_roles',label:'Role of each medium',type:'list'\},\s*\{sec:'Execution',key:'measurement',label:'How we will know it worked',type:'list'\}/)
  assert.match(BM, /media_roles:'media, channels, role of each medium/)
  assert.match(BM, /measurement:'measurement, how we will know it worked/)
})

test('switched on, the media row is two boxes on sheet 1 after the budget, and the later boxes run 09 to 15', () => {
  const g = grid(true)
  const sheets = g.gridSheets()
  const rows = sheets[0].rows
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[4].map(c => c.key), ['budget_and_scope'])
  assert.deepEqual(rows[5].map(c => [c.num, c.key, c.kind, c.label]), [['07', 'media_roles', 'list', 'Role of each medium'], ['08', 'measurement', 'list', 'How we will know it worked']])
  const nums = sheets.flatMap(s => s.rows.flat()).map(c => c.num).filter(n => /^\d+$/.test(n))
  assert.deepEqual([...new Set(nums)], ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'])
  assert.deepEqual(sheets[1].rows.flat().map(c => [c.num, c.key]).slice(0, 3), [['09', 'insight'], ['10', 'single_minded_proposition'], ['11', 'reasons_to_believe']])
  assert.equal(sheets.filter(s => !s.appendix).length, g.gridContentSheets(), 'still two content sheets')
  assert.ok(g.gridKeys().indexOf('media_roles') === g.gridKeys().indexOf('budget_and_scope') + 1 && g.gridKeys().includes('measurement'))
  assert.ok(g.gridKeys().includes('objection'))
})

test('switched on, every box at its limit is two content sheets, nothing named as over, and the corner tag prints on a list', () => {
  const g = grid(true)
  const v = AT_LIMIT(g)
  for (const [k, lim] of [['media_roles', 55], ['measurement', 70]] as const) assert.equal(g.gridWords(v[k]), lim, `${k} is filled to its limit`)
  const out = g.gridBody(ctxOf(v, { marks: {}, notes }))
  assert.equal(out.contentSheets, 2)
  assert.deepEqual(out.warnings, [], 'at its limit a box does not step down')
  assert.match(out.html, /<b>07<\/b>Role of each medium<\/div><div class="bd"><ul>/)
  assert.match(out.html, /<b>08<\/b>How we will know it worked<\/div><div class="bd"><ul>/)
  assert.match(out.html, /<b>15<\/b>Mandatories/)
  assert.doesNotMatch(out.html, /SHEET<b>3\//)
  // over its limit a new box steps down like the others, and a part that rests on an assumption carries the tag
  const over = g.gridBody(ctxOf({ ...v, media_roles: ['To confirm: ' + words(4 * 20)], measurement: [words(120)] }))
  assert.deepEqual(over.warnings.map(w => [w.key, w.step]).sort(), [['measurement', 3], ['media_roles', 2]])
  assert.equal((over.html.match(/class="tc"/g) || []).length, 1, 'the list box carries the to-confirm tag from its first item')
  assert.doesNotMatch(over.html, /To confirm:/)
  // a brief that has neither part prints the missing box and the gate names them
  const bare = g.gridBody(ctxOf({}))
  assert.equal((bare.html.match(/Missing: ask the Brief agent to write this part\./g) || []).length, 19, 'every box but the open questions reads missing')
  assert.ok(g.gridGaps({ get: () => '', hasVal } as never).some(x => x.key === 'media_roles'))
  assert.ok(g.gridGaps({ get: () => '', hasVal } as never).some(x => x.key === 'measurement'))
})

test('a box’s word limit is the brief schema’s for every part that has one, and a long part steps its own type down', () => {
  const g = grid()
  const schema = JSON.parse(readFileSync(join(templates(), '..', '..', 'server', 'napkin', 'brief', 'golden_brief.schema.json'), 'utf8')) as { fields: { id: string; type?: string; max_words?: number; max_items?: number }[] }
  // the app's key for each schema field, as the template's own pipeline declares it (one key per field: the objectives and the response have none with a limit)
  const pipeline = readFileSync(join(templates(), 'brief-maker', 'app', 'pipeline.yaml'), 'utf8')
  const keyOf: Record<string, string[]> = {}
  for (const m of pipeline.matchAll(/^ {2}([\w.]+):\s+\{ class: \w+, rubric: (\w+)/gm)) (keyOf[m[2]] ||= []).push(m[1])
  const limited = schema.fields.filter(f => f.max_words)
  assert.ok(limited.length >= 13, 'every schema field with a word limit is checked')
  for (const f of limited) {
    assert.equal(keyOf[f.id]?.length, 1, `${f.id} is one part of the brief`)
    assert.equal(g.gridLimit(keyOf[f.id][0]), f.max_words, `${f.id} keeps the schema's limit in gridLimit`)
  }
  // every list part with an item cap is a list on the form and in the document
  const doc = JSON.parse(readFileSync(join(templates(), 'brief-maker', 'schema.json'), 'utf8')) as { properties: Record<string, { type: string }> }
  for (const f of schema.fields.filter(x => x.max_items)) {
    const k = keyOf[f.id][0]
    assert.equal(doc.properties[k].type, 'array', `${f.id} is an array in the document`)
    assert.match(BM, new RegExp(`key:'${k}',label:'[^']+',type:'list'`), `${f.id} is a list row on the form`)
  }
  assert.ok(schema.fields.filter(x => x.max_items).length >= 3)
  assert.equal(g.gridLimit('objectives.commercial'), 0, 'a part with no limit is never stepped down')
  assert.equal(g.gridWords(words(7)), 7)
  assert.equal(g.gridWords(['a b', 'c']), 3)
  assert.equal(g.gridWords(null), 0)
  assert.deepEqual([[70, 70], [71, 70], [88, 70], [112, 70], [120, 70], [9, 0]].map(([w, l]) => g.gridStep(w, l)), [0, 1, 2, 2, 3, 0])
  assert.equal(g.gridStep(g.gridWords(words(45)), g.gridLimit('job')), 2, 'a job twice its size steps down now it has a limit')
})

// What size a part's text really prints at: the grid's own CSS read with a small cascade (class chains, specificity, order),
// so a step-down class that no rule reaches shows as "no smaller", whatever the page claims in its toast.
type GridCellFns = Grid & { gridCell(c: unknown, ctx: unknown): string }
function printedSize(css: string, ancestors: string[][], el: string[]): number {
  const rules: { chain: string[][]; spec: number; order: number; px: number }[] = []
  let order = 0
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const px = /font-size:([\d.]+)px/.exec(m[2])
    if (!px || m[1].trim().startsWith('*')) continue
    for (const sel of m[1].split(',')) {
      const chain = sel.trim().split(/\s+/).map(part => part.split('.').filter(Boolean))
      rules.push({ chain, spec: chain.flat().length, order: order++, px: Number(px[1]) })
    }
  }
  // the element chain: sheet > box > .bd > the text element; a rule applies when its chain is a subsequence ending at a node of the chain
  const nodes = [...ancestors, el]
  const applies = (rule: (typeof rules)[number], upto: number) => {
    let i = rule.chain.length - 1
    if (!rule.chain[i].every(c => nodes[upto].includes(c))) return false
    for (let n = upto - 1; n >= 0 && i > 0; n--) if (rule.chain[i - 1].every(c => nodes[n].includes(c))) i--
    return i === 0 || (i === 1 && false)
  }
  let size = 0
  for (let upto = 0; upto < nodes.length; upto++) {
    const hit = rules.filter(r => applies(r, upto)).sort((a, b) => a.spec - b.spec || a.order - b.order).pop()
    if (hit) size = hit.px
  }
  return size
}

test('every box with a word limit prints smaller when it steps down, and on a tight sheet, in the type that is really on the page', () => {
  const g = grid(true) as GridCellFns
  const css = g.gridCss()
  const cells = g.gridSheets().flatMap(s => s.rows.flat()).filter(c => c.kind !== 'sources' && g.gridLimit(c.key))
  assert.deepEqual(cells.map(c => c.key).sort(), Object.keys(AT_LIMIT(g)).filter(k => g.gridLimit(k)).sort().filter(k => k !== 'objection'), 'every limited box is checked')
  assert.ok(['job', 'barrier', 'media_roles', 'measurement', 'single_minded_proposition', 'insight'].every(k => cells.some(c => c.key === k)))
  const render = (c: GridCell, n: number, tight: boolean) => {
    const base = AT_LIMIT(g)
    const v = { ...base, [c.key]: c.kind === 'list' ? [words(n)] : words(n), objection: words(g.gridLimit('objection')) }
    const html = g.gridCell(c, ctxOf(v))
    const box = /<div class="(box[^"]*)">/.exec(html)![1].split(/\s+/)
    const text = /<p class="([^"]*)">|<(li)>/.exec(html.slice(html.indexOf('class="bd"')))!
    const el = text[2] ? [] : (text[1] || '').split(/\s+/).filter(Boolean)
    return printedSize(css, [['sheet', ...(tight ? ['tight'] : [])], box, ['bd']], el)
  }
  for (const c of cells) {
    const lim = g.gridLimit(c.key)
    const full = render(c, lim, false), over = render(c, Math.ceil(lim * 1.7), false), tight = render(c, lim, true)
    assert.ok(full > 0 && over > 0, `${c.key} has a printed size`)
    assert.ok(over < full, `${c.key} over its limit prints smaller (${over}px, was ${full}px)`)
    assert.ok(tight < full, `${c.key} on a tight sheet prints smaller (${tight}px, was ${full}px)`)
  }
  // the objection sits in the single thought's box: it steps down in its own line, is named as over, and tightens with the sheet
  const hero = cells.find(c => c.key === 'single_minded_proposition')!
  const obj = (n: number, tight = false) => {
    const v = { ...AT_LIMIT(g), objection: words(n) }
    const html = g.gridCell(hero, ctxOf(v)), p = /<p class="(obj[^"]*)">/.exec(html)![1].split(/\s+/)
    return printedSize(css, [['sheet', ...(tight ? ['tight'] : [])], /<div class="(box[^"]*)">/.exec(html)![1].split(/\s+/), ['bd']], p)
  }
  assert.ok(obj(52) < obj(30), 'an over-long objection prints smaller')
  assert.ok(obj(30, true) < obj(30), 'and on a tight sheet')
  const body = g.gridBody(ctxOf({ ...AT_LIMIT(g), objection: words(52) }))
  assert.deepEqual(body.warnings.map(w => [w.key, w.step]), [['objection', 3]], 'the over-long objection is named, so the toast is true')
  assert.deepEqual(g.gridBody(ctxOf({ ...AT_LIMIT(g), objection: words(30) })).warnings, [])
})

test('the grid prints a header, an info grid and a footer as the sheets need them, and places each part in its box', () => {
  const g = grid()
  const vals = { job: 'Make an ordinary person ring.', background: 'Where we are.', audience: 'Who.', 'objectives.commercial': 'C', 'objectives.behavioural': 'B', 'objectives.attitudinal': 'A',
    budget_and_scope: 'Budget.', insight: 'The insight.', single_minded_proposition: 'One thought.', reasons_to_believe: ['r1', 'r2'], competitor_context: 'Rivals.',
    'desired_response.think': 't', 'desired_response.feel': 'f', 'desired_response.do': 'd', tone_and_world: ['warm'], mandatories: ['logo'], open_questions: ['What is the budget?'] }
  const out = g.gridBody(ctxOf(vals, { marks: { single_minded_proposition: [1] }, notes }))
  // The page rule: two content sheets, and the appendix is outside that count. The footer still numbers every page.
  assert.equal(out.sheets, 3)
  assert.equal(out.contentSheets, 2)
  assert.equal(out.appendixSheets, 1)
  for (const n of [1, 2]) assert.match(out.html, new RegExp(`SHEET<b>${n}/2</b>`))
  assert.match(out.html, /APPENDIX<b>1\/1<\/b>/)
  assert.doesNotMatch(out.html, /SHEET<b>3\//, 'the appendix is not a third sheet')
  for (const n of [1, 2, 3]) assert.match(out.html, new RegExp(`<span>${n} of 3</span>`))
  assert.equal((out.html.match(/class="hd"/g) || []).length, 3, 'a header on every sheet')
  assert.equal((out.html.match(/class="info"/g) || []).length, 1, 'the info grid on the first sheet only')
  assert.equal((out.html.match(/class="foot"/g) || []).length, 3, 'a footer on every sheet')
  assert.match(out.html, /Napkin \/ Ballymaloe Relish \/ Better With Ballymaloe \/ Creative brief 1\.2 \/ Confidential/)
  assert.match(out.html, /<b>01<\/b>The job<\/div><div class="bd"><p class="job">Make an ordinary person ring\.<\/p>/)
  assert.match(out.html, /<div class="box dark"><div class="lab"><b>08<\/b>The single thought<\/div><div class="bd"><p class="big">One thought\.<sup class="fn">1<\/sup><\/p>/)
  assert.match(out.html, /<b>09<\/b>Why they should believe it<\/div><div class="bd"><ul><li>r1<\/li><li>r2<\/li><\/ul>/)
  assert.match(out.html, /<div class="src"><ol><li value="1"><b>ThinkBusiness<\/b>: A title · 2024 — <a href="https:\/\/example\.com\/a">/)
  assert.deepEqual(out.warnings, [])
  // A part nobody has written reads as missing, never as a quiet blank (the export writes it before it prints).
  assert.match(out.html, /<b>03<\/b>The barrier<\/div><div class="bd"><p class="todo">Missing: ask the Brief agent to write this part\.<\/p>/)
  assert.match(out.html, /The objection it has to beat: <i>missing: ask the Brief agent to write it<\/i>/)
  assert.doesNotMatch(out.html, /To be written|Not written yet/)
})

test('the grid names a part that ran over its box, drops an appendix with nothing in it, and escapes what it prints', () => {
  const g = grid()
  const vals = { single_minded_proposition: words(30), audience: '<script>alert(1)</script>', background: words(120) }
  const out = g.gridBody(ctxOf(vals))
  assert.equal(out.sheets, 3, 'the appendix is always there, and says so when it has nothing to list')
  assert.match(out.html, /No outside sources were cited\. Every claim rests on the client’s brief and on proposals marked to confirm\./)
  assert.match(out.html, /<p>No open questions: the brief holds what it needs\.<\/p>/)
  assert.deepEqual(out.warnings.map(w => [w.key, w.step]).sort(), [['background', 3], ['single_minded_proposition', 2]])
  assert.match(out.html, /class="box dark fit2"/, 'the single thought steps down inside its own box')
  assert.match(out.html, /class="box fit3"/)
  assert.doesNotMatch(out.html, /<script>/)
  assert.match(out.html, /&#60;script&#62;alert\(1\)&#60;\/script&#62;/)
  assert.match(out.html, /<p class="todo">Missing: ask the Brief agent to write this part\.<\/p>/, 'a part nobody has written yet is not left blank')
})

test('a brief leaves with nothing empty: the gate names every empty part, the header holds suggestions, and the Brief agent writes first', () => {
  const g = grid()
  const all = { job: 'J.', background: 'B.', barrier: 'Ba.', audience: 'A.', 'objectives.commercial': 'c', 'objectives.behavioural': 'b', 'objectives.attitudinal': 'a',
    budget_and_scope: 'x', insight: 'I.', single_minded_proposition: 'S.', objection: 'O.', reasons_to_believe: ['r'], competitor_context: 'k',
    'desired_response.think': 't', 'desired_response.feel': 'f', 'desired_response.do': 'd', tone_and_world: ['w'], mandatories: ['m'] }
  assert.deepEqual(g.gridGaps({ get: (k: string) => (all as Record<string, unknown>)[k], hasVal }), [], 'a complete brief has no gap')
  const thin = { ...all, job: '', barrier: undefined, objection: ' ', mandatories: [] }
  assert.deepEqual(g.gridGaps({ get: (k: string) => (thin as Record<string, unknown>)[k], hasVal }).map(x => x.key), ['job', 'barrier', 'mandatories', 'objection'])
  const at = (o: object) => ({ get: (k: string) => (o as Record<string, unknown>)[k], hasVal })
  assert.equal(g.gridHollow(at(all)), false)
  assert.equal(g.gridHollow(at(thin)), false, 'a brief missing four parts is still a brief')
  assert.equal(g.gridHollow(at({})), true, 'an empty brief is not exported')
  assert.equal(g.gridHollow(at({ single_minded_proposition: 'Just one thing.' })), true)
  assert.equal(g.gridHollow(at({ job: 'J.', background: 'B.', audience: 'A.', insight: 'I.' })), false)
  assert.match(BM, /Not exported: there is hardly anything/)
  assert.match(BM, /Not exported: almost everything here is a guess/)
  // A one-word brief: every part comes back, every text part marked, the lists invented. Complete-looking and hollow.
  const guess = Object.fromEntries(Object.keys(all).map(k => [k, Array.isArray((all as Record<string, unknown>)[k]) ? ['x'] : 'To confirm: A guess.']))
  assert.deepEqual(g.gridGaps(at(guess)), [], 'nothing is empty')
  assert.equal(g.gridGrounded(at(guess)), 0)
  assert.equal(g.gridHollow(at(guess)), true, 'a brief of guesses is not exported as a grid')
  // Ballymaloe: the client's own words in several parts, the rest proposed.
  const rooted = { ...guess, job: 'Make an ordinary person ring.', audience: 'Families who cook.', budget_and_scope: '40k, Irish retail.' }
  assert.equal(g.gridHollow(at(rooted)), false)
  assert.equal(g.gridHollow(at({ ...rooted, audience: 'To confirm: A.' })), true, 'two grounded parts are not enough')
  assert.equal(g.gridHollow(at({ goal: 'make me a brief' })), true)
  // The header: a value, a suggestion marked as one, or a prompt for what only a person knows. Never a blank.
  const info = g.gridHeaderInfo({ client: 'Ballymaloe Relish, an Irish family relish brand.', project: 'Better With Ballymaloe', version: '1.2', date: '29 October 2026',
    me: 'Sai', today: new Date(2026, 9, 29) })
  assert.deepEqual(info.map(p => p[0]), ['Client', 'Project', 'Version', 'Date', 'Reference', 'Prepared by', 'Agency lead', 'Client lead'])
  assert.equal(info.find(p => p[0] === 'Reference')?.[1], 'BAL-261029 (suggested)')
  assert.deepEqual([info[5][1], info[6][1], info[7][1]], ['Sai', 'Sai', '[client lead, to confirm]'])
  const blank = g.gridHeaderInfo({ date: '29 October 2026', today: new Date(2026, 9, 29) })
  assert.ok(blank.every(p => String(p[1]).trim() !== ''), 'even a brief with no client, project or signed-in person has no empty cell')
  assert.equal(blank.find(p => p[0] === 'Prepared by')?.[1], 'Napkin Studio')
  // The export: the grid asks the Brief agent for what is missing and stops, saying so, if it is still missing; the plain export never waits.
  const ex = fn(BM, 'exportOnce')
  assert.match(ex, /style==='plain'\)\s*return runExport\(kind, style\)/)
  assert.match(ex, /gridGaps\(ctx\)/)
  assert.match(ex, /fillParts\(gaps\.map/)
  assert.match(ex, /Not exported: /)
  assert.match(fn(BM, 'fillParts'), /regenField\(f,guidanceFor\?guidanceFor\(k\):null,null,function\(j\)\{/)
  assert.match(fn(BM, 'regenField'), /if\(done\) done\(j\)/)
  // A fill that cannot start still finishes, so an export waiting on it never hangs; one export runs at a time.
  assert.match(fn(BM, 'regenField'), /if\(!window\.clan\)\{ if\(done\) done\(\); return; \}/)
  assert.match(fn(BM, 'regenField'), /setStatus\(esc\(NO_MW\)\); if\(done\) done\(\); return;/)
  assert.match(fn(BM, 'doExport'), /if\(EXPORTING\)\{ toast\('An export is already running\.'\); return; \}/)
  assert.match(fn(BM, 'doExport'), /EXPORTING=false/)
  // Sideways overflow counts, and when no part is over a limit the longest parts are the ones tightened.
  assert.match(fn(BM, 'gridOverflow'), /scrollWidth>b\.clientWidth/)
  assert.match(fn(BM, 'runExport'), /if\(!long\.length\) long=gridLongest\(2\)/)
  assert.match(BM, /overflow-wrap:anywhere/)
  // The three new parts are on the form beside the others, and the page can find them by the words a person uses.
  assert.match(BM, /key:'job',label:'The job'[\s\S]*key:'background'[\s\S]*key:'barrier',label:'The barrier'/)
  assert.match(BM, /key:'single_minded_proposition'[\s\S]*key:'objection',label:'The objection to beat'/)
  assert.match(BM, /job:'job, the job, task'/)
  assert.match(BM, /objection:'objection, the objection, doubt'/)
})

test('bad data never prints as junk: text and numbers print, anything else counts as empty', () => {
  const g = grid()
  assert.equal(g.gridText({ a: 1 }), '')
  assert.equal(g.gridText(true), '')
  assert.equal(g.gridText(null), '')
  assert.equal(g.gridText(42), '42')
  assert.equal(g.gridText('  hi  '), 'hi')
  assert.equal(g.gridText(['a', { b: 1 }, ' ', 'c']), 'a; c')
  assert.deepEqual(g.gridItems('one'), ['one'])
  assert.deepEqual(g.gridItems(['a', null, { x: 1 }, 'b']), ['a', 'b'])
  assert.equal(g.gridHas({}), false)
  assert.equal(g.gridHas('   '), false)
  const bad = { job: { nested: 'object' }, background: true, audience: [['a', 'b'], 'c'], insight: 12345, reasons_to_believe: 'a string, not a list', mandatories: 7 }
  const out = g.gridBody({ ...ctxOf(bad), project: undefined, client: undefined })
  assert.doesNotMatch(out.html, /\[object Object\]|undefined|>null<|>true<|>false</)
  assert.match(out.html, /Creative brief\. Untitled brief/, 'a brief with no project name is not called undefined')
  const gaps = g.gridGaps({ get: (k: string) => (bad as Record<string, unknown>)[k], hasVal }).map(x => x.key)
  assert.ok(gaps.includes('job') && gaps.includes('background'), 'an object or a boolean is empty, so the export writes it')
  assert.ok(!gaps.includes('insight') && !gaps.includes('mandatories'), 'a number is text')
})

test('the appendix runs on over as many sheets as it needs, and nothing in it is cut or repeated', () => {
  const g = grid()
  const many = Array.from({ length: 25 }, (_, i) => ({ n: i + 1, name: `Publisher ${i + 1}`, items: [{ text: `Article title number ${i + 1} · 2025`, uri: `https://example.com/a-${i + 1}/with/a/long/path/to/read` }] }))
  const qs = Array.from({ length: 40 }, (_, i) => `Question ${i} about something only the client knows, in a sentence of a fair length?`)
  const out = g.gridBody(ctxOf({ open_questions: qs }, { marks: {}, notes: many }))
  const sheets = g.gridSheets().filter(s => !s.appendix).length
  assert.ok(out.sheets > sheets + 1, 'more than one appendix sheet')
  for (let i = 0; i < qs.length; i++) assert.equal((out.html.match(new RegExp(`Question ${i} about`, 'g')) || []).length, 1, `question ${i} printed once`)
  for (let i = 1; i <= 25; i++) assert.equal((out.html.match(new RegExp(`<b>Publisher ${i}</b>`, 'g')) || []).length, 1, `source ${i} printed once`)
  assert.match(out.html, /Appendix \(continued\)\. Sources and questions to settle\./)
  assert.match(out.html, new RegExp(`APPENDIX<b>${out.appendixSheets}/${out.appendixSheets}</b>`))
  assert.equal(out.contentSheets, 2, 'a long appendix never adds a content sheet')
  // The same numbers a footnote carries, in order, across the sheets.
  const nums = [...out.html.matchAll(/<li value="(\d+)"><b>Publisher/g)].map(m => +m[1])
  assert.deepEqual(nums, Array.from({ length: 25 }, (_, i) => i + 1))
  // A short list beside a long one says so, instead of an empty box.
  const lopsided = g.gridBody(ctxOf({ open_questions: qs }, { marks: {}, notes: many.slice(0, 2) }))
  assert.match(lopsided.html, /All listed on the previous sheet\./)
  // A brief with nothing to list still has its appendix, saying so.
  const none = g.gridBody(ctxOf({}))
  assert.equal(none.sheets, sheets + 1)
  assert.match(none.html, /No outside sources were cited\./)
})

test('the page rule: a brief is two content sheets however long its parts run, and the appendix is outside the count', () => {
  const g = grid()
  assert.equal(g.gridContentSheets(), 2)
  assert.ok(g.gridSheets().filter(s => !s.appendix).length <= g.gridContentSheets(), 'the sheet list holds at most two content sheets')
  // Every part three times past its box, a long reasons list and a long appendix: the content stays on two sheets.
  const long: Record<string, unknown> = {}
  for (const s of g.gridSheets()) for (const r of s.rows) for (const c of r) long[c.key] = (g.gridLimit(c.key) ? words(g.gridLimit(c.key) * 3) : words(60))
  long.reasons_to_believe = Array.from({ length: 12 }, (_, i) => `Reason ${i} ${words(25)}`)
  long.open_questions = Array.from({ length: 40 }, (_, i) => `Question ${i} about something only the client knows, in a sentence of a fair length?`)
  const out = g.gridBody(ctxOf(long, { marks: {}, notes }))
  assert.equal(out.contentSheets, 2, 'long content never becomes a third content sheet')
  assert.ok(out.warnings.length > 0, 'a part that ran over its box is named, not spilled')
  assert.doesNotMatch(out.html, /SHEET<b>[3-9]\//)
  // The appendix may run to several sheets, each labelled as appendix and numbered after the content sheets.
  assert.equal(out.sheets, out.contentSheets + out.appendixSheets)
  for (let n = 1; n <= out.appendixSheets; n++) assert.match(out.html, new RegExp(`APPENDIX<b>${n}/${out.appendixSheets}</b>`))
})

test('an export never prints a clipped sheet: it is measured, the Brief agent tightens the long parts once, and otherwise it stops', () => {
  assert.match(fn(BM, 'gridOverflow'), /createElement\('iframe'\)/)
  assert.match(fn(BM, 'gridOverflow'), /rows\[rows\.length-1\]\.getBoundingClientRect\(\)\.bottom>ft\.getBoundingClientRect\(\)\.top/)
  assert.match(fn(BM, 'buildGridExportHTML'), /return measureGrid\(doc\)\.then\(function\(bad\)\{ LAST_GRID_OVERFLOW=bad; return doc; \}\)/)
  const run = fn(BM, 'runExport')
  assert.match(run, /LAST_GRID_OVERFLOW\.length/)
  assert.match(run, /Rewrite this part in at most '\+gridLimit\(k\)\+' words/)
  assert.match(run, /!retried&&long\.length/)
  assert.match(run, /Not exported: sheet '\+LAST_GRID_OVERFLOW\[0\]\+' is too full\./)
  // the guard returns before exportDoc is called
  assert.ok(run.indexOf('Not exported: sheet') < run.indexOf('window.clan.exportDoc'))
})

// The real render: every box at its limit, drawn in headless Chrome, and the room left above each footer. Off unless
// NAPKIN_RENDER_CHECK=1 (and a Chrome is found), because the room depends on the machine's fonts: the figures in the
// feature record were measured on the Mac the page is made on, where the first sheet keeps 265 px (row off) and 34 px (row on).
const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p))
test('rendered, every box at its limit leaves room above the footer: the row off as before, the row on with two content sheets', { skip: process.env.NAPKIN_RENDER_CHECK !== '1' || !CHROME }, () => {
  const room = (on: boolean) => {
    const g = grid(on)
    const meas = `<script>onload=function(){var r=[];[].forEach.call(document.querySelectorAll('.sheet'),function(sh){var rows=sh.querySelectorAll('.row'),ft=sh.querySelector('.foot').getBoundingClientRect().top;r.push(Math.round(ft-rows[rows.length-1].getBoundingClientRect().bottom))});document.body.setAttribute('data-r',r.join(','))}</script>`
    const html = `<!DOCTYPE html><html><head><meta charset=utf-8><style>${g.gridCss()}</style></head><body>${g.gridBody(ctxOf(AT_LIMIT(g))).html}${meas}</body></html>`
    const dir = mkdtempSync(join(tmpdir(), 'brief-render-'))
    try {
      writeFileSync(join(dir, 'p.html'), html)
      const r = spawnSync(CHROME as string, ['--headless=new', '--disable-gpu', '--window-size=900,1200', '--virtual-time-budget=3000', '--dump-dom', `file://${join(dir, 'p.html')}`], { encoding: 'utf8' })
      return (/data-r="([^"]*)"/.exec(r.stdout)?.[1] ?? '').split(',').map(Number)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  const off = room(false), on = room(true)
  assert.ok(off[0] > 200 && off[1] > 100, `row off: no sheet is full (${off})`)
  assert.ok(on[0] >= 30 && on[1] > 100, `row on: sheet 1 keeps at least 30 px, sheet 2 is untouched (${on})`)
  assert.equal(on.length, off.length, 'the row adds no sheet')
})

test('a sheet too full with no part over its limit prints one step smaller, on that sheet only, before anyone is asked to rewrite', () => {
  const g = grid()
  const v = AT_LIMIT(g)
  const plain = g.gridBody(ctxOf(v))
  assert.doesNotMatch(plain.html, /class="sheet tight"/)
  const out = g.gridBody({ ...ctxOf(v), tight: [1] })
  assert.equal((out.html.match(/class="sheet tight"/g) || []).length, 1, 'only the named sheet')
  assert.match(out.html, /^<div class="sheet tight">/, 'and it is sheet 1')
  assert.deepEqual(out.warnings, [], 'nothing is named as over its limit: the step is not a rewrite')
  const css = g.gridCss()
  assert.match(css, /\.tight \.bd\{font-size:10\.6px;line-height:1\.38\}/)
  assert.ok(css.indexOf('.tight .bd') < css.indexOf('.fit1 .bd'), 'a box already stepped down by its own limit keeps its own step')
})

test('the export tries the tight step once, writes with it, and fails only if the sheet still overflows', async () => {
  const toasts: string[] = []
  const exported: string[] = []
  const built: unknown[] = []
  const filled: string[][] = []
  const OVER: number[] = [], WARN: unknown[] = []
  let stillOver = false
  const env = {
    toast: (m: string) => toasts.push(m), listWords: listJoin, gridLimit: (k: string) => (k === 'job' ? 30 : 0), gridLongest: () => [{ key: 'insight', label: 'The insight', words: 40 }],
    LAST_GRID_OVERFLOW: OVER, LAST_GRID_WARNINGS: WARN, docLocked: () => false, noMiddleware: () => false, WRITER_: 'The Brief agent', get: () => 'p',
    buildExportHTML: (_style: string, tight?: number[]) => {
      built.push(tight)
      OVER.length = 0
      if (!tight || stillOver) OVER.push(1)
      return Promise.resolve(tight ? '<tight/>' : '<plain/>')
    },
    fillParts: (keys: string[]) => { filled.push(keys); return Promise.resolve() },
    window: { clan: { exportDoc: (_k: string, _b: string, html: string) => { exported.push(html); return Promise.resolve({ ok: true }) } } },
  }
  const run = lift<{ runExport(kind: string, style?: string, retried?: boolean, tight?: number[]): Promise<unknown> }>(BM, ['runExport'], env)
  // too full, nothing over a limit: one tight render, and it goes out. The Brief agent is not asked.
  await run.runExport('pdf', 'grid')
  assert.deepEqual(built, [undefined, [1]], 'measured, then drawn tight on sheet 1')
  assert.deepEqual(exported, ['<tight/>'])
  assert.deepEqual(filled, [], 'no rewrite for a sheet that only needed a step')
  assert.ok(!toasts.some(t => /Not exported/.test(t)))
  // still too full after the step: it goes on to the old retry once, then stops naming the sheet, never looping
  built.length = 0; exported.length = 0; toasts.length = 0; stillOver = true
  await run.runExport('pdf', 'grid')
  assert.deepEqual(exported, [])
  assert.equal(filled.length, 1, 'the Brief agent tightens the longest parts once')
  assert.ok(toasts.some(t => /Not exported: sheet 1 is too full\./.test(t)))
  assert.ok(built.length <= 6, 'a bounded number of renders')
  // a part over its limit is the old path: the Brief agent first, no tight step
  built.length = 0; filled.length = 0; toasts.length = 0; WARN.push({ key: 'job', label: 'The job', words: 60, limit: 30, step: 3 })
  await run.runExport('pdf', 'grid')
  assert.equal(filled[0]?.[0], 'job')
  assert.ok(!built.some(t => Array.isArray(t)), 'no tight step when a part is over its limit')
})

// The overflow decision with the real pieces: the real runExport, buildGridExportHTML, gridBody and gridCss. Only the browser's
// measure (gridOverflow) is a stand-in, and it reads the HTML that was really built: a sheet overflows unless it was drawn
// tight, so a step that did nothing to the document leaves it over.
test('the real overflow decision: a sheet with no part over its limit is redrawn tight, and one that still overflows goes to the Brief agent, then stops naming the sheet', async () => {
  const g = grid()
  const NAMES = ['exportMarkHtml', 'exportSourcesList', 'gridContentSheets', 'gridSheets', 'gridKeys', 'gridLimit', 'gridText', 'gridItems', 'gridHas', 'gridFlag', 'gridWords', 'gridStep', 'gridCell', 'gridChunks', 'gridAppendix', 'gridClientName', 'gridHeaderInfo', 'gridInfo', 'gridSheet', 'gridBody', 'gridCss', 'gridLongest', 'measureGrid', 'buildGridExportHTML', 'buildExportHTML', 'runExport']
  const setup = (vals: Record<string, unknown>, alwaysOver: boolean) => {
    const toasts: string[] = [], exported: string[] = [], renders: string[] = [], filled: string[][] = []
    const env = {
      arr, esc, GRID_MEDIA_ROW: false, hasVal, toast: (m: string) => toasts.push(m), listWords: listJoin, WRITER_: 'The Brief agent',
      inlineLogos: () => Promise.resolve([]), confList: () => [],
      LAST_GRID_WARNINGS: [] as unknown[], LAST_GRID_OVERFLOW: [] as number[], docLocked: () => false, noMiddleware: () => false,
      get: (k: string) => vals[k], CHAIN: { state: 'ok' }, chainForExport: () => Promise.resolve(), exportCitations: () => ({ marks: {}, notes: [] }), exportParts: () => [],
      workingTitle: () => 'Better With Ballymaloe', window: { __CLAN__: { manifest: { version: '1.2' }, me: { name: 'Sai' } },
        clan: { exportDoc: (_k: string, _b: string, html: string) => { exported.push(html); return Promise.resolve({ ok: true }) } } },
      FIELDS: Object.keys(vals).map(key => ({ key, label: key })),
      gridOverflow: (doc: string) => {
        renders.push(doc.includes('class="sheet tight"') ? 'tight' : 'plain')
        const sheets = doc.split('<div class="sheet').slice(1)
        return Promise.resolve(sheets.flatMap((sh, i) => (alwaysOver ? i === 0 : !sh.startsWith(' tight"') && i === 0) ? [i + 1] : []))
      },
      fillParts: (keys: string[]) => { filled.push(keys); return Promise.resolve() },
      regenField: () => undefined,
    }
    const f = lift<{ runExport(kind: string, style?: string): Promise<unknown> }>(BM, NAMES, env)
    return { f, toasts, exported, renders, filled }
  }
  // 1. too full with no part over its limit: drawn again with sheet 1 tight, exported, the Brief agent never asked
  const a = setup(AT_LIMIT(g), false)
  await a.f.runExport('pdf', 'grid')
  assert.deepEqual(a.renders, ['plain', 'tight'], 'measured plain, then redrawn tight')
  assert.equal(a.exported.length, 1)
  assert.match(a.exported[0], /^<!DOCTYPE html>.*<div class="sheet tight">/s, 'the document that went out has sheet 1 drawn tight')
  assert.equal((a.exported[0].match(/class="sheet tight"/g) || []).length, 1, 'and only sheet 1')
  assert.deepEqual(a.filled, [], 'no rewrite for a step')
  assert.ok(!a.toasts.some(t => /Not exported|Printed smaller/.test(t)))
  // 2. still too full when tight: the Brief agent tightens the longest parts once, and then it refuses, naming the sheet
  const b = setup(AT_LIMIT(g), true)
  await b.f.runExport('pdf', 'grid')
  assert.equal(b.exported.length, 0, 'nothing goes out')
  assert.equal(b.renders[0], 'plain'); assert.equal(b.renders[1], 'tight', 'the step is tried before the Brief agent is asked')
  assert.equal(b.filled.length, 1, 'then the Brief agent tightens, once')
  assert.ok(b.filled[0].length > 0 && b.toasts.some(t => /The Brief agent is tightening/.test(t)))
  assert.ok(b.toasts.some(t => /Not exported: sheet 1 is too full\./.test(t)), 'and it stops naming the sheet')
  assert.ok(b.toasts.indexOf(b.toasts.find(t => /The Brief agent is tightening/.test(t))!) < b.toasts.findIndex(t => /Not exported/.test(t)))
  assert.ok(b.renders.length <= 4, `bounded: ${b.renders}`)
  // 3. a part over its limit is the old path: the Brief agent first, no tight step before it
  const c = setup({ ...AT_LIMIT(g), job: words(60) }, false)
  await c.f.runExport('pdf', 'grid')
  assert.equal(c.renders[0], 'plain')
  assert.equal(c.filled.length, 1, 'a part over its limit goes to the Brief agent, not to the step')
  assert.equal(c.filled[0][0], 'job')
  assert.equal(c.renders[1], 'plain', 'the first redraw after the Brief agent is the plain one, then the step')
})

test('a sheet that cannot be measured is never exported: one retry with a longer wait, then the plain buttons are offered', async () => {
  assert.match(fn(BM, 'gridOverflow'), /setTimeout\(function\(\)\{ end\(null\); \},wait\)/)
  assert.match(fn(BM, 'measureGrid'), /gridOverflow\(doc,4000\)[\s\S]*gridOverflow\(doc,8000\)/)
  assert.match(fn(BM, 'buildGridExportHTML'), /return measureGrid\(doc\)/)
  const run = fn(BM, 'runExport')
  assert.ok(run.indexOf('LAST_GRID_OVERFLOW===null') < run.indexOf('LAST_GRID_OVERFLOW.length'), 'null is read before the length')
  assert.match(run, /Try again, or use Plain PDF or Plain HTML/)
  // run it: a frame that never loads must not reach exportDoc, and the wait doubles once
  const waits: number[] = []
  const timers: Array<() => void> = []
  const doc = { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild() {}, removeChild() {} } }
  const g = lift<{ gridOverflow: (d: string, w: number) => Promise<unknown>; measureGrid: (d: string) => Promise<unknown> }>(
    BM, ['gridOverflow', 'measureGrid'],
    { document: doc, setTimeout: (cb: () => void, ms: number) => { waits.push(ms); timers.push(cb) } })
  const p = g.measureGrid('<html>')
  timers[0]()
  await new Promise(r => setImmediate(r))
  timers[1]()
  assert.equal(await p, null)
  assert.deepEqual(waits, [4000, 8000])
  let printed = 0, said = ''
  const env = {
    LAST_GRID_OVERFLOW: null, LAST_GRID_WARNINGS: [], toast: (m: string) => { said = m },
    buildExportHTML: () => Promise.resolve('<html>'), listWords: (a: string[]) => a.join(', '), gridLongest: () => [],
    docLocked: () => false, noMiddleware: () => false, WRITER: 'the Brief agent', WRITER_: 'The Brief agent', fillParts: () => Promise.resolve(), gridLimit: () => 0,
    get: () => 'x', window: { clan: { exportDoc: () => { printed++; return Promise.resolve({ ok: true }) } } },
  }
  const r = lift<{ runExport: (k: string, s?: string) => Promise<unknown> }>(BM, ['runExport'], env)
  await r.runExport('pdf', 'grid')
  assert.equal(printed, 0, 'an unmeasured grid never reaches print')
  assert.match(said, /^Not exported: .*Plain PDF or Plain HTML/)
  await r.runExport('pdf', 'plain')
  assert.equal(printed, 1, 'the plain export is unaffected')
  // The sheet (Save · PDF): a sheet that could not be laid out on its pages comes back null and is not printed.
  said = ''
  const s2 = lift<{ runExport: (k: string, s?: string) => Promise<unknown> }>(BM, ['runExport'], { ...env, buildExportHTML: () => Promise.resolve(null) })
  await s2.runExport('pdf')
  assert.equal(printed, 1, 'an unmeasured sheet never reaches print')
  assert.match(said, /^Not exported: this browser could not lay the sheet out/)
  await r.runExport('pdf')
  assert.equal(printed, 2, 'a measured sheet prints, with no grid overflow rule')
})

test('a part the Review agent rejected is exported as to confirm, and the export says it was written, not approved', async () => {
  const mark = lift<{ confirmMarked(v: unknown): unknown }>(BM, ['confirmMarked'], {}).confirmMarked
  assert.equal(mark('Families who cook.'), 'To confirm: Families who cook.')
  assert.equal(mark('To confirm: Families.'), 'To confirm: Families.', 'a part already marked is left alone')
  assert.deepEqual(mark(['a', 'b']), ['To confirm: a', 'b'], 'a list marks its first line')
  assert.equal(mark(''), '')
  // fillParts: the Review agent passes one part and rejects the other. Only the rejected one is marked in the brief.
  const data: Record<string, unknown> = { audience: 'Families who cook.', insight: 'People skip dinner.' }
  const patched: Array<[string, unknown]> = []
  const FIELDS = [{ key: 'audience', label: 'Audience' }, { key: 'insight', label: 'The insight' }]
  const state: Record<string, string> = { audience: 'done', insight: 'failed' }
  const env = {
    FIELDS, REV: 'the Review agent', REV_: 'The Review agent', hasVal, confirmMarked: mark, get: (k: string) => data[k],
    patch: (k: string, v: unknown) => { patched.push([k, v]); data[k] = v; return Promise.resolve({ ok: true }) },
    regenField: (f: { key: string }, _g: unknown, _r: unknown, done: (j: unknown) => void) => done({ fields: { [f.key]: { state: state[f.key] } } }),
  }
  const fill = lift<{ fillParts(keys: string[]): Promise<string[]> }>(BM, ['fillParts'], env)
  assert.deepEqual(await fill.fillParts(['audience', 'insight']), ['The insight'])
  assert.deepEqual(patched, [['insight', 'To confirm: People skip dinner.']])
  // what prints: the sheet draws the mark as the box's corner tag, and the sentence reads clean
  const g = grid()
  const out = g.gridBody(ctxOf({ audience: data.audience, insight: data.insight }))
  assert.equal((out.html.match(/<span class="tc">to confirm<\/span>/g) || []).length, 1, 'only the rejected part carries the tag')
  assert.match(out.html, /People skip dinner\./)
  assert.doesNotMatch(out.html, /To confirm: People/)
  // the toast names it
  const words = lift<{ notApprovedWords(l: string[]): string }>(BM, ['notApprovedWords'], { REV: 'the Review agent', listWords: listJoin }).notApprovedWords
  assert.equal(words(['The insight', 'Audience']), 'Written, not approved by the Review agent: the insight and audience.')
  assert.equal(words([]), '')
  // the export passes them on and says so once the export has started
  let said = ''
  const run = lift<{ runExport(k: string, s: string, r?: boolean, t?: number[], rej?: string[]): Promise<unknown> }>(BM, ['runExport'], {
    LAST_GRID_OVERFLOW: [], LAST_GRID_WARNINGS: [], toast: (m: string) => { said = m }, buildExportHTML: () => Promise.resolve('<html>'),
    get: () => 'x', notApprovedWords: words, window: { clan: { exportDoc: () => Promise.resolve({ ok: true }) } },
  })
  await run.runExport('pdf', 'grid', false, undefined, ['The insight'])
  assert.equal(said, 'Written, not approved by the Review agent: the insight.')
  await run.runExport('pdf', 'grid', false, undefined, [])
  assert.equal(said, 'Preparing PDF…', 'nothing rejected: nothing extra is said')
  assert.match(fn(BM, 'exportOnce'), /\.then\(function\(rejected\)\{[\s\S]*runExport\(kind, style, false, undefined, rejected\)/)
})

test('the footer names the client, not its descriptor, and the page count never wraps', () => {
  const g = grid()
  const ctx = { ...ctxOf({ audience: 'Who.' }), client: 'Ballymaloe Relish, an Irish family relish brand.' }
  const out = g.gridBody(ctx)
  assert.match(out.html, /Napkin \/ Ballymaloe Relish \/ Better With Ballymaloe \/ Creative brief 1\.2 \/ Confidential/)
  assert.doesNotMatch(out.html, /class="foot"><span>[^<]*an Irish/)
  assert.match(g.gridCss(), /\.foot span:last-child\{white-space:nowrap\}/)
  assert.match(g.gridCss(), /\.fit3 \.bd\{font-size:10px\}/, 'the smallest step stays readable')
})

test('the grid prints on A4 sheets that break cleanly, and stays among the OS bar’s ways to save beside the sheet and a plain one', () => {
  const css = grid().gridCss()
  assert.match(css, /@page\{size:A4;margin:0\}/)
  assert.match(css, /\.sheet\{width:210mm;height:297mm;[^}]*break-after:page\}/)
  assert.match(fn(BM, 'buildExportHTML'), /style==='plain'\?buildPlainExportHTML\(\):style==='grid'\?buildGridExportHTML\(tight\):buildSheetExportHTML\(style==='client'\?'client':'agency'\)/)
  assert.match(fn(BM, 'runExport'), /buildExportHTML\(style, tight\)/)
  // Save · PDF and its other ways to save are the OS bar's (the side tab design): one ACTIONS entry each.
  const A = obj(BM, 'ACTIONS')
  assert.match(A, /pdf:function\(\)\{ doExport\('pdf'\); \}/, 'Save · PDF, in the OS bar, is the sheet')
  assert.match(A, /client:function\(\)\{ doExport\('pdf','client'\); \}/)
  assert.match(A, /html:function\(\)\{ doExport\('html'\); \}/, 'Save · HTML is the sheet')
  assert.match(A, /gridPdf:function\(\)\{ doExport\('pdf','grid'\); \}/, 'the grid template is still a PDF')
  assert.match(A, /gridHtml:function\(\)\{ doExport\('html','grid'\); \}/)
  assert.match(A, /plainHtml:function\(\)\{ doExport\('html','plain'\); \}/)
  assert.match(A, /plainPdf:function\(\)\{ doExport\('pdf','plain'\); \}/)
  assert.match(fn(BM, 'barItems'), /id:'pdf'[\s\S]*id:'client'[\s\S]*id:'html'[\s\S]*id:'gridPdf'[\s\S]*id:'gridHtml'[\s\S]*id:'plainPdf'[\s\S]*id:'plainHtml'/)
  // The grid's fit rules apply to the grid only; the sheet flows onto as many pages as it needs.
  const run = fn(BM, 'runExport')
  assert.match(run, /style==='grid'&&LAST_GRID_OVERFLOW===null/)
  assert.match(run, /style==='grid'&&LAST_GRID_OVERFLOW\.length/)
  assert.match(fn(BM, 'exportOnce'), /style==='client'&&!docLocked\(\)/, 'the client copy is of a locked brief')
})


test('a part the draft marks "To confirm:" prints a corner tag, not the words in the sentence', () => {
  const g = grid()
  assert.equal(g.gridText('To confirm: Easy.'), 'Easy.')
  assert.equal(g.gridText(['To confirm: a', 'b']), 'a; b')
  assert.equal(g.gridFlag('To confirm: Easy.'), true)
  assert.equal(g.gridFlag(['x', 'to confirm: y']), true)
  assert.equal(g.gridFlag('Easy. To confirm: later'), false, 'only a leading mark counts')
  const ctx = (v: Record<string, unknown>) => ({ get: (k: string) => v[k], hasVal, cit: { marks: {}, notes: [] }, info: [], project: 'P', client: 'C', version: '1' })
  const marked = g.gridBody(ctx({ insight: 'To confirm: Tension here.', background: 'Plain fact.' })).html
  assert.match(marked, /class="tc">to confirm</)
  assert.doesNotMatch(marked, /To confirm: Tension/)
  assert.equal((marked.match(/class="tc"/g) || []).length, 1, 'one tag, only on the marked box')
})

// ── the shared fields snippet: the source card (OS-layer contract §8.3) ─────

/** The card's renderer, lifted with the page's own helpers and words. */
function cardKit() {
  // The page's esc holds a quote in a regex the lifter cannot read past; the
  // stand-in escapes the same characters.
  const names = ['obj', 'arr', 'clip', 'tierWord', 'isYou', 'nameOfId', 'personName', 'reviewLine', 'cardHTML']
  const vars = ['ORIGIN_WORD', 'VERDICT_WORD', 'CARD_KIND'].map(n => obj(CLF, n)).join('\n')
    + '\nvar VIEW=null; var OPAQUE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
  const body = `${vars}\n${names.map(n => fn(CLF, n)).join('\n')}\nreturn {cardHTML};`
  const plainDate = (d: string) => `on ${String(d).slice(0, 10)}`
  return new Function('plainDate', 'esc', body)(plainDate, esc) as { cardHTML(c: unknown, compact?: boolean): string }
}

const carriedPin = {
  ref: 'f_01JA0B3P4Q', kind: 'fact', label: 'Orchard Hill · share', value: '23%', detail: 'Bord Bia · high confidence',
  origin: 'research', from: { document_id: 'r1', title: 'Lúnasa launch', app_id: 'ie.napkin.campaign-research', path: 'docs/r1.clan' },
  review: { verdict: 'rejected', by: 'You', at: '2026-11-08T10:00:00Z', note: 'The panel was revised' },
  history: [
    { verdict: 'rejected', by: 'You', at: '2026-11-08T10:00:00Z', note: 'The panel was revised' },
    { verdict: 'verified', by: 'mary', at: '2026-11-01T10:00:00Z', superseded: true },
  ],
}

test('the source card says where a fact came from, its latest verdict, and folds the rest under Record', () => {
  const { cardHTML } = cardKit()
  const h = cardHTML(carriedPin)
  assert.match(h, /^<div class="clf-sc" data-card="f_01JA0B3P4Q" data-origin="research">/)
  assert.match(h, /<span class="clf-sc-k o-research">Research<\/span>/)
  assert.match(h, /<span class="clf-sc-r v-rejected">Marked wrong by you · on 2026-11-08<\/span>/)
  assert.match(h, /<span class="clf-sc-v">23%<\/span><p class="clf-sc-t">Orchard Hill · share<\/p>/)
  assert.match(h, /From <b>Lúnasa launch<\/b><small>campaign research<\/small>/)
  // The history is folded, newest first, the replaced one marked.
  const rec = h.slice(h.indexOf('<details class="clf-more clf-sc-rec"><summary>Record</summary>'))
  assert.ok(rec.indexOf('Marked wrong by you') < rec.indexOf('Verified by mary'), rec)
  assert.match(rec, /Verified by mary · on 2026-11-01 · replaced/)
  assert.match(h, /data-clf-sc="open" data-ref="f_01JA0B3P4Q">Where this came from/)
  assert.match(h, /data-clf-sc="from" data-path="docs\/r1\.clan">Open Lúnasa launch/)

  // Every origin has its words; one the host never sends is this document.
  const o = (origin: string) => /clf-sc-k o-[a-z]+">([^<]+)</.exec(cardHTML({ ...carriedPin, origin }))?.[1]
  assert.deepEqual(['research', 'client', 'brand', 'layer', 'person', 'document', 'rumour'].map(o),
    ['Research', 'Client upload', 'Brand Clan', 'Knowledge layer', 'A person', 'This document', 'This document'])

  // Unreviewed: no verdict, no Record. Hostile words are escaped.
  const bare = cardHTML({ ref: 'fi_1', kind: 'finding', label: '<img src=x onerror=alert(1)>', origin: 'document' })
  assert.doesNotMatch(bare, /clf-sc-r|Record|<img/)
  assert.match(bare, /&#60;img src=x onerror=alert\(1\)&#62;/)
  // Gone from the document: said so.
  assert.match(cardHTML({ ref: 'f_X', kind: 'unknown', label: 'f_X', origin: 'document' }), /not in the document any more/)
})

test('the drawer shows the same card, compact, from the same renderer', () => {
  const { cardHTML } = cardKit()
  const c = cardHTML(carriedPin, true)
  assert.match(c, /^<div class="clf-sc compact" data-card="f_01JA0B3P4Q" data-origin="research">/)
  // The drawer shows the value and words itself; the provenance is the card's.
  assert.doesNotMatch(c, /clf-sc-v|clf-sc-t|data-clf-sc="open"/)
  const head = (x: string) => x.slice(0, x.indexOf('</div>'))
  assert.equal(head(c).replace(' compact', ''), head(cardHTML(carriedPin)))
  assert.match(c, /<summary>Record<\/summary>/)
  // One renderer: the drawer and ClanFields.card both go through card(), which
  // is the only caller of cardHTML.
  assert.match(fn(CLF, 'draw'), /card\(cref,slot,true\)/)
  assert.match(CLF, /card:function\(ref,el\)\{ return card\(ref,el,false\); \}/)
  assert.equal(CLF.split('cardHTML(').length - 1, 2) // its definition and card()'s call
  assert.match(CLF, /stack:stack/)
})

test('cards a page asks for in one tick are one POST /cite, kept until the document changes', async () => {
  const asked: string[][] = []
  let version = 'v1'
  let missing = new Set<string>(['f_GONE'])
  const fetchCites = (refs: string[]) => {
    asked.push(refs)
    return Promise.resolve(Object.fromEntries(refs.filter(r => !missing.has(r)).map(r => [r, { ref: r, kind: 'fact' }])))
  }
  const uniqFn = new Function(`${fn(CLF, 'uniq')}; return uniq;`)()
  const body = `${fn(CLF, 'cardsFor')}\nreturn {cardsFor};`
  const { cardsFor } = new Function('CARDS', 'CARDS_AT', 'CARD_BATCH', 'cardVer', 'fetchCites', 'uniq', 'arr', body)(
    {}, null, null, () => version, fetchCites, uniqFn, arr) as { cardsFor(refs: string[]): Promise<Record<string, unknown>> }

  const [a, b] = await Promise.all([cardsFor(['f_1', 'fi_2']), cardsFor(['f_1', 'f_GONE'])])
  assert.deepEqual(asked, [['f_1', 'fi_2', 'f_GONE']])
  assert.deepEqual(Object.keys(a), ['f_1', 'fi_2'])
  assert.equal(b.f_GONE, null)
  // Kept: asking again asks nothing — except what came back empty.
  await cardsFor(['f_1', 'fi_2'])
  assert.equal(asked.length, 1)
  missing = new Set()
  const again = await cardsFor(['f_GONE'])
  assert.deepEqual(asked.at(-1), ['f_GONE'])
  assert.deepEqual(again.f_GONE, { ref: 'f_GONE', kind: 'fact' })
  // The document changed: asked afresh.
  version = 'v2'
  await cardsFor(['f_1'])
  assert.deepEqual(asked.at(-1), ['f_1'])
})


// ── Brief Maker on the new UI (features/brief-new-ui.clan) ──────────────────

type Item = { key: string; sec: string; w: number; r?: number; as?: string; tone?: string }
type Cell = { key?: string; head?: string; col: number; row: number; w: number; h: number; order?: number; as?: string; tone?: string }
type Lay = {
  layoutOrder(fields: { key: string; sec: string }[], stored: unknown, rows?: boolean): Item[]
  layoutPack(items: Item[]): Cell[]
  layoutParts(items: Item[]): Record<string, { col: number; row: number; w: number; h: number; order: number; as?: string; tone?: string }>
  layoutRows(items: Item[]): Item[][]
  layoutStep(items: Item[], key: string, d: number): Item[]
  layoutShift(items: Item[], key: string, d: number): Item[]
  layoutJoin(items: Item[], key: string, target: string, after: boolean): Item[]
  layoutNewRow(items: Item[], key: string, target: string, below: boolean): Item[]
  layoutWithout(items: Item[], keys: string[]): Item[]
  layoutCanStep(items: Item[], key: string): [boolean, boolean]
  layoutResize(items: Item[], key: string, w: number): Item[]
  layoutLook(items: Item[], key: string, prop: string, v: string): Item[]
  boxGaps(cells: Cell[]): { row: number; col: number; w: number }[]
}
const BM_FIELDS = new Function(`${BM.slice(BM.indexOf('var FIELDS=['), BM.indexOf('];', BM.indexOf('var FIELDS=[')) + 2)} return FIELDS;`)() as { key: string; sec: string }[]
const lay = () => lift<Lay>(BM, ['clampW', 'withLook', 'partCopy', 'layoutOrder', 'layoutFlow', 'layoutRows', 'fitRow', 'fromRows', 'rowsFit', 'rowAt', 'takeOut', 'layoutPack', 'layoutParts', 'layoutIndex',
  'layoutResize', 'layoutJoin', 'layoutNewRow', 'layoutStep', 'layoutShift', 'layoutWithout', 'layoutCanStep', 'layoutLook', 'boxGaps'],
  { GRID_COLS: 12, MIN_W: 3, ROW_MAX: 4, arr, DEFAULT_W: new Function(`${obj(BM, 'DEFAULT_W')} return DEFAULT_W;`)(), META_KEYS: ['client', 'project_name', 'budget_and_scope'],
    AS_KINDS: ['prose', 'bullets', 'callout', 'statement', 'cell'], TONES: ['plain', 'tint', 'inverse'] })
const keysOf = (xs: { key?: string }[]) => xs.filter(x => x.key).map(x => x.key)
// The sheet's rows as keys and widths: [['background:6', 'barrier:6'], …]
const rowsOf = (L: Lay, xs: Item[]) => L.layoutRows(xs).map(r => r.map(p => `${p.key}:${p.w}`))
const rowWith = (L: Lay, xs: Item[], k: string) => rowsOf(L, xs).find(r => r.some(x => x.startsWith(k + ':')))!
// What the document returns after a save, read back as the sheet reads it.
const reload = (L: Lay, xs: Item[]) => L.layoutOrder(BM_FIELDS, JSON.parse(JSON.stringify(L.layoutParts(xs))), true)

test('a brief with no layout sits in the schema’s order at the default widths, the header’s rows first', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  const head = ['client', 'project_name', 'budget_and_scope']
  assert.deepEqual(keysOf(items), [...head, ...BM_FIELDS.map(f => f.key).filter(k => !head.includes(k))], 'every part, the header’s first (Client, Project, Budget & scope), the rest in the schema’s order')
  const cells = L.layoutPack(items)
  const at = (k: string) => cells.find(c => c.key === k)!
  // The header's rows are full-width ruled rows under the title, one per row.
  assert.deepEqual(head.map(k => [at(k).col, at(k).w]), [[1, 12], [1, 12], [1, 12]])
  assert.ok(at('client').row < at('project_name').row && at('project_name').row < at('budget_and_scope').row && at('budget_and_scope').row < at('job').row)
  // The job is a full row; background and barrier share one; the three objectives share one.
  assert.deepEqual([at('job').col, at('job').w], [1, 12])
  assert.equal(at('background').row, at('barrier').row)
  assert.deepEqual([at('background').col, at('barrier').col], [1, 7])
  assert.deepEqual(['objectives.commercial', 'objectives.behavioural', 'objectives.attitudinal'].map(k => at(k).col), [1, 5, 9])
  // A section heading takes a row of its own where the section changes, and nothing shares a cell.
  const heads = cells.filter(c => c.head).map(c => c.head)
  assert.deepEqual(heads, ['Identity', 'Execution', 'The brief', 'Objectives', 'Strategy', 'Desired response', 'Execution'])
  const taken = new Set<string>()
  for (const c of cells) for (let x = c.col; x < c.col + c.w; x++) {
    const k = `${c.row}:${x}`; assert.ok(!taken.has(k), `cell ${k} is used once`); taken.add(k)
    assert.ok(x >= 1 && x <= 12)
  }
})

test('rows stay rows: dragging the edge two parts share trades columns between them, and no part changes row', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  const before = rowsOf(L, items)
  assert.deepEqual(rowWith(L, items, 'background'), ['background:6', 'barrier:6'])
  const rowOfEach = (xs: Item[]) => Object.fromEntries(L.layoutRows(xs).flatMap((r, n) => r.map(p => [p.key, n])))
  for (const w of [1, 3, 4, 8, 9, 11, 40]) {
    const next = L.layoutResize(items, 'background', w)
    const [bg, br] = rowWith(L, next, 'background').map(x => +x.split(':')[1])
    assert.equal(bg + br, 12, `${w}: the two trade, the row keeps its twelve columns`)
    assert.equal(bg, Math.max(3, Math.min(9, w)), `${w}: neither goes under three columns`)
    assert.deepEqual(rowOfEach(next), rowOfEach(items), `${w}: every part keeps its row`)
    assert.equal(rowsOf(L, next).length, before.length)
  }
  // The three objectives: the middle edge trades between behavioural and attitudinal only.
  const mid = L.layoutResize(items, 'objectives.behavioural', 6)
  assert.deepEqual(rowWith(L, mid, 'objectives.commercial'), ['objectives.commercial:4', 'objectives.behavioural:5', 'objectives.attitudinal:3'])
  // The owner's recording: Client widened next to Project, then Project shrunk and widened again. They
  // stay on one row the whole time, and the space Project gives up comes back to it.
  let rows = L.layoutJoin(L.layoutResize(items, 'project_name', 4), 'client', 'project_name', true)
  assert.deepEqual(rowWith(L, rows, 'client').length, 2)
  for (const [k, w] of [['project_name', 3], ['project_name', 9], ['project_name', 2], ['project_name', 6]] as const) {
    rows = L.layoutResize(rows, k, w)
    const r = rowWith(L, rows, 'client')
    assert.equal(r.length, 2, `${k} to ${w}: Client and Project share the row`)
    assert.equal(r.reduce((s, x) => s + +x.split(':')[1], 0), 12)
  }
  // Widths stay on the grid: never fractional.
  assert.deepEqual(rowWith(L, L.layoutResize(items, 'background', 6.4), 'background'), ['background:6', 'barrier:6'])
})

test('a free outer edge, at the end of a row that does not fill the sheet, sizes only into that free space', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  // Alone on its row: anywhere from three to twelve columns.
  assert.deepEqual(rowWith(L, L.layoutResize(items, 'job', 1), 'job'), ['job:3'])
  assert.deepEqual(rowWith(L, L.layoutResize(items, 'job', 40), 'job'), ['job:12'])
  assert.deepEqual(rowWith(L, L.layoutResize(items, 'job', 7), 'job'), ['job:7'])
  // A row of four and four (four free): the last part grows into the four free columns, no further, and the
  // first keeps its width.
  const two = L.layoutResize(L.layoutResize(items, 'background', 4), 'barrier', 4)
  assert.deepEqual(rowWith(L, two, 'background'), ['background:4', 'barrier:4'])
  assert.deepEqual(rowWith(L, L.layoutResize(two, 'barrier', 12), 'background'), ['background:4', 'barrier:8'])
  assert.deepEqual(rowWith(L, L.layoutResize(two, 'barrier', 6), 'background'), ['background:4', 'barrier:6'])
  // A full row's last edge has nowhere to go.
  assert.deepEqual(rowWith(L, L.layoutResize(items, 'barrier', 9), 'background'), ['background:6', 'barrier:6'])
  // In Boxed the free space is the row's: drawn after the last part, never over it.
  const cells = L.layoutPack(L.layoutResize(two, 'barrier', 6))
  const br = cells.find(c => c.key === 'barrier')!
  assert.deepEqual(L.boxGaps(cells).filter(g => g.row === br.row), [{ row: br.row, col: 11, w: 2 }])
})

test('dropping a part onto a row joins it; a full row shrinks its parts to fit and none drops out', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  // The job (twelve columns) dropped after the barrier on the full background row: thirds.
  const three = L.layoutJoin(items, 'job', 'barrier', true)
  assert.deepEqual(rowWith(L, three, 'job'), ['background:4', 'barrier:4', 'job:4'])
  // Before a part, in its place.
  assert.deepEqual(rowWith(L, L.layoutJoin(items, 'job', 'barrier', false), 'job'), ['background:4', 'job:4', 'barrier:4'])
  // Into a row with room for it: nothing shrinks.
  const room = L.layoutJoin(L.layoutResize(L.layoutResize(L.layoutResize(items, 'background', 4), 'barrier', 4), 'job', 4), 'job', 'barrier', true)
  assert.deepEqual(rowWith(L, room, 'job'), ['background:4', 'barrier:4', 'job:4'])
  // Inside its own row a drop only reorders, widths kept.
  assert.deepEqual(rowWith(L, L.layoutJoin(items, 'barrier', 'background', false), 'barrier'), ['barrier:6', 'background:6'])
  // Four parts at most, three columns each: a fifth drop makes a row of its own, and nothing is lost.
  let s = L.layoutOrder(BM_FIELDS, undefined)
  for (const k of ['insight', 'single_minded_proposition']) s = L.layoutJoin(s, k, 'audience', true)
  const four = rowWith(L, s, 'audience')
  assert.equal(four.length, 4)
  assert.ok(four.every(x => +x.split(':')[1] === 3))
  const five = L.layoutJoin(s, 'objection', 'audience', true)
  assert.deepEqual(rowWith(L, five, 'objection'), ['objection:6'], 'a row of its own, below')
  assert.equal(rowWith(L, five, 'audience').length, 4)
  assert.deepEqual(keysOf(five).sort(), BM_FIELDS.map(f => f.key).sort(), 'every part is still on the sheet')
  // A row is one section: a drop across a section boundary makes a row of its own instead (as before:
  // a part never shared a row with another section's).
  const across = L.layoutJoin(items, 'background', 'client', true)
  assert.deepEqual(rowWith(L, across, 'background'), ['background:6'])
  assert.deepEqual(rowWith(L, across, 'client'), ['client:12'])
  assert.deepEqual(rowWith(L, across, 'barrier'), ['barrier:12'], 'its old row gets the width back')
  const cells = L.layoutPack(across)
  assert.ok(cells.find(c => c.key === 'background')!.row > cells.find(c => c.key === 'client')!.row)
})

test('dropping between rows makes a row of its own; dragging a part out gives its width back to the rest of that row', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  const above = L.layoutNewRow(items, 'barrier', 'job', false)
  const r = rowsOf(L, above)
  const at = (k: string) => r.findIndex(x => x.some(y => y.startsWith(k + ':')))
  assert.deepEqual(r[at('barrier')], ['barrier:6'], 'a row of its own, at its own width')
  assert.equal(at('barrier'), at('job') - 1, 'above the job’s row')
  assert.deepEqual(r[at('background')], ['background:12'], 'the background takes back the barrier’s six columns')
  assert.equal(rowsOf(L, L.layoutNewRow(items, 'barrier', 'background', true)).findIndex(x => x[0] === 'barrier:6'), at('job') + 1)
  // A part alone on its row dropped beside its own row: nothing to do.
  assert.deepEqual(L.layoutNewRow(items, 'job', 'job', true), items)
  // Out of a row of three: the two left share the freed columns evenly.
  const three = L.layoutJoin(items, 'job', 'barrier', true)
  assert.deepEqual(rowWith(L, L.layoutNewRow(three, 'barrier', 'background', true), 'background'), ['background:6', 'job:6'])
  // Out of a row with free space: the rest grows by what was freed, the free space stays.
  const free = L.layoutResize(L.layoutResize(items, 'background', 6), 'barrier', 3)
  assert.deepEqual(rowWith(L, L.layoutNewRow(free, 'barrier', 'job', true), 'background'), ['background:9'])
  // The client copy leaves a confidential part out the same way: its row closes up.
  assert.deepEqual(rowWith(L, L.layoutWithout(items, ['barrier']), 'background'), ['background:12'])
  assert.ok(!keysOf(L.layoutWithout(items, ['barrier'])).includes('barrier'))
})

test('Move up / Move down and the arrow keys: out of a shared row into one of its own, or a lone row past its neighbour', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  // Sharing a row: it steps out into a row of its own above (or below), and the row takes its width back.
  const up = rowsOf(L, L.layoutStep(items, 'barrier', -1))
  const i = up.findIndex(x => x[0] === 'barrier:6')
  assert.deepEqual([up[i], up[i + 1]], [['barrier:6'], ['background:12']])
  const down = rowsOf(L, L.layoutStep(items, 'barrier', 1))
  const j = down.findIndex(x => x[0] === 'barrier:6')
  assert.deepEqual([down[j - 1], down[j]], [['background:12'], ['barrier:6']])
  // Alone: it swaps with the row above (or below); nothing moves past either end.
  assert.deepEqual(keysOf(L.layoutStep(items, 'client', -1)), keysOf(items))
  assert.deepEqual(keysOf(L.layoutStep(items, 'project_name', -1)).slice(0, 3), ['project_name', 'client', 'budget_and_scope'])
  assert.deepEqual(keysOf(L.layoutStep(items, 'job', -1)).slice(0, 4), ['client', 'project_name', 'job', 'budget_and_scope'])
  assert.deepEqual(keysOf(L.layoutStep(items, 'open_questions', 1)), keysOf(items).filter(k => k !== 'open_questions').concat('open_questions'))
  const last = L.layoutStep(L.layoutStep(items, 'open_questions', 1), 'open_questions', 1)
  assert.deepEqual(rowsOf(L, last), rowsOf(L, L.layoutStep(items, 'open_questions', 1)))
  // The panel's buttons know when there is nowhere to go.
  assert.deepEqual(L.layoutCanStep(items, 'client'), [false, true])
  assert.deepEqual(L.layoutCanStep(items, 'barrier'), [true, true])
  // Left and right: a place earlier or later inside the row, widths kept; never out of it.
  const left = L.layoutResize(L.layoutShift(items, 'barrier', -1), 'barrier', 4)
  assert.deepEqual(rowWith(L, left, 'barrier'), ['barrier:4', 'background:8'])
  assert.deepEqual(rowsOf(L, L.layoutShift(items, 'background', -1)), rowsOf(L, items))
  assert.deepEqual(rowsOf(L, L.layoutShift(items, 'job', 1)), rowsOf(L, items))
  // The grip's keys and the panel's buttons go through these, with a decision that says what moved.
  const pr = fn(BM, 'placeRow')
  assert.match(pr, /if\(v\) saveLayout\(layoutStep\(layoutItems\(\), f\.key, v\), 'move '\+headOf\(f\)\+\(v<0\?' up':' down'\)\);/)
  assert.match(pr, /else saveLayout\(layoutShift\(layoutItems\(\), f\.key, h\), 'move '\+headOf\(f\)\+\(h<0\?' left':' right'\)\);/)
  assert.match(fn(BM, 'renderSelPart'), /else if\(a==='up'\|\|a==='down'\) saveLayout\(layoutStep\(layoutItems\(\), f\.key, a==='up'\?-1:1\), 'move '\+headOf\(f\)\+' '\+a\);/)
  assert.match(fn(BM, 'renderSelPart'), /data-sp="up"'\+\(can\[0\]\?'':' disabled'\)/)
})

test('an older brief’s stored order is packed into rows once, as the old sheet drew it; nothing is written until something changes', () => {
  const L = lay()
  // The owner's First Round as stored on 10 Nov (a flow: order and widths; its rows were never read).
  const old = {
    project_name: { col: 1, row: 2, w: 4, h: 1, order: 0 }, client: { col: 5, row: 2, w: 8, h: 1, order: 1 },
    budget_and_scope: { col: 1, row: 4, w: 12, h: 1, order: 2 }, job: { col: 1, row: 6, w: 12, h: 1, order: 3 },
    background: { col: 1, row: 7, w: 6, h: 1, order: 4 }, barrier: { col: 7, row: 7, w: 6, h: 1, order: 5 },
  }
  const items = L.layoutOrder(BM_FIELDS, old)
  assert.deepEqual(rowsOf(L, items).slice(0, 4), [['project_name:4', 'client:8'], ['budget_and_scope:12'], ['job:12'], ['background:6', 'barrier:6']])
  // The same flow the old sheet packed: a section starts a row, a part too wide for the rest starts the next.
  const flow = L.layoutOrder(BM_FIELDS, { client: { w: 6, order: 0 }, project_name: { w: 12, order: 1 } })
  assert.deepEqual([rowWith(L, flow, 'client'), rowWith(L, flow, 'project_name')], [['client:6'], ['project_name:12']])
  // A layout naming a part only by width keeps its schema place; a stray entry is ignored.
  const partial = L.layoutOrder(BM_FIELDS, { audience: { w: 12 }, nonsense: { order: 0 } })
  assert.deepEqual(keysOf(partial), keysOf(L.layoutOrder(BM_FIELDS, undefined)))
  assert.equal(partial.find(x => x.key === 'audience')!.w, 12)
  // Once saved (layout.model 'rows'), the rows are the places, read as they are: a row with free space
  // never fills up again from the row below it.
  const out = L.layoutNewRow(items, 'project_name', 'client', true)
  assert.deepEqual(rowsOf(L, out).slice(0, 2), [['client:12'], ['project_name:4']])
  const narrowed = L.layoutResize(out, 'client', 8)
  assert.deepEqual(rowsOf(L, reload(L, narrowed)).slice(0, 2), [['client:8'], ['project_name:4']], 'Project stays on its own row')
  assert.deepEqual(rowsOf(L, L.layoutOrder(BM_FIELDS, L.layoutParts(narrowed))).slice(0, 1), [['client:8', 'project_name:4']], 'read as a flow, it would have jumped back up')
  // saveLayout writes the rows model; reading only (layoutItems) writes nothing, and a save that changes
  // nothing is not a decision.
  const calls: unknown[][] = []
  let stored: Record<string, unknown> = { frame: 'boxed', parts: old }
  const S = lift<{ saveLayout(items: Item[], what: string): unknown }>(BM, ['saveLayout', 'sameParts'],
    { layoutData: () => stored, layoutParts: L.layoutParts, patch: (...a: unknown[]) => { calls.push(a); stored = a[1] as Record<string, unknown> } })
  assert.equal(calls.length, 0)
  S.saveLayout(L.layoutResize(items, 'client', 8), 'widen Client')
  assert.equal(calls.length, 1, 'the first save after a read migrates the layout')
  assert.equal((calls[0][1] as { model: string }).model, 'rows')
  S.saveLayout(L.layoutOrder(BM_FIELDS, (stored as { parts: unknown }).parts, true), 'nothing')
  assert.equal(calls.length, 1, 'no change, no decision')
  assert.match(fn(BM, 'layoutItems'), /layoutOrder\(FIELDS, l\.parts, l\.model==='rows'\)/)
  const schema = JSON.parse(page('brief-maker/schema.json')) as { properties: { layout: { properties: Record<string, { enum?: string[] }> } } }
  assert.deepEqual(schema.properties.layout.properties.model.enum, ['rows'])
})

test('the owner’s sequence holds on reload: Client widened by Project, Project out to a row of its own and back, three on a row', () => {
  const L = lay()
  let s = L.layoutOrder(BM_FIELDS, undefined)
  // Client and Project share a row.
  s = reload(L, L.layoutJoin(s, 'project_name', 'client', true))
  assert.deepEqual(rowWith(L, s, 'client'), ['client:6', 'project_name:6'])
  // Widen Client next to Project: Project gives the columns, and stays.
  s = reload(L, L.layoutResize(s, 'client', 9))
  assert.deepEqual(rowWith(L, s, 'client'), ['client:9', 'project_name:3'])
  // Shrink and widen Project (its left edge is Client's right edge).
  s = reload(L, L.layoutResize(s, 'client', 5))
  assert.deepEqual(rowWith(L, s, 'client'), ['client:5', 'project_name:7'])
  s = reload(L, L.layoutResize(s, 'project_name', 4))
  assert.deepEqual(rowWith(L, s, 'client'), ['client:5', 'project_name:4'], 'its free outer edge leaves free space, no box, no jump')
  // Out to its own row, then back beside Client.
  s = reload(L, L.layoutNewRow(s, 'project_name', 'client', true))
  assert.deepEqual(rowsOf(L, s).slice(0, 2), [['client:9'], ['project_name:4']])
  s = reload(L, L.layoutJoin(s, 'project_name', 'client', true))
  assert.deepEqual(rowWith(L, s, 'client'), ['client:8', 'project_name:4'])
  // Three parts on one row.
  s = reload(L, L.layoutJoin(s, 'job', 'barrier', true))
  assert.deepEqual(rowWith(L, s, 'job'), ['background:4', 'barrier:4', 'job:4'])
  // Reload: the same rows, cells and widths, and every stored place in the schema's range.
  const parts = JSON.parse(JSON.stringify(L.layoutParts(s)))
  assert.deepEqual(L.layoutPack(L.layoutOrder(BM_FIELDS, parts, true)), L.layoutPack(s))
  for (const p of Object.values(parts) as { col: number; row: number; w: number; h: number; order: number }[]) {
    for (const n of ['col', 'row', 'w', 'h', 'order'] as const) assert.ok(Number.isInteger(p[n]), n)
    assert.ok(p.col >= 1 && p.col + p.w - 1 <= 12 && p.w >= 3 && p.row >= 1 && p.order >= 0)
  }
  // A part the stored rows do not name sits on a row of its own after the part before it.
  delete parts.barrier
  const gap = L.layoutOrder(BM_FIELDS, parts, true)
  assert.deepEqual(rowWith(L, gap, 'barrier'), ['barrier:6'])
  assert.deepEqual(rowWith(L, gap, 'background'), ['background:4', 'job:4'])
})

test('no Width presets: Place on page keeps Show as, Tone and Move up / down', () => {
  const sp = fn(BM, 'renderSelPart')
  for (const gone of ['aria-label="Width"', 'data-w=', 'Two-thirds', "'Third'", "'Half'", 'WIDTHS', '.sp-l [data-w]']) assert.ok(!sp.includes(gone), `${gone} is gone from the panel`)
  assert.ok(!BM.includes('var WIDTHS'), 'no width presets in the page')
  assert.ok(sp.indexOf('aria-label="Show as"') < sp.indexOf('aria-label="Tone"') && sp.indexOf('aria-label="Tone"') < sp.indexOf('data-sp="up"'))
  assert.match(sp, /data-sp="down"/)
})

test('the brief’s state pill says Draft, Ready to lock, Locked or Reopened; what needs a call is counted on Decisions only', () => {
  const { briefStatus } = lift<{ briefStatus(s: unknown): { label: string; tone: string | null; locked: boolean } }>(BM, ['briefStatus'], {})
  assert.deepEqual(briefStatus({ locked: false, reopened: false, needs: 0, canLock: false }), { label: 'Draft', tone: null, locked: false })
  // One needs indicator (owner, 9 Nov 2026): a count here disagreed with Decisions after Set aside.
  assert.deepEqual(briefStatus({ locked: false, reopened: false, needs: 2, canLock: false }), { label: 'Draft', tone: null, locked: false })
  assert.deepEqual(briefStatus({ locked: false, reopened: false, needs: 0, canLock: true }), { label: 'Ready to lock', tone: 'ok', locked: false })
  assert.deepEqual(briefStatus({ locked: true, reopened: false, needs: 0, canLock: false }), { label: 'Locked', tone: 'ok', locked: true })
  assert.deepEqual(briefStatus({ locked: true, reopened: true, needs: 1, canLock: false }), { label: 'Reopened', tone: 'warn', locked: false })
  for (const s of ['Draft', 'Ready to lock', 'Locked', 'Reopened']) assert.ok(s.length <= 28, 'a bar label is at most 28 characters')
})

test('each OS bar button runs the same handler as its side-tab control; the document commands are the bar’s alone', () => {
  const ACTIONS = obj(BM, 'ACTIONS')
  const actionIds = [...ACTIONS.matchAll(/^\s*(\w+):/gm)].map(m => m[1])
  assert.deepEqual(actionIds.sort(), ['client', 'gridHtml', 'gridPdf', 'html', 'lock', 'pdf', 'plainHtml', 'plainPdf', 'redraft', 'reopen', 'unlock'])
  // Every control in the side tab that names an action has one, and is bound through the table.
  // Save · PDF, its other ways to save and Draft it again are not in the tab any more (the side tab design).
  const tab = BM.slice(BM.indexOf('<aside class="stab"'), BM.indexOf('</aside>'))
  const acts = [...tab.matchAll(/data-act="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual([...new Set(acts)].sort(), ['lock', 'reopen'])
  for (const gone of ['id="exPdf"', 'id="saveMore"', 'id="saveMenu"', 'id="redraft"', 'id="newDraft"', 'Save · PDF', 'Draft it again']) assert.ok(!tab.includes(gone), `${gone} left the side tab`)
  assert.match(BM, /document\.querySelectorAll\('#stab \[data-act\]'\)\.forEach\(function\(b\)\{ var a=b\.getAttribute\('data-act'\); if\(ACTIONS\[a\]\) b\.addEventListener\('click', function\(\)\{ ACTIONS\[a\]\(\); \}\); \}\);/)
  assert.match(BM, /if\(m\.type==='clan:bar-action'\)\{ if\(phase==='doc'&&ACTIONS\.hasOwnProperty\(m\.id\)\) ACTIONS\[m\.id\]\(\); return; \}/)
  assert.match(BM, /if\(m\.type==='clan:bar\?'\)\{ sendBar\(true\); return; \}/)
  // The bar's list: only ids the table has, at most ten buttons, labels the bar takes.
  type BarI = { kind: string; id?: string; label: string; disabled?: boolean }
  const items = (o: { phase?: string; A?: boolean; L?: boolean; reopened?: string[]; armed?: boolean }) => lift<{ barItems(): BarI[] }>(BM, ['barItems'], {
    phase: o.phase ?? 'doc', DRAFT: o.phase === 'proc' ? { stage: 'context', state: 'running' } : null, STAGES: ['extract', 'context', 'draft', 'judge'], PLAN: [1, 2, 3, 4], draftLive: () => o.phase === 'proc', approveLocked: () => !!o.A, docLocked: () => !!(o.A || o.L), lockState: () => ({ reopened: o.reopened ?? [] }), arr,
    REDRAFT_ARMED: o.armed ? 1 : null,
  }).barItems()
  assert.deepEqual(items({ phase: 'intake' }), [{ kind: 'mode', mode: 'ask' }, { kind: 'status', label: 'Draft', tone: null, locked: false }], 'before there is a brief: the name alone (mode ask), no buttons, and the state is Draft (never the host’s guess)')
  assert.deepEqual(items({ phase: 'proc' }), [{ kind: 'mode', mode: 'working', label: 'Working · Step 2/4' }, { kind: 'status', label: 'Draft', tone: null, locked: false }], 'the crew at work: the run’s step for the bar, still a draft')
  const SAVES = ['client', 'html', 'gridPdf', 'gridHtml', 'plainPdf', 'plainHtml']
  const draft = items({})
  // No lock and no status item: Lock and the state pill are the side tab's brief view (no duplicates).
  assert.deepEqual(draft.map(i => i.id ?? i.kind), ['pdf', 'redraft', ...SAVES])
  assert.ok(!draft.some(i => i.kind === 'status' || i.id === 'lock'), 'the bar repeats neither the lock nor the state')
  assert.equal(draft.find(i => i.id === 'client')!.disabled, true, 'the client copy waits for the lock')
  assert.equal(items({ armed: true }).find(i => i.id === 'redraft')!.label, 'Click again to redraft')
  const locked = items({ A: true })
  assert.deepEqual(locked.map(i => i.id ?? i.kind), ['pdf', 'unlock', 'reopen', ...SAVES], 'a locked brief offers Unlock (POST /unapprove) and Reopen a part…, not a redraft')
  assert.equal(locked.find(i => i.id === 'client')!.disabled, false)
  assert.match(fn(BM, 'unlockClick'), /hostPost\('\/unapprove',\{rationale:/, 'Unlock calls /unapprove as Lock calls /approve')
  assert.match(fn(BM, 'lockClick'), /unlockClick\(\)/, 'a lock pressed while locked still unlocks')
  assert.equal(locked.find(i => i.id === 'reopen')!.label, 'Reopen a part…')
  assert.deepEqual(items({ A: true, reopened: ['x'] }).map(i => i.id ?? i.kind), ['pdf', ...SAVES], 'reopened: Lock the brief again is the side tab’s')
  for (const list of [draft, locked]) {
    assert.ok(list.filter(i => i.kind === 'button').length <= 10, 'at most the ten buttons a bar takes')
    for (const i of list) {
      assert.ok(i.label.length <= 28, i.label)
      if (i.kind === 'button') assert.ok(actionIds.includes(i.id!), `bar button ${i.id} has a handler`)
    }
  }
})

test('a locked brief reopens one part for a client’s change, through /client-review/reopen', () => {
  const src = fn(BM, 'renderReopen')
  assert.match(src, /hostPost\('\/client-review\/reopen', \{answer:p\.decision\}\)/)
  assert.match(fn(BM, 'reopenable'), /!p\.reopened&&p\.decision&&\(p\.state==='rejected'\|\|p\.state==='accepted_with_changes'\)/)
  assert.match(BM, />Reopen a part…<\/button>/)
})

test('the grid export’s header carries the brief’s logos, never a hard-coded NAPKIN', () => {
  const g = grid()
  const none = g.gridBody(ctxOf({ job: 'J' })).html
  assert.doesNotMatch(none, /NAPKIN/)
  assert.doesNotMatch(none, /class="logo"/, 'no logos, no logo cell')
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
  const withLogos = g.gridBody({ ...ctxOf({ job: 'J' }), logos: [{ src: png, alt: 'Client' }, { src: svg, alt: 'Agency' }, { src: 'javascript:alert(1)', alt: 'x' }, { src: 'https://x.test/a.png', alt: 'y' }] }).html
  assert.equal((withLogos.match(/<div class="logo">/g) || []).length, 3, 'on every sheet')
  assert.match(withLogos, new RegExp(`<div class="logo"><img src="${png.replace(/[+/]/g, '\\$&')}" alt="Client"><img src="${svg.replace(/[+/]/g, '\\$&')}" alt="Agency"></div>`))
  assert.doesNotMatch(withLogos, /javascript:|x\.test/, 'only inlined pictures print')
  assert.doesNotMatch(BM, /class="logo">NAPKIN/)
})

test('logos come from uploads now and a Brand Clan later, ordered client, agency, partner', () => {
  const LOGOS = [{ slot: 'partner', ref: { asset: 'p.png' } }, { slot: 'client', ref: { asset: 'c.png' } }, { slot: 'agency', ref: { brand: 'brand-wk', asset: 'logo-primary' } }, { slot: 'client' }]
  const KIT = { brand: { name: { value: 'Lumen Water' } }, kit: { version: 5 }, visual: { logos: {
    'lumen-primary': { name: 'Lumen mark', variants: { mono: { asset: 'assets/lumen-mono.svg', colour: 'mono', on: 'dark' }, 'full-light': { asset: 'assets/lumen-mark.svg', colour: 'full', on: 'light' } } },
    wordmark: { name: 'Wordmark', variants: { a: { asset: 'assets/../../etc/passwd.png' } } },
    nofile: { name: 'No file', variants: {} } } } }
  const lifted = (vals: Record<string, unknown>) => lift<{ logoSrc(l: unknown): string; nextSlot(ls: unknown[]): string; sheetLogos(): { slot: string }[]; kitLogos(k: unknown): { id: string; asset: string }[]; brandAttached(): { id: string } | null; upKeys(): string[] }>(BM,
    ['logoSrc', 'slotRank', 'sheetLogos', 'nextSlot', 'logosOf', 'items', 'brandAttached', 'kitLogos', 'isBrandKit', 'upKeys'], {
      LOGO_SLOTS: [['client', 'Client'], ['agency', 'Agency'], ['partner', 'Partner']], arr, assetUrl: (n: string) => `clan://localhost/assets/${n}`,
      get: (k: string) => vals[k],
    })
  const L = lifted({ logos: LOGOS })
  assert.equal(L.logoSrc({ ref: { asset: 'c.png' } }), 'clan://localhost/assets/c.png')
  assert.equal(L.logoSrc({ ref: { brand: 'b', asset: 'x' } }), '', 'a Brand Clan logo with no kit attached has no picture')
  assert.deepEqual(L.sheetLogos().map(l => l.slot), ['client', 'agency', 'partner'], 'a logo with no ref is left out')
  assert.equal(L.nextSlot([]), 'client')
  assert.equal(L.nextSlot([{ slot: 'client' }]), 'agency')
  assert.equal(L.nextSlot([{ slot: 'client' }, { slot: 'agency' }]), 'partner')
  // A Brand Clan attached (data.upstream.<its id>, feat/brand-clan's carry): its logos are offered, a full-colour
  // variant for light paper first; a logo pointing out of the assets folder, or with no picture, is not.
  const K = lifted({ logos: LOGOS, upstream: { 'brand-wk': KIT, 'res-1': { findings: {} } } })
  assert.deepEqual(K.brandAttached()!.id, 'brand-wk')
  assert.deepEqual(K.kitLogos(KIT), [{ id: 'lumen-primary', name: 'Lumen mark', asset: 'lumen-mark.svg' }])
  assert.equal(K.logoSrc({ ref: { brand: 'brand-wk', asset: 'lumen-primary' } }), 'clan://localhost/assets/lumen-mark.svg')
  assert.equal(K.logoSrc({ ref: { brand: 'other', asset: 'lumen-primary' } }), '', 'only the kit that is attached')
  assert.deepEqual(K.upKeys(), ['res-1'], 'a Brand Clan is not research')
  assert.match(fn(BM, 'renderLogos'), /kitOffers\(\)/, 'the Logos box offers the kit’s logos')
  assert.match(fn(BM, 'kitOffers'), /ref:\{brand:x\.brandId, asset:x\.id\}|brandId:b\.id/)
  assert.match(fn(BM, 'renderLook'), /renderBrandLine\(\)/)
})

test('the look is appearance: layout and logos are schema appearance keys, and Reset look clears them with the theme', () => {
  const schema = JSON.parse(page('brief-maker/schema.json')) as { properties: Record<string, { 'x-clan-appearance'?: boolean }> }
  for (const k of ['theme', 'layout', 'logos']) assert.equal(schema.properties[k]['x-clan-appearance'], true, k)
  assert.match(fn(BM, 'resetLook'), /patch\(\{theme:null, layout:null, logos:null\}/)
})

test('nothing the brief did before is gone: every control is still on the page', () => {
  // Owner rule: no feature that exists today is removed or hidden by the new UI.
  for (const id of ['prompt', 'addAny', 'genBtn', 'chips', 'intakeStatus', 'dropveil', 'fromUp', 'proc', 'meet', 'procActs', 'tiles',
    'fields', 'review', 'crewline', 'upNote', 'madeFrom', 'boards', 'lockBtn', 'lockList', 'lockedBadge', 'status',
    'crOpen', 'reopenBtn', 'clientAnswer', 'brandLine', 'swatches', 'logoList', 'resetLook', 'sideHint',
    'toast', 'walker', 'docIdent', 'hProj', 'hCli'])
    assert.match(BM, new RegExp(`id="${id}"`), `#${id} is on the page`)
  // What left the side tab is in the OS bar, by the same handlers (the side tab design): Save · PDF,
  // Draft it again (two clicks), the client copy, HTML, the grid and the plain layout. Save as… and a
  // new brief are the shell's own (the document menu's Save as…, Continue in › Start fresh).
  const bar = fn(BM, 'barItems')
  for (const id of ['pdf', 'redraft', 'client', 'html', 'gridPdf', 'gridHtml', 'plainPdf', 'plainHtml', 'unlock', 'reopen']) assert.match(bar, new RegExp(`id:'${id}'`), `${id} is in the OS bar`)
  assert.match(fn(BM, 'redraftClick'), /if\(!REDRAFT_ARMED\)\{[\s\S]*draftNow\('', true\);/, 'Draft it again still takes two clicks')
  assert.match(BM, /See each part as it is written/)
  // Per-part: the way into why stays on the part; edit, write again and keep as is (locked_fields)
  // are the Selected part panel's, as the mock (no hover icons on the part).
  const row = fn(BM, 'fieldRow')
  assert.match(row + fn(BM, 'provHtml'), /prov/)
  assert.doesNotMatch(row, /class="ctrls"|act-edit|act-regen|act-lock/, 'no hover cluster on the part')
  // The selected part offers the same, through the same functions.
  const sel = fn(BM, 'renderSelPart')
  assert.match(sel, /else if\(a==='edit'&&row\) startEdit\(row,f\);/)
  assert.match(sel, /else if\(a==='regen'\) startRegen\(row,f\);/)
  assert.match(sel, /else if\(a==='regen-go'\)\{[\s\S]{0,160}?regenField\(f,g\); \}/)
  assert.match(sel, /else if\(a==='keep'\) toggleLock\(f\);/)
  assert.match(sel, /else if\(a==='hist'\) openHist\(f\);/)
  assert.match(sel, /else if\(a==='reopen'\) reopenPart\(f\);/)
  // Where it came from is the OS's one part view (where-it-came-from), compact, not the brief's own Built from.
  assert.match(sel, /renderProv\(\)/, 'the part view is drawn by renderProv')
  assert.match(sel, /id="spChips"/, 'its certainty and facts are the state chips, under the crumb')
  assert.match(sel, /<div class="sp-prov" id="spProv"><\/div>/)
  assert.doesNotMatch(sel, /whyHtml|sp-w|spBuilt|spLineCard|F\.card\(|id="spHead"/)
})

test('the selected part shows the OS part view, compact; a selected line only where it sits', () => {
  const src = fn(BM, 'renderProv')
  assert.match(src, /F\.partView\(f\.key, b, \{panel:true, compact:true, name:headOf\(f\), sheet:sheet, seen:seen, also:also\}\)/)
  assert.match(src, /sheet=valToText\(get\(f\.key\), f\.type\)/, 'the sheet’s words, so Built from does not quote them back')
  assert.match(src, /hb\.textContent='History · '\+n\+' ›'/, 'History · n ›, counted from the record')
  assert.match(src, /data-sig/, 'drawn once per part and version, so picking a line does not redraw it')
  assert.match(src, /goPart\(c\.getAttribute\('data-clf-part'\)\)/, 'an Also used in chip selects that part')
  assert.doesNotMatch(BM, /function renderBuilt\(|function builtRow\(|class="bf-row|class="sp-w"/)
  // while someone types in the panel, only the part view follows the chain
  assert.match(fn(BM, 'loadChain'), /if\(sp&&sp\.contains\(document\.activeElement\)\) renderProv\(\); else renderSelPart\(\);/)
  // a list line: the crumb says line n of N, and the line stays lit on the sheet; it is not quoted
  const L = lift<{ lineCrumb(f: { key: string; type: string }): string }>(BM, ['lineCrumb'], {
    SEL_ITEM: 1, get: () => ['No price promotion', 'No “limited time” language', 'Under-15s'],
  })
  assert.equal(L.lineCrumb({ key: 'mandatories', type: 'list' }), 'line 2 of 3')
  assert.equal(L.lineCrumb({ key: 'background', type: 'text' }), '')
  assert.match(fn(BM, 'renderSelPart'), /\(line\?' <span aria-hidden="true">›<\/span> '\+esc\(line\):''\)/)
  assert.doesNotMatch(BM, /This line<em>/)
  assert.match(fn(BM, 'goPart'), /select\(key\)/, 'a used-in chip selects that part')
  const decisions: Record<string, { cites: string[] }> = { background: { cites: ['f_1', 'f_2'] }, audience: { cites: ['f_2'] }, insight: { cites: ['f_2', 'f_bad'] }, barrier: { cites: ['f_1'] } }
  const vals: Record<string, unknown> = { background: 'B', audience: 'A', insight: 'I', barrier: '' }
  const U = lift<{ partCites(k: string): string[]; usedIn(r: string, but: string): string[] }>(BM, ['partCites', 'usedIn'], {
    decisionsFor: (k: string) => (decisions[k] ? [decisions[k]] : []), claimDecision: () => null,
    citesOf: (ds: ({ cites: string[] } | null | undefined)[]) => [...new Set(ds.flatMap(d => (d ? d.cites : [])))],
    wrongPin: (id: string) => id === 'f_bad', hasVal: (v: unknown) => !!v, get: (k: string) => vals[k],
    layoutItems: () => ['background', 'barrier', 'audience', 'insight'].map(key => ({ key })),
  })
  assert.deepEqual(U.partCites('insight'), ['f_2'], 'a pin marked wrong is not something it was built from')
  assert.deepEqual(U.usedIn('f_2', 'background'), ['audience', 'insight'], 'in reading order, never the part itself')
  assert.deepEqual(U.usedIn('f_1', 'background'), [], 'an empty part is not using anything')
})

// ── per-part Confidential (owner, 9 Nov) ─────────────────────────────────────

test('a part marked Confidential is hatched and tagged, kept in the agency copy and left out of the client copy', () => {
  const schema = JSON.parse(page('brief-maker/schema.json')) as { properties: Record<string, { type?: string; 'x-clan-appearance'?: boolean }> }
  assert.equal(schema.properties.confidential_fields.type, 'array')
  assert.equal(schema.properties.confidential_fields['x-clan-appearance'], undefined, 'who may read a part is not its look: Reset look keeps it')
  const sel = fn(BM, 'renderSelPart')
  assert.match(sel, /keepBtn\(f,A,kept\)\+confBtn\(f,wr,conf\)/, 'beside Keep as is')
  assert.match(fn(BM, 'keepBtn'), /data-sp="keep"/)
  assert.match(fn(BM, 'confBtn'), /data-sp="conf"/)
  assert.match(sel, /else if\(a==='conf'\) toggleConf\(f\);/)
  assert.match(fn(BM, 'toggleConf'), /patch\('confidential_fields', next/)
  assert.match(fn(BM, 'toggleConf'), /if\(!canWrite\(f\.key\)\)/, 'a locked brief changes a reopened part only')
  assert.match(fn(BM, 'fieldRow'), /row\.classList\.toggle\('conf', conf\)/)
  assert.match(fn(BM, 'fieldRow'), /class="conftag"/)
  assert.match(BM, /\.pgrid > \.row\.conf\{background-image:repeating-linear-gradient\(135deg/)
  // The client copy prints no confidential part; the agency copy prints them hatched and tagged.
  assert.match(fn(BM, 'sheetItems'), /copy==='client'\?layoutWithout\(items, confList\(\)\):items/)
  const g = grid()
  const out = g.gridBody({ ...ctxOf({ budget_and_scope: 'Secret money.' }), conf: ['budget_and_scope'] }).html
  assert.match(out, /class="box conf"><div class="lab"><b>06<\/b>Budget and scope<span class="cf">Confidential<\/span>/)
  assert.match(fn(BM, 'exportField'), /class="cf">Confidential</)
})

// ── the sheet as it prints ───────────────────────────────────────────────────

type Block = { id: number | string; top: number; bottom: number; head: boolean }
const sheet = () => lift<{ sheetPaginate(b: Block[], o?: unknown): (number | string)[][] }>(BM, ['sheetPaginate'], { arr, A4: { h: 1123, top: 56, bottom: 64 } })

test('the sheet breaks into A4 pages between whole rows, a heading going with the row under it', () => {
  const P = sheet().sheetPaginate
  const b = (id: number | string, top: number, bottom: number, head = false): Block => ({ id, top, bottom, head })
  // Everything fits on one page.
  assert.deepEqual(P([b(1, 300, 330, true), b(2, 330, 600), b(3, 600, 1000)]), [[1, 2, 3]])
  // Row 3 runs past the page's bottom margin (1123 - 64): it starts page 2, at the top margin.
  const two = P([b(1, 300, 330, true), b(2, 330, 900), b(3, 900, 1100), b(4, 1100, 1500)])
  assert.deepEqual(two, [[1, 2], [3, 4]], 'row 4 fits under row 3 once page 2 starts at row 3 (1500 - (900 - 56) < 1059)')
  // A heading at the foot of a page moves on with its row.
  assert.deepEqual(P([b(1, 300, 900), b(2, 900, 930, true), b(3, 930, 1200)]), [[1], [2, 3]])
  // A row taller than a page gets a page to itself, and the next row starts the one after.
  assert.deepEqual(P([b(1, 300, 400), b(2, 400, 2000), b(3, 2000, 2100)]), [[1], [2], [3]])
  // The pictures follow the grid as one block.
  assert.deepEqual(P([b(1, 300, 1000), b('boards', 1000, 1300)]), [[1], ['boards']])
  assert.deepEqual(P([]), [])
})

test('the screen and the PDF are one sheet: one builder, one measure, guides where the pages break', () => {
  // Save · PDF builds the sheet from the page's own styles, measures it at A4 width, and prints the pages it measured.
  const build = fn(BM, 'buildSheetExportHTML')
  assert.match(build, /sheetMeasure\(sheetDoc\(ctx, null\), 8000\)/)
  assert.match(build, /LAST_SHEET_PAGES=sheetPaginate\(blocks\)/)
  assert.match(build, /return sheetDoc\(ctx, LAST_SHEET_PAGES\)/)
  assert.match(fn(BM, 'sheetCtx'), /css:pageCss\(\)/)
  assert.match(fn(BM, 'sheetCtx'), /cells:layoutPack\(items\)/, 'the same grid the screen packs')
  assert.match(fn(BM, 'renderStructured'), /packed=layoutPack\(layoutItems\(\)\)/, 'the screen packs it the same way, the layout’s order and widths')
  assert.match(fn(BM, 'sheetMeasure'), /width:794px;visibility:hidden/, 'measured A4 wide, in this page (a frame in a sandboxed app cannot be read)')
  assert.doesNotMatch(fn(BM, 'sheetMeasure'), /iframe/)
  // A phone's rules shape the screen's sheet only, never the printed one or its probe.
  assert.match(BM, /#sheet \.pgrid > \.row,#sheet \.pgrid > \.sechead\{grid-column:1 \/ -1!important/)
  // The screen measures the agency copy the same way, and draws a guide before each page's first row.
  assert.match(fn(BM, 'scheduleBreaks'), /sheetMeasure\(sheetDoc\(ctx, null\), 6000\)[\s\S]*sheetPaginate\(blocks\)/)
  assert.match(fn(BM, 'renderStructured'), /class(Name)?='pbreak'/)
  assert.match(fn(BM, 'renderStructured'), /scheduleBreaks\(\)/)
  // No phone/PDF switch (owner removal), and the type on the sheet does not follow the window.
  assert.doesNotMatch(BM, /data-format=|Phone view|phone\/PDF/i)
  assert.match(BM, /\.sheet\.a4 \.val\.spp\{font-size:28px\}/)
  // Documents stay paper: the sheet keeps the light stock in a dark room, as it prints.
  assert.match(BM, /\.sheet\.a4\{color-scheme:light;\s*--paper:#FBF7EE;/)
  // The last page ends the document: no blank page after it.
  assert.match(BM, /\.sheet\.a4\.page:last-child\{break-after:auto;page-break-after:auto\}/)
  // Place on page is one row that never folds, so nothing has to remember it open (owner, 2026-11-11).
  assert.doesNotMatch(fn(BM, 'renderSelPart'), /<details class="sp-l"|OPEN_WHY\['spl:'/)
})

// ── the Research Tool on the new UI (features/research-new-ui.clan) ─────────

test('research: every action the old header and the Review agent’s bar held is in the inspector, and the sections stay', () => {
  const at = RT.indexOf('<aside class="insp'), end = RT.indexOf('</aside>', at)
  assert.ok(at > 0 && end > at, 'the inspector is in the page')
  const insp = RT.slice(at, end)
  assert.doesNotMatch(RT, /<header class="top/, 'the header bar is gone')
  // The buttons keep their ids, so their handlers are the ones they had.
  for (const [id, label] of [['whoBtn', 'change'], ['extractBtn', 'Read the ask again'], ['researchBtn', 'Run research'],
    ['synthBtn', 'Find the points'], ['exportBtn', 'Save · PDF'], ['lockBtn', 'Lock and accept']]) {
    assert.match(insp, new RegExp(`id="${id}"[^>]*>${label}<`), `${id} is in the inspector`)
    assert.match(RT, new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('click'`), `${id} is wired`)
  }
  for (const id of ['judge', 'viewsw', 'mapview', 'rbox', 'rbox-refresh', 'insp-ask', 'insp-sel', 'nav-report-a', 'nav-start-a', 'nav-ask', 'nav-facts', 'nav-findings'])
    assert.match(insp, new RegExp(`id="${id}"`), `${id} is in the inspector`)
  for (const href of ['#report', '#start', '#ask', '#facts', '#findings', '#selection']) assert.ok(insp.includes(`href="${href}"`), href)
  assert.match(insp, /data-view="report"[^>]*>Report</)
  assert.match(insp, /data-view="map"[^>]*>Evidence map</)
  // The report's own parts are where they were.
  const doc = RT.slice(RT.indexOf('<main id="doc">'), RT.indexOf('</main>'))
  for (const id of ['report', 'start', 'gates', 'jobs', 'walker', 'records', 'ask', 'legend', 'facts', 'findings', 'selection', 'docfoot'])
    assert.match(doc, new RegExp(`id="${id}"`), `${id} is in the document`)
  // Refresh, How it ran and Ask the research are the inspector's, each still a button.
  assert.match(fn(RT, 'renderInspector'), /refreshBtn\(stale/)
  assert.match(fn(RT, 'renderInspector'), /data-act="show-run"/)
  assert.match(fn(RT, 'renderAsks'), /askBoxHtml\('_new', 'Ask the research'\)/)
  // Owner removals stay removed.
  for (const gone of ['show-findings', 'source-mix', 'rb-outline', 'answer formed']) assert.ok(!RT.includes(gone), gone)
  // Continue in is the OS bar's: the panel starts no brief of its own (same POST /spinoff).
  assert.doesNotMatch(RT, /data-act="spin-brief"|function doSpinBrief/)
  assert.match(fn(RT, 'judgeBarHtml'), /Continue in ▾/)
  // Save · PDF keeps its other ways to save behind ▾.
  assert.match(insp, /data-act="export-html"[^>]*>HTML file</)
})

test('research: the report body is the mock’s, and every section of the record is drawn in it', () => {
  const r = fn(RT, 'renderReport')
  // band, stats, 00 the ask, headline and summary, lens × market sections, then the record
  for (const part of ['rpBand(r, lk)', 'rpStats()', 'rpAsk(0)', 'h2 class="headline"', 'rep-sum', 'rpSection(s, n, ms', 'rpConfirm(r', 'rpNotResearched(r',
    'rp-asks-at', 'evAppendixHtml(evm())'])
    assert.ok(r.includes(part), part)
  assert.ok(!r.includes('rep-foot'), 'the record’s versions and hashes are not on the page')
  // Read the ask again sits under the ask; All 19 fields and Your request open what they name.
  const ask = fn(RT, 'rpAsk')
  assert.match(ask, /data-act="extract"[^>]*>Read the ask again</)
  assert.match(ask, /data-act="goto-records" data-to="ask"/)
  assert.match(ask, /data-act="show-run">Your request and answers</)
  // Contests keep Resolve and Why; gaps offer Research this, which only fills the ask box.
  assert.match(fn(RT, 'rpContest'), /data-act="resolve"/)
  assert.match(fn(RT, 'rpContest'), /data-act="why"/)
  assert.match(fn(RT, 'gapRow'), /data-act="gap-ask"/)
  assert.doesNotMatch(fn(RT, 'gapAsk'), /doAsk|sendAsk|apiProxy/)
  // One Ask the research box; a lens-scoped question is asked from it with About.
  assert.doesNotMatch(fn(RT, 'renderAsks'), /askBoxHtml\(L\.k/)
  assert.match(fn(RT, 'aboutHtml'), /id="rqlens-'\+esc\(slug\(key\)\)\+'"/)
  assert.match(fn(RT, 'doAsk'), /rqlens-/)
})

// UAT round 5: a new brief's page took 3.4 s to download; Write the brief showed before its click was wired, and a
// press then did nothing. It is drawn disabled and turned on by renderIntake, after the listener, at start-up.
test('brief: Write the brief is not offered before its click is wired', () => {
  assert.match(BM, /<button type="button" class="go" id="genBtn" disabled>Write the brief<\/button>/)
  assert.match(fn(BM, 'renderIntake'), /genOff\(\);/)
  assert.match(fn(BM, 'genOff'), /g\.disabled=noMiddleware\(\)\|\|UPLOADING>0/)
  const wired = BM.indexOf("$('genBtn').addEventListener('click'"), boot = BM.lastIndexOf('\n  render();')
  assert.ok(wired > 0 && boot > wired, 'the first render, which enables it, runs after the click is wired')
})

// UAT attachment journeys, 2026-11-12: a file that could not be added was dropped silently and "Adding…" stayed for
// good; Write the brief could start a draft while files were still going up.
test('brief: a file that cannot be added is named, and Write waits for the upload', async () => {
  const els: Record<string, { textContent: string; disabled: boolean; cls: Set<string>; classList: unknown }> = {}
  const el = (id: string) => els[id] ||= (() => { const cls = new Set<string>(); return { textContent: '', disabled: false, cls,
    classList: { remove: (c: string) => cls.delete(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } } })()
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const assets: unknown[] = []
  const fetch = (url: string) => gate.then(() => url.includes('.zip')
    ? { status: 400, json: () => Promise.resolve({ error: { type: 'bad_request', message: 'not a file the studio keeps' } }) }
    : { status: 200, json: () => Promise.resolve({ internal_path: 'human/assets/x' }) })
  const env = { $: el, UPLOADING: 0, noMiddleware: () => false, data: () => ({ reference_assets: assets }), clanScheme: 'clan://localhost',
    patch: (_k: string, v: unknown[]) => { assets.splice(0, assets.length, ...v) }, fileType: () => 'doc', mediaTypeOf: () => 'application/pdf',
    sha256Hex: () => Promise.resolve('0'.repeat(64)), fetch, READ_EXT: /^(pdf|zip)$/ }
  const f = lift<{ uploadList(l: unknown[], s: unknown, d?: () => void): void }>(BM, ['genOff', 'upWhy', 'unreadNote', 'uploadList'], env)
  const file = (name: string, size: number) => ({ name, size, type: '', arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)) })
  let finished = false
  f.uploadList([file('notes.pdf', 10), file('bad.zip', 10), file('empty.pdf', 0)], el('intakeStatus'), () => { finished = true })
  assert.equal(el('intakeStatus').textContent, 'Adding 3 files…')
  assert.equal(el('genBtn').disabled, true, 'Write the brief waits while files go up')
  release()
  for (let i = 0; i < 50 && !finished; i++) await new Promise(r => setTimeout(r, 0))
  assert.ok(finished, 'the upload ends')
  assert.equal(el('genBtn').disabled, false, 'and Write the brief is back')
  assert.equal(assets.length, 1, 'the good file is on the desk')
  assert.match(el('intakeStatus').textContent, /^Could not add bad\.zip \(not a file the studio keeps\), empty\.pdf \(it is empty\)\.$/)
  assert.ok(el('intakeStatus').cls.has('err'), 'said as an error')
})

// Owner, 2026-11-12 (UAT round 7): a file the agents can't read is kept, and the person is told when they add it.
test('brief: a file the agents cannot read is added, and the person is told so', async () => {
  const els: Record<string, { textContent: string; disabled: boolean; cls: Set<string>; classList: unknown }> = {}
  const el = (id: string) => els[id] ||= (() => { const cls = new Set<string>(); return { textContent: '', disabled: false, cls,
    classList: { remove: (c: string) => cls.delete(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } } })()
  const assets: unknown[] = []
  const env = { $: el, UPLOADING: 0, noMiddleware: () => false, data: () => ({ reference_assets: assets }), clanScheme: 'clan://localhost',
    patch: (_k: string, v: unknown[]) => { assets.splice(0, assets.length, ...v) }, fileType: () => 'doc', mediaTypeOf: () => '',
    sha256Hex: () => Promise.resolve('0'.repeat(64)),
    fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({ internal_path: 'human/assets/x' }) }),
    READ_EXT: /^(txt|text|md|markdown|csv|tsv|json|ya?ml|log|pdf|docx|pptx|png|jpe?g|gif|webp)$/ }
  const f = lift<{ uploadList(l: unknown[], s: unknown, d?: () => void): void; unreadNote(n: string[]): string }>(BM, ['genOff', 'upWhy', 'unreadNote', 'uploadList'], env)
  const file = (name: string) => ({ name, size: 10, type: '', arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) })
  let finished = false
  f.uploadList([file('kestrel-archive.zip'), file('kestrel-shelf.png'), file('notes.txt')], el('intakeStatus'), () => { finished = true })
  for (let i = 0; i < 50 && !finished; i++) await new Promise(r => setTimeout(r, 0))
  assert.equal(assets.length, 3, 'all three are kept with the brief')
  assert.equal(el('intakeStatus').textContent, 'kestrel-archive.zip is added, but the agents can’t read .zip files. They read PDF, Word, PowerPoint, pictures and text.')
  assert.ok(!el('intakeStatus').cls.has('err'), 'a note, not an error')
  assert.equal(f.unreadNote(['a.zip', 'b.key']), 'a.zip, b.key are added, but the agents can’t read .zip or .key. They read PDF, Word, PowerPoint, pictures and text.')
  assert.match(BM, /var READ_EXT=\/\^\(txt\|text\|md\|markdown\|csv\|tsv\|json\|ya\?ml\|log\|pdf\|docx\|pptx\|png\|jpe\?g\|gif\|webp\)\$\/;/, 'the same list as the test')
})

// UAT round 5: the fact panel is drawn again on every document change, and the question being typed was lost, so
// pressing Ask sent nothing. The draft is kept per selected item, put back on redraw, the caret kept, cleared on send.
test('research: a question typed about a fact survives a redraw', () => {
  const env = { esc, slug: (x: string) => x, LENSES: [], LENS: {}, ASK: { ui: {} }, secByLens: () => null, secName: (x: { title: string }) => x.title,
    lensName: (k: string) => k, VIEW: { sel: 'fact:f1' }, PV: { askDraft: { 'fact:f1': 'Is <this> true?' } } }
  const f = lift<{ askHtml(ph: string): string }>(RT, ['askField', 'aboutHtml', 'aboutName', 'askHtml'], env)
  assert.match(f.askHtml('Ask about this fact…'), /<textarea id="pv-askq"[^>]*>Is (&lt;|&#60;)this(&gt;|&#62;) true\?<\/textarea>/, 'the draft is drawn back, escaped')
  assert.match(RT, /else if\(id==='pv-askq'\)\{ if\(VIEW\.sel\) PV\.askDraft\[VIEW\.sel\]=t\.value; \}/, 'kept as typed, per item')
  assert.match(fn(RT, 'renderSel'), /ae\.id==='pv-askq'[\s\S]*q\.focus\(\{preventScroll:true\}\); q\.setSelectionRange/, 'focus and caret survive the redraw')
  assert.match(RT, /case 'pv-ask':[^\n]*\n\s*if\(VIEW\.sel\) delete PV\.askDraft\[VIEW\.sel\];/, 'cleared once sent')
})

// Owner, 2026-11-11 ("follows old UI"): the Ask box is one composed field in the new UI's language, with About as a
// chip that opens the shell's menu of plain section names, never a native select, and Ask as the shell's button.
test('research: the Ask box is one field with an About chip, no native select', () => {
  const LENSES = [{ k: 'market', l: 'Market' }, { k: 'audience', l: 'Audience' }], LENS = { market: LENSES[0], audience: LENSES[1] }
  const secs: Record<string, { n: number; title: string; lens: string }> = { market: { n: 1, title: 'The market', lens: 'market' } }
  const env = { esc, slug: (x: string) => x.replace(/[^a-z0-9_-]/gi, '-'), LENSES, LENS, ASK: { ui: { _new: { draft: 'Why?', lens: 'market' } } },
    secByLens: (k: string) => secs[k] || null, secName: (x: { title: string }) => x.title, lensName: (k: string) => (LENS as Record<string, { l: string }>)[k]?.l || k,
    VIEW: { sel: null }, PV: { askDraft: {} } }
  const f = lift<{ askBoxHtml(k: string, l: string): string; askHtml(ph: string): string }>(RT, ['askBoxHtml', 'askField', 'aboutHtml', 'aboutName', 'askHtml'], env)
  const box = f.askBoxHtml('_new', 'Ask the research')
  assert.doesNotMatch(box, /<select/, 'no native select in the Ask box')
  assert.equal((box.match(/class="rq-field/g) || []).length, 1, 'one composed field')
  assert.match(box, /<textarea id="rqin-_new"[^>]*placeholder="Ask the research…"[^>]*>Why\?<\/textarea>/, 'a short placeholder; the draft kept')
  assert.match(box, /<label class="sr" for="rqin-_new">Ask the research<\/label>/, 'no mono caps label, named for screen readers')
  assert.match(box, /<details class="rq-aboutm"><summary aria-label="About: The market">About · <b>The market<\/b>/, 'About is a chip naming the section')
  assert.match(box, /<div class="pv-menu" role="menu">/, 'it opens the shell’s menu')
  assert.match(box, /data-lens="">Anything<\/button>/)
  assert.match(box, /aria-checked="true" data-act="rq-lens" data-k="_new" data-lens="market">The market<\/button>/, 'plain section names, the chosen one checked')
  assert.match(box, /data-lens="audience">Audience<\/button>/)
  assert.doesNotMatch(box, /§/, 'no section numbers in About')
  assert.match(box, /<input type="hidden" id="rqlens-_new" value="market">/, 'the lens rides in a hidden input for doAsk')
  assert.match(box, /<div class="rq-foot">[\s\S]*<button type="button" class="sp-btn rq-send" data-act="rq-send" data-k="_new">Ask<\/button><\/div><\/div>/, 'Ask is the shell’s button, inside the field')
  // The selected view's Ask about this… is the same field.
  const sel = f.askHtml('Ask about this finding…')
  assert.match(sel, /^<div class="rq-field pv-ask"><textarea id="pv-askq"[^>]*placeholder="Ask about this finding…"/)
  assert.match(sel, /class="sp-btn rq-send" data-act="pv-ask">Ask</)
  assert.doesNotMatch(sel, /pv-btn primary|<select/)
  // The look: a hairline on the panel surface, the agency colour's 2px ring, no thick red ring, no new colours.
  const css = RT.slice(RT.indexOf('.rq-field{'), RT.indexOf('.rq-field .sp-btn:hover'))
  assert.match(css, /\.rq-field\{[^}]*border:1px solid var\(--line\)[^}]*background:var\(--paper\)/)
  assert.match(css, /\.rq-field:focus-within\{border-color:var\(--ag-act\);box-shadow:0 0 0 2px color-mix\(in srgb,var\(--ag-act\)/)
  assert.match(css, /\.rq-field textarea:focus-visible\{outline:none\}/, 'the global 3px red focus outline is off inside the field')
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b|--create/i, 'tokens only')
  assert.doesNotMatch(RT, /#insp-ask textarea\{|\.rq-about select/, 'the old textarea and select styles are gone')
  // Choosing in the menu keeps the draft and sets the lens; the menu closes outside or on Escape.
  assert.match(fn(RT, 'onAskAct'), /case 'rq-lens':[\s\S]*lu\.draft=lin\.value;[\s\S]*lu\.lens=b\.getAttribute\('data-lens'\)\|\|''/)
  assert.match(fn(RT, 'closeAbout'), /details\.rq-aboutm\[open\]/)
})

test('research: a figure the sentence states becomes its field where it stands', () => {
  const P: Record<string, { value: unknown; unit: string; sources?: string[] }> = { f_A: { value: 0.24, unit: 'proportion' }, f_B: { value: 0.11, unit: 'proportion' }, f_T: { value: 'long words that are not a figure at all', unit: 'text' } }
  const env = {
    arr, isObj, esc: (x: unknown) => String(x ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`), pins: () => P, fnds: () => ({ fi_X: { statement: 'X' } }),
    window: { ClanFields: {} }, fmtAny: (p: { value: number }) => `${Math.round(p.value * 100)}%`,
    srcRecs: () => ({ src_k: { publisher: 'Kantar' } }),
  }
  const f = lift<{ inlineCited(t: string, c: string[]): { html: string; left: string[] }; claimHtml(t: string, c: string[]): string }>(RT, ['inlineFig', 'fno', 'inlineCited', 'restCites', 'citeName', 'claimHtml'], env)
  const x = f.inlineCited('Ireland grew 24% and GB 11% & more.', ['f_A', 'f_B', 'fi_X'])
  assert.equal(x.html, 'Ireland grew <clan-field ref="f_A"></clan-field> and GB <clan-field ref="f_B"></clan-field> &#38; more.')
  assert.deepEqual(x.left, ['fi_X'])
  // Not inside a longer number, and a figure the sentence does not state follows it.
  const y = f.inlineCited('Up 124% on 2024.', ['f_A'])
  assert.deepEqual(y.left, ['f_A'])
  // What the sentence does not state is one quiet tag: its findings, else its publishers, and its pins.
  const c = f.claimHtml('Growth is real.', ['f_A', 'f_T', 'fi_X'])
  assert.match(c, /^Growth is real\. <span class="rp-cites"><span class="clf-src rp-tag" title="[^"]*">F1 · 2 pins<\/span><\/span>$/)
  P.f_A = { ...P.f_A, sources: ['src_k'] }
  assert.match(f.claimHtml('Growth is real.', ['f_A']), />Kantar · 1 pin</)
  assert.match(f.claimHtml('Nothing cited.', []), /no cite/)
})

type MapNode = { id: string; col: string; kind: string; used: boolean; out?: boolean; order: number; label: string; meta?: string }
type MapModel = { nodes: Record<string, MapNode>; edges: { from: string; to: string; kind: string }[]; cols: Record<string, MapNode[]>; gaps: MapNode[] }
const mapModel = (r: unknown, p: unknown, s: unknown) => lift<{ mapModel(r: unknown, p: unknown, s: unknown): MapModel }>(RT, ['pinLabel', 'mapModel'], { arr, isObj, MARKET: {} }).mapModel(r, p, s)
const pin = (sources?: string[]) => ({ key: 'k', value: 1, unit: 'count', confidence: 'high', ...(sources ? { sources } : {}) })

test('research: the evidence map draws only the edges the document carries, left to right', () => {
  const P = {
    sources: { src_aaaa: { publisher: 'Kantar' }, src_bbbb: { publisher: 'CSO' }, src_unus: { publisher: 'Nobody cites' } },
    pins: { f_000001: pin(['src_aaaa']), f_000002: pin(['src_bbbb', 'src_gone']), f_000003: pin(), f_000004: pin(['src_aaaa']), f_000005: pin(['src_aaaa']) },
    findings: { fi_A: { statement: 'A', status: 'verified', cites: ['f_000001', 'f_000002'] }, fi_R: { statement: 'R', status: 'rejected', cites: ['f_000004'] },
      fi_M: { statement: 'M', status: 'proposed', cites: ['f_MISSING'] } },
  }
  const S = { contested: [{ id: 'ct_1', status: 'resolved', chosen: 'f_000001', values: [{ fact_id: 'f_000001' }, { fact_id: 'f_000005' }] }] }
  const r = { summary: [{ text: 'One', cites: ['fi_A', 'f_000003'] }, { text: 'Two', cites: ['fi_GONE'] }] }
  const M = mapModel(r, P, S)
  const has = (a: string, b: string) => M.edges.find(e => e.from === a && e.to === b)
  // sources → pins → findings → summary
  assert.ok(has('src_aaaa', 'f_000001') && has('f_000001', 'fi_A') && has('fi_A', 'sum:0') && has('f_000003', 'sum:0'))
  assert.equal(M.edges.filter(e => M.nodes[e.from].col === 'summary').length, 0, 'nothing comes out of the summary')
  // Links to what the document lacks are gaps, never guessed.
  assert.equal(has('gap:src_gone', 'f_000002')?.kind, 'feeds')
  assert.equal(has('gap:f_MISSING', 'fi_M')?.kind, 'gap')
  assert.equal(has('gap:fi_GONE', 'sum:1')?.kind, 'gap')
  assert.equal(M.nodes['gap:nosource'].label, '1 pin with no source record')
  assert.equal(has('gap:nosource', 'f_000003')?.kind, 'gap')
  assert.deepEqual(M.gaps.map(g => g.col).sort(), ['finding', 'pin', 'source', 'source'])
  // A rejected finding and a value not chosen are considered, not chosen; what feeds only them is not used.
  assert.ok(M.nodes.fi_R.out && M.nodes.f_000005.out)
  assert.equal(has('f_000004', 'fi_R')?.kind, 'out')
  assert.equal(M.nodes.f_000004.used, false)
  assert.equal(M.nodes.src_unus.used, false)
  assert.equal(M.nodes.fi_M.used, false, 'a finding no summary line cites is not used')
  assert.ok(M.nodes.f_000001.used && M.nodes.src_aaaa.used && M.nodes.fi_A.used)
  // Each column is ordered by what it feeds: the used before the rest.
  assert.deepEqual(M.cols.summary.map(n => n.id), ['sum:0', 'sum:1'])
  assert.equal(M.cols.finding[0].id, 'fi_A')
  assert.deepEqual(M.cols.pin.slice(0, 3).map(n => n.id).sort(), ['f_000001', 'f_000002', 'f_000003'])
})

test('research: the evidence map draws an empty or partial document without breaking', () => {
  const empty = mapModel(null, null, null)
  assert.deepEqual(Object.keys(empty.nodes), [])
  assert.deepEqual(empty.edges, [])
  const noReport = mapModel(undefined, { pins: { f_000001: pin() }, findings: {} }, {})
  assert.equal(noReport.nodes.f_000001.used, false)
  assert.equal(noReport.cols.summary.length, 0)
  // The example document: every summary cite resolves, and the pins carry no source record yet.
  const ex = mapModel({ summary: [{ text: 'x', cites: ['f_000001'] }] }, { pins: { f_000001: pin() }, findings: {} }, {})
  assert.equal(ex.nodes['gap:nosource'].meta, 'pinned before sources travelled')
})

// ── the evidence panel (design/evidence-panel-final.md) ────────────────────

type EvPin = { group: string; via: string[]; direct: boolean; lines: string[] }
type EvSection = { id: string; n: number; lens: string; title: string; cited: string[]; backing: string[]; pinned: string[]; more: string[]; gaps: string[] }
type EvModel = {
  pin: Record<string, EvPin>; fnd: Record<string, { group: string }>; src: Record<string, { group: string; pins: string[] }>
  lines: { ref: string; kind: string; cites: string[]; sec: string }[]; usedF: string[]; consF: string[]; sections: EvSection[]
  counts: { pins: number; sources: number; findings: number; feeds: Record<string, number>; considered: Record<string, number>; unused: Record<string, number>; gaps: number }
}
type EvFam = { key: string; label: string; market: string; ids: string[]; rows: { v: string; ids: string[] }[] }
type EvFns = {
  evidenceModel(d: unknown): EvModel; closure(E: EvModel, ref: string): Record<string, 1>
  evFamilies(ids: string[], P: unknown, fmt: (p: unknown) => string): EvFam[]
  mapShown(M: MapModel, E: EvModel, cons: boolean): MapModel
}
/** The research the design was judged on (doc 1711cfd7), its shape only: texts, values and publishers replaced. */
const EVDOC = JSON.parse(readFileSync(join(dirname(templates()), 'tests', 'fixtures', 'research-evidence.json'), 'utf8'))
const EV_FNS = ['sectionBacking', 'evidenceModel', 'closure', 'famWords', 'evFamilies', 'mapShown']
const ev = () => lift<EvFns>(RT, EV_FNS, { arr, isObj })
const evFmt = (p: { value?: unknown; unit?: string }) => lift<{ fmtPinValue(p: unknown): string }>(RT, ['fmtPinValue'], {}).fmtPinValue(p)

test('research: one evidence model gives the design’s numbers, and its groups add up', () => {
  const E = ev().evidenceModel(EVDOC)
  const c = E.counts
  assert.deepEqual([c.feeds.pins, c.considered.pins, c.unused.pins], [50, 2, 144])
  assert.deepEqual([c.feeds.sources, c.considered.sources, c.unused.sources], [30, 0, 27])
  assert.equal(c.feeds.pins + c.considered.pins + c.unused.pins, c.pins)
  assert.equal(c.pins, 196)
  assert.equal(c.feeds.sources + c.considered.sources + c.unused.sources, c.sources)
  assert.equal(c.sources, 57)
  assert.deepEqual([c.feeds.viaF, c.feeds.direct, c.feeds.findings, c.findings, c.considered.findings, c.feeds.publishers, c.gaps], [28, 22, 4, 7, 3, 25, 37])
  // The pins block never counts: Clearance lists 120, and 6 are written about.
  const cl = E.sections.find(s => s.id === 's_regulation_clearance')!
  assert.deepEqual([cl.n, cl.cited.length, cl.pinned.length, cl.more.length], [7, 6, 120, 114])
  assert.match(fn(RT, 'evidenceModel'), /sectionBacking\(s\)/)
  assert.equal(RT.match(/kind==='pins'/g)?.length, 1, 'the pins block is read in sectionBacking only')
  // Nothing at all, and no report: no throw, nothing feeds.
  assert.equal(ev().evidenceModel(null).counts.pins, 0)
  const bare = ev().evidenceModel({ projection: EVDOC.projection })
  assert.equal(bare.counts.feeds.pins, 0)
  assert.equal(bare.counts.unused.pins + bare.counts.considered.pins, 196)
})

test('research: a line’s closure is what it rests on, and nothing else', () => {
  const f = ev(), E = f.evidenceModel(EVDOC)
  const line = E.lines.find(l => l.ref === 'report.summary[0]')!
  const C = f.closure(E, 'report.summary[0]')
  assert.deepEqual(f.closure(E, 'sum:0'), C, 'the map’s name for the line is the same line')
  for (const c of line.cites) assert.ok(C[c], c)
  const fi = line.cites.find(c => /^fi_/.test(c))!
  for (const p of EVDOC.projection.findings[fi].cites) {
    assert.ok(C[p], `${p}, under ${fi}`)
    for (const s of EVDOC.projection.pins[p].sources) assert.ok(C[s], `${s}, under ${p}`)
  }
  const unused = Object.keys(E.pin).filter(id => E.pin[id].group === 'unused')
  assert.ok(unused.length && unused.every(id => !C[id]), 'no unused pin is in a line’s closure')
  assert.ok(!Object.keys(C).some(k => /^report\.(headline|summary\[[1-9]\])/.test(k)), 'other lines are not')
  // A section's trace is its sentences' closure; a pin's reaches the lines that cite it.
  const S = f.closure(E, 'sec:s_regulation_clearance')
  assert.ok(E.sections.find(s => s.id === 's_regulation_clearance')!.cited.every(id => S[id]))
  const p0 = line.cites.find(c => /^f_/.test(c))!
  assert.ok(f.closure(E, p0)['report.summary[0]'])
})

test('research: families fold the not-used pins, so Clearance’s trace stays short', () => {
  const f = ev(), E = f.evidenceModel(EVDOC)
  const cl = E.sections.find(s => s.id === 's_regulation_clearance')!
  const fams = f.evFamilies(cl.more, EVDOC.projection.pins, evFmt)
  assert.ok(fams.length > 1 && fams.length < 20, `${fams.length} family rows`)
  assert.equal(fams.reduce((n, x) => n + x.ids.length, 0), 114)
  for (const x of fams) {
    assert.doesNotMatch(x.label + x.market, /_|regulation\./, x.label)
    assert.equal(x.rows.reduce((n, r) => n + r.ids.length, 0), x.ids.length)
    assert.equal(new Set(x.rows.map(r => r.v)).size, x.rows.length, 'one row per value')
  }
  // A key that is not lens.family.* is Other, last.
  const odd = f.evFamilies(['a', 'b'], { a: { key: 'loose', value: 1 }, b: { key: 'x.size_value_eur', value: 2, market: 'IE' } }, evFmt)
  assert.deepEqual(odd.map(x => [x.label, x.market]), [['Size value', 'IE'], ['Other', '']])
  assert.match(fn(RT, 'secTraceHtml'), /evFamsHtml\('sec:'\+s\.id, fams\)/)
})

test('research: the report body draws no pins block, one gap per section, and one cite tag per sentence', () => {
  const E = ev().evidenceModel(EVDOC), P = EVDOC.projection.pins, F = EVDOC.projection.findings, SR = EVDOC.projection.sources
  const gaps = EVDOC.selection.gaps as { id: string }[]
  const env = {
    arr, isObj, esc, pins: () => P, fnds: () => F, srcRecs: () => SR, sel: () => EVDOC.selection, window: {},
    fmtAny: evFmt, lensName: (l: string) => l, slug: (x: string) => x, pinChip: (id: string) => `<a class="pinc">${id}</a>`,
    rpFinding: (id: string) => `<p class="rp-fp">${id}</p>`, rpContestLine: () => '', GAP_TLD: {},
    gapById: (id: string) => gaps.find(g => g.id === id) || null,
  }
  type B = { rpSection(s: unknown, n: number, ms: string, es: unknown): string; restCites(c: string[]): string }
  const f = lift<B>(RT, ['rpSection', 'behindLine', 'rpBlock', 'rpHead', 'pad2', 'lineField', 'claimHtml', 'inlineCited', 'restCites', 'citeName', 'inlineFig', 'fno', 'rpGapNote', 'gapWords', 'entityWords'], env)
  EVDOC.report.sections.forEach((s: { id: string; blocks: { kind: string }[] }, i: number) => {
    const es = E.sections.find(x => x.id === s.id)!
    const h = f.rpSection(s, i + 1, 'IE · GB', es)
    assert.doesNotMatch(h, /rp-pins|class="pinc/, `${s.id}: no pins block`)
    assert.ok((h.match(/class="rp-gap"/g) || []).length <= 1, `${s.id}: at most one gap`)
    assert.equal((h.match(/class="clf-src rp-tag"/g) || []).length, s.blocks.filter(b => b.kind === 'claim').length, `${s.id}: one tag per sentence`)
    assert.match(h, new RegExp(`class="rs-eye" data-act="ev-sec" data-sec="${s.id}"`))
    const mg = Math.max(0, es.gaps.length - 1)
    const parts = [es.cited.length ? `${es.cited.length} cited` : '', es.more.length ? `${es.more.length} more fact${es.more.length === 1 ? '' : 's'}` : '', mg ? `${mg} more gap${mg === 1 ? '' : 's'}` : ''].filter(Boolean)
    assert.ok(h.includes(`Behind this section · ${parts.join(' · ')} →`), `${s.id}: behind line`)
    if (s.id === 's_consumer_culture') assert.ok(h.includes('Behind this section · 8 cited · 39 more facts · 1 more gap →'))
  })
  // Section 01 had 14 gap notes; it shows one.
  assert.equal(EVDOC.report.sections[0].blocks.filter((b: { kind: string }) => b.kind === 'gap').length, 14)
  // More than three names fold to the first and +n; a finding names itself.
  const five = Object.keys(P).filter(id => P[id].sources.length).slice(0, 40).filter((id, i, a) => a.findIndex(x => SR[P[x].sources[0]]?.publisher === SR[P[id].sources[0]]?.publisher) === i).slice(0, 5)
  assert.equal(five.length, 5)
  assert.match(f.restCites(five), new RegExp(`>${SR[P[five[0]].sources[0]].publisher} \\+4 · 5 pins<`))
  assert.match(f.restCites(five.slice(0, 2)), /> ?Publisher \d+ · Publisher \d+ · 2 pins</)
  assert.match(f.restCites(['fi_5TNZ2TVZH74B', five[0]]), />F2 · 1 pin</)
  assert.match(f.restCites([]), /no cite/)
  assert.doesNotMatch(RT, /function rpPins/)
})

test('research: no label in the box, a trace, the map or a crumb is a raw key', () => {
  const E = ev().evidenceModel(EVDOC), P = EVDOC.projection.pins, SR = EVDOC.projection.sources
  const env = { arr, isObj, esc, pins: () => P, fnds: () => EVDOC.projection.findings, srcRecs: () => SR, window: {}, MARKET: { IE: 'Ireland', GB: 'Great Britain' },
    evTitle: () => '', lensName: (l: string) => l, evSec: (id: string) => E.sections.find(s => s.id === id) || null }
  type L = { evRow(id: string): string; crumbWord(c: unknown): string; mapLines(n: unknown): string[]; fmtAny(p: unknown): string }
  const f = lift<L>(RT, ['evRow', 'pinSid', 'confDots', 'clipT', 'pinLabel', 'fmtAny', 'fmtPinValue', 'crumbWord', 'shortId', 'pad2', 'secName', 'mapLines'], env)
  const text = (h: string) => h.replace(/<[^>]*>/g, ' ')
  for (const id of Object.keys(P)) {
    const p = P[id], keyRe = new RegExp(String(p.key).replace(/\./g, '\\.'))
    for (const t of [text(f.evRow(id)).replace(f.fmtAny(p), ''), f.crumbWord({ ref: id }), f.mapLines({ kind: 'pin', pin: p, label: '' }).join(' ').replace(f.fmtAny(p), '')]) {
      assert.doesNotMatch(t, /_/, `${id}: ${t}`)
      assert.doesNotMatch(t, keyRe, `${id}: ${t}`)
    }
  }
  assert.equal(f.crumbWord({ ref: 'sec:s_regulation_clearance' }), '07 Clearance')
  assert.match(fn(RT, 'mapLines'), /pinLabel\(\{key:n\.pin\.key, unit:n\.pin\.unit\}\)/)
  assert.doesNotMatch(fn(RT, 'mapLines'), /\.key\.split|\.key\)\.split/)
})

test('research: the map draws what feeds the report; Show considered adds exactly the considered set', () => {
  const f = ev(), E = f.evidenceModel(EVDOC)
  const M = lift<{ mapModel(r: unknown, p: unknown, s: unknown): MapModel }>(RT, ['pinLabel', 'mapModel'], { arr, isObj, MARKET: {} }).mapModel(EVDOC.report, EVDOC.projection, EVDOC.selection)
  const groupOf = (n: MapNode) => n.kind === 'pin' ? E.pin[n.id]?.group : n.kind === 'finding' ? E.fnd[n.id]?.group : n.kind === 'source' ? E.src[n.id]?.group : n.kind
  const real = (m: MapModel) => Object.values(m.nodes).filter(n => n.kind !== 'gap')
  const off = f.mapShown(M, E, false), on = f.mapShown(M, E, true)
  assert.ok(real(off).every(n => groupOf(n) === 'feeds' || n.kind === 'summary'), 'nothing not used or considered by default')
  assert.deepEqual([off.cols.pin, off.cols.source, off.cols.finding, off.cols.summary].map(c => c.filter(n => n.kind !== 'gap').length), [50, 30, 4, 5])
  assert.ok(off.cols.summary.some(n => n.id === 'report.headline'), 'the headline is drawn')
  const added = real(on).filter(n => !off.nodes[n.id]).map(n => n.id).sort()
  const considered = [...Object.keys(E.pin).filter(k => E.pin[k].group === 'considered'), ...Object.keys(E.fnd).filter(k => E.fnd[k].group === 'considered'),
    ...Object.keys(E.src).filter(k => E.src[k].group === 'considered')].sort()
  assert.deepEqual(added, considered)
  assert.equal(added.length, 5)
  assert.ok(added.every(id => on.nodes[id].out), 'drawn as considered, not chosen')
  assert.ok(on.edges.every(e => on.nodes[e.from] && on.nodes[e.to]))
  // No "unused" box, no dashed legend; the legend links what is not used to Evidence.
  assert.doesNotMatch(fn(RT, 'mapSvg'), /unused/)
  assert.doesNotMatch(RT, /\.n\.unused|<i class="d"><\/i>not used|· not used'/)
  // The design's map (2026-11-11): stubs end each column, and "left out" draws exactly the left-out findings.
  const mv = fn(RT, 'renderMapV')
  assert.match(mv, /\+'\+c\.unused\.sources\+'▤ not used/)
  assert.match(mv, /\+'\+c\.unused\.pins\+'◆ not used/)
  assert.match(mv, /data-act="pv-leftout">'\+\(PV\.leftOut\?'Hide the '\+nleft/)
})

test('research: the Evidence box holds what left the body, and the export keeps it as an appendix', () => {
  // The panel (2026-11-11): the report view or one item, then the map; Ask under the report view.
  const insp = RT.slice(RT.indexOf('<aside class="insp'), RT.indexOf('</aside>'))
  assert.ok(insp.indexOf('id="pv"') < insp.indexOf('id="mapview"') && insp.indexOf('id="mapview"') < insp.indexOf('id="insp-ask"'), 'report or item, the map, then Ask')
  assert.match(fn(RT, 'reportViewHtml'), /id="pv-q" type="search" placeholder="Find a fact or source"/)
  const g = fn(RT, 'evGroupsHtml')
  for (const k of ["'sources', 'Sources'", "'facts', 'Facts'", "'contests', 'Where sources disagree'", "'considered', 'Considered, not chosen'", "'unused', 'Not used'", "'gaps', 'Gaps'"]) assert.ok(g.includes(k), k)
  assert.match(g, /Nothing was weighed and set aside\./)
  assert.match(g, /No two sources gave different values for the same figure\./)
  assert.match(fn(RT, 'renderEvidence'), /Evidence appears once research has pinned facts\./)
  assert.match(fn(RT, 'renderEvidence'), /Nothing pinned yet\. Run research\./)
  assert.match(fn(RT, 'gapRow'), /data-act="gap-ask"/)
  assert.match(fn(RT, 'evGroupsHtml'), /E\.contests\.map\(rpContest\)/)
  // The body: the band's counts open Evidence; the record's sections are not drawn there any more.
  assert.match(fn(RT, 'rpStats'), /st\('sources'.*st\('unused', np\+' pin'\+\(np===1\?'':'s'\), true\).*st\('gaps'/s)
  const r = fn(RT, 'renderReport')
  for (const gone of ['rpContests', 'rpGaps', 'rpPinned', 'rpCoverage', 'rpExcluded', 'rpHowRan', 'rpRecord']) assert.ok(!RT.includes(`function ${gone}(`), gone)
  assert.match(r, /post\+=evAppendixHtml\(evm\(\)\)/)
  // The appendix is print-only on screen, and the HTML export shows it.
  assert.match(fn(RT, 'evAppendixHtml'), /class="rp-sec ev-appx print-only" id="rp-appx"/)
  assert.match(RT, /\.print-only\{display:none\}\n@media print\{\.print-only\{display:block!important\}/)
  assert.match(fn(RT, 'buildExportHTML'), /querySelectorAll\('\.print-only'\)\.forEach\(function\(n\)\{ n\.classList\.remove\('print-only'\); \}\)/)
  // The groups' open state is remembered per viewer, and storage may be refused.
  assert.match(RT, /try\{ EV\.open=JSON\.parse\(localStorage\.getItem\('clan\.research\.evopen'\)\|\|'\{\}'\)\|\|\{\}; \}catch\(e\)\{ EV\.open=\{\}; \}/)
  assert.match(fn(RT, 'evSave'), /^function evSave\(\)\{ try\{ localStorage\.setItem/)
})

test('research: no tap in the document opens the OS’s drawer; everything opens in the inspector, with its trail', () => {
  assert.doesNotMatch(RT, /ClanFields\.open\(/, 'the research never calls the drawer')
  assert.doesNotMatch(RT, /clan:open|clf-drawer['"]?\)\.classList\.add/, 'nor asks the shell or the page to open it')
  // A link inside a card is always the inspector's, drawer or not.
  const go = RT.slice(RT.indexOf("window.addEventListener('clan:cardgo'"), RT.indexOf("window.addEventListener('clan:cardact'"))
  assert.match(go, /e\.preventDefault\(\); VIEW\.origin=null; select\(d\.ref, !!VIEW\.sel\)/)
  assert.doesNotMatch(go, /d\.drawer/)
  // Full record, Resolve, Why and Show me open here.
  for (const [act, call] of [['pin-full', "inspect('rec:'+b.getAttribute('data-ref'), true)"], ['resolve', "inspect(b.getAttribute('data-contest')"], ['chk-why', 'inspect(ref, false)'], ['chk-open', 'inspect(ref, false)']])
    assert.ok(RT.includes(`case '${act}': ${act === 'chk-open' ? 'if(ref) ' : ''}${call}`), act)
  assert.match(fn(RT, 'doFinding'), /inspect\(id, false\)/)
  // The full record is the OS's card, drawn in the inspector.
  assert.match(fn(RT, 'selBody'), /\/\^rec:\/\.test\(ref\)\) return '<div id="insp-card" data-line="/)
  // A field anywhere in the page, and a card's own Where-this-came-from button, are caught before the OS's drawer.
  assert.match(RT, /var sc=e\.target\.closest\('\[data-clf-sc\]'\);/)
  assert.match(RT, /var host=t\.closest\('clan-field,clan-cite,clan-chart,clan-quote,clan-gap,clan-sources'\); if\(!host\) return;/)
  // Every tap the page handles itself goes to select(), and none posts to the shell for a drawer.
  const posts = RT.match(/postMessage\(\{type:'[^']+'/g) || []
  assert.ok(posts.every(p => !/drawer|clan:open/.test(p)), posts.join(', '))
})

test('research: the evidence panel’s CSS uses the theme’s tokens, never a hex colour', () => {
  const a = RT.indexOf('/* ── evidence panel'), b = RT.indexOf('/* /evidence panel */')
  assert.ok(a > 0 && b > a)
  assert.doesNotMatch(RT.slice(a, b), /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(RT, /\.rp-side\.won \.v\{[^}]*#14161B/, 'the chosen value reads in dark too')
})

test('research: the report box and the OS bar say the report’s state in the same words', () => {
  type F = { reportStatus(r: unknown, locked: boolean, stale: boolean, open: number): { label: string; tone: string | null; locked: boolean }
    barItems(st: unknown, has: boolean, lk: boolean): { kind: string; id?: string; label: string; disabled?: boolean; primary?: boolean }[] }
  const gate = { t: '' }
  // the run's state, for the bar's mode (the name alone at the ask; the run's step while it works)
  const run = { fresh: false, job: null as null | { state: string }, active: false, step: 0, report: true }
  const f = lift<F>(RT, ['reportStatus', 'barItems', 'barMode'], {
    isObj, theAgent: (k: string) => `the ${k} agent`, CHAT: { reportBusy: false, get job() { return run.job } }, gateWords: () => gate.t,
    thread: () => (run.fresh ? [] : [{}]), camp: () => (run.fresh ? {} : { name: {} }), jobActive: () => run.active,
    liveQuestion: () => null, runStep: () => run.step, PLAN: [{}, {}, {}, {}], D: () => (run.report ? { report: {} } : {}) })
  assert.equal(f.reportStatus(null, false, false, 0).label, 'No report yet')
  assert.deepEqual(f.reportStatus({}, true, true, 3), { label: 'Locked', tone: 'ok', locked: true })
  assert.equal(f.reportStatus({}, false, true, 3).label, 'Out of date')
  assert.equal(f.reportStatus({}, false, false, 2).label, 'Draft')
  assert.equal(f.reportStatus({}, false, false, 0).label, 'Ready to lock')
  // The OS bar (the design's Brief-tab parity): Redo ▾ and Save · PDF ▾, no state pill; locked, Save only.
  const st = f.reportStatus({}, false, false, 1)
  const bar = f.barItems(st, true, false) as { kind: string; id?: string; menu?: { id: string }[] }[]
  assert.deepEqual(bar.map(i => i.id), ['redo', 'save'])
  assert.deepEqual(bar[0].menu?.map(m => m.id), ['refresh', 'synth', 'research', 'extract'])
  assert.deepEqual(bar[1].menu?.map(m => m.id), ['export', 'export-html', 'save-clan'])
  assert.deepEqual((f.barItems(f.reportStatus({}, true, false, 0), true, true) as { id?: string }[]).map(i => i.id), ['save'])
  // Not brief-ready: Continue in begins with the gate line (gaps.md §7 L3); never once it is locked.
  gate.t = 'Not brief-ready yet: 1 call open (Finding 3). You can still start; the brief flags what is open.'
  assert.deepEqual(f.barItems(st, true, false)[0], { kind: 'gate', label: gate.t, tone: 'warn' })
  assert.equal(f.barItems(f.reportStatus({}, true, false, 0), true, true).filter(i => i.kind === 'gate').length, 0)
  gate.t = ''
  // The mock's bar per step: the ask shows the name alone, a run its step, a run that left no report how it ended.
  run.fresh = true
  assert.deepEqual(f.barItems(f.reportStatus(null, false, false, 0), false, false)[0], { kind: 'mode', mode: 'ask' })
  run.fresh = false; run.job = { state: 'running' }; run.active = true; run.step = 1
  assert.deepEqual(f.barItems(st, true, false)[0], { kind: 'mode', mode: 'working', label: 'Working · Step 2/4' })
  run.active = false; run.job = { state: 'cancelled' }; run.report = false
  assert.deepEqual(f.barItems(f.reportStatus(null, false, false, 0), false, false)[0], { kind: 'mode', mode: 'working', label: 'Stopped' })
  run.job = null; run.report = true
  // A bar action from an older shell still does what the page's button does.
  const onBar = fn(RT, 'onBarAction')
  assert.match(onBar, /'refresh'\) doRefreshReport\(\)/)
  assert.match(onBar, /'lock'\) doLock\(\)/)
  assert.match(onBar, /'export'\) doExport\('pdf'\)/)
  assert.match(RT, /m\.type==='clan:bar-action'\)\{ onBarAction/)
  assert.match(RT, /m\.type==='clan:bar\?'\)\{ BAR\.last=''/)
})

test('a list of sentences reads as sentences in the OS fields, a list of names with commas', () => {
  const { textOf } = lift<{ textOf(v: unknown): string }>(CLF, ['textOf'], {})
  assert.equal(textOf(['A €4 deal that gets you both.', 'To confirm: baked every morning.']), 'A €4 deal that gets you both. To confirm: baked every morning.')
  assert.equal(textOf(['IE', 'GB']), 'IE, GB')
  assert.equal(textOf([{ name: 'Lidl' }, { name: 'Tesco' }]), 'Lidl, Tesco')
})

// ── one needs count: the host's view (Tester B 7 / 14 / 12) ───────────────

test('the shared fields count what blocks the lock once per place and reason, as the shell does', () => {
  const at = (a: Record<string, unknown>) => ({ blocks_lock: true, text: 'Nobody has checked it', ...a })
  const VIEW = {
    attention: [
      at({ code: 'unverified_finding', address: 'd#findings[fi_1]' }),
      at({ code: 'unverified_finding', address: 'd#findings[fi_1]', decision: 'd_2' }),  // the same need, twice
      at({ code: 'bad_verdict', address: 'd#findings[fi_1]' }),                           // another reason, same place
      at({ code: 'low_certainty', address: 'd#campaign.brand', blocks_lock: false }),     // does not block
      at({ code: 'unmerged_branch', text: 'A copy was not brought back' }),               // no address: keyed by its words
    ],
  }
  const { needs } = lift<{ needs: () => unknown[] }>(CLF, ['needs'], { VIEW, arr })
  assert.equal(needs().length, 3)
})

test('the research lock counts the host’s needs, and lists unfilled parts apart', () => {
  const R = page('campaign-research/index.html')
  const host = [
    { code: 'unverified_finding', address: 'd#findings[fi_1]', text: 'Nobody has checked it', blocks_lock: true },
    { code: 'open_contest', address: 'd#selection.contested[ct_1]', text: 'Two values, nothing picked', blocks_lock: true },
  ]
  const env = (view: unknown) => ({
    window: { ClanFields: { view: () => view, needs: () => host } },
    arr, esc, isObj,
    pathOf: (a: string) => { const i = String(a).indexOf('#'); return i < 0 ? String(a) : String(a).slice(i + 1) },
    fnds: () => ({ fi_1: { statement: 'Gen Z drink less', status: 'proposed' } }),
    FIELD: { brand: { label: 'Brand' } },
    clipT: (t: string) => t,
    NEED_K: { open_contest: 'Open contest', unverified_finding: 'Unverified finding' },
    blockers: () => [{ k: 'page', html: 'its own' }, { k: 'page', html: 'reading' }, { k: 'page', html: 'of 3' }],
    missingFor: (g: string) => (g === 'created' ? [{ k: 'client_org', label: 'Client' }] : []),
  })
  const names = ['hostNeeds', 'needHtml', 'lockItems', 'unfilled']
  const f = lift<{ lockItems: () => { k: string; html: string }[]; unfilled: () => unknown[] }>(R, names, env({ attention: host }))
  const items = f.lockItems()
  assert.equal(items.length, 2, 'the host’s count, not the page’s own 3')
  assert.equal(items[0].k, 'Unverified finding')
  assert.match(items[0].html, /href="#finding-fi_1">Gen Z drink less<\/a> — Nobody has checked it/)
  assert.match(items[1].html, /#contest-ct_1/)
  assert.equal(f.unfilled().length, 1, 'a gate’s missing field is listed apart, not counted')
  // No host view (a problem, or none yet): the page’s own reading stands in.
  assert.equal(lift<{ lockItems: () => unknown[] }>(R, names, env({ problem: 'no chain' })).lockItems().length, 3)
  assert.equal(lift<{ lockItems: () => unknown[] }>(R, names, env(null)).lockItems().length, 3)
})

// ── a job another poll applied first (N1) ──────────────────────────────────

test('a done job another poll applied first still redraws the brief from what it wrote', () => {
  let chains = 0, renders = 0, ended = 0
  type B = { landed(c: unknown): boolean; onJobReply(j: Record<string, unknown>, r: unknown): void }
  const b = lift<B>(BM, ['landed', 'onJobReply'], {
    hostErr: () => null, mwBody: (r: unknown) => r,
    loadChain: () => { chains += 1 }, render: () => { renders += 1 }, endJob: () => { ended += 1 }, pollJob: () => {},
  })
  assert.equal(b.landed({ applied: true }), true)
  assert.equal(b.landed({ applied: false, reason: 'already applied' }), true)
  assert.equal(b.landed({ applied: false, reason: 'stale base' }), false)
  assert.equal(b.landed(null), false)
  const j: Record<string, unknown> = { task: 'draft_brief', onUpdate: () => {}, onEnd: () => {} }
  b.onJobReply(j, { api: 'napkin.middleware/1', job: { id: 'job_1', state: 'done' }, change: { applied: false, reason: 'already applied' } })
  assert.equal(j.applied, true, 'the job reads as landed, not as failed')
  assert.ok(chains >= 1 && renders >= 1, 'the chain is read again and the page redrawn')
  assert.equal(ended, 1)
})

test('a research job another poll applied first reads as applied and the chain is read again', () => {
  let chains = 0
  type R = { landed(c: unknown): boolean; jobFrom(j: Record<string, unknown>, r: unknown): void; afterApplied(j: Record<string, unknown>): void }
  const r = lift<R>(RT, ['landed', 'jobFrom', 'afterApplied'], {
    loadChain: () => { chains += 1 }, render: () => {}, ended: () => {},
  })
  const j: Record<string, unknown> = {}
  r.jobFrom(j, { job: { id: 'job_2', state: 'done' }, change: { applied: false, reason: 'already applied' } })
  assert.equal(j.applied, true)
  r.afterApplied(j)
  assert.equal(chains, 1)
})

test('a new version re-reads the brief’s lock view with its chain, so the lock never says Ready over open needs', () => {
  let reloads = 0
  const CHAIN = { state: 'ok', decisions: [{ id: 'd_1' }] }
  type C = { chainMoved(): boolean }
  const c = lift<C>(BM, ['chainSig', 'chainMoved'], {
    CHAIN, CHAIN_SIG: null, arr, OSF: () => ({ reload: () => { reloads += 1 } }),
  })
  assert.equal(c.chainMoved(), false, 'the first read is the page opening: the view is already being read')
  assert.equal(c.chainMoved(), false, 'the same chain again')
  CHAIN.decisions = [{ id: 'd_2' }, { id: 'd_1' }]
  assert.equal(c.chainMoved(), true, 'a job landed')
  assert.equal(reloads, 1)
  assert.equal(c.chainMoved(), false)
  assert.equal(reloads, 1)
})

test('the lock carries no count badge of its own: Decisions holds the one count, the lock says why in words', () => {
  for (const src of [BM, RT]) assert.doesNotMatch(src, /class="n"/, 'no badge on a lock button')
  const w = lift<{ lockWhy(n: number): string }>(BM, ['lockWhy'], {})
  assert.equal(w.lockWhy(2), 'Settle 2 first')
  assert.equal(w.lockWhy(1), 'Settle 1 first')
  assert.doesNotMatch(fn(BM, 'renderLockBtn'), /need you|lb\.innerHTML/)
})

test('a list printed in one line loses each item’s closing stop before the join', () => {
  const g = lift<{ gridText(v: unknown): string }>(BM, ['gridText'], {})
  assert.equal(g.gridText(['Launch in the UK this spring.', 'Reach 3% share.']), 'Launch in the UK this spring; Reach 3% share.')
})

test('the reopen help names the client review button as the OS bar reads it now', () => {
  const view = { v: null as unknown }
  const f = lift<{ clientReviewLabel(): string }>(BM, ['clientReviewLabel'], { osView: () => view.v })
  assert.equal(f.clientReviewLabel(), 'Client review')
  view.v = { client: { answer: { current: true } } }
  assert.equal(f.clientReviewLabel(), 'New client answer')
  assert.match(fn(BM, 'renderReopen'), /clientReviewLabel\(\)/)
})

test('taking a point out with no reason says “Add a reason” at the box, not in a toast', () => {
  const src = fn(RT, 'onCheck')
  assert.doesNotMatch(src, /toast\('Say what/)
  assert.match(src, /ui\.err=true/)
  assert.match(RT, /Add a reason: say what’s wrong with it/)
})

// ── B4: what people read carries no keys or ids ────────────────────────────

test('the Review agent’s words lose their ids; a finding is named by what it says', () => {
  const F = { fi_DSEQGHSPHSY6: { statement: 'Christmas is the busiest period for cider' } }
  const b = lift<{ noIds(s: string): string }>(BM, ['noIds'], { get: (k: string) => (k === 'projection' ? { findings: F } : undefined) })
  assert.equal(b.noIds('below 1.2% ABV (f_RPH5UFCVDCUV). At 0.5% (f_TKL7YLB7DEEQ, f_VLB4EBQYKK4T) it is.'), 'below 1.2% ABV. At 0.5% it is.')
  assert.equal(b.noIds('Objective cites finding fi_DSEQGHSPHSY6.'), 'Objective cites the finding “Christmas is the busiest period for cider”.')
  assert.equal(b.noIds('A person verified: fi_UNKNOWN99'), 'A person verified: a finding')
  const r = lift<{ noIds(s: string): string }>(RT, ['noIds'], { fnds: () => ({}) })
  assert.equal(r.noIds('Rests on Christmas (f_64) and spring (fi_1).'), 'Rests on Christmas and spring.')
  assert.doesNotMatch(r.noIds('cites finding fi_ABCDEF12'), /fi_/)
})

test('a pin reads by its key in words, never the key itself, and the report header carries no campaign id', () => {
  const r = lift<{ pinLabel(p: unknown): string }>(RT, ['pinLabel'], { MARKET: { GB: 'Great Britain' } })
  assert.equal(r.pinLabel({ key: 'rhythm.key_moment.christmas_the_busiest', unit: 'text', market: 'GB' }), 'Key moment · Great Britain')
  assert.equal(r.pinLabel({ key: 'regulation.mandatory_copy', unit: 'text', market: 'GB' }), 'Mandatory copy · Great Britain')
  assert.equal(r.pinLabel({ key: 'consumer.penetration_young_adults', unit: 'proportion' }), 'Penetration young adults')
  assert.doesNotMatch(fn(RT, 'pinChip'), /esc\(p\.key\)/)
  assert.doesNotMatch(RT, /c\.id\?' · '\+esc\(c\.id\.value\)/)
})

test('a sign-in id reads as the person’s name on a source card', () => {
  const f = lift<{ nameOfId(n: string): string }>(CLF, ['nameOfId'], {})
  assert.equal(f.nameOfId('sam@wk'), 'Sam')
  assert.equal(f.nameOfId('ann.lee@napkin'), 'Ann Lee')
  assert.equal(f.nameOfId('ana-maria'), 'ana maria')
})

test('the brief opens with ruled form rows: Client, Project, Budget & scope, parts like any other, no Version, no card', () => {
  const css = (sel: string) => { const m = BM.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, `a rule for ${sel}`); return m![1] }
  // A ruled row: the label in a ~92px margin, the value across the page; a hairline of ink between rows,
  // and no card (no radius, fill or shadow).
  const row = css('.sheet.a4 .pgrid > .row.k-cell')
  assert.match(row, /display:grid;grid-template-columns:minmax\(60px,92px\) minmax\(0,1fr\)/)
  assert.match(row, /border-top:1px solid var\(--line\)/)
  assert.match(row, /border-radius:0;background-color:transparent;box-shadow:none/)
  assert.match(css('.sheet.a4 .pgrid > .row.k-cell > .lab'), /grid-column:1/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.k-cell > \.val,\.sheet\.a4 \.pgrid > \.row\.k-cell > \.edit\{grid-column:2\}/)
  // The label in the sheet's mono label style, free to wrap; the value in the body type (no bold cell type).
  assert.match(css('.sheet.a4 .pgrid > .row.k-cell .lab > span:first-child'), /var\(--font-mono\).*white-space:normal/)
  assert.doesNotMatch(BM, /\.row\.k-cell \.val\{font-weight:600/)
  // Selected: a highlighter's wash on the value and the ink tick, not the accent's rounded card.
  assert.match(css('.sheet.a4 .pgrid > .row.k-cell.sel,.sheet.a4.frame-boxed .pgrid > .row.k-cell.sel'), /background-color:transparent;box-shadow:inset 2px 0 0 var\(--b-text\)/)
  assert.match(css('.sheet.a4 .pgrid > .row.k-cell.sel > .val'), /background:color-mix\(in srgb,var\(--clf-hl,var\(--rs-hl,#F6E36B\)\) 45%,transparent\)/)
  // Empty: "not given", muted italic.
  assert.match(fn(BM, 'fieldRow'), /isMeta\(f\.key\)\?'not given'/, 'an empty header row says “not given”')
  assert.match(fn(BM, 'sheetCells'), /isMeta\(f\.key\)\?'not given'/, 'in print too')
  assert.match(css('.sheet.a4 .pgrid > .row.k-cell .val.empty'), /font-style:italic;font-weight:400;color:var\(--b-muted\)/)
  // The header's parts are drawn as cells wherever the layout puts them.
  assert.match(fn(BM, 'kindOf'), /\(f\.key==='project_name'\|\|f\.key==='client'\|\|f\.key==='budget_and_scope'\)\?'cell'/)
})

test('the header’s rows move and resize like every other part; the version is the side tab’s, not the sheet’s', () => {
  // No 2×2 packing and no fixed meta row: the sheet is the layout's grid, on screen and in print.
  for (const gone of ['function packSheet', 'function metaLong', 'META_SHORT', 'meta-version', 'versionLine', 'p.meta', "<span>Version</span>"]) assert.ok(!BM.includes(gone), `${gone} is gone`)
  // The grip, the right edge, and Place on page (Show as, Tone, up and down) are on every part.
  assert.match(fn(BM, 'placeRow'), /if\(!docLocked\(\)\)\{\s*var g=document\.createElement\('button'\); g\.type='button'; g\.className='grip'/)
  assert.match(fn(BM, 'renderSelPart'), /\+=\(!docLocked\(\)\?'<div class="sp-l"/)
  assert.doesNotMatch(fn(BM, 'layoutStep'), /isMeta|meta\(/)
  // A moved or resized header part is saved in layout.parts like the others and read back in place.
  const L = lay()
  const moved = L.layoutResize(L.layoutJoin(L.layoutOrder(BM_FIELDS, undefined), 'budget_and_scope', 'tone_and_world', true), 'client', 6)
  const back = L.layoutOrder(BM_FIELDS, L.layoutParts(moved), true)
  assert.deepEqual(keysOf(back), keysOf(moved))
  assert.equal(back.find(x => x.key === 'client')!.w, 6)
  const k = keysOf(back)
  assert.equal(k.indexOf('budget_and_scope'), k.indexOf('tone_and_world') + 1)
  // The version reads in the side tab's state line: "v1 · edited …", or "v2 · locked by …".
  assert.match(fn(BM, 'renderStateLine'), /var v=docVersion\(\)/)
  assert.match(fn(BM, 'renderStateLine'), /\[v, 'locked by '\+who/)
  assert.match(fn(BM, 'renderStateLine'), /\[v, w\?'edited '\+agoWords\(w\):''\]/)
  // The title line (the document's header, not a part) keeps the version.
  assert.match(fn(BM, 'sheetCtx'), /meta:\[clientName\(\), docVersion\(\), fmtDay\(lastWhen\(\)\)\]/)
})

test('a header row shows its whole text, never truncated (owner, 2026-11-10); the panel and print keep every word', () => {
  // A ruled header row spans the page, so a long value simply wraps: no line clamp, no ellipsis, on screen or in print.
  assert.equal((BM.match(/k-cell[^{}]*\{[^}]*line-clamp/g) || []).length, 0, 'no clamp on a header row')
  assert.doesNotMatch(BM, /k-cell[^{}]*\{[^}]*text-overflow:ellipsis/, 'no ellipsis on a header row')
  // The whole text sits on the sheet; the row's tooltip keeps it too.
  assert.match(fn(BM, 'fieldRow'), /isMeta\(f\.key\)\?' title="'\+esc\(String\(v\)\)/)
  // The sheet shows the whole text, so the panel never repeats it (owner, 2026-11-11).
  assert.doesNotMatch(fn(BM, 'renderSelPart'), /sp-full/)
  // Print draws the same ruled rows from the same parts (kindOf), with every word and no Version row.
  assert.match(fn(BM, 'sheetCells'), /'<div class="row k-'\+kd\+toneClass\(c\.tone\)/)
  assert.match(fn(BM, 'sheetCells'), /kd=kindOf\(f, c\.as\)/)
  assert.doesNotMatch(fn(BM, 'sheetCells'), /c\.version/)
  // The client copy leaves a confidential header part out like any other.
  assert.match(fn(BM, 'sheetItems'), /copy==='client'\?layoutWithout\(items, confList\(\)\):items/)
})

// ── Show as and Tone: how a part looks (owner, 2026-11-10) ──────────────────

const AS = ['prose', 'bullets', 'callout', 'statement', 'cell'], TN = ['plain', 'tint', 'inverse']
type Look = { kindOf(f: object, as?: string): string; toneClass(t?: string): string; sentencesOf(v: unknown): string[] }
const look = () => lift<Look>(BM, ['kindOf', 'toneClass', 'sentencesOf'], { AS_KINDS: AS })
type FieldDef = { key: string; sec: string; label: string; type?: string; hero?: boolean }
const BM_DEFS = BM_FIELDS as unknown as FieldDef[]
const fdef = (k: string) => BM_DEFS.find(f => f.key === k)!

test('kindOf keeps each part’s default, and a stored Show as overrides it', () => {
  const L = look()
  assert.equal(L.kindOf(fdef('single_minded_proposition')), 'statement')
  assert.equal(L.kindOf(fdef('insight')), 'callout')
  for (const k of ['client', 'project_name', 'budget_and_scope']) assert.equal(L.kindOf(fdef(k)), 'cell')
  assert.equal(L.kindOf(fdef('background')), 'prose')
  // A stored `as` wins, for any part, header rows included; an unknown one is ignored.
  assert.equal(L.kindOf(fdef('background'), 'bullets'), 'bullets')
  assert.equal(L.kindOf(fdef('single_minded_proposition'), 'prose'), 'prose')
  assert.equal(L.kindOf(fdef('client'), 'statement'), 'statement')
  assert.equal(L.kindOf(fdef('background'), 'cell'), 'cell')
  assert.equal(L.kindOf(fdef('insight'), 'poster'), 'callout')
  // Tone is a class: tint and inverse only.
  assert.equal(L.toneClass('tint'), ' tone-tint')
  assert.equal(L.toneClass('inverse'), ' tone-inverse')
  assert.equal(L.toneClass('plain'), '')
  assert.equal(L.toneClass(undefined), '')
  // Bullets are the part's sentences; a list keeps its own lines.
  assert.deepEqual(L.sentencesOf('Sales fell 4%. Young people stopped coming! Why? “Nobody asked.” e.g. lunch.'), ['Sales fell 4%.', 'Young people stopped coming!', 'Why?', '“Nobody asked.” e.g. lunch.'])
  assert.deepEqual(L.sentencesOf('one line\nanother'), ['one line', 'another'])
  assert.deepEqual(L.sentencesOf(['a. b.', 'c']), ['a. b.', 'c'])
})

test('Show as and Tone are saved in layout.parts beside the place, and read back', () => {
  const L = lay()
  const items = L.layoutOrder(BM_FIELDS, undefined)
  const shown = L.layoutLook(L.layoutLook(items, 'background', 'as', 'bullets'), 'background', 'tone', 'inverse')
  const parts = L.layoutParts(shown)
  assert.equal(parts.background.as, 'bullets')
  assert.equal(parts.background.tone, 'inverse')
  assert.equal(parts.background.w, 6, 'its width is kept')
  assert.ok(!('as' in parts.barrier) && !('tone' in parts.barrier), 'a part with no look writes none')
  const back = L.layoutOrder(BM_FIELDS, parts, true)
  const bg = back.find(x => x.key === 'background')!
  assert.deepEqual([bg.as, bg.tone], ['bullets', 'inverse'])
  // Moving and resizing keep the look; an unknown value or property changes nothing.
  const moved = L.layoutResize(L.layoutStep(back, 'background', 1), 'background', 12)
  const m = moved.find(x => x.key === 'background')!
  assert.deepEqual([m.as, m.tone, m.w], ['bullets', 'inverse', 12])
  assert.deepEqual(L.layoutLook(items, 'background', 'as', 'poster'), items)
  assert.deepEqual(L.layoutLook(items, 'background', 'w', '3'), items)
  // A stored look that is not one of the schema's values is not read.
  const odd = L.layoutOrder(BM_FIELDS, { background: { w: 6, order: 3, as: 'poster', tone: 'neon' } }).find(x => x.key === 'background')!
  assert.ok(!('as' in odd) && !('tone' in odd))
  // The schema names both, with the same values.
  const schema = JSON.parse(page('brief-maker/schema.json')) as { properties: { layout: { properties: { parts: { additionalProperties: { properties: Record<string, { enum?: string[] }> } } } } } }
  const pp = schema.properties.layout.properties.parts.additionalProperties.properties
  assert.deepEqual(pp.as.enum, AS)
  assert.deepEqual(pp.tone.enum, TN)
})

test('the panel’s Show as and Tone save through saveLayout with a decision that says what changed', () => {
  const calls: unknown[][] = []
  const L = lay()
  const S = lift<{ saveLayout(items: Item[], what: string): void; lookWhat(f: object, prop: string, v: string): string }>(BM, ['saveLayout', 'lookWhat', 'partLabel'],
    { layoutData: () => ({ frame: 'boxed' }), layoutParts: L.layoutParts, patch: (...a: unknown[]) => { calls.push(a) },
      AS_WORDS: { prose: 'Prose', bullets: 'Bullets', callout: 'Callout', statement: 'Statement', cell: 'Field' } })
  const items = L.layoutOrder(BM_FIELDS, undefined)
  S.saveLayout(L.layoutLook(items, 'background', 'as', 'bullets'), S.lookWhat(fdef('background'), 'as', 'bullets'))
  S.saveLayout(L.layoutLook(items, 'insight', 'tone', 'tint'), S.lookWhat(fdef('insight'), 'tone', 'tint'))
  S.saveLayout(L.layoutLook(items, 'client', 'as', 'cell'), S.lookWhat(fdef('client'), 'as', 'cell'))
  const [k, v, o] = calls[0] as [string, { frame: string; parts: Record<string, { as?: string }> }, { action: string; actor: string }]
  assert.equal(k, 'layout')
  assert.equal(v.frame, 'boxed', 'the rest of the layout is kept')
  assert.equal(v.parts.background.as, 'bullets')
  assert.deepEqual([o.action, o.actor], ['show Background as bullets', 'human'])
  assert.equal((calls[1] as [string, unknown, { action: string }])[2].action, 'show Insight in the tint tone')
  assert.equal((calls[2] as [string, unknown, { action: string }])[2].action, 'show Client / brand as field')
  // The panel: Show as and Tone in Place on page (no Width presets), as dropdowns on one row, set to the current value.
  const sp = fn(BM, 'renderSelPart')
  assert.ok(!sp.includes('aria-label="Width"') && sp.indexOf('aria-label="Show as"') < sp.indexOf('aria-label="Tone"'))
  assert.ok(sp.indexOf('aria-label="Tone"') < sp.indexOf('data-sp="up"'), 'before Move up and down')
  assert.match(sp, /AS_KINDS\.map\(function\(k\)\{ return '<option value="'\+k\+'"'\+\(kd===k\?' selected':''\)\+'>'\+AS_WORDS\[k\]/)
  assert.match(sp, /TONES\.map\(function\(t\)\{ return '<option value="'\+t\+'"'\+\(tone===t\?' selected':''\)\+'>'/)
  assert.match(sp, /saveLayout\(layoutLook\(layoutItems\(\), f\.key, 'as', k\), lookWhat\(f, 'as', k\)\)/)
  assert.match(sp, /saveLayout\(layoutLook\(layoutItems\(\), f\.key, 'tone', t\), lookWhat\(f, 'tone', t\)\)/)
  assert.match(obj(BM, 'AS_WORDS'), /cell:'Field'/)
  // Locked: Place on page, with them, is not offered.
  assert.match(sp, /\+=\(!docLocked\(\)\?'<div class="sp-l"/)
  // The sheet on screen draws the stored kind and tone.
  assert.match(fn(BM, 'fieldRow'), /kd=kindOf\(f, lk\.as\)/)
  assert.match(fn(BM, 'fieldRow'), /row\.className='row k-'\+kd\+toneClass\(lk\.tone\)/)
})

type SC = { sheetCells(cells: Cell[], ctx: object, rows: number[] | null): string }
const sheetCellsOf = () => lift<SC>(BM, ['sheetCells', 'kindOf', 'toneClass', 'sentencesOf', 'boxGaps', 'exportMarkHtml'],
  { AS_KINDS: AS, GRID_COLS: 12, arr, esc, hasVal: (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && !v.length), isMeta: (k: string) => ['client', 'project_name', 'budget_and_scope'].includes(k), headOf: (f: FieldDef) => f.label })

test('print draws every kind and tone: prose, bullets, callout, statement, field; tint and inverse; Confidential kept', () => {
  const vals: Record<string, unknown> = { background: 'Sales fell. Teens left.', insight: 'Summer is shared.', single_minded_proposition: 'Two spoons.', client: 'McDonald’s Ireland', mandatories: ['Logo', 'Legal line'], barrier: 'Price.' }
  const L = lay()
  let items = L.layoutOrder(BM_FIELDS, undefined)
  items = L.layoutLook(items, 'background', 'as', 'bullets')
  items = L.layoutLook(items, 'insight', 'tone', 'tint')
  items = L.layoutLook(items, 'single_minded_proposition', 'tone', 'inverse')
  items = L.layoutLook(items, 'barrier', 'as', 'cell')
  items = L.layoutLook(items, 'mandatories', 'as', 'callout')
  const cells = L.layoutPack(items)
  const ctx = { get: (k: string) => vals[k], fieldOf: fdef, conf: ['single_minded_proposition'], cells, look: {} }
  const h = sheetCellsOf().sheetCells(cells, ctx, null)
  const row = (k: string) => { const at = h.indexOf(`<span>${fdef(k).label}</span>`); assert.ok(at > 0, k); return h.slice(h.lastIndexOf('<div class="row', at), h.indexOf('</div></div>', at)) }
  assert.match(row('background'), /^<div class="row k-bullets[ "]/)
  assert.match(row('background'), /<ul><li>Sales fell\.<\/li><li>Teens left\.<\/li><\/ul>/)
  assert.match(row('insight'), /^<div class="row k-callout tone-tint"/)
  assert.match(row('single_minded_proposition'), /^<div class="row k-statement tone-inverse conf"/, 'a confidential part keeps its tag in the agency copy')
  assert.match(row('single_minded_proposition'), /class="val spp"/)
  assert.match(row('client'), /^<div class="row k-cell/)
  assert.match(row('barrier'), /^<div class="row k-cell/)
  assert.match(row('mandatories'), /^<div class="row k-callout[ "]/)
  assert.match(row('mandatories'), /<p>Logo<\/p><p>Legal line<\/p>/, 'a list shown as a callout: a line per item')
  assert.match(row('audience'), /^<div class="row k-prose[ "]/)
  // The hero shown as prose loses the statement's look.
  const plain = L.layoutPack(L.layoutLook(L.layoutOrder(BM_FIELDS, undefined), 'single_minded_proposition', 'as', 'prose'))
  assert.doesNotMatch(sheetCellsOf().sheetCells(plain, { ...ctx, cells: plain }, null), /spp/)
  // The page estimate is measured on these same cells (sheetMeasure of sheetDoc), and breakSig sees a look change.
  assert.match(fn(BM, 'breakSig'), /layoutItems\(\)/)
  // Each kind and tone has the mock's look on the sheet and in print (the page's own CSS prints).
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.k-callout \.val\{font:italic 400 21px\/1\.32 var\(--font-serif\);border-left:3\.5px solid var\(--brief-accent\)/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.k-statement \.val,\.sheet\.a4 \.val\.spp\{font:600 28px\/1\.16 var\(--font-serif\)/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.k-bullets \.val ul\{padding-left:18px;margin:0\}/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.tone-tint\{background-color:color-mix\(in srgb,var\(--brief-accent\) 9%,var\(--b-bg\)\)!important/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.tone-inverse\{background-color:var\(--b-text\)!important/)
  assert.match(BM, /\.sheet\.a4 \.pgrid > \.row\.tone-inverse > \*\{--b-text:var\(--b-bg\)/)
})

test('Boxed is a ruled form: cells stretch to their row, neighbours share one 1px line, the frame closes on every row', () => {
  // Stretch, no gaps, and one opaque line per edge (inside top/left, 1px outside right/bottom, so neighbours overlap).
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.pgrid\{column-gap:0;row-gap:0;align-items:stretch/)
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.pgrid > \.row,\.sheet\.a4\.frame-boxed \.pgrid > \.row\.k-cell\{align-self:stretch;border:0!important/)
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.pgrid > \.row::after,\.sheet\.a4\.frame-boxed \.pgrid > \.rowfree::after\{content:"";position:absolute;top:0;left:0;right:-1px;bottom:-1px;border:1px solid var\(--frame-line\)/)
  // A row's free space is the row's (owner, 11 Nov): its frame closes around it, a dashed line where the last
  // part ends, so it never reads as an empty part.
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.pgrid > \.row\.endfree::after\{border-right-color:transparent\}/)
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.pgrid > \.rowfree::after\{border-left:1px dashed /)
  assert.match(BM, /\.sheet\.a4\.frame-boxed\{--frame-line:color-mix\(in srgb,var\(--b-text\) 70%,var\(--b-bg\)\)\}/, 'opaque, so an overlap never darkens')
  assert.doesNotMatch(BM, /frame-boxed \.pgrid\{[^}]*border:1px/, 'no frame on the grid as well as on the cells')
  assert.doesNotMatch(BM, /frame-boxed \.pgrid > \.row[^{]*\{[^}]*inset -1px -1px/, 'no half-drawn per-cell edges')
  // Every part is drawn at its stored width; a grid row that ends short of the edge closes with its free
  // space over the rest, on screen and in print (stretching the last part hid a resize: "it snaps back").
  const L = lay()
  const items = L.layoutResize(L.layoutOrder(BM_FIELDS, undefined), 'objection', 6)
  const cells = L.layoutPack(items)
  const gaps = L.boxGaps(cells)
  const byRow: Record<number, Cell[]> = {}
  cells.filter(c => c.key).forEach(c => { (byRow[c.row] ||= []).push(c) })
  for (const [r, cs] of Object.entries(byRow)) {
    const end = Math.max(...cs.map(c => c.col + c.w - 1)), g = gaps.filter(x => x.row === +r)
    if (end === 12) assert.equal(g.length, 0, `row ${r} is full`)
    else assert.deepEqual(g, [{ row: +r, col: end + 1, w: 12 - end }], `row ${r} closes with its free space`)
  }
  // A third and a half: the background's edge gives the barrier eight, the barrier's free edge takes it
  // back to six; the half keeps its six columns and two free columns close the row.
  const odd = L.layoutPack(L.layoutResize(L.layoutResize(L.layoutOrder(BM_FIELDS, undefined), 'background', 4), 'barrier', 6))
  const bar = odd.find(c => c.key === 'barrier')!
  assert.deepEqual(L.boxGaps(odd).filter(g => g.row === bar.row), [{ row: bar.row, col: 11, w: 2 }])
  const boxed = sheetCellsOf().sheetCells(odd, { get: () => 'x', fieldOf: fdef, conf: [], cells: odd, look: { frame: 'boxed' } }, null)
  assert.match(boxed, /<span>The barrier<\/span>/)
  assert.ok(boxed.includes(`grid-column:${bar.col} / span 6;`), 'print draws the stored width')
  assert.ok(boxed.includes(`<div class="rowfree" aria-hidden="true" data-r="${bar.row}" style="grid-column:11 / span 2;`), 'print closes the row with its free space')
  assert.match(boxed, new RegExp(`<div class="row k-[^"]* endfree[^"]*" data-r="${bar.row}" style="grid-column:${bar.col} / span 6;`), 'the last part says the free space follows it')
  const open = sheetCellsOf().sheetCells(odd, { get: () => 'x', fieldOf: fdef, conf: [], cells: odd, look: {} }, null)
  assert.ok(open.includes(`grid-column:${bar.col} / span 6;`), 'the open frame keeps the stored width')
  assert.doesNotMatch(open, /rowfree|endfree/, 'the open frame has no boxes to close in print')
  // On screen: the same free space in both frames (in Open it is where a dragged part joins the row), and
  // no width but the stored one (placeRow's).
  const rs = fn(BM, 'renderStructured')
  assert.match(rs, /gaps=boxGaps\(packed\)/)
  assert.match(rs, /b\.className='rowfree'/)
  assert.match(rs, /if\(ends\[p\.row\]===p\.col\+p\.w-1\) row\.classList\.add\('endfree'\)/)
  assert.doesNotMatch(rs, /row\.style\.gridColumn=/, 'nothing overrides a part’s width after placeRow')
  // The page estimate: a hidden heading has no box, so it is measured where the last row ended, never at
  // the viewport's top (with the page scrolled, that pushed every heading a scroll's height down the sheet
  // and broke the pages early).
  assert.match(fn(BM, 'sheetMeasure'), /b=el\.getClientRects\(\)\.length\?el\.getBoundingClientRect\(\):\{top:last, bottom:last\}/)
})

test('a resize holds: saved, read back and packed again at the new width, the header’s rows and every Show as kind alike', () => {
  const L = lay()
  // The owner's First Round: Client at nine columns, alone on its row (it used to draw at twelve in Boxed).
  let stored = L.layoutParts(L.layoutResize(L.layoutOrder(BM_FIELDS, undefined), 'client', 9))
  const read = (p: unknown) => L.layoutOrder(BM_FIELDS, p, true)
  const kinds = ['prose', 'bullets', 'callout', 'statement', 'cell']
  const keys = ['client', 'project_name', 'budget_and_scope', 'job', 'background', 'barrier', 'insight', 'single_minded_proposition', 'objectives.behavioural']
  keys.forEach((k, i) => {
    // Show as first (any kind), then a resize: the write carries both, and a re-render reads both back.
    let items = L.layoutLook(read(stored), k, 'as', kinds[i % kinds.length])
    items = L.layoutResize(items, k, 5)
    stored = JSON.parse(JSON.stringify(L.layoutParts(items)))   // what patch-data writes, as the document returns it
    const back = read(stored).find(x => x.key === k)!
    assert.deepEqual([back.w, back.as], [5, kinds[i % kinds.length]], k)
    const cell = L.layoutPack(read(stored)).find(c => c.key === k)!
    assert.equal(cell.w, 5, `${k} is drawn at five columns`)
    // In Boxed, the part's own cell is never widened: the rest of its row is free space, not the part.
    const cells = L.layoutPack(read(stored))
    for (const g of L.boxGaps(cells)) assert.ok(!(g.row === cell.row && g.col <= cell.col + cell.w - 1 && g.col + g.w - 1 >= cell.col), `${k}: no box over the part`)
  })
  // The write stays inside the schema every brief carries (documents made before Show as included):
  // layout.parts entries allow extra keys, and col/row/w/h/order are integers in range.
  for (const p of Object.values(stored)) {
    for (const n of ['col', 'row', 'w', 'h', 'order'] as const) assert.ok(Number.isInteger(p[n]), n)
    assert.ok(p.col >= 1 && p.col <= 12 && p.w >= 1 && p.w <= 12 && p.row >= 1 && p.h >= 1 && p.order >= 0)
  }
})

test('a part moves in both frames: onto a part, into a row’s free space, between rows, by the panel and the keyboard; it holds on reload', () => {
  const L = lay()
  // The owner's First Round: Client at six columns, the rest of its row free.
  const stored = L.layoutParts(L.layoutResize(L.layoutOrder(BM_FIELDS, undefined), 'client', 6))
  const items = L.layoutOrder(BM_FIELDS, stored, true)
  const cellOf = (xs: Item[], k: string) => L.layoutPack(xs).find(c => c.key === k)!
  // Dropped into the free space beside Client (after its last part), Project joins the row and the row fits.
  const beside = L.layoutJoin(items, 'project_name', 'client', true)
  const c = cellOf(beside, 'client'), p = cellOf(beside, 'project_name')
  assert.deepEqual([p.row, p.col, p.w], [c.row, 7, 6], 'beside Client, six columns')
  // It holds: written, read back, packed again.
  const back = reload(L, beside)
  assert.deepEqual([cellOf(back, 'project_name').row, cellOf(back, 'project_name').w], [cellOf(back, 'client').row, 6])
  // A part that fits the free space keeps its width.
  const narrow = L.layoutResize(items, 'project_name', 4)
  assert.equal(cellOf(L.layoutJoin(narrow, 'project_name', 'client', true), 'project_name').w, 4)
  assert.equal(cellOf(L.layoutJoin(narrow, 'project_name', 'client', true), 'client').w, 6)
  // Onto a full row: the parts shrink to fit, and both stay.
  const full = L.layoutResize(items, 'client', 12)
  const fitted = L.layoutJoin(full, 'project_name', 'client', true)
  assert.equal(cellOf(fitted, 'project_name').row, cellOf(fitted, 'client').row)
  assert.equal(cellOf(fitted, 'project_name').w + cellOf(fitted, 'client').w, 12)
  // Onto a part of another section: a row of its own, its width kept.
  assert.equal(L.layoutJoin(items, 'job', 'client', true).find(x => x.key === 'job')!.w, 12)
  assert.deepEqual(rowWith(L, L.layoutJoin(items, 'background', 'client', true), 'background'), ['background:6'])
  // Move up / Move down: read back the same.
  const up = L.layoutStep(items, 'project_name', -1)
  assert.deepEqual(keysOf(reload(L, up)).slice(0, 2), ['project_name', 'client'])
  // The drag: the free space of a row joins it after its last part; a part's top or bottom edge, or the
  // space between rows, makes a row of its own; its left or right half joins before or after it.
  const da = fn(BM, 'dropAt')
  assert.match(da, /free=el&&el\.closest\?el\.closest\('#fields \.rowfree'\):null/)
  assert.match(da, /return \{row:line\[line\.length-1\], kind:'join', after:true, free:free\};/)
  assert.match(da, /if\(y<b\.top\+band\|\|y>b\.bottom-band\)\{/)
  assert.match(da, /return \{row:r, kind:'join', after:x>b\.left\+b\.width\/2\};/)
  assert.match(da, /if\(near\)\{ b=near\.getBoundingClientRect\(\); return \{row:near, kind:'row', after:y>b\.bottom\}; \}/)
  const sd = fn(BM, 'startDrag')
  assert.match(sd, /drop=dropAt\(ev\.clientX, ev\.clientY, row\);/)
  assert.match(sd, /next=drop\.kind==='row'\?layoutNewRow\(items, f\.key, t\.key, drop\.after\):layoutJoin\(items, f\.key, t\.key, drop\.after\);/)
  assert.match(sd, /saveLayout\(next, moveWhat\(next, f\)\);/)
  // The decision says where it went: "move The barrier beside Where we are", "… to a row of its own".
  const W = lift<{ moveWhat(items: Item[], f: object): string; resizeWhat(items: Item[], f: object, w: number): string }>(BM, ['moveWhat', 'resizeWhat', 'layoutRows', 'layoutFlow', 'partCopy', 'withLook', 'rowAt'],
    { GRID_COLS: 12, ROW_MAX: 4, AS_KINDS: AS, TONES: TN, fieldOf: fdef, headOf: (f: FieldDef) => ({ background: 'Where we are', client: 'Client', project_name: 'Project' } as Record<string, string>)[f.key] ?? f.label })
  const d = L.layoutOrder(BM_FIELDS, undefined)
  assert.equal(W.moveWhat(L.layoutShift(d, 'barrier', -1), fdef('barrier')), 'move The barrier beside Where we are')
  assert.equal(W.moveWhat(L.layoutStep(d, 'barrier', -1), fdef('barrier')), 'move The barrier to a row of its own')
  assert.equal(W.resizeWhat(beside, fdef('client'), 9), 'widen Client, narrowing Project')
  assert.equal(W.resizeWhat(items, fdef('client'), 4), 'narrow Client')
  assert.match(fn(BM, 'startResize'), /if\(w!==p\.w\) saveLayout\(next, resizeWhat\(base, f, w\)\);/)
  // The grip is reached in both frames: above its neighbours in Boxed, in the margin in Open.
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.grip\{left:3px;z-index:3\}/)
  assert.match(BM, /\.sheet\.a4 \.grip\{left:-16px;/)
})

test('every part gets its move grip and width handle, whatever it is shown as, and they can be reached in Boxed', () => {
  const pr = fn(BM, 'placeRow')
  // placeRow draws both handles for every part (header rows and every kind), only a locked brief has none.
  assert.match(pr, /if\(!docLocked\(\)\)\{\s*var g=document\.createElement\('button'\); g\.type='button'; g\.className='grip';/)
  assert.match(pr, /r\.className='redge';/)
  assert.match(pr, /row\.appendChild\(g\); row\.appendChild\(r\);/)
  assert.doesNotMatch(pr, /kindOf|isMeta|k-cell/, 'no kind is left without handles')
  // renderStructured places every packed part with placeRow, header rows included.
  assert.match(fn(BM, 'renderStructured'), /placeRow\(row,f,\{key:p\.key, col:p\.col, row:guideRow\(p\.row\), w:p\.w\}\)/)
  // A ruled cell's grid leaves the handles where they are.
  assert.match(BM, /\.row\.k-cell > :not\(\.lab\):not\(\.val\):not\(\.edit\):not\(\.grip\):not\(\.redge\)/)
  // Boxed has no gap between cells: the handles sit on the part's own edges, above the neighbour and the lines
  // (outside the box, the next cell covered the width handle, so only a row's last part could be sized).
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.grip\{left:3px;z-index:3\}/)
  assert.match(BM, /\.sheet\.a4\.frame-boxed \.redge\{right:-6px;width:12px;z-index:3\}/)
  // A part is sized by its edge only: Place on page has no Width presets (owner, 11 Nov).
  assert.doesNotMatch(fn(BM, 'renderSelPart'), /data-w=|WIDTHS/)
  // While a part is sized, its row redraws as the edge moves (the neighbour trades columns), its free space
  // steps aside and comes back after; let go unchanged, the row is put back as it was.
  const rz = fn(BM, 'startResize')
  assert.match(rz, /next=layoutResize\(base, f\.key, Math\.round\(\(ev\.clientX-left\+gap\)\/step\)\);/)
  assert.match(rz, /querySelectorAll\('\.rowfree'\)\.forEach\(function\(b\)\{ if\(b\.style\.gridRowStart===row\.style\.gridRowStart\) b\.hidden=true; \}\)/)
  assert.match(rz, /querySelectorAll\('\.rowfree\[hidden\]'\)\.forEach\(function\(b\)\{ b\.hidden=false; \}\)/)
  assert.match(rz, /else line\.forEach\(function\(c, n\)\{ c\.style\.gridColumn=was\[n\]; \}\);/)
})

test('a selected line of the report lights as the mock’s claim: the headline, a summary line and a paragraph alike, no grey block, no box', () => {
  // Hover and selection are a wash on the words themselves, line by line, with the 2px ink underline.
  assert.match(RT, /\.rep clan-field\.clf-ln:not\(\.rp-fs\)\{padding:1px 0;border-radius:3px\}/)
  assert.match(RT, /\.rep clan-field\.clf-ln:not\(\.rp-fs\):hover:not\(:has\(\.clf:hover,button:hover,a:hover\)\)\{background:color-mix\(in srgb,var\(--rs-hl\) 34%,transparent\);box-shadow:0 2px 0 #141413\}/)
  assert.match(RT, /\.rep clan-field\.clf-ln\.rsel-hit:not\(\.rp-fs\)\{background:color-mix\(in srgb,var\(--rs-hl\) 62%,transparent\)!important;box-shadow:0 2px 0 #141413;outline:0\}/)
  // The headline is a line like the others: no block of its own, no grey wash on it or its heading.
  assert.doesNotMatch(CLF, /clan-field\.clf-ln\[as="answer"\]\{display:block/)
  assert.doesNotMatch(RT, /\.headline:has\(> clan-field\.clf-ln|\.headline\.rsel-line\{/)
  const mark = fn(RT, 'markReport')
  // a pin's own chip is marked, never the cite chips inside a selected line
  assert.match(mark, /clan-field\[ref="'\+id\+'"\] > \.clf/)
  // a selected line takes no wash on its block or section
  assert.match(mark, /lf\.getAttribute\('data-ref'\)===id&&!lf\.classList\.contains\('rp-fs'\)\) return;[\s\S]*rsel-line/)
})

// ── every line is a field (owner, 2026-11-09) ──────────────────────────────

test('every line of a report or a list is a field: the answer, a line, a list item, a chart, a gap by its id', () => {
  const f = lift<{ kindOf(r: string): string | null }>(CLF, ['kindOf', 'isPath'], {
    PATH: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, gap: (id: string) => (id === 'g_gb_awareness' ? { id } : null),
  })
  assert.equal(f.kindOf('report.headline'), 'answer')
  assert.equal(f.kindOf('report.summary[2]'), 'line')
  assert.equal(f.kindOf('report.sections[s_market].blocks[0]'), 'line')
  assert.equal(f.kindOf('mandatories[0]'), 'item')
  assert.equal(f.kindOf('objectives.commercial[1]'), 'item')
  assert.equal(f.kindOf('chart:f_1,f_2'), 'chart')
  assert.equal(f.kindOf('g_gb_awareness'), 'gap')
  assert.equal(f.kindOf('insight'), 'path')
  // The report's own lines are named by their place, never as a list item; what the host writes is no field.
  assert.equal(f.kindOf('report[0]'), null)
  assert.equal(f.kindOf('projection.pins[0]'), null)
  assert.equal(f.kindOf('fi_1'), 'finding')
})

test('a line’s kind and certainty come from what it cites, never from a model', () => {
  type K = { kind: string; lv: number; fis: string[]; flag: boolean }
  const findings = {
    fi_a: { statement: 'A', status: 'verified', confidence: 'high', cites: ['f_1'] },
    fi_b: { statement: 'B', status: 'proposed', confidence: 'medium', cites: ['f_2'] },
    fi_c: { statement: 'C', status: 'rejected', cites: [] },
  }
  const pins = { f_1: { value: 0.68, confidence: 'high' }, f_2: { value: 0.234, confidence: 'medium' }, f_3: { value: 12, confidence: 'low' },
    f_t: { value: 'No ads where most viewers are under fifteen', unit: 'text', quotes: { src_a: 'no ads where most viewers are under fifteen years old' } }, f_c: { value: 'qsr.fast_food', unit: 'code', key: 'roster.categories.primary' } }
  const contests = [{ id: 'ct', status: 'resolved', chosen: 'f_2', values: [{ fact_id: 'f_2' }, { fact_id: 'f_9' }] }]
  const LV = new Function(`${obj(CLF, 'LV')} return LV;`)()
  const f = lift<{ lineKind(l: unknown): K }>(CLF, ['lineKind', 'numPin', 'codePin', 'quotesText', 'andList', 'findingLv', 'pinLv', 'lvOf', 'resolvedFor', 'excludedPin', 'fno', 'uniq'], {
    arr, obj: (v: unknown) => (isObj(v) ? v : {}), LV, findings: () => findings, pins: () => pins, contests: () => contests,
    normText: (t: unknown) => String(t ?? '').toLowerCase().replace(/[^a-z0-9%.]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim(),
    data: () => ({ selection: { excluded: [{ fact_id: 'f_3' }] } }),
    fmt: (p: { value: unknown }) => (typeof p.value !== 'number' ? String(p.value) : p.value < 1 ? `${Math.round(p.value * 1000) / 10}%` : String(p.value)),
  })
  const k = (text: string, cites: string[]) => f.lineKind({ text, cites })
  assert.deepEqual([k('Most stops are social.', ['fi_a', 'f_1']).kind, k('x', ['fi_a']).lv], ['Restates Finding 1', 3])
  // A figure is a numeric fact only (design: line kinds).
  assert.equal(k('68% of stops are unplanned.', ['f_1']).kind, 'Quotes a figure')
  assert.equal(k('Most stops are unplanned.', ['f_1']).kind, 'A figure, in our words')
  assert.equal(k('Delivery grew 23.4%.', ['f_2']).kind, 'A figure sources disagreed on')
  assert.equal(k('Teens take the bus after school.', ['f_t']).kind, 'A source’s point, in our words')
  assert.equal(k('The rule: no ads where most viewers are under fifteen years old, says the code.', ['f_t']).kind, 'Quotes a source')
  assert.equal(k('It is fast food.', ['f_c']).kind, 'From the client’s record')
  assert.equal(k('Big, and teens take the bus.', ['f_1', 'f_t']).kind, 'A figure and a source’s point')
  const inf = k('So it moves home.', ['fi_a', 'fi_b'])
  assert.deepEqual([inf.kind, inf.lv], ['Draws on Findings 1 and 2', 1])
  const none = k('Nobody says so.', [])
  assert.deepEqual([none.kind, none.lv], ['Our reading, nothing cited', 2])
  const thin = k('A ritual, maybe.', ['fi_b'])
  assert.deepEqual([thin.kind, thin.lv], ['From Finding 2 · proposed', 1])
  // A rejected finding or a figure marked wrong flags the line, and it is low.
  assert.deepEqual([k('x', ['fi_c']).flag, k('x', ['fi_c']).lv], [true, 1])
  assert.equal(k('12 of them.', ['f_3']).flag, true)
})

// ── checks in the side panel, not the report body (research-new-ui, the mock's needs-box) ──

/** The research's checks with a stand-in record: two proposed findings and an open contest. */
function checksEnv(o: { locked?: boolean; ui?: Record<string, unknown>; busy?: Record<string, boolean>; at?: string; excluded?: string[] } = {}) {
  const F: Record<string, { statement: string; status: string; cites: string[] }> = {
    fi_A: { statement: 'Treats are bought on impulse', status: 'proposed', cites: ['f_1', 'f_2'] },
    fi_B: { statement: 'Delivery is growing', status: 'verified', cites: ['f_3'] },
    fi_C: { statement: 'Sharing is the ritual', status: 'proposed', cites: ['f_3'] },
  }
  const ct = { id: 'ct_1', status: 'open', key: 'category/qsr.fast_food:market.size_value@IE', values: [{ fact_id: 'f_4', value: 0.23, unit: 'percent', from: 'x', sources: ['src_a'] }, { fact_id: 'f_5', value: 0.31, unit: 'percent', from: 'y', sources: ['src_b'] }] }
  const CHK = { ui: o.ui ?? {}, busy: o.busy ?? {}, at: o.at ?? '' }
  const env = {
    CHK, arr, esc, isObj, listJoin,
    slug: (s: string) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-'),
    fnds: () => F, sel: () => ({ contested: [ct] }), fview: () => ({ attention: [] }),
    refOfAddress: (a: string) => a, contestById: (id: string) => (id === 'ct_1' ? ct : null),
    pinSource: () => 'Mintel', excludedIds: () => Object.fromEntries((o.excluded ?? []).map(id => [id, {}])),
    srcRecs: () => ({}), fmtAny: (v: { value: number }) => `${Math.round(v.value * 100)}%`, fromName: (v: { from: string }) => (v.from === 'x' ? 'Kantar' : 'Mintel'),
    contestWhat: () => 'Market size', decidedBy: () => 'You', TheAgent: (r: string) => `The ${r.charAt(0).toUpperCase()}${r.slice(1)} agent`,
    window: { ClanFields: { locked: () => (o.locked ? { who: { you: true } } : null) } },
  }
  Object.assign(env, { ClanFields: env.window.ClanFields })
  type C = { checks(): { ref: string; kind: string; open: boolean }[]; yourCallHtml(all: unknown[], open: number, N: number): string; findingNeeds(ref: string): string | null; chkTag(c: unknown, shown: boolean): string }
  return { f: lift<C>(RT, ['checks', 'chkId', 'chkById', 'chkLocked', 'chkStatus', 'chkKindWord', 'chkTag', 'chkRests', 'chkGone', 'chkAnswers', 'chkQuestion', 'findingNeeds', 'yourCallHtml'], { ...env, CHK_WHY: ['It’s newer'] }), CHK }
}

test('the report carries no decision UI: a finding that needs a call reads in the flow, proposed, with a quiet tag', () => {
  // No card in the body any more: the old in-body buttons are gone.
  assert.doesNotMatch(RT, /function checkCard|Yes, keep it|No, take it out|rc-chk|yc-cut/)
  assert.match(fn(RT, 'rpFinding'), /'proposed', to=replacedBy\(id\)/, 'a proposed finding is tagged proposed, not "needs your call"')
  assert.match(RT, /\.rp-fp\.s-proposed\{border:1px dashed/, 'the mock’s dashed proposed outline')
  const { f } = checksEnv()
  const open = f.checks().filter(c => c.open)
  const tag = f.chkTag(open[0], true)
  assert.match(tag, /^<button type="button" class="rc-need" id="chk-fi_A" data-act="chk-sel" data-chk="chk-fi_A">Needs your call<\/button>$/)
  assert.match(f.chkTag(open.find(c => c.kind === 'contest'), true), />Two sources disagree · Needs your call</)
  // Settled: a quiet line beside it.
  assert.equal(f.chkTag(f.checks().find(c => c.ref === 'fi_B'), true), '<span class="rc-st" id="chk-fi_B" tabindex="-1">✓ You agreed</span>')
  // The stats row's "N need your call" selects the check in hand; the tags and the box's Finding n select too.
  assert.match(fn(RT, 'rpStats'), /class="rp-need" data-act="chk-go"/)
  assert.match(fn(RT, 'renderChecks'), /host\.appendChild\(box\)/, 'beside the finding, in its line')
})

test('Your call · N open holds the question, Keep and Cut, Next check and n of N checked', () => {
  const { f } = checksEnv()
  const all = f.checks(), open = all.filter(c => c.open).length
  const h = f.yourCallHtml(all, open, all.length)
  assert.match(h, /<div class="nb-h">Your call · 3 open<\/div>/)
  assert.match(h, /<p class="nb-t"><button type="button" class="nb-link" data-act="chk-sel" data-chk="chk-fi_A">Finding 1<\/button> rests on 2 facts from one source\. Keep it\?<\/p>/)
  assert.match(h, /<button type="button" class="pri" data-act="chk-yes" data-ref="fi_A" data-where="box">Keep<\/button><button type="button" data-act="chk-no" data-ref="fi_A" data-where="box">Cut<\/button>/)
  assert.match(h, /data-act="chk-next">Next check ↓<\/button>/)
  assert.match(h, /<b>1 of 4<\/b> checked/)
})

test('Cut asks what is wrong before taking it out, inline where it was pressed, with Keep it for now', () => {
  const { f } = checksEnv({ ui: { fi_A: { mode: 'no', why: '', where: 'box', err: true } } })
  const all = f.checks()
  const h = f.yourCallHtml(all, 3, 4)
  assert.match(h, /<label for="chkwhy-fi_A">What’s wrong with it\? The Synthesis agent will use this to fix it\.<\/label>/)
  assert.match(h, /aria-invalid="true"/)
  assert.match(h, /Add a reason: say what’s wrong with it, so it can be fixed\./)
  assert.match(h, /data-act="chk-reject" data-ref="fi_A" data-where="box">Take it out<\/button><button type="button" data-act="chk-cancel" data-ref="fi_A" data-where="box">Keep it for now<\/button>/)
  // The card asks the same, with its own field, and shows Keep and Cut while the box asks why.
  const card = f.findingNeeds('fi_A')!
  assert.match(card, /<b>Your call · 1 open<\/b><p>It rests on 2 facts from one source\. Keep it, or cut it\?<\/p>/)
  assert.match(card, /data-act="chk-yes" data-ref="fi_A" data-where="card">Keep</)
  assert.doesNotMatch(card, /chkwhy/)
  const c2 = checksEnv({ ui: { fi_A: { mode: 'no', why: 'old', where: 'card' } } }).f.findingNeeds('fi_A')!
  assert.match(c2, /<input type="text" id="chkwhyc-fi_A" data-ref="fi_A" value="old"/)
  assert.equal(f.findingNeeds('fi_B'), null, 'a finding agreed to needs no call')
  // Busy and error states.
  const busy = checksEnv({ busy: { fi_A: true }, ui: { fi_A: { where: 'box', fail: 'Not saved: the host refused' } } }).f
  const bh = busy.yourCallHtml(busy.checks(), 3, 4)
  assert.match(bh, /data-act="chk-yes" data-ref="fi_A" data-where="box" disabled>Saving…<\/button>/)
  assert.match(bh, /<p class="rc-err" role="alert">Not saved: the host refused<\/p>/)
})

test('the note on a fact marked wrong, a contest’s own answers, and a locked report with no answers', () => {
  const ex = checksEnv({ excluded: ['f_1'] }).f
  assert.match(ex.yourCallHtml(ex.checks(), 3, 4), /<p class="nb-note">It rests on a fact someone marked wrong\. If there is a new point/)
  const ct = checksEnv({ at: 'chk-ct_1' }).f
  const h = ct.yourCallHtml(ct.checks(), 3, 4)
  assert.match(h, /Market size<\/button>: two sources disagree\. Which should the report use\?/)
  assert.match(h, /<p class="nb-from">Kantar says 23%\. Mintel says 31%\.<\/p>/)
  assert.match(h, /data-act="chk-pick" data-ref="ct_1" data-fid="f_4" data-where="box"><span>23%<\/span><small>Kantar<\/small>/)
  const pick = checksEnv({ at: 'chk-ct_1', ui: { ct_1: { mode: 'pick', fid: 'f_5', where: 'box' } } }).f
  assert.match(pick.yourCallHtml(pick.checks(), 3, 4), /Why 31%\? Pick a reason, or say it\..*data-act="chk-reason".*Use 31%<\/button>.*>Back<\/button>/s)
  const lk = checksEnv({ locked: true }).f
  const lh = lk.yourCallHtml(lk.checks(), 3, 4)
  assert.doesNotMatch(lh, /data-act="chk-(yes|no|pick)"/, 'locked: no answers')
  assert.doesNotMatch(lk.findingNeeds('fi_A')!, /data-act="chk-/)
})

test('answering moves focus to the next check; the selected finding’s card is the same Your call', () => {
  const d = fn(RT, 'chkDecide')
  assert.match(d, /nx=chkAfter\(id0\)/)
  assert.match(d, /CHK\.at=nx; CHK\.picked=!!nx; renderChecks\(\); focusCall\(\);/)
  assert.match(fn(RT, 'focusCall'), /\.nb-ans button:not\(\[disabled\]\)/)
  assert.match(CLF, /var nh=f\.status==='proposed'&&NEEDS\?NEEDS\(id\):null;/)
  assert.match(CLF, /needsWith:function\(fn\)\{ NEEDS=typeof fn==='function'\?fn:null; \}/)
  assert.match(RT, /ClanFields\.needsWith\(findingNeeds\)/)
  const ord = lift<{ chkAfter(id: string): string }>(RT, ['chkAfter'], { chkOrder: () => ['a', 'b', 'c'] })
  assert.equal(ord.chkAfter('a'), 'b')
  assert.equal(ord.chkAfter('c'), 'a')
  assert.equal(lift<{ chkAfter(id: string): string }>(RT, ['chkAfter'], { chkOrder: () => ['a'] }).chkAfter('a'), '')
})

// ── gaps read in words ─────────────────────────────────────────────────────

test('a gap’s category or measure key reads in words, the same in the report, Not researched and the gap field', () => {
  const GT = { GAP_TLD: { com: 1, ie: 1, uk: 1, org: 1, net: 1, io: 1, gov: 1, eu: 1, co: 1, edu: 1, info: 1, html: 1, pdf: 1 } }
  const r = lift<{ gapWords(s: string): string }>(RT, ['entityWords', 'gapWords'], GT)
  const c = lift<{ gapWords(s: string): string }>(CLF, ['gapWords'], GT)
  for (const [raw, want] of [
    ['Size value for qsr.fast_food in Ireland', 'Size value for fast food in Ireland'],
    ['size value for category/qsr.fast_food in Ireland', 'Size value for fast food in Ireland'],
    ['market.size_value for brand/bulmers in Ireland', 'Size value for Bulmers in Ireland'],
  ]) {
    assert.equal(r.gapWords(raw), want)
    assert.equal(c.gapWords(raw).replace(/^[a-z]/, x => x.toUpperCase()), want)
  }
  assert.equal(r.gapWords('See mintel.com, e.g. the report.'), 'See mintel.com, e.g. the report.', 'a web address and e.g. stay')
  assert.match(fn(CLF, 'renderGap'), /gapWords\(g\.wanted\|\|g\.searched\|\|g\.key\|\|g\.id\)/)
  assert.match(fn(CLF, 'viewGap'), /what=gapWords\(/)
  assert.match(fn(RT, 'rpNotResearched'), /reason:gapWords\(/)
})

// ── the Synthesis agent ───────────────────────────────────────────────────

test('the research report is composed by the Synthesis agent; the brief stays the Brief agent’s', () => {
  const R = (rolesWindow() as { NapkinRoles: { of(x: string): string; name(r: string): string; ofDecision(d: unknown): string | null; forStage(a: string, s: string): string } }).NapkinRoles
  assert.equal(R.name('synthesis'), 'Synthesis agent')
  for (const a of ['compose_report', 'report', 'report.compose', 'synthesise_findings', 'synthesise_finding', 'synthesise']) assert.equal(R.of(a), 'synthesis', a)
  assert.equal(R.ofDecision({ agent: 'start_campaign', action: 'compose_report', kind: 'edit' }), 'synthesis')
  assert.equal(R.ofDecision({ agent: 'start_campaign', action: 'synthesise_finding', kind: 'finding' }), 'synthesis')
  assert.equal(R.ofDecision({ agent: 'start_campaign', action: 'propose_audience', kind: 'edit' }), 'strategy')
  assert.equal(R.forStage('research', 'synthesise'), 'synthesis')
  // The brief: drafted by the Brief agent; its own "synthesis" step is the Strategy agent planning.
  assert.equal(R.ofDecision({ agent: 'draft_brief', action: 'draft', kind: 'edit' }), 'brief')
  assert.equal(R.forStage('brief', 'draft'), 'brief')
  assert.equal(R.forStage('brief', 'context'), 'strategy')
  assert.match(BM, /var CREW_ROLE=\{extract:'knowledge', synthesis:'strategy', drafter:'brief', judge:'review'\};/)
  assert.match(BM, /AGENT_NAME\[k\]=ROLES\?ROLES\.name\(roleOf\(k\)\)/)
  // A ceramic sphere, which no research stage uses.
  const X = page('shared/agent-sphere/extra.js')
  assert.match(X, /MAT_OF\.Synthesis = 'ceramic'/)
  assert.match(X, /"name": "Synthesis"/)
})

// The run stage holds at any window (owner bug, 2026-11-11): asking, the caption over the card says who
// asks and the card has no second header; nothing in the score shrinks under the card; the rails stack
// under the score below 1100px, in the research and the brief alike.
test('the agent stage: the caption says who asks above the card, and the rails stack below 1100px', () => {
  const r = lift<{ stageAsks(k: string): string }>(RT, ['stageAsks'], { agentName: (k: string) => `${k[0].toUpperCase()}${k.slice(1)} agent` })
  assert.equal(r.stageAsks('strategy'), 'Strategy agent asks')
  assert.match(fn(RT, 'workHtml'), /var l1=liveQuestion\(\)\?stageAsks\(/)
  assert.doesNotMatch(RT, /Quick question before we go on/)
  const BM = page('brief-maker/index.html')
  const b = lift<{ stageAsks(k: string): string }>(BM, ['stageAsks'], { ROLES: { name: () => 'Brief agent' } })
  assert.equal(b.stageAsks('brief'), 'Brief agent asks')
  for (const [name, src, pre] of [['research', RT, '.rt-work '], ['brief', BM, '']] as const) {
    const p = pre.replace(/[.]/g, '\\.')
    assert.match(src, new RegExp(`${p}\\.sstage\\{grid-template-columns:minmax\\(0,310px\\) minmax\\(min\\(320px,100%\\),440px\\) minmax\\(0,310px\\)`), `${name}: the rails shrink to nothing before the stage overflows`)
    assert.match(src, new RegExp(`@media \\(max-width:1100px\\)\\{ ${p}\\.sstage\\{grid-template-columns:minmax\\(0,1fr\\) minmax\\(0,1fr\\);grid-template-areas:"s s" "l r"`), `${name}: below 1100px the rails stack under the score`)
    assert.match(src, new RegExp(`${p}(\\.sstage )?\\.score>\\*\\{flex:none\\}`), `${name}: nothing in the score shrinks, so the caption never runs under the card`)
    assert.match(src, new RegExp(`${p}\\.sstage\\.nk-asking\\{height:auto;min-height:clamp\\(`), `${name}: asking, the stage grows with the card`)
    assert.doesNotMatch(src, /@media \(max-width:980px\)\{ (\.rt-work )?\.sstage/, `${name}: the old one-column switch is gone`)
  }
})

// Confirming a part of the ask (owner, 2026-11-11): in the side panel, never a modal, in plain words,
// and the yes is written with the person's note.
test('research: Confirm opens in the side panel in plain words, and writes the value with the note', () => {
  assert.match(fn(RT, 'doConfirm'), /inspect\('ask:'\+k, false\)/)
  assert.doesNotMatch(fn(RT, 'doConfirm'), /openDialog/, 'no modal for confirm')
  const camp: Record<string, unknown> = { client_org: { origin: 'proposed', value: { name: 'Guinness', ref: 'org/guinness' }, fact_ids: ['f_1', 'f_2', 'f_3'], decision: 'd_X' } }
  const pins = { f_1: { key: 'roster.client_org', value: 'Guinness' }, f_2: { key: 'brand.owner', value: 'Diageo' }, f_3: { key: 'brand.name', value: 'Guinness' } }
  const writes: unknown[][] = []
  const els: Record<string, { value: string }> = { 'cf-note-client_org': { value: '  It is their brand  ' } }
  const env = {
    FIELD: { client_org: { k: 'client_org', label: 'Client', type: 'ref' } }, BANDS: {}, MARKET: {}, camp: () => camp, pins: () => pins, arr, isObj, esc, listJoin,
    clipT: (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t), plural: (n: number, w: string) => `${n} ${n === 1 ? w : w + 's'}`,
    pinLabel: (p: { key: string }) => p.key.split('.').pop(), fmtAny: (p: { value: string }) => p.value, verdictState: () => ({ unanswered: [] }),
    reportLocked: () => false, WHO: { shell: { id: 'tia@tbwa', name: 'Tia' } }, reviewer: () => '', human: (x: string) => x, renderValue: () => '',
    $: (id: string) => els[id] || null, byOf: () => 'tia@tbwa', setReviewer: () => {}, hasHost: () => true, mintDecisionId: () => 'd_NEW',
    renderSel: () => {}, toast: () => {}, loadChain: () => {}, VIEW: { sel: 'ask:client_org', trail: [] }, CONF: { ui: {} as Record<string, unknown> },
    window: { ClanFields: null, clan: { patchData: (...a: unknown[]) => { writes.push(a); return Promise.resolve({ ok: true }) } } },
  }
  const f = lift<{ confirmViewHtml(k: string): string; confirmWrite(k: string): void }>(RT, ['confirmViewHtml', 'confirmWrite', 'plainValue', 'askQuestion', 'codeText'], env)
  const h = f.confirmViewHtml('client_org')
  assert.match(h, /<h3 class="cf-q">Is the client Guinness\?<\/h3>/)
  assert.match(h, /We worked this out from 3 facts/)
  assert.equal((h.match(/class="cf-fact" data-pv="f_/g) || []).length, 3, 'the facts are tappable rows')
  assert.match(h, /Yes, that’s right/); assert.match(h, /Change it…/); assert.match(h, /Not now/)
  assert.match(h, /<details class="cf-note"><summary>Add a note<\/summary>/, 'the note stays folded')
  assert.doesNotMatch(h, /cf-who|Your name/, 'signed in, no name is asked: the check is the signed-in person’s')
  for (const bad of [/org\//, /#campaign/, /patch-data/i, /pinned/i, /\bpins?\b/, /inference/i, /[0-9a-f]{8}-[0-9a-f]{4}-/, /What will be written/])
    assert.doesNotMatch(h, bad, `no developer text: ${bad}`)
  f.confirmWrite('client_org')
  assert.equal(writes.length, 1)
  const [path, value, dec] = writes[0] as [string, Record<string, unknown>, Record<string, unknown>]
  assert.equal(path, 'campaign.client_org')
  assert.deepEqual([value.origin, value.confirmed_from, value.by, (value.value as { name: string }).name], ['confirmed', 'proposed', 'human:tia@tbwa', 'Guinness'])
  assert.deepEqual([dec.action, dec.pinned, dec.rationale], ['confirm', true, 'Confirmed the client: Guinness — It is their brand'])
  // With no shell (offline), a name is asked once: remembered, the next confirm does not ask again.
  const off = lift<{ confirmViewHtml(k: string): string }>(RT, ['confirmViewHtml', 'plainValue', 'askQuestion', 'codeText'], { ...env, WHO: { shell: null, ask: null }, reviewer: () => '' })
  assert.match(off.confirmViewHtml('client_org'), /class="cf-who"/)
  const known = lift<{ confirmViewHtml(k: string): string }>(RT, ['confirmViewHtml', 'plainValue', 'askQuestion', 'codeText'], { ...env, WHO: { shell: null, ask: null }, reviewer: () => 'Tia' })
  assert.doesNotMatch(known.confirmViewHtml('client_org'), /cf-who/)
})

test('research: nothing the person sees names an address, a code, patch-data or a contract id', () => {
  for (const bad of ['W1P-I5', 'W2-O2', 'W5-Z1', 'W2-A3', 'via patch-data', 'Heads up.', 'What will be written', 'class="addr"', "class=\"path\"", 'contract campaign-clan/1', 'this view writes nothing', "preview('Request'"])
    assert.ok(!RT.includes(bad), bad)
  assert.doesNotMatch(fn(RT, 'renderValue'), /esc\(v&&v\.ref\)|esc\(x\.ref\)|sha256/, 'no entity code or hash beside a value')
})

// The side panel's job block is one shared helper (owner, 2026-11-11): the brief and the research draw the
// working agent the same, as the panel's own top section, from the agent-sphere engine.
test('the side panel’s job block: research and brief use the one shared helper and size', () => {
  const roles = page('shared/agent-sphere/roles.js')
  const size = Number(/var SIDE = (\d+)/.exec(roles)?.[1]), narrow = Number(/SIDE_NARROW = (\d+)/.exec(roles)?.[1])
  assert.ok(size >= 88 && size <= 96, `the job-block sphere is 88-96px, got ${size}`)
  assert.equal(narrow, 64, 'below 320px the sphere drops to 64px')
  assert.match(roles, /NARROW = 320/)
  assert.match(roles, /side: side, sideSet: sideSet, SIDE: SIDE/)
  const css = fn(roles, 'sideCss')
  assert.doesNotMatch(css, /\.side-agent\{[^}]*border-radius:1\dpx/, 'no card: no rounded border of its own')
  assert.match(css, /border-bottom:1px solid/, 'a hairline under it, on the panel’s surface')
  assert.match(css, /nk-job-well\{[^}]*box-shadow:inset/, 'the sphere sits in an inset well')
  assert.match(css, /\.side-agent\.nk-job-off\{grid-template-rows:0fr/, 'it folds away by height')
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.side-agent\{transition:none\}/)
  assert.match(css, /var\(--ag-act/, 'the working hairline is the agency colour')
  const side = fn(roles, 'side')
  assert.match(side, /nk-job-role">' \+ esc\(caption\(r\)\)/, 'the role in mono caps')
  assert.match(side, /nk-job-st/)
  assert.match(fn(RT, 'sideAgent'), /R2\.sideSet\(el, job\)/)
  assert.match(fn(page('brief-maker/index.html'), 'sideAgent'), /ROLES\.sideSet\(el, job\)/)
  for (const src of [RT, page('brief-maker/index.html')]) assert.doesNotMatch(src, /\.side-agent \.nk-ag\{width:/, 'no app sizes the job block itself')
  // research: under the tabs, edge to edge
  assert.match(RT, /<div class="insp-sw" id="viewsw"[\s\S]{0,300}<\/div>\s*<div class="side-agent" id="sideAgent"/)
  // Your call names the finding and counts what it rests on; the sources are a tap away, never listed.
  assert.match(fn(RT, 'chkRests'), /pubs\.length===1\?'one source':pubs\.length\+' sources'/)
})

// Owner, 2026-11-11 ("the agent is small, space is big"): the sphere fills its well. The engine's view reads the
// element's real box; a stage-sized geometry inside a bigger box drew a 44px sphere in a 106px well.
test('the job block: the sphere fills its well, the ring hugging it', () => {
  const ctx: Record<string, unknown> = {}
  vm.runInNewContext(page('shared/agent-sphere/roles.js'), ctx)
  const R = ctx.NapkinRoles as { SIDE: number; SIDE_NARROW: number; sideBox(d: number): number; fit(n: number): { rFrac: number; cyFrac: number; ringGap: number; ringScale: number; sphere: number }; side(r: string, o: object): string }
  const roles = page('shared/agent-sphere/roles.js'), air = Number(/WELL_AIR = (\d+)/.exec(roles)?.[1])
  for (const [d, want] of [[R.SIDE, 88], [R.SIDE_NARROW, 64]]) {
    const box = R.sideBox(d), g = R.fit(box)
    assert.equal(g.sphere, want, `the sphere draws at ${want}px`)
    assert.equal(g.cyFrac, 0.5, 'centred in its box')
    const ringR = box * g.rFrac + g.ringGap + 3.5 * g.ringScale / 2
    assert.ok(g.ringGap <= 5, 'the ring hugs the sphere')
    assert.ok(ringR <= box / 2 - 2 && ringR >= box / 2 - 8, `the ring sits just inside the box (${ringR.toFixed(1)} of ${box / 2})`)
    assert.ok(air >= 4 && air <= 10, 'the well is the box and a little air')
    assert.ok(box + air <= want * 1.4, `the well (${box + air}px) holds the sphere (${want}px), no big empty space`)
  }
  // the markup asks the engine for a filling sphere at the box's size, and hydrate sizes it from the real box
  const html = R.side('research', { doing: 'x' })
  assert.match(html, new RegExp(`data-nk-size="${R.sideBox(R.SIDE)}"[^>]* data-nk-fit="1"`))
  assert.match(fn(roles, 'hydrate'), /hasAttribute\('data-nk-fit'\)\) \{ o\.fit = true; o\.size = Math\.min\(el\.clientWidth, el\.clientHeight\)/)
  assert.match(fn(roles, 'mount'), /rFrac: \[F\.rFrac, F\.rFrac\], cyFrac: F\.cyFrac, ringGap: F\.ringGap, ringScale: F\.ringScale/)
  // the still frame draws its sphere at the same .8 of the box, so the swap to the live view does not jump
  assert.match(fn(roles, 'still'), /viewBox="-1\.25 -1\.25 2\.5 2\.5"/)
  assert.match(roles, /var FIT_R = 0\.4;/)
  // tight: small padding, the text beside the sphere, vertically centred
  const css = fn(roles, 'sideCss')
  assert.match(css, /\.nk-job-go\{[^']*align-items:center;gap:14px;[^']*padding:10px var\(--sb\)/)
  assert.match(css, /\.nk-job-t\{[^']*align-content:center/)
})

test('the job block: brief and research draw it identically', () => {
  const brief = page('brief-maker/index.html')
  for (const [name, src] of [['research', RT], ['brief', brief]] as const) {
    assert.match(src, /<div class="side-agent" id="sideAgent" role="status" aria-live="polite" hidden><\/div>/, `${name} has the one block`)
    assert.match(src, /\.side-agent\{--side-bleed:18px;margin-top:-1\dpx\}/, `${name}: edge to edge at the same 18px bleed`)
    assert.doesNotMatch(src, /\.nk-job-(well|go|t|role|do|st)\b[^{]*\{/, `${name} styles none of the block's own parts`)
    assert.doesNotMatch(src, /\.side-agent \.nk-ag\{[^}]*(width|height)/, `${name} never sizes the sphere`)
  }
  assert.match(fn(RT, 'sideAgent'), /R2\.sideSet\(el, job\)/)
  assert.match(fn(brief, 'sideAgent'), /ROLES\.sideSet\(el, job\)/)
})

test('the job block says a question’s gist, the whole question in its tooltip', () => {
  const f = lift<{ askGist(q: string): string }>(RT, ['askGist'], { clipT: (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t) })
  assert.equal(f.askGist('Can you find more sources for it?'), 'finding more sources')
  assert.equal(f.askGist('Please check the GB figure.'), 'checking the GB figure')
  assert.equal(f.askGist('What do Gen Z spend on treats?'), 'answering “What do Gen Z spend on treats”')
  assert.match(fn(RT, 'sideAgent'), /title:'Asked: “'\+aj\.question\+'”'/)
  assert.match(fn(RT, 'sideAgent'), /onGo:function\(\)\{ goTo\(aj\.ref\|\|\(sec\?'sec:'\+sec\.id:null\), aj\.lens\); \}/)
})

// Report / Evidence map (owner, 2026-11-11: "the map is shown in sources, even after the report is selected"):
// VIEW.v is the one source of truth; the tabs, the content and the panel's width are drawn from it together.
function tabsEnv() {
  type Fake = { hidden: boolean; innerHTML: string; cls: Set<string>; attrs: Record<string, string>; classList: { toggle(c: string, on?: boolean): void; remove(c: string): void; contains(c: string): boolean }; setAttribute(k: string, v: string): void; getAttribute(k: string): string | null; querySelectorAll(): Fake[]; contains(): boolean }
  const el = (attrs: Record<string, string> = {}): Fake => {
    const cls = new Set<string>()
    const e: Fake = { hidden: false, innerHTML: '', cls, attrs, classList: { toggle(c, on) { if (on ?? !cls.has(c)) cls.add(c); else cls.delete(c) }, remove(c) { cls.delete(c) }, contains: c => cls.has(c) },
      setAttribute(k, v) { attrs[k] = v }, getAttribute: k => attrs[k] ?? null, querySelectorAll: () => [], contains: () => false }
    return e
  }
  const btns = [el({ 'data-view': 'report', 'aria-pressed': 'true' }), el({ 'data-view': 'map', 'aria-pressed': 'false' })]
  const sw = el(); sw.querySelectorAll = () => btns
  const els: Record<string, Fake> = { pv: el(), 'pv-foot': el(), 'insp-ask': el(), mapview: el(), ws: el(), viewsw: sw, insp: el() }
  els.mapview.hidden = true
  const store: Record<string, string> = {}
  const env = {
    $: (id: string) => els[id] ?? null, VIEW: { v: 'report', sel: null as string | null, trail: [] as unknown[] } as { v: string; sel: string | null; trail: unknown[]; mem?: unknown }, PV: { keySeen: true, keyOpen: false, surf: false, root: 'report' as string },
    D: () => ({ report: {} }), isObj: (x: unknown) => !!x && typeof x === 'object',
    renderMapV: () => { els.mapview.innerHTML = 'MAP' }, keepScroll: (f: () => void) => f(), markReport: () => {}, endSurf: () => {},
    reportViewHtml: () => 'REPORT', reportFootHtml: () => '', itemHtml: (r: string) => 'ITEM ' + r, litPage: () => {},
    docId: () => 'd1', document: { activeElement: null }, window: {}, setTimeout: () => 0, clearTimeout: () => {},
    localStorage: { setItem() {} }, sessionStorage: { setItem: (k: string, v: string) => { store[k] = v } },
  }
  const f = lift<{ setView(v: string): void; renderSel(): void; renderPanel(): void }>(RT, ['setView', 'renderSel', 'renderPanel'], env)
  const pressed = () => btns.filter(b => b.attrs['aria-pressed'] === 'true').map(b => b.attrs['data-view'])
  return { f, els, env, pressed, store }
}

test('research panel: each tab remembers what it had open (owner, 2026-11-12)', () => {
  const { f, els, env } = tabsEnv()
  // a finding opened on the Report tab
  env.VIEW.sel = 'fi_2'; env.VIEW.trail = [{ ref: 'fi_2' }]; env.PV.root = 'report'; f.renderSel()
  f.setView('map')
  assert.equal(env.VIEW.sel, null, 'the map opens on the map, not on the report\'s item')
  assert.equal(els.mapview.hidden, false)
  // a fact opened from the map
  env.VIEW.sel = 'f_1'; env.VIEW.trail = [{ ref: 'f_1' }]; env.PV.root = 'map'; f.renderSel()
  f.setView('report')
  assert.equal(env.VIEW.sel, 'fi_2', 'Report comes back to the finding it had open')
  assert.equal(env.PV.root, 'report'); assert.equal(els.pv.innerHTML, 'ITEM fi_2')
  assert.equal(els.mapview.hidden, true, 'and the map is gone')
  f.setView('map')
  assert.equal(env.VIEW.sel, 'f_1', 'the map comes back to the fact it had open'); assert.equal(env.PV.root, 'map')
  // pressing the tab you are on starts it fresh
  f.setView('map')
  assert.equal(env.VIEW.sel, null)
  f.setView('report'); f.setView('map')
  assert.equal(env.VIEW.sel, null, 'a fresh start is not undone by the next visit')
  // Show on map keeps the report's item for the way back
  assert.match(RT, /function showOnMap\(ref\)\{ setView\('map'\); VIEW\.sel=null;/)
})

test('research panel: the pressed tab and the content are one state, both ways and after a selection', () => {
  const { f, els, env, pressed, store } = tabsEnv()
  f.setView('map')
  assert.deepEqual(pressed(), ['map']); assert.equal(els.mapview.hidden, false); assert.equal(els.pv.hidden, true)
  assert.ok(els.ws.cls.has('ws-map'), 'the panel widens for the map')
  f.setView('report')
  assert.deepEqual(pressed(), ['report'])
  assert.equal(els.mapview.hidden, true, 'the map goes when Report is pressed')
  assert.equal(els.pv.hidden, false); assert.equal(els.pv.innerHTML, 'REPORT')
  assert.ok(!els.ws.cls.has('ws-map'), 'and the panel narrows with it')
  assert.equal(store['clan.research.view.d1'], 'report', 'the last tab is kept for a reload')
  // an item opened from the map keeps the Map tab, shows the item, and Back returns to the map
  f.setView('map'); env.VIEW.sel = 'f_1'; f.renderSel()
  assert.deepEqual(pressed(), ['map']); assert.equal(els.pv.innerHTML, 'ITEM f_1'); assert.equal(els.mapview.hidden, true)
  assert.ok(els.ws.cls.has('ws-map'), 'the panel keeps its map width on the Map tab: the report beside it does not jump')
  // the restore on load goes through setView too, so its highlight matches
  assert.match(RT, /if\(sessionStorage\.getItem\('clan\.research\.view\.'\+docId\(\)\)==='map'\) setView\('map'\);/)
  assert.doesNotMatch(fn(RT, 'setView'), /aria-pressed|ws-map/, 'setView only changes the state; renderPanel draws it')
  // only one set of view tabs on the page: the hidden legacy inspector holds none
  assert.equal((RT.match(/data-view="map"/g) || []).length, 1)
})

// The map tab stays the map (owner, 2026-11-11 video: "the evidence map and Report toggles are not working
// right, evidence map is not highlighting the right nodes"): a click in the report lights the map; a sentence
// lights what it cites and what those rest on, never everything their facts feed elsewhere.
function mapEnv() {
  // S:a ─ p1 ─ f1 ─┐
  //   └── p2 ─ f2 ─┴ L1          a sentence of §1 cites p1 alone
  const nodes: Record<string, { k: string; ref?: string; col: number }> = {
    'S:a': { k: 'src', ref: 'src_a', col: 0 }, p1: { k: 'fact', ref: 'p1', col: 1 }, p2: { k: 'fact', ref: 'p2', col: 1 },
    f1: { k: 'find', ref: 'f1', col: 2 }, f2: { k: 'find', ref: 'f2', col: 2 }, L1: { k: 'ln', ref: 'report.summary[0]', col: 3 },
  }
  const edges = [['S:a', 'p1'], ['S:a', 'p2'], ['p1', 'f1'], ['p2', 'f2'], ['f1', 'L1'], ['f2', 'L1']].map(([a, b]) => ({ a, b }))
  const G = { nodes }
  const PV: { mapSel: string | null; mapSet: string[] | null } = { mapSel: null, mapSet: null }
  const sent = 'report.sections[s1].blocks[2]'
  const E = { up: { [sent]: ['p1'] }, sections: [{ id: 's1', cited: ['p1'], findings: ['f1'] }] }
  const f = lift<{ mapNodesOf(r: string): string[]; mapChain(g: unknown, e: unknown): Record<string, number> | null }>(RT, ['mapNodeOf', 'mapNodesOf', 'mapFocus', 'mapChain', 'chainV'], {
    MAPV: { G }, PV, arr, evm: () => E, evSec: (id: string) => E.sections.find(x => x.id === id) ?? null,
    srcRecs: () => ({ src_a: {} }), pubKeyOf: () => 'a', visV: (_g: unknown, id: string) => id,
  })
  const lit = () => Object.keys(f.mapChain(G, edges) ?? {}).sort()
  return { f, PV, lit, sent }
}

test('research map: a sentence lights what it cites and what that rests on, not its neighbours', () => {
  const { f, PV, lit, sent } = mapEnv()
  assert.deepEqual(f.mapNodesOf(sent), ['p1'], 'a sentence is no box of its own: its cited fact is')
  assert.deepEqual(f.mapNodesOf('sec:s1'), ['p1', 'f1'], 'a section: what it cites and its findings')
  assert.deepEqual(f.mapNodesOf('chart:p1,p2'), ['p1', 'p2'])
  assert.deepEqual(f.mapNodesOf('f1'), ['f1'], 'a finding is its own box')
  assert.deepEqual(f.mapNodesOf('report.summary[0]'), ['L1'])
  assert.deepEqual(f.mapNodesOf('gap_1'), [])
  PV.mapSet = ['p1']
  assert.deepEqual(lit(), ['S:a', 'p1'], 'the sentence lights its fact and the source under it, not f1, f2 or the line')
  PV.mapSet = null; PV.mapSel = 'f1'
  assert.deepEqual(lit(), ['L1', 'S:a', 'f1', 'p1'], 'one box lights what it rests on and what rests on it')
  PV.mapSel = null
  assert.equal(f.mapChain({ nodes: {} }, []), null, 'nothing in focus lights nothing')
})

test('research map: on the Map tab a click in the report lights the map; the OS asking to show an item opens it', () => {
  const calls: string[] = []
  const VIEW = { v: 'map', sel: null as string | null, trail: [] as { ref: string }[] }
  const f = lift<{ select(r: string, push?: boolean, open?: boolean): void }>(RT, ['select'], {
    VIEW, PV: {}, endSurf: () => {}, mapLight: (r: string) => calls.push('light ' + r), selLabel: (r: string) => r,
    traceSel: () => {}, renderSel: () => calls.push('render'), checks: () => [], CHK: {}, chkId: () => '', renderChecks: () => {},
    $: () => null, window: {},
  })
  f.select('report.sections[s1].blocks[2]', false)
  assert.deepEqual(calls, ['light report.sections[s1].blocks[2]']); assert.equal(VIEW.sel, null, 'the map is not swapped for a detail')
  f.select('f1', false, true)
  assert.equal(VIEW.sel, 'f1', 'open: the detail, under the Map tab')
  VIEW.sel = null; VIEW.v = 'report'; calls.length = 0
  f.select('f1', false)
  assert.equal(VIEW.sel, 'f1', 'on the Report tab a click opens the detail as before')
  assert.match(fn(RT, 'provHost'), /select\(ref, !!VIEW\.sel, !fromPage\)/, 'a field clicked in the report lights the map; the Decisions drawer opens the item')
  assert.match(RT, /\.insp-sw\{[^}]*position:sticky;top:0/, 'the tabs stay at the top of the panel as it scrolls')
})

// A line says what it is (owner, 2026-11-11: "This line was a fact/derived. Based on the sources from below").
test('research panel: a line says in a sentence what it is and what it is based on', () => {
  const f = lift<{ lineWhatHtml(r: string, o: unknown, nf: number, ns: number, need: boolean): string }>(RT, ['lineWhatHtml'], {
    arr, esc, fnum: (i: string) => i.slice(1), theAgent: () => 'the Synthesis agent', bars: (n: number) => `[${n}]`,
    plural: (n: number, w: string) => `${n} ${n === 1 ? w : w + 's'}`, andListW: listJoin,
  })
  const h = f.lineWhatHtml('report.headline', { kind: 'Draws on Findings 4, 2 and 1', fis: ['f4', 'f2', 'f1'], pins: [], lv: 1 }, 24, 9, false)
  assert.match(h, /<span class="pv-kindtag">Worked out<\/span>/)
  assert.match(h, /This headline was worked out by the Synthesis agent from Findings 4, 2 and 1\./)
  assert.match(h, /Based on 3 findings, 24 facts and 9 sources, listed below\./)
  assert.match(h, /How sure: \[1\] thin/)
  const fact = f.lineWhatHtml('report.sections[s1].blocks[1]', { kind: 'A figure, in our words', fis: [], pins: ['p1'], lv: 2 }, 2, 2, false)
  assert.match(fact, />A fact</); assert.match(fact, /This sentence states a figure from a source, in our words\./)
  const q = f.lineWhatHtml('report.summary[0]', { kind: 'Quotes a source', fis: [], pins: ['p1'], lv: 3 }, 1, 1, true)
  assert.match(q, /This summary line quotes a source\./); assert.match(q, /Needs you/)
  assert.match(f.lineWhatHtml('report.summary[1]', { kind: 'Our reading, nothing cited', fis: [], pins: [], lv: 2 }, 0, 0, false), /Nothing is cited under it\./)
  assert.match(fn(RT, 'viewLineHtml'), /crumbHtml\(\)\+lineWhatHtml\(ref, o,/)
})

test('research map: the four columns fit the width given, edges inside it', () => {
  const f = lift<{ mapFit(a: number): { cx: number[]; cw: number[]; w: number; tight: boolean } }>(RT, ['mapFit'], { COLX: [0, 236, 486, 722], COLW: [208, 224, 206, 108] })
  // the panel's map width at 1280, 1440 and 1600 (744px panel), the 440px panel, and wide
  for (const avail of [700, 560, 402, 900]) {
    const m = f.mapFit(avail)
    assert.equal(m.cx.length, 4); assert.equal(m.cw.length, 4)
    assert.ok(m.w <= avail, `all four columns fit ${avail}px (got ${m.w})`)
    assert.equal(m.w, m.cx[3] + m.cw[3], 'Lines’ right edge is the map’s width')
    for (let i = 0; i < 3; i++) assert.ok(m.cx[i] + m.cw[i] < m.cx[i + 1], `column ${i + 1} ends before column ${i + 2}: room for the edges`)
  }
  assert.equal(f.mapFit(402).tight, true, 'smaller type when squeezed')
  assert.equal(f.mapFit(900).tight, false)
  assert.match(fn(RT, 'renderMapV'), /fit=mapFit\(avail\), CX=fit\.cx, CW=fit\.cw;/)
})

// The run stage's sphere on a dark stage (owner, 2026-11-11): it is lit for the stage's own ground, a pale
// material keeps a shaded side and a rim there, and the role mark is subtler at stage size.
test('the stage sphere: lit for the stage’s ground, pale materials shaded on dark, the mark scaled to size', () => {
  for (const src of [RT, page('brief-maker/index.html')]) {
    assert.match(src, /bg:(isDark\(\)|dark)\?'#16181D':'#F6F1E7'/, 'the sphere is lit for a dark stage when the stage is dark')
    assert.match(src, /SPH\.view\.setBg\(/, 'and follows a change of scheme')
  }
  const av = page('shared/agent-sphere/agent-view.js')
  assert.match(av, /float pale = uDarkBg \* smoothstep\(\.55, \.9, dot\(base/)
  assert.match(av, /float big = smoothstep\(40\., 110\., uR\), mk = mix\(1\., \.8, big\);/)
  const roles = page('shared/agent-sphere/roles.js')
  assert.match(roles, /<g transform="scale\(' \+ mk \+ '\)">/, 'the static frame scales its mark too')
  assert.match(roles, /stroke="#000" stroke-opacity="\.16"/, 'and has a rim')
})

// ── the research panel, one thing at a time (features/research-new-ui.clan; the approved design, 2026-11-11) ──
test('research panel: the footing says itself, no key needed (owner override)', () => {
  const foot = fn(RT, 'footHtml')
  assert.match(foot, /Uses <b>'\+c\.feeds\.sources\+'<\/b> of '\+c\.sources\+' sources · <b>'\+c\.feeds\.pins\+'<\/b> of '\+c\.pins\+' facts · <b>'\+c\.feeds\.findings\+'<\/b> of '\+c\.findings\+' findings/)
  assert.match(foot, /class="lead" aria-hidden="true">▤ ◆ /, 'the glyphs are a quiet lead-in, never alone')
  assert.match(foot, /plural\(need, 'finding'\)\)\+' wait'\+\(need===1\?'s':''\)\+' for your call'/)
  assert.match(foot, /'All '\+plural\(k, 'finding'\)\+' kept'/)
  assert.match(foot, />facts used</)
  assert.match(foot, /g\+' couldn’t find'/)
  const chip = fn(RT, 'mktChip')
  assert.match(chip, /'Nothing found for ':'Facts found for '/)
})

test('research panel: one primary per view, Lock waits with "Settle n first", and the report view never quotes the page', () => {
  const rv = fn(RT, 'reportViewHtml')
  assert.match(rv, />Lock the report<\/button>/)
  assert.match(rv, /'Settle '\+open\.length\+' first'/)
  assert.equal((rv.match(/pv-btn primary/g) || []).length, 1)
  for (const k of ['Left out · ', 'Found, not used · ', 'Couldn’t find · ']) assert.ok(rv.includes(k), k)
  // Your call rows name a finding by number and section, never its text.
  assert.doesNotMatch(fn(RT, 'callRow'), /statement/)
  assert.doesNotMatch(fn(RT, 'rowFind'), /statement/)
})

test('research panel: the missing source is named by its origin, never by its id', () => {
  const f = lift<{ missLabel(k: string): string; entityName(e: string): string }>(RT, ['missLabel', 'entityName'], { brandName: () => '', slug: (s: string) => s })
  assert.equal(f.missLabel('lib:brand/mcdonald-s-ireland'), 'From what Napkin knew about McDonald’s Ireland')
  assert.equal(f.missLabel('none'), 'No source saved')
  const v = fn(RT, 'viewMissHtml')
  assert.match(v, /Confirmed by a person in an earlier chat\. The note of who confirmed it wasn’t copied into this document\./)
  assert.match(v, /Record not copied/)
  assert.doesNotMatch(v, /src_|esc\(k\)\+'<\/span>/, 'no raw id on the surface')
  // A fact whose source record is not held carries the chain mark; the map draws one dashed tile per origin.
  assert.match(fn(RT, 'rowFact'), /noSource\(id\)\?'<span class="mk prop" title="Source record not copied">'\+ICO_CHAIN/)
  assert.match(fn(RT, 'mapGraphV'), /var mk='M:'\+missKey\(id\)/)
})

test('research panel: the map draws only what the report uses, grouped, and lights the chain both ways', () => {
  const g = fn(RT, 'mapGraphV')
  assert.match(g, /E\.pin\[id\]\.group==='feeds'/)
  assert.match(g, /'Quoted straight in the summary'/)
  assert.match(g, /'⋮ '\+tail\.length\+' more'/)
  const ch = fn(RT, 'chainV')
  assert.match(ch, /if\(up\[e\.b\]&&!up\[e\.a\]\)/)
  assert.match(ch, /if\(down\[e\.a\]&&!down\[e\.b\]\)/)
  assert.match(fn(RT, 'drawEdgesV'), /el\.classList\.add\(foc\.indexOf\(id\)!==-1\?'on':chain\[id\]\?'lit':'dim'\)/)
  assert.match(fn(RT, 'mapChain'), /if\(PV\.mapSel\) return chainV\(f\[0\], edges\)/, 'one box: both ways')
  assert.match(fn(RT, 'renderMapV'), /data-act="pv-mapopen">Open<\/button>/)
  assert.match(RT, /PV\.keySeen=localStorage\.getItem\('clan\.research\.mapkey'\)==='1'; PV\.keyOpen=!PV\.keySeen;/, 'the Key opens on the first visit, then folds')
})

// ── Brief Maker: intake (brief-intake-qa) ─────────────────────────────────

// The draft may stop once, in needs_input, for a few questions (middleware-api §10.6). The page keeps
// polling, shows them with Skip on each and Skip, just draft for all, and answers with answer_question.
// ── Brief Maker: a running brief resumes when reopened (brief-resumes-running-job) ──

// The frame is sandboxed without allow-same-origin, so the page cannot keep a job id across an open.
// The shell tells it the document's unsettled jobs (clan:jobs); each new id gets one job_status poll,
// and its reply's task says which resume path takes it.
test('Brief Maker: clan:jobs resumes a running draft once, a fix and a redraft, and ignores other tasks', async () => {
  type Reply = { task: string; job: { id: string; state: string }; result?: { fields?: Record<string, { state: string; by: string | null }> } }
  const replies: Record<string, Reply> = {
    job_d: { task: 'draft_brief', job: { id: 'job_d', state: 'needs_input' } },
    job_x: { task: 'research_lens', job: { id: 'job_x', state: 'running' } },
    job_f: { task: 'fix_parts', job: { id: 'job_f', state: 'running' } },
    job_r: { task: 'regenerate_field', job: { id: 'job_r', state: 'running' },
      result: { fields: { insight: { state: 'drafting', by: 'drafter' }, background: { state: 'done', by: null }, mandatories: { state: 'kept', by: null } } } },
    job_e: { task: 'draft_brief', job: { id: 'job_e', state: 'done' } },
  }
  const polls: string[] = [], drafts: unknown[][] = [], fixes: unknown[][] = [], regens: unknown[][] = []
  let chains = 0
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = []
  const parent = {}
  const env = {
    window: {
      parent,
      clan: { apiProxy: (_: string, p: { task: string; input: { job_id: string } }) => { polls.push(p.input.job_id); return Promise.resolve(replies[p.input.job_id]) } },
      addEventListener: (t: string, h: (e: { source: unknown; data: unknown }) => void) => { if (t === 'message') listeners.push(h) },
    },
    arr, hostErr: () => null, mwBody: (r: unknown) => r, loadChain: () => { chains += 1 },
    DRAFT: null, FIX: null, REGEN: {} as Record<string, unknown>, BUSY: { extracting: 1, drafting: 1, judging: 1, revising: 1 },
    fieldOf: (k: string) => (k === 'insight' ? { key: 'insight' } : null),
    startDraft: (...a: unknown[]) => { drafts.push(a) }, phase: 'intake', hasContent: () => false,
    fixParts: (...a: unknown[]) => { fixes.push(a) },
    regenField: (...a: unknown[]) => { regens.push(a) },
  }
  const lib = fn(BM, 'ownJob') + fn(BM, 'resumeJobs') + fn(BM, 'regenFieldOf') + fn(BM, 'resumeJob')
  const at = BM.indexOf('var SEEN_JOBS={};')
  const listen = BM.slice(BM.indexOf("window.addEventListener('message'", at), BM.indexOf('});', BM.indexOf("window.addEventListener('message'", at)) + 3)
  assert.match(listen, /m\.type!=='clan:jobs'\) return;\s*resumeJobs\(m\.jobs\);/)
  new Function(...Object.keys(env), `var SEEN_JOBS={}; var LIVE_JOB={queued:1, running:1, needs_input:1};\n${lib}\n${listen}`)(...Object.values(env))
  const post = (data: unknown, source: unknown = parent) => listeners.forEach(h => h({ source, data }))
  const settle = () => new Promise(r => setTimeout(r, 0))

  post({ type: 'clan:jobs', jobs: ['job_d'] }, {})   // not from the shell: not heard
  await settle()
  assert.deepEqual(polls, [])
  post({ type: 'clan:jobs', jobs: ['job_d', 'job_x'] })
  await settle()
  assert.deepEqual(drafts, [['', [], 'job_d', false]], 'the draft goes back to the Agents screen through the resume path')
  assert.deepEqual(polls, ['job_d', 'job_x'])
  // the listing changes and says the same ids again: nothing is resumed twice, nor polled again
  post({ type: 'clan:jobs', jobs: ['job_d', 'job_x', 'job_f', 'job_r', 'job_e'] })
  await settle()
  assert.equal(drafts.length, 1, 'a draft resumes once')
  assert.deepEqual(polls, ['job_d', 'job_x', 'job_f', 'job_r', 'job_e'])
  assert.deepEqual(fixes, [['', 'job_f']])
  assert.deepEqual(regens, [[{ key: 'insight' }, '', 'job_r']], 'a redraft resumes on the one part it has in flight')
  assert.equal(chains, 1, 'a job that already ended is not resumed: the brief re-reads what it wrote')
  // an unknown task (job_x) started nothing
  assert.equal(drafts.length + fixes.length + regens.length, 3)
  // and the storage the sandbox refused is gone
  assert.doesNotMatch(BM, /sessionStorage\.(get|set)Item/)
})

test('a needs_input reply keeps the poll alive, carries the questions, and a running reply resumes', () => {
  type J = Record<string, unknown> & { state: string; questions?: unknown; questions_id?: unknown }
  const ended: J[] = [], polled: string[] = []
  const f = lift<{ onJobReply(j: J, r: unknown): void }>(BM, ['onJobReply'], {
    hostErr: () => null, mwBody: (r: unknown) => r, endJob: (j: J) => { ended.push(j) }, loadChain: () => {},
    pollJob: (j: J) => { polled.push(j.state) }, setTimeout: (fn: () => void) => { fn(); return 1 }, clearTimeout: () => {},
    LAST_PROPOSALS: null,
  })
  const q = [{ id: 'q_budget', key: 'budget', text: 'What is the budget?', why: 'w', priority: 'important', skippable: true }]
  const j: J = { task: 'draft_brief', state: 'running', delay: 900, onUpdate: () => {}, onEnd: () => {} }
  f.onJobReply(j, { job: { id: 'job_1', state: 'needs_input', stage: 'context', question: null, questions_id: 'qs_1', questions: q } })
  assert.equal(j.state, 'needs_input')
  assert.deepEqual(j.questions, q)
  assert.equal(j.questions_id, 'qs_1')
  assert.equal(ended.length, 0, 'the finished state never shows while the job waits')
  assert.deepEqual(polled, ['needs_input'], 'it keeps polling')
  // answered, skipped or timed out: the job runs again and the questions go
  f.onJobReply(j, { job: { id: 'job_1', state: 'running', stage: 'context', question: null } })
  assert.equal(j.questions, null)
  assert.equal(ended.length, 0)
  f.onJobReply(j, { job: { id: 'job_1', state: 'done', stage: 'judge' } })
  assert.equal(ended.length, 1)
})

test('answers go out as answer_question; a refusal after the wait ran out is not the end of the draft', async () => {
  type J = Record<string, unknown>
  const sent: { task: string; input: Record<string, unknown> }[] = []
  const replies: unknown[] = []
  const toasts: string[] = [], polls: J[] = [], updates: J[] = [], handled: unknown[] = []
  const f = lift<{ answerJob(j: J, a: Record<string, string | null>): void }>(BM, ['answerJob'], {
    window: { clan: { apiProxy: (_: string, body: { task: string; input: Record<string, unknown> }) => { sent.push(body); return Promise.resolve(replies.shift()) } } },
    hostErr: (r: { error?: string }) => (r && r.error ? r.error : null), toast: (m: string) => { toasts.push(m) },
    pollJob: (j: J) => { polls.push(j) }, onJobReply: (_: J, r: unknown) => { handled.push(r) }, clearTimeout: () => {},
  })
  const j: J = { task: 'draft_brief', id: 'job_1', questions_id: 'qs_1', state: 'needs_input', onUpdate: (x: J) => { updates.push({ ...x }) } }
  replies.push({ job: { state: 'running' } })
  f.answerJob(j, { q_budget: 'EUR 150,000 incl. VAT', q_timeline: null })
  f.answerJob(j, {})  // a second click while the first is out sends nothing
  await Promise.resolve(); await Promise.resolve()
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], { task: 'answer_question', input: { job_id: 'job_1', questions_id: 'qs_1', answers: { q_budget: 'EUR 150,000 incl. VAT', q_timeline: null } } })
  assert.equal(handled.length, 1, 'the reply is the job’s, as a poll’s')
  assert.equal(j.answering, false)
  // the wait ran out first (409): say so, keep polling, never end the draft
  replies.push({ error: 'job_state (409): nobody answered in time, so it went on without' })
  f.answerJob(j, {})
  await Promise.resolve(); await Promise.resolve()
  assert.equal(handled.length, 1)
  assert.equal(polls.length, 1)
  assert.match(toasts[0], /went on without/)
  // nothing is sent when the job holds no open questions
  f.answerJob({ ...j, questions_id: null }, {})
  assert.equal(sent.length, 2)
})

test('the questions card has Skip on each question and Skip, just draft for all', () => {
  const html = lift<{ askHtml(qs: unknown[], name: string): string }>(BM, ['askHtml'], { esc, WRITER: 'the Brief agent' }).askHtml([
    { id: 'q_budget', text: 'What is the budget?', why: 'Scope depends on it', skippable: true },
    { id: 'q_client', text: 'Which client <b>?', skippable: false }], 'The Strategy agent')
  // the agent-stage card: signed by the agent of the stage asking (role names, never a persona)
  assert.match(html, /^<span class="aq-k">The Strategy agent asks<\/span><span class="aq-q" id="bq-intake">A few quick questions before the plan<\/span>/)
  assert.match(html, /What you skip, the Brief agent proposes and marks for you to confirm\./)
  assert.match(html, /<div class="aq-item" data-q="q_budget"><label class="aq-l" for="ask_q_budget">What is the budget\?<\/label><span class="aq-why">Scope depends on it<\/span><textarea id="ask_q_budget" rows="2"><\/textarea><button type="button" class="aq-skip" data-skip="q_budget">Skip this one<\/button><\/div>/)
  // a question that is not skippable has no Skip; text is escaped
  assert.match(html, /<div class="aq-item" data-q="q_client"><label class="aq-l" for="ask_q_client">Which client &#60;b&#62;\?<\/label><textarea id="ask_q_client" rows="2"><\/textarea><\/div>/)
  assert.equal(html.split('data-skip=').length - 1, 1)
  assert.match(html, /<button type="button" class="sp-btn" id="askSkipAll">Skip, just draft<\/button><button type="button" class="sp-btn aq-send" id="askSend">Send answers<\/button>/)
  assert.doesNotMatch(html, /\b(Ellis|Dara|Jude|Sam|Dex)\b/)
})

test('the card is drawn once per set of questions, so typed text survives a poll; Skip all sends none, Send sends typed', () => {
  type El = { value?: string; disabled?: boolean; handlers: Record<string, () => void>; classList: { toggle(): void; add(): void; remove(): void }; addEventListener(e: string, f: () => void): void; querySelector(s: string): El; focus(): void; textContent?: string }
  const mk = (): El => { const el: El = { value: '', handlers: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener(e, f) { el.handlers[e] = f }, querySelector: () => el, focus() {} }; return el }
  const attrs: Record<string, string> = {}
  let writes = 0
  const sendEl = mk(), skipAllEl = mk(), row = mk(), ta = mk()
  const skipBtn = mk()
  const box = {
    hidden: true, get innerHTML() { return '' }, set innerHTML(_: string) { writes++ }, classList: { add() {}, remove() {} }, focus() {},
    getAttribute: (k: string) => attrs[k] ?? null, setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] },
    querySelector: (sel: string) => (sel === '#askSkipAll' ? skipAllEl : sel === '#askSend' ? sendEl : sel.startsWith('#ask_') ? ta : { ...row, querySelector: (s: string) => (s === 'textarea' ? ta : s === '.aq-skip' ? skipBtn : row) }),
    querySelectorAll: () => [],
  }
  const sent: Record<string, string | null>[] = []
  const ids: string[] = []
  const f = lift<{ renderAsk(j: Record<string, unknown>): boolean }>(BM, ['askHtml', 'renderAsk'], {
    esc, WRITER: 'the Brief agent', ROLES: { forStage: (_a: string, s: string) => (s === 'context' ? 'strategy' : ''), The: () => 'The Strategy agent' },
    $: (id: string) => { ids.push(id); return box }, answerJob: (_: unknown, a: Record<string, string | null>) => { sent.push(a) },
  })
  const qs = [{ id: 'q_budget', text: 'Budget?', skippable: true }]
  const j: Record<string, unknown> = { state: 'needs_input', stage: 'context', questions: qs, questions_id: 'qs_1' }
  assert.equal(f.renderAsk(j), true)
  assert.equal(writes, 1)
  assert.deepEqual([...new Set(ids)], ['procAsk'], 'the questions sit in the stage card, under the risen sphere')
  ta.value = 'EUR 150,000'
  f.renderAsk(j); f.renderAsk(j)  // the next polls
  assert.equal(writes, 1, 'the card is not redrawn, so what is typed stays')
  assert.equal(ta.value, 'EUR 150,000')
  sendEl.handlers.click()
  assert.deepEqual(sent[0], { q_budget: 'EUR 150,000' })
  skipBtn.handlers.click()  // Skip drops the typed answer
  sendEl.handlers.click()
  assert.deepEqual(sent[1], { q_budget: null })
  skipAllEl.handlers.click()
  assert.deepEqual(sent[2], {})
  // a new set of questions is drawn afresh
  f.renderAsk({ ...j, questions_id: 'qs_2' })
  assert.equal(writes, 2)
  // the wait over: the card goes
  assert.equal(f.renderAsk({ state: 'running' }), false)
  assert.equal(box.hidden, true)
  assert.equal(attrs['data-qs'], undefined)
  // the agent-stage pattern: the stage's question card, the sphere rising while intake asks
  assert.match(BM, /<div class="askq" id="procAsk" role="group" tabindex="-1" hidden><\/div>/)
  assert.match(fn(BM, 'askInStage'), /if\(renderAsk\(j\)\)\{ ASK\.id=null; if\(ROLES\) ROLES\.ask\(stage, true\); return; \}/)
  assert.match(fn(BM, 'renderProc'), /askInStage\(j, at\)/)
  assert.match(fn(BM, 'tellSphere'), /var asking=j\.state==='needs_input'&&!!\(j\.question\|\|arr\(j\.questions\)\.length\)/)
  // the working page counts needs_input as live: it can be stopped, and it never reads as finished
  assert.match(fn(BM, 'renderProc'), /var asking=j\.state==='needs_input';\s*var live=[^;]*\|\|asking;/)
  assert.match(fn(BM, 'renderProc'), /canStop=live&&j\.id/)
})

test('only the new draft asks for intake', () => {
  assert.equal(BM.split('intake:true').length - 1, 1, 'one request carries it')
  type J = { task: string }
  const runs: { j: J; input: Record<string, unknown> }[] = []
  const f = lift<{ startDraft(p: string, a: unknown[], id?: string): void }>(BM, ['startDraft'], {
    DRAFT: null, forceIntake: false, reduce: true, renderProc: () => {}, setPhase: () => {}, render: () => {}, arr,
    window: { scrollTo: () => {} }, setTimeout: () => 0, pollJob: () => {},
    runJob: (j: J, input: Record<string, unknown>) => { runs.push({ j, input }) },
  })
  f.startDraft('A brief for Brewline', [{ name: 'a.pdf' }])
  assert.equal(runs[0].j.task, 'draft_brief')
  assert.equal(runs[0].input.intake, true)
  assert.deepEqual(runs[0].input.attachments, [{ name: 'a.pdf' }])
  // the redraft and the part fixes go through other jobs and ask nothing
  for (const name of ['regenField', 'fixParts']) assert.doesNotMatch(fn(BM, name), /intake/)
})

// ── UAT 2026-11-12: words that say what is true ────────────────────────────

test('Brief Maker says whose bad verdict it is: the Review agent’s own check is not someone marking a part wrong', () => {
  const { kindWord } = lift<{ kindWord(x: unknown, view: unknown): string }>(BM, ['kindWord'], { arr, KIND_WORD: new Function(`${obj(BM, 'KIND_WORD')} return KIND_WORD`)() })
  const view = { decisions: [
    { decision: { id: 'd_agent' }, who: { kind: 'agent', id: 'agent:review', name: 'Review agent' } },
    { decision: { id: 'd_me' }, who: { kind: 'person', id: 'human:a', name: 'Ann', you: true } },
    { decision: { id: 'd_bo' }, who: { kind: 'person', id: 'human:b', name: 'Bo' } },
  ] }
  const bad = (decision: string) => ({ code: 'bad_verdict', decision })
  assert.equal(kindWord(bad('d_agent'), view), 'Review agent said no')
  assert.equal(kindWord(bad('d_me'), view), 'You marked it wrong')
  assert.equal(kindWord(bad('d_bo'), view), 'Marked wrong by Bo')
  assert.equal(kindWord(bad('d_gone'), view), 'Marked wrong')
  assert.equal(kindWord({ code: 'open_contest' }, view), 'Sources disagree')
  assert.equal(kindWord({ code: 'something_new' }, view), 'Needs you')
  assert.match(fn(BM, 'lkItemHtml'), /kindWord\(x, osView\(\)\)/)
  assert.match(fn(BM, 'lockItems'), /decision:a\.decision/)
})

test('the shared field chip says an agent said no, and keeps "marked wrong" for a person', () => {
  const blocks: Record<string, unknown> = { d_agent: { decision: { actor: 'agent:review' } }, d_p: { decision: { actor: 'human:ann' } } }
  const { needTag } = lift<{ needTag(a: unknown): string }>(CLF, ['needTag', 'isPerson'], {
    blockOf: (id: string) => blocks[id] ?? null, NEED_TAG: { flagged_field: 'needs changing', bad_verdict: 'marked wrong' },
  })
  assert.equal(needTag({ code: 'bad_verdict', decision: 'd_agent' }), 'an agent said no')
  assert.equal(needTag({ code: 'bad_verdict', decision: 'd_p' }), 'marked wrong')
  assert.equal(needTag({ code: 'flagged_field', decision: 'd_agent' }), 'needs changing')
})

test('Research names the Strategy agent for picking what to look into (roles.js STAGES.research.select)', () => {
  const R = { the: (r: string) => `the ${r[0].toUpperCase()}${r.slice(1)} agent` }
  const { stageLabel } = lift<{ stageLabel(k: string): string }>(RT, ['stageLabel', 'TheAgent', 'theAgent'], { roles: () => R, STAGE: {} })
  assert.equal(stageLabel('select'), 'The Strategy agent picks what to look into')
  assert.match(fn(RT, 'picksHtml'), /Leave these and '\+esc\(theAgent\('strategy'\)\)\+' picks the lenses/)
  assert.match(RT, /S\.who=TheAgent\(WORK_ROLE\[S\.k\]\)/)
})

test('the Research select stage wears the Strategy agent\'s sphere (owner, 2026-11-12)', () => {
  const WORK_ROLE = new Function(`${obj(RT, 'WORK_ROLE')} return WORK_ROLE;`)() as Record<string, string>
  assert.equal(WORK_ROLE.select, 'strategy')
  assert.match(RT, /sphereTag\(WORK_ROLE\[S\.k\], 44,/)
})

test('a question asked from a fact or finding goes with it as ask_research input.about', () => {
  const sent: { task: string; input: Record<string, unknown> }[] = []
  const ASK = { ui: {} as Record<string, unknown>, jobs: [] as Record<string, unknown>[] }
  const env = {
    $: (id: string) => (id === 'rqin-_new' ? { value: 'When was the ruling?' } : null), slug: (s: string) => s, ASK,
    toast: () => {}, LENS: { regulation_clearance: {} }, VIEW: { sel: 'f_01ABC' }, renderAsks: () => {},
    attachments: () => [], onAskReply: () => {}, isObj,
    window: { clan: { apiProxy: (_k: string, p: { task: string; input: Record<string, unknown> }) => { sent.push(p); return new Promise(() => {}) } } },
  }
  const f = lift<{ doAsk(k: string, about?: string | null): Record<string, unknown> }>(RT, ['doAsk', 'sendAsk'], env)
  ASK.ui._new = { lens: 'regulation_clearance' }
  const j = f.doAsk('_new', 'f_01ABC')
  assert.equal(j.about, 'f_01ABC')
  assert.deepEqual(sent[0], { task: 'ask_research', input: { question: 'When was the ruling?', lens: 'regulation_clearance', about: 'f_01ABC' } })
  f.doAsk('_new', 'fi_01XYZ')
  assert.equal(sent[1].input.about, 'fi_01XYZ')
  // the general box sends none, whatever the inspector has selected; a section is not an item
  f.doAsk('_new')
  f.doAsk('_new', 'sec:regulation')
  assert.equal('about' in sent[2].input, false)
  assert.equal('about' in sent[3].input, false)
  assert.match(RT, /var pj=doAsk\('_new', VIEW\.sel\);/)
  // kept across a reload with the job
  assert.match(fn(RT, 'saveAskJobs'), /about:j\.about\|\|null/)
  assert.match(fn(RT, 'resumeAsks'), /about:x\.about\|\|null/)
})

// ── a run the middleware lost (a deploy restarts it; jobs live in its memory) ──

const UNKNOWN_JOB = { ok: false, status: 404, data: null, error: { type: 'unknown_job', message: 'no such job for this document' } }
const INTERRUPTED_WORDS = 'This run was interrupted (the service restarted). Run it again.'

test('Research: a run lost to a restart ends as stopped, says it was interrupted and offers to run it again', () => {
  const stored: Record<string, unknown> = {}
  const CHAT: { job: Record<string, unknown> | null } = { job: { id: 'job_1', state: 'running', stage: 'research' } }
  const env = {
    CHAT, INTERRUPTED: INTERRUPTED_WORDS, MW_API: 'napkin.middleware/1', isObj, arr,
    mwBody: (r: { data?: unknown }) => r.data, store: (k: string, v: unknown) => { stored[k] = v }, jobKey: () => 'k',
    render: () => {}, jobActive: () => /^(sending|checking|queued|running)$/.test(String(CHAT.job?.state)),
    loadChain: () => {}, landed: () => false, schedulePoll: () => {},
  }
  const f = lift<{ onJobReply(r: unknown, resume?: boolean): void; interrupted(r: unknown): boolean }>(RT, ['onJobReply', 'hostErr', 'interrupted'], env)
  f.onJobReply(UNKNOWN_JOB)
  assert.equal(CHAT.job?.state, 'failed')
  assert.equal(CHAT.job?.interrupted, true)
  assert.equal(CHAT.job?.error, INTERRUPTED_WORDS)
  assert.equal(stored.k, null, 'the lost id is not polled again on open')
  // on open (resume) too: the run is shown as interrupted, not dropped
  CHAT.job = { id: 'job_2', state: 'checking' }
  f.onJobReply(UNKNOWN_JOB, true)
  assert.equal(CHAT.job?.interrupted, true)
  assert.equal(f.interrupted({ ok: false, status: 404, error: { type: 'invalid_input', message: 'x' } }), false)
  // the desk's words and the re-run action: the existing failure state
  const sp = lift<{ speech(T: unknown[]): Record<string, string> }>(RT, ['speech'], {
    CHAT, liveQuestion: () => null, jobActive: () => false, isObj, arr, D: () => ({}), STAGE: { research: {} }, runRole: () => 'research',
    firstPrompt: () => ({ text: 'go' }), theAgent: () => 'the Research agent', camp: () => ({}), pins: () => ({}), LENSES: [],
  }).speech([])
  assert.equal(sp.text, 'I had to stop. What we already found stays in the document.')
  assert.equal(sp.err, INTERRUPTED_WORDS)
  assert.match(sp.acts, /data-act="chat-retry">Run it again</)
  // other jobs (research runs, asks) say the same words
  assert.equal(lift<{ mwError(r: unknown): string }>(RT, ['mwError', 'interrupted'], { INTERRUPTED: INTERRUPTED_WORDS }).mwError(UNKNOWN_JOB), INTERRUPTED_WORDS)
})

test('Brief Maker: a draft lost to a restart stops with "We had to stop", the words, and Run it again', () => {
  const ended: Record<string, unknown>[] = []
  const env = {
    INTERRUPTED: INTERRUPTED_WORDS, MW: { configured: true }, NO_MW: '', MW_API: 'napkin.middleware/1',
    mwBody: (r: { data?: unknown }) => r.data, endJob: (j: Record<string, unknown>) => ended.push(j),
  }
  const f = lift<{ onJobReply(j: Record<string, unknown>, r: unknown): void }>(BM, ['onJobReply', 'hostErr', 'interrupted'], env)
  const running = { task: 'draft_brief', id: 'job_1', state: 'running', stage: 'draft' }
  f.onJobReply(running, UNKNOWN_JOB)
  assert.equal(running.state, 'failed')
  assert.equal((running as Record<string, unknown>).error, INTERRUPTED_WORDS)
  assert.equal(ended.length, 1)
  // picked up on open (checking) it is interrupted too, not "couldn't start"
  const resumed = { task: 'draft_brief', id: 'job_2', state: 'checking' }
  f.onJobReply(resumed, UNKNOWN_JOB)
  assert.equal(resumed.state, 'failed')
  const rp = fn(BM, 'renderProc')
  assert.match(rp, /failed:'We had to stop'/)
  assert.match(rp, /l2\.textContent=j\.error\?j\.error:/)
  assert.match(rp, /j\.interrupted&&!live\?'<button type="button" class="sp-btn" id="procAgain">Run it again<\/button>'/)
  assert.match(rp, /\$\('procAgain'\); if\(again\) again\.addEventListener\('click',function\(\)\{ if\(DRAFT===j\) DRAFT=null; draftNow\(''\); \}\)/)
})

test('asking from the inspector says where the answer will appear and brings it into view when it lands', () => {
  const secs: Record<string, unknown> = { regulation_clearance: {} }
  const { askWhere } = lift<{ askWhere(l: string | null): string }>(RT, ['askWhere'], {
    askSections: () => secs, aboutName: (k: string) => (k === 'regulation_clearance' ? 'Regulation and clearance' : k),
  })
  assert.equal(askWhere('regulation_clearance'), 'under Regulation and clearance')
  assert.equal(askWhere('media_spend'), 'at the end of the report')
  assert.equal(askWhere(null), 'at the end of the report')
  // pv-ask marks its job, empties its box and says where; the reply names the answer to reveal.
  // a fact or finding ask shows under its item instead (factAsksHtml), so only a section's ask says where
  assert.match(RT, /var pj=doAsk\('_new', VIEW\.sel\); if\(pj\)\{ pj\.from='pv'; if\(pq\) pq\.value=''; if\(!pj\.about\) toast\('Asked\. The answer will appear '\+askWhere\(pj\.lens\)\+'\.'\); \}/)
  assert.match(fn(RT, 'onAskReply'), /if\(j\.from==='pv'&&aid\)\{ ASK\.reveal=aid; toast\('Answered '\+askWhere\(j\.lens\)\+'\.'\); \}/)
  assert.match(fn(RT, 'renderAsks'), /revealAsk\(\);\s*\}$/)
  assert.match(fn(RT, 'doAsk'), /return j;/)
})

// ── a question asked from a fact: its answer under the fact, in the report only when added ──
// (research-fact-answer-v1, owner 2026-11-12)

type Ask = Record<string, unknown>
const FACT = 'f_01RULING'
function factEnv(asksData: Record<string, Ask>, extra: Record<string, unknown> = {}) {
  const ASK = { ui: {}, jobs: [] as Ask[], reveal: null as unknown, writing: null as unknown }
  const data = { report: {}, asks: asksData }
  return {
    ASK, data,
    env: {
      ASK, esc, arr, isObj, D: () => data, hasHost: () => true, reportLocked: () => false, me: () => 'ann',
      agentName: () => 'Research agent', TheAgent: () => 'The Research agent', clipT: (t: string) => t,
      selLabel: (r: string) => (r === FACT ? 'Advertising standards ruling, 2023' : r), citeName: () => 'Press', pins: () => ({}), fmtAny: () => '',
      findChip: (id: string) => `<chip ${id}>`, secByLens: (l: string) => (l === 'regulation_clearance' ? { n: 7, title: 'Clearance' } : null),
      secWords: (s: { n: number; title: string }) => `§${s.n} ${s.title}`, plainDay: (s: string) => s, slug: (s: string) => s,
      askCite: (ids: string[]) => ` [${ids.join(' ')}]`,
      asks: () => Object.values(data.asks).sort((x, y) => (String(x.asked_at) < String(y.asked_at) ? -1 : 1)),
      ...extra,
    },
  }
}
const FACT_FNS = ['inReport', 'aboutWord', 'askAddedHtml', 'whenWords', 'nameOf', 'faCite', 'inRepWhere', 'factAnswerHtml', 'factPendingHtml', 'factAsksHtml']
type FactFns = { inReport(a: Ask): boolean; factAsksHtml(r: string): string; askAddedHtml(a: Ask): string }
const answered = (more: Ask = {}): Ask => ({
  id: 'ask_1', question: 'When was the ruling?', about: FACT, in_report: false, lens: 'regulation_clearance', in_section: true, asked_at: '2026-11-12T10:00:00Z',
  answer: [{ text: 'The ruling was issued in December 2023.', cites: [FACT] }, { text: 'The brand ran a censored poster.', cites: ['f_02POSTER'] }],
  missing: ['whether the original poster was withdrawn'], status: 'partial', ...more,
})

test('a fact ask shows pending, then its answer, under the fact; not in the report until added', () => {
  const { env, ASK, data } = factEnv({})
  const f = lift<FactFns>(RT, FACT_FNS, env)
  ASK.jobs.push({ about: FACT, question: 'When was the ruling?', state: 'running', jobId: 'job_1' })
  const busy = f.factAsksHtml(FACT)
  assert.match(busy, /pv-fa busy/)
  assert.match(busy, /The Research agent is answering “When was the ruling\?”, from this fact first…/)
  assert.equal(f.factAsksHtml('f_OTHER').includes('pv-fa'), false, 'another fact shows nothing of it')
  ASK.jobs.length = 0
  data.asks = { ask_1: answered() }
  const h = f.factAsksHtml(FACT)
  assert.match(h, /Research agent · about this fact/)
  assert.match(h, /<li>The ruling was issued in December 2023\.<span class="pv-chip pv-fa-this">this fact<\/span><\/li>/)
  assert.match(h, /data-pv="f_02POSTER"/)
  assert.match(h, /<p class="pv-fa-miss">Not on record: whether the original poster was withdrawn\.<\/p>/)
  assert.match(h, /data-act="pvq-add" data-ask="ask_1">Add to report<\/button>/)
  assert.match(h, /data-act="pvq-again" data-ask="ask_1">Ask again<\/button>/)
  // the report leaves it out; a general question's answer stays in it as before
  assert.equal(f.inReport(answered()), false)
  assert.equal(f.inReport({ id: 'ask_g', question: 'Q', about: null }), true)
  assert.equal(f.inReport({ id: 'ask_old', question: 'Q' }), true, 'an answer from before about is in the report')
  assert.match(fn(RT, 'renderAsks'), /all=asks\(\)\.filter\(inReport\)/)
  assert.match(fn(RT, 'renderAsks'), /rjobs=ASK\.jobs\.filter\(function\(j\)\{ return !j\.about; \}\)/)
  assert.ok(RT.includes("histRow(id)+askHtml('Ask about this fact…')+factAsksHtml(id);"))
  assert.match(fn(RT, 'viewFindingHtml'), /askHtml\('Ask about this finding…'\)\+factAsksHtml\(fid\)/)
})

test('Add to report writes in_report as the person; the answer shows in the report; Take out puts it back', async () => {
  const writes: { patch: Record<string, Record<string, Ask>>; action: string; rationale: string }[] = []
  const toasts: string[] = []
  const { env, data } = factEnv({ ask_1: answered() }, {
    doWho: () => {}, mintDecisionId: () => 'd_01ADD', nowIso: () => new Date().toISOString(), addr: (p: string) => `doc#${p}`,
    renderFactAsks: () => {}, renderAsks: () => {}, toast: (m: string) => toasts.push(m),
    humanWrite: (patch: Record<string, Record<string, Ask>>, action: string, rationale: string) => {
      writes.push({ patch, action, rationale })
      for (const [k, v] of Object.entries(patch.asks)) data.asks[k] = { ...data.asks[k], ...v }
      return Promise.resolve({ ok: true })
    },
  })
  const f = lift<FactFns & { setInReport(id: string, on: boolean): Promise<void> }>(RT, [...FACT_FNS, 'setInReport'], env)
  await f.setInReport('ask_1', true)
  assert.equal(writes[0].action, 'add_ask_to_report')
  assert.equal(writes[0].patch.asks.ask_1.in_report, true)
  assert.equal(writes[0].patch.asks.ask_1.in_report_by, 'human:ann')
  assert.match(writes[0].rationale, /^d_01ADD · add · doc#asks\[ask_1\]\.in_report · put the answer to “When was the ruling\?” in the report under §7 Clearance, by human:ann$/)
  assert.equal(f.inReport(data.asks.ask_1), true)
  const card = f.factAsksHtml(FACT)
  assert.match(card, /✓ In the report under §7 Clearance · <button type="button" class="pv-link" data-act="pvq-show" data-ask="ask_1">Show<\/button> · <button type="button" class="pv-link" data-act="pvq-out" data-ask="ask_1">Take out<\/button>/)
  assert.equal(card.includes('Add to report'), false)
  const rep = f.askAddedHtml(data.asks.ask_1)
  assert.match(rep, /class="rq-a rq-added" id="rq-ask_1"/)
  assert.match(rep, /<p class="rq-q">You asked: When was the ruling\?<\/p>/)
  assert.match(rep, /Research agent · added by you just now · rests on 2 facts/)
  assert.deepEqual(toasts, ['In the report under §7 Clearance.'])
  await f.setInReport('ask_1', false)
  assert.equal(writes[1].action, 'take_ask_out_of_report')
  assert.equal(writes[1].patch.asks.ask_1.in_report, false)
  assert.equal(f.inReport(data.asks.ask_1), false)
  assert.match(f.factAsksHtml(FACT), /Add to report/)
})

test('a fact ask keeps going when you move elsewhere, says so on the side, and lands under its fact', () => {
  const sent: { task: string; input: Record<string, unknown> }[] = []
  const replies: ((r: unknown) => void)[] = []
  const toasts: { m: string; act?: { label: string; run(): void } }[] = []
  const opened: string[] = []
  const timers: (() => void)[] = []
  const VIEW = { sel: FACT as string | null }
  const { env, ASK, data } = factEnv({}, {
    VIEW, LENS: { regulation_clearance: {} }, attachments: () => [], toast: (m: string, act?: { label: string; run(): void }) => toasts.push({ m, act }),
    openAsked: (r: string) => opened.push(r), askWhere: () => '', renderAsks: () => {}, render: () => {}, loadChain: () => {},
    saveAskJobs: () => {}, mwError: () => null, mwBody: (r: { data: unknown }) => r.data, setTimeout: (f: () => void) => { timers.push(f) },
    $: (id: string) => (id === 'rqin-_new' ? { value: 'When was the ruling?' } : null),
    window: { clan: { apiProxy: (_k: string, p: { task: string; input: Record<string, unknown> }) => { sent.push(p); return new Promise(r => replies.push(r)) } } },
  })
  const f = lift<FactFns & { doAsk(k: string, about?: string): Ask; onAskReply(j: Ask, r: unknown): void }>(RT, [...FACT_FNS, 'doAsk', 'sendAsk', 'pollAsk', 'onAskReply'], env)
  const j = f.doAsk('_new', FACT)
  // the reply comes back while the person has gone to another fact, then to the report
  VIEW.sel = 'f_OTHER'
  f.onAskReply(j, { ok: true, data: { job: { id: 'job_9', state: 'running' } } })
  assert.equal(timers.length, 1, 'still polled')
  VIEW.sel = null
  timers[0]()
  assert.deepEqual(sent[1], { task: 'job_status', input: { job_id: 'job_9' } })
  assert.equal(ASK.jobs.length, 1)
  // the side agent names the fact while it runs, and opens it
  const el: { innerHTML: string; hidden: boolean } = { innerHTML: '', hidden: true }
  lift<{ sideAgent(): void }>(RT, ['sideAgent'], {
    ...env, $: () => el, document: { body: { classList: { contains: () => false } } }, JOBS: [], RECON: {}, CHAT: {},
    roles: () => null, TheAgent: () => 'The Research agent',
  }).sideAgent()
  assert.equal(el.innerHTML, '<span><b>Research agent</b> · answering about Advertising standards ruling, 2023</span>')
  // it lands: stored under the fact, and the notice opens it
  data.asks = { ask_1: answered({ in_report: false }) }
  f.onAskReply(j, { ok: true, data: { job: { id: 'job_9', state: 'done' }, result: { ask: 'ask_1' }, change: { applied: true } } })
  assert.equal(ASK.jobs.length, 0)
  assert.equal(toasts.at(-1)?.m, 'Answered: Advertising standards ruling, 2023')
  toasts.at(-1)?.act?.run()
  assert.deepEqual(opened, [FACT])
  assert.equal(ASK.reveal, null, 'the report is not scrolled to it: it is not there')
  VIEW.sel = FACT
  assert.match(f.factAsksHtml(FACT), /The ruling was issued in December 2023\./)
})

test('reloading mid-ask resumes it under its fact; one lost to a restart says so with Ask again', () => {
  const { env, ASK } = factEnv({}, { INTERRUPTED: INTERRUPTED_WORDS })
  const f = lift<FactFns>(RT, FACT_FNS, env)
  assert.match(fn(RT, 'resumeAsks'), /about:x\.about\|\|null, state:'running'/)
  ASK.jobs.push({ about: FACT, question: 'When was the ruling?', state: 'running', jobId: 'job_1', error: INTERRUPTED_WORDS })
  const h = f.factAsksHtml(FACT)
  assert.match(h, /Not answered: This run was interrupted \(the service restarted\)\. Run it again\./)
  assert.match(h, /data-act="rq-retry" data-i="0">Ask again<\/button>/)
})

// ── a research linked into an existing brief (features/brief-link-redraft.clan) ──
// The notice says what came in and offers one press to write the brief again with it: the same
// Draft it again (draftNow), unarmed. Not now puts it off; a locked brief never shows it.
type LinkApi = {
  linkNoteHtml(): string; linkRewrite(): void; linkLater(): void; linkRunEnded(j: { state: string }): void; linkedNew(): { document_id: string }[]
}
function linkPage(o: { locked?: boolean; seen?: Record<string, unknown>; taken?: number; phase?: string } = {}) {
  const data: Record<string, unknown> = { upstream: { r1: { campaign: { name: 'Oat' } } }, link_notice: o.seen, background: 'Old background.', project_name: 'Barista comeback IE' }
  const patches: { path: string; value: unknown }[] = []
  const drafts: string[] = []
  const LINK = { run: null, done: null, shown: false, off: false }
  const UP = { res: { upstream: [{ document_id: 'r1', how: 'linked', noun: 'report', title: 'Oatly Barista · Ireland', taken: o.taken ?? 1, linked_at: '2026-11-12T10:00:00Z', holds: { facts: 55, findings: 2 } }] } }
  const FIELDS = [{ key: 'project_name', label: 'Project', type: 'text' }, { key: 'background', label: 'Background', type: 'text' }]
  const api = lift<LinkApi>(BM, ['linkSeen', 'linkedNew', 'linkMark', 'linkRewrite', 'linkLater', 'linkRunEnded', 'linkChanges', 'linkNoteHtml'], {
    LINK, UP, FIELDS, arr, esc, listWords: listJoin,
    get: (k: string) => data[k],
    patch: (path: string, value: unknown) => { patches.push({ path, value }); data[path] = value; return Promise.resolve({ ok: true }) },
    isBrandKit: () => false, approveLocked: () => !!o.locked, draftLive: () => false, phase: o.phase ?? 'doc',
    draftNow: (p: string) => { drafts.push(p) }, renderLinkNote: () => {},
    valToText: (v: unknown) => (v == null ? '' : String(v)), partCites: (k: string) => (k === 'background' ? ['f_1', 'f_2', 'fi_1'] : []),
    isLocked: () => false, isHuman: (d: unknown) => d === 'human', decisionsFor: (k: string) => (k === 'project_name' ? ['human'] : ['agent']),
  })
  return { api, data, patches, drafts, LINK }
}

test('after a research is linked, the brief says what came in and offers one rewrite', () => {
  const { api } = linkPage()
  const h = api.linkNoteHtml()
  assert.match(h, /Research linked: Oatly Barista · Ireland/)
  assert.match(h, /55 facts and 2 findings came in\. The brief was written without them\./)
  assert.match(h, /data-lk="go">Rewrite with the research</)
  assert.match(h, /data-lk="later">Not now</)
  assert.match(h, /Answers you already gave are used, not asked again\./)
  assert.match(BM, /<div class="upnote lknote" id="linkNote" role="status" hidden><\/div>\s*<div class="upnote" id="upNote"/, 'first in the side panel')
})

test('Rewrite with the research runs the draft once, with no arming, and says what changed after', async () => {
  const { api, data, patches, drafts, LINK } = linkPage()
  api.linkRewrite(); api.linkRewrite()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(drafts, [''], 'the same draftNow Draft it again runs, once, on one press')
  assert.deepEqual(patches.map(p => p.path), ['link_notice'])
  assert.deepEqual(data.link_notice, { r1: { taken: 1, how: 'used' } }, 'used: it does not come back on the next visit')
  assert.equal(api.linkNoteHtml(), '', 'nothing while the rewrite runs')
  data.background = 'The brand arrived in Ireland in 2016.'
  api.linkRunEnded({ state: 'done' })
  assert.equal(LINK.run, null)
  const h = api.linkNoteHtml()
  assert.match(h, /Rewritten with Oatly Barista · Ireland/)
  assert.match(h, /Background now rests on the research \(2 facts cited\)\. Project kept your words\./)
  assert.match(h, /data-lk="show">Show what changed</)
  // the redraft itself is the bar's: draftNow, and the two-press arming stays only on the bar's button
  assert.match(fn(BM, 'linkRewrite'), /draftNow\('', true\)/)
  assert.doesNotMatch(fn(BM, 'linkRewrite'), /REDRAFT_ARMED|setTimeout/)
})

test('a rewrite that stops says nothing more', () => {
  const { api } = linkPage()
  api.linkRewrite()
  api.linkRunEnded({ state: 'failed' })
  assert.equal(api.linkNoteHtml(), '')
})

test('Not now puts it off; it comes back when the research is taken again', async () => {
  const { api, data, drafts } = linkPage()
  api.linkLater()
  await new Promise(r => setTimeout(r, 0))
  assert.deepEqual(data.link_notice, { r1: { taken: 1, how: 'later' } })
  assert.equal(api.linkNoteHtml(), '')
  assert.deepEqual(drafts, [])
  // taken again (an update): the newer version is new to the brief
  assert.match(linkPage({ seen: { r1: { taken: 1, how: 'later' } }, taken: 2 }).api.linkNoteHtml(), /Research linked/)
  assert.equal(linkPage({ seen: { r1: { taken: 2, how: 'used' } }, taken: 2 }).api.linkNoteHtml(), '')
})

test('a locked brief, or one not on its sheet, never shows it', () => {
  assert.equal(linkPage({ locked: true }).api.linkNoteHtml(), '')
  assert.equal(linkPage({ phase: 'intake' }).api.linkNoteHtml(), '')
  const locked = linkPage({ locked: true })
  locked.api.linkRewrite()
  assert.deepEqual(locked.drafts, [], 'and pressing nothing on it runs nothing')
})

// ── Draft it again, in place (features/brief-redraft-in-place) ──────────────
// The same draft_brief job, but the sheet stays: each unlocked part sweeps while the run writes it, the
// agent at work is in the side panel with a Stop, and the agents ask nothing (intake false).
function redraftPage(o: { locked?: string[] } = {}) {
  type J = { task: string; inPlace: boolean; id?: string; state: string; stage?: string; error?: string | null; fields: Record<string, { state: string; by?: string }>; onUpdate(j: J): void; onEnd(j: J): void }
  const runs: { j: J; input: Record<string, unknown> }[] = []
  const phases: string[] = []
  const toasts: string[] = []
  let rendered = 0
  const FIELDS = [{ key: 'background', label: 'Background' }, { key: 'insight', label: 'Insight' }, { key: 'audience', label: 'Audience' }]
  const rows = FIELDS.map(f => {
    const cls = new Set<string>()
    return { key: f.key, cls, getAttribute: () => f.key, classList: { toggle: (c: string, on: boolean) => { if (on) cls.add(c); else cls.delete(c) } } }
  })
  const side = { innerHTML: '', hidden: true }
  const stop = { innerHTML: '', hidden: true, classList: { toggle: () => {} } }
  const env = {
    DRAFT: null, forceIntake: false, reduce: true, phase: 'doc', FIX: null, REGEN: {}, FIELDS, arr,
    STAGES: ['extract', 'context', 'draft', 'judge'], STAGE_K: { extract: 'extract', context: 'synthesis', draft: 'drafter', judge: 'judge' },
    SWEEP: new Function(`${obj(BM, 'SWEEP')} return SWEEP`)(), DRAFT_SIDE: new Function(`${obj(BM, 'DRAFT_SIDE')} return DRAFT_SIDE`)(),
    isLocked: (k: string) => (o.locked || []).includes(k), roleOf: (k: string) => k, fieldOf: () => null,
    document: { querySelectorAll: () => rows }, $: (id: string) => (id === 'sideAgent' ? side : id === 'sideStop' ? stop : null),
    ROLES: { sideSet: (el: { hidden: boolean; innerHTML: string }, job: { role: string; doing: string; status: string } | null) => { el.hidden = !job; el.innerHTML = job ? `${job.role} · ${job.doing} · ${job.status}` : '' } },
    esc, renderProc: () => { phases.push('renderProc') }, setPhase: (p: string) => { phases.push(p) }, render: () => { rendered++ },
    renderLinkNote: () => {}, renderLock: () => {}, linkRunEnded: () => {}, toast: (m: string) => { toasts.push(m) },
    pollJob: () => {},
    window: { scrollTo: () => {} }, setTimeout: () => 0,
    runJob: (j: J, input: Record<string, unknown>) => { j.state = 'sending'; runs.push({ j, input }) },
  }
  const f = lift<{ startDraft(p: string, a: unknown[], id?: string | null, inPlace?: boolean): void; sweepKeys(j: unknown): string[] }>(BM,
    ['startDraft', 'draftLive', 'sweepKeys', 'markSweep', 'draftSide', 'renderSideStop', 'draftInPlace', 'sideAgent'], env)
  const swept = () => rows.filter(r => r.cls.has('working')).map(r => r.key)
  return { f, runs, phases, rows, side, stop, swept, toasts, rendered: () => rendered }
}

test('Draft it again runs in place: the sheet stays, intake is off, and the server is told it is a redraft', () => {
  const p = redraftPage()
  p.f.startDraft('the ask', [{ name: 'a.pdf' }], null, true)
  assert.deepEqual(p.phases, [], 'no Agents screen: the phase stays doc')
  assert.equal(p.runs[0].j.task, 'draft_brief')
  assert.deepEqual(p.runs[0].input, { prompt: 'the ask', attachments: [{ name: 'a.pdf' }], intake: false, redraft: true })
  // a first draft from the ask still goes to the Agents screen and asks
  const q = redraftPage()
  q.f.startDraft('the ask', [])
  assert.deepEqual(q.phases.slice(0, 1), ['proc'])
  assert.equal(q.runs[0].input.intake, true)
  assert.equal('redraft' in q.runs[0].input, false)
  // the bar's Draft it again and the linked-research notice both run it in place; one at a time
  assert.match(fn(BM, 'draftNow'), /if\(draftLive\(\)\)\{ if\(!DRAFT\.inPlace\)\{ setPhase\('proc'\); renderProc\(\); \} return; \}/)
  assert.match(fn(BM, 'draftNow'), /startDraft\(ask, atts, null, !!inPlace&&phase==='doc'\)/)
  assert.match(fn(BM, 'redraftClick'), /if\(draftLive\(\)\) return;/)
  assert.match(fn(BM, 'barItems'), /label:REDRAFT_ARMED\?'Click again to redraft':'Draft it again', disabled:draftLive\(\)/, 'off while it runs')
  assert.match(fn(BM, 'linkNoteHtml'), /if\(phase!=='doc'\|\|approveLocked\(\)\|\|draftLive\(\)\|\|LINK\.run\) return '';/, 'the notice is hidden while it runs')
})

for (const end of ['done', 'failed', 'cancelled']) {
  test(`the in-place sweep follows the parts the run is writing and clears when it is ${end}`, () => {
    const p = redraftPage({ locked: ['audience'] })
    p.f.startDraft('', [], null, true)
    assert.deepEqual(p.swept(), ['background', 'insight'], 'every unlocked part sweeps before the job reports any')
    const j = p.runs[0].j
    j.id = 'job_1'; j.state = 'running'; j.stage = 'draft'
    j.fields = { background: { state: 'done' }, insight: { state: 'drafting', by: 'drafter' }, audience: { state: 'kept' } }
    j.onUpdate(j)
    assert.deepEqual(p.swept(), ['insight'], 'keyed on the part states: a part written stops sweeping')
    assert.ok(!p.side.hidden)
    assert.equal(p.side.innerHTML, 'drafter · writing every part · step 3 of 4', 'the side panel shows DRAFT: the Brief agent, writing')
    assert.ok(!p.stop.hidden)
    assert.match(p.stop.innerHTML, /data-ds="stop">Stop</)
    j.stage = 'context'; j.onUpdate(j)
    assert.equal(p.side.innerHTML, 'synthesis · planning the brief · step 2 of 4')
    j.state = end; if (end === 'failed') j.error = 'The draft failed.'
    j.onEnd(j)
    assert.deepEqual(p.swept(), [], 'the sweep is cleared')
    assert.ok(p.side.hidden && p.stop.hidden, 'the agent and the Stop fold away')
    assert.ok(p.rendered() > 0, 'the brief is drawn again with what landed')
    assert.deepEqual(p.toasts, end === 'failed' ? ['The draft failed.'] : [])
  })
}

test('the sweep is the mock’s aw-sheen in the app’s accent, and still with reduced motion', () => {
  assert.match(BM, /@keyframes aw-sheen\{from\{background-position:150% 0\}to\{background-position:-50% 0\}\}/)
  assert.match(BM, /#fields \.row\.working\{background-image:linear-gradient\(100deg,transparent 30%,color-mix\(in srgb,var\(--accent\) 6%,transparent\) 50%,transparent 70%\);background-size:200% 100%;animation:aw-sheen 1\.4s linear infinite\}/)
  assert.match(BM, /#fields \.row\.working > \*\{opacity:\.55;/)
  assert.match(BM, /@media \(prefers-reduced-motion: reduce\)\{#fields \.row\.working\{animation:none;background-image:none\}\}/, 'no sweep, the dim stays')
  assert.match(fn(BM, 'renderStructured'), /markSweep\(\);/, 'a redraw keeps the sweep on the parts still in hand')
  assert.match(BM, /<div class="side-agent" id="sideAgent" role="status" aria-live="polite" hidden><\/div>\s*<div class="side-stop" id="sideStop" hidden><\/div>/)
  assert.match(fn(BM, 'resumeJob'), /startDraft\('', \[\], id, st!=='needs_input'&&phase==='doc'&&hasContent\(\)\)/, 'a reopened redraft comes back in place')
})
