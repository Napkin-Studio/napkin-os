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

test('a suggestion by the host’s matcher is Ellis’s', () => {
  type F = { crewKey(d: unknown): string | null }
  const crew = () => ({ forWork: (w: string) => (w === 'read' ? 'extract' : ''), ofDecision: () => 'judge' })
  const f = lift<F>(CLF, ['ellisKey', 'crewKey'], { crew }) as F & { ellisKey(): string }
  assert.equal(f.crewKey({ handler: 'client_parts_match@1', actor: 'process:host', action: 'suggest_part' }), 'extract')
  assert.equal(f.crewKey({ handler: 'client_parts_match@1' }), 'extract')
  assert.equal(f.crewKey({ handler: 'find_client_parts@1.0' }), 'extract') // an older chain
  assert.equal(f.crewKey({ handler: 'judge_brief@1' }), 'judge')
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
const RECON_FNS = ['reviewEvent', 'reviewed', 'keepRecon', 'walk', 'reconsider']
type Job = { task: string; input: { events: { kind: string; id: string; decision: string; replaced_by?: string }[] }; then: ((j: Job) => void) | null; error?: string; jobId?: string; quiet?: boolean }
function reconEnv(locked = false) {
  const runs: Job[] = []
  const kept: (string | null)[] = []
  const RECON = { queue: [] as unknown[], job: null as Job | null }
  const classes = new Set<string>()
  const walker = { innerHTML: '', classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) } } }
  const env = {
    RECON, arr, walker,
    $: (id: string) => (id === 'walker' ? walker : null),
    CREW_OK: true,
    agentFigure: (k: string, o: { walking?: boolean }) => `<svg data-agent="${k}"${o.walking ? ' data-walking="true"' : ''}></svg>`,
    calm: () => false,
    setTimeout: () => 0, clearTimeout: () => {},
    pathOf: (a: string) => (a.includes('#') ? a.slice(a.indexOf('#') + 1) : a),
    store: (_k: string, v: string | null) => { kept.push(v) },
    docId: () => 'doc1',
    reportLocked: () => locked,
    window: { clan: { apiProxy: () => Promise.resolve() } },
    runTask: (task: string, input: Job['input'], then: Job['then'], quiet?: boolean) => { const j = { task, input, then, quiet }; runs.push(j); return j },
  }
  type F = { reviewed(route: string, body: unknown, res: unknown): void; reviewEvent(route: string, body: unknown, res: unknown): unknown }
  return { f: lift<F>(RT, RECON_FNS, env), runs, kept, RECON, walker }
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

test('a review leaves the page where it is, and Sam walks the bottom edge while the crew works', () => {
  const { f, runs, walker } = reconEnv()
  const on = () => walker.classList.contains('on')
  assert.ok(!on())
  f.reviewed('/verdict', { polarity: 'good' }, { ok: true, decision: 'd_1', targets: ['doc1#facts[f_01A]'] })
  assert.equal(runs[0].quiet, true, 'the reconsider job does not scroll the page')
  assert.ok(on(), 'Sam shows while the job runs')
  assert.match(walker.innerHTML, /data-agent="synthesis" data-walking="true"/)
  assert.match(walker.innerHTML, /Sam is bringing the report in step with your review/)
  finish(runs[0])
  assert.ok(!on(), 'and leaves when nothing is pending')
  // A job a person starts still brings the jobs panel into view.
  assert.match(fn(RT, 'runTask'), /if\(!quiet&&el&&el\.scrollIntoView\) el\.scrollIntoView/)
  assert.match(RT, /<div class="walker" id="walker" role="status" aria-live="polite"><\/div>/)
  assert.match(RT, /@media \(prefers-reduced-motion: reduce\)\{\.walker \.wk-who,\.walker \.wk-fig\{animation:none\}\}/)
})

test('a locked report starts no reconsider job', () => {
  const { f, runs, RECON } = reconEnv(true)
  f.reviewed('/verify', { finding: 'fi_01A' }, { ok: true, decision: 'd_1', targets: ['doc1#findings[fi_01A]'] })
  assert.equal(runs.length, 0)
  assert.equal(RECON.queue.length, 1)
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

test('Jude says nothing needs you only when the review agrees', () => {
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
  // It opens the OS's drawer on the part, where the override is recorded.
  assert.match(fn(BM, 'bindNotes'), /act-override'\); if\(o\) o\.addEventListener\('click',function\(\)\{ var F=OSF\(\); if\(F\) F\.open\(f\.key\); \}\)/)
  // The drawer offers the override on a path whatever its value.
  const vb = fn(CLF, 'verdictBlock')
  assert.match(vb, /data-clf="override"/)
  assert.doesNotMatch(vb.slice(0, vb.indexOf('data-clf="override"')), /editableValue|textOf/)
})

test("a person's verdict on a part is theirs, not the Judge's", () => {
  type F = { provHtml(f: { key: string }): string; notesHtml(f: { key: string }): string }
  const person = { id: 'd_p', kind: 'verdict', polarity: 'bad', agent: 'human:aoife', rationale: 'It needs mandatories.' }
  const judge = { id: 'd_j', kind: 'verdict', polarity: 'bad', agent: 'judge_brief', rationale: 'Too thin.' }
  const make = (v: Record<string, unknown>) => lift<F>(BM, ['provHtml', 'notesHtml'], {
    CHAIN: { state: 'ok' }, OPEN_WHY: {}, JUDE: 'Jude', DARA: 'Dara', YOU: '<you>',
    get: () => '', hasVal: () => false, decisionsFor: () => [], esc: (s: string) => s, arr: (a: unknown) => (Array.isArray(a) ? a : []),
    verdictOf: () => ({ d: v, bad: true, open: true }), ownVerdictOf: () => ({ d: v, bad: true, open: true }),
    crossVerdictsOf: () => [], proposalOf: () => null, docLocked: () => false, OSF: () => ({}),
    hasReasoning: () => false, plainJudge: (s: string) => s, fig: (k: string) => `<fig ${k}>`,
    isHuman: (d: { agent?: string }) => /^human:/.test(String(d && d.agent)),
    whoName: (d: { agent?: string }) => (/^human:/.test(String(d.agent)) ? 'You' : 'Jude'),
    whoMark: (d: { agent?: string }) => (/^human:/.test(String(d.agent)) ? '<you>' : '<fig judge>'),
    fixBtn: (d: { id: string }) => `<fix ${d.id}>`,
  })
  const p = make(person), j = make(judge)
  assert.match(p.provHtml({ key: 'mandatories' }), /<you>You/)
  assert.match(p.notesHtml({ key: 'mandatories' }), /You said this part needs another look/)
  assert.doesNotMatch(p.notesHtml({ key: 'mandatories' }), /Jude: this part/)
  assert.match(j.provHtml({ key: 'mandatories' }), /<fig judge>Jude/)
  assert.match(j.notesHtml({ key: 'mandatories' }), /Jude: this part needs another look/)
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
test('a note on a brief can be fixed by the crew, and the worker walks the bottom edge', () => {
  const FIX_SAY = new Function('SAM', 'DARA', 'JUDE', `${obj(BM, 'FIX_SAY')} return FIX_SAY;`)('Sam', 'Dara', 'Jude')
  const classes = new Set<string>()
  const attrs: Record<string, string> = {}
  const walker = {
    innerHTML: '',
    classList: { contains: (c: string) => classes.has(c), toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) } },
    getAttribute: (k: string) => attrs[k] ?? null, setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] },
  }
  type J = { task: string; verdict: string; stage?: string; summary?: string; error?: string | null; onUpdate(j: J): void; onEnd(j: J): void }
  const runs: { j: J; input: unknown }[] = []
  const said: string[] = []
  let locked = false
  const env = {
    FIX: null, DRAFT: null, FIX_SAY, walker, SAM: 'Sam', DARA: 'Dara', JUDE: 'Jude', NO_MW: 'no middleware', phase: 'doc', reduce: false,
    $: (id: string) => (id === 'walker' ? walker : null),
    esc: (s: string) => String(s), docLocked: () => locked, noMiddleware: () => false,
    window: { clan: { apiProxy: () => Promise.resolve() } },
    fig: (k: string, o: { walking?: boolean }) => `<svg data-agent="${k}"${o.walking ? ' data-walking="true"' : ''}></svg>`,
    setStatus: (h: string) => { said.push(h) }, renderStructured: () => {}, pollJob: () => {},
    runJob: (j: J, input: unknown) => { runs.push({ j, input }) },
    setTimeout: () => 0, clearTimeout: () => {},
  }
  type F = { fixBtn(d: { id: string } | null): string; fixParts(vid: string, resumeId?: string): void; walk(): void }
  const f = lift<F>(BM, ['fixBtn', 'fixParts', 'walk'], env)
  assert.match(f.fixBtn({ id: 'd_note' }), /<button type="button" class="save act-fix" data-v="d_note" title="Sam looks up what it needs, Dara rewrites the parts, Jude checks them">Fix this with the crew<\/button>/)
  locked = true
  assert.equal(f.fixBtn({ id: 'd_note' }), '', 'a locked brief has nothing to fix')
  locked = false
  f.fixParts('d_note')
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0].input, { verdict: 'd_note' })
  assert.equal(runs[0].j.task, 'fix_parts')
  assert.ok(classes.has('on'))
  assert.match(walker.innerHTML, /data-agent="synthesis" data-walking="true"/)
  assert.match(walker.innerHTML, /Sam is looking up what the fix needs/)
  assert.match(f.fixBtn({ id: 'd_note' }), / disabled /, 'one fix at a time')
  f.fixParts('d_other')
  assert.equal(runs.length, 1, 'a second fix waits for the first')
  runs[0].j.stage = 'draft'; runs[0].j.onUpdate(runs[0].j)
  assert.match(walker.innerHTML, /data-agent="drafter"[^>]*>.*Dara is rewriting the parts together/)
  runs[0].j.stage = 'judge'; runs[0].j.onUpdate(runs[0].j)
  assert.match(walker.innerHTML, /Jude is checking the fix/)
  runs[0].j.summary = 'Fixed 3 of 3 part(s), 0 proposed, 4 new fact(s) found.'
  runs[0].j.onEnd(runs[0].j)
  assert.ok(!classes.has('on'))
  assert.equal(said[said.length - 1], 'Fixed 3 of 3 part(s), 0 proposed, 4 new fact(s) found.')
  // The page does not move, both notes offer it, and a reload picks the job up.
  assert.doesNotMatch(fn(BM, 'fixParts'), /scrollIntoView/)
  assert.match(fn(BM, 'crossNoteHtml'), /\+fixBtn\(d\)\+/)
  assert.match(fn(BM, 'notesHtml'), /\(v\.bad&&!locked\?fixBtn\(v\.d\):''\)/)
  assert.match(fn(BM, 'bindNotes'), /\.act-fix'\)\.forEach\(function\(b\)\{ b\.addEventListener\('click',function\(\)\{ fixParts\(b\.getAttribute\('data-v'\)\); \}\); \}\);/)
  assert.match(fn(BM, 'resumeJobs'), /stored\(jobKey\('fix_parts'\)\); if\(fid\) fixParts\('', fid\);/)
  assert.match(BM, /<div class="walker" id="walker" role="status" aria-live="polite"><\/div>/)
  assert.match(BM, /@media \(prefers-reduced-motion: reduce\)\{\.walker \.wk-who,\.walker \.wk-fig\{animation:none\}\}/)
})

// ── Brief Maker: what a part rests on (brief-fact-provenance) ─────────────

// The Lidl brief: Dara worked out that the offer was over in 10 days from two
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
  const acc = { id: 'd_acc', kind: 'edit', actor: 'human', rationale: 'Accepted d_prop1: Dara’s proposal for background.' }
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

test('the drawer quotes the words the planner typed', () => {
  type W = { writerBlock(ref: string): string }
  const mats: Record<string, unknown> = {
    mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect: win back switchers.' },
    mat_f: { kind: 'client_brief', name: 'Lidl brief.pdf' },
  }
  const dec = { id: 'd_1', action: 'draft', agent: 'draft_brief@1.0/drafter', cites: ['mat_p', 'mat_f'], reasoning: { decided: 'x' } }
  const w = lift<W>(CLF, ['obj', 'uniq', 'clip', 'plural', 'becauseList', 'attnOf', 'matName', 'kindOf', 'isPath', 'askOf', 'acceptedId', 'acceptOf', 'isAccept', 'writerBlock'], {
    arr, esc, PATH: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/,
    writerOf: () => ({ block: { decision: dec } }), captures: () => ({}), passages: () => ({}), pins: () => ({}), findings: () => ({}),
    materials: () => mats, isPerson: () => false, say: () => '', crewKey: () => 'drafter', andList: listJoin, upTitle: () => '',
    MAT_KIND: { prompt: 'your prompt', client_brief: 'the client’s brief', other: 'a file' }, textOf: String, SURE: {},
    STATUS_WORD: {}, label: () => '', srcOf: () => null, srcShort: () => '', confidential: () => false, LOCK: '', fmt: () => '',
    dayMonth: () => '', whoDid: () => '', blockOf: () => null, givenOf: () => 'Dara', proposerOf: () => 'Dara',
  })
  const h = w.writerBlock('background')
  assert.match(h, /<h3>What you asked for<\/h3><blockquote class="clf-q said">A brief for Lidl Connect: win back switchers\.<\/blockquote><p class="clf-by">What you typed<\/p>/)
  // the attachment is still named, not quoted, and the prompt is not listed twice
  assert.match(h, /<h3>From your material<\/h3>.*Lidl brief\.pdf/)
  assert.equal(count(h, 'data-open="mat_p"'), 0)
})

// ── a redraft of a held part (redraft-provenance) ──────────────────────────
// Dara's first draft, Jude's note that sent it back, Dara's second, and the
// person's accept, as the chain holds them (newest first). Every reader
// credits Dara, quotes the ask, and shows no decision's id.

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
  targets: [SMP_ADDR], timestamp: '2026-10-23T09:02:00+00:00', rationale: 'Rewrote the single-minded proposition on Jude’s note and your ask.',
  reasoning: { decided: 'One thing, said once.', because: [{ point: 'Your ask: “Make it one thing.”' }, { point: 'It says one thing.' }] } }, who: dara, targets: SMP_T, superseded: false }
const youAccept = { decision: { id: 'd_A', kind: 'edit', agent: 'human', actor: 'human:me', action: `accept proposal ${SMP}`, fields_changed: [SMP],
  timestamp: '2026-10-23T09:05:00+00:00', rationale: 'Accepted Dara’s new version of single-minded proposition.',
  reasoning: { decided: 'Accepted it.', because: [{ point: 'Dara proposed it.', cites: ['d_P2'] }] } }, who: { kind: 'person', id: 'me', name: 'You', you: true }, targets: SMP_T, superseded: false }
const oldAccept = { decision: { id: 'd_O', kind: 'edit', agent: 'human', actor: 'human:me', action: `edit ${SMP}`, fields_changed: [SMP],
  timestamp: '2026-10-23T09:05:00+00:00', rationale: 'Accepted d_P2: Dara’s proposal for single-minded proposition.' },
  who: { kind: 'person', id: 'me', name: 'You', you: true }, targets: SMP_T, superseded: false }

/** The drawer's readers over a chain, the crew named as the snippet names them, dates left as stamps. */
function drawerEnv(decisions: unknown[], value = 'One thing, said once.') {
  type F = {
    provenance(path: string): string
    history(path: string): string
    writerBlock(path: string): string
    proposalOf(path: string): { decision: { id: string } } | null
    acceptOf(b: unknown): { decision: { id: string } } | null
  }
  const crewKey = (d: { agent?: string }) => (/drafter/.test(String(d.agent)) ? 'drafter' : /judge/.test(String(d.agent)) ? 'judge' : null)
  const givenOf = (k: string | null) => ({ drafter: 'Dara', judge: 'Jude' } as Record<string, string>)[String(k)] || ''
  const DID = new Function(`${obj(CLF, 'DID')} return DID;`)()
  const DID_ACTION = new Function(`${obj(CLF, 'DID_ACTION')} return DID_ACTION;`)()
  return lift<F>(CLF, ['obj', 'uniq', 'clip', 'plural', 'becauseList', 'attnOf', 'askOf', 'matName', 'kindOf', 'isPath', 'blockOf', 'isEdit', 'qualify', 'wroteKey',
    'writerOf', 'proposalOf', 'isPerson', 'acceptedId', 'acceptOf', 'isAccept', 'drafterKey', 'proposerOf', 'saidWords', 'provenance', 'didWords', 'history', 'writerBlock'], {
    arr, esc, PATH: /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/, VIEW: { document_id: 'brief', decisions }, DID, DID_ACTION,
    docId: () => 'brief', upstreams: () => ({}), valueAt: () => value, envAt: () => null, ORIGIN: {}, personName: () => 'ana',
    crew: () => ({ forWork: (w: string) => (w === 'draft' ? 'drafter' : '') }), crewKey, givenOf,
    whoDid: (b: { who: { you?: boolean }; decision: { agent?: string } }) => (b.who.you ? 'You' : givenOf(crewKey(b.decision)) || 'The crew'),
    dayMonth: (d: string) => d, captures: () => ({}), passages: () => ({}), pins: () => ({}), findings: () => ({}),
    materials: () => ({ mat_p: { kind: 'prompt', name: 'prompt', text: 'A brief for Lidl Connect.' } }), say: () => '', andList: listJoin, upTitle: () => '',
    MAT_KIND: { prompt: 'your prompt', other: 'a file' }, textOf: String, SURE: {}, STATUS_WORD: {}, label: () => '', srcOf: () => null, srcShort: () => '',
    confidential: () => false, LOCK: '', fmt: () => '',
  })
}

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

test('the drawer credits an accepted proposal to Dara and quotes the ask', () => {
  const f = drawerEnv([youAccept, secondDraft, judeNo, firstDraft])
  assert.equal(f.acceptOf(youAccept)?.decision.id, 'd_P2')
  assert.equal(f.acceptOf(judeNo), null, 'a verdict cites a draft to judge it')
  assert.equal(f.provenance(SMP), 'drafted by Dara · you accepted')
  assert.equal(f.proposalOf(SMP), null, 'the accept answered it')

  const h = f.writerBlock(SMP)
  assert.match(h, /^<p class="clf-by"><b>Dara<\/b> wrote this on 2026-10-23T09:02:00\+00:00, on your ask; <b>You<\/b> accepted it on 2026-10-23T09:05:00\+00:00\.<\/p>/)
  assert.match(h, /<h3>What you asked for<\/h3><blockquote class="clf-q said">Make it one thing\.<\/blockquote><blockquote class="clf-q said">A brief for Lidl Connect\.<\/blockquote><p class="clf-by">What you typed<\/p>/)
  // What the proposal rested on, not the accept; the ask is not listed twice.
  assert.match(h, /<summary>Why it says this<\/summary><ul class="clf-hist"><li><span>It says one thing\.<\/span><\/li><\/ul>/)
  assert.doesNotMatch(h, /Dara proposed it|d_P2|d_A/)

  const lines = [...f.history(SMP).matchAll(/<li><span>(.*?)<\/span><\/li>/g)].map(m => m[1])
  assert.deepEqual(lines, [
    '<b>You</b> accepted Dara’s new version on 2026-10-23T09:05:00+00:00 — “Accepted Dara’s new version of single-minded proposition.”',
    '<b>Dara</b> proposed a new version on 2026-10-23T09:02:00+00:00 — “Rewrote the single-minded proposition on Jude’s note and your ask.”',
    '<b>Jude</b> said it is wrong on 2026-10-23T09:01:00+00:00 — “Say one thing, not two.”',
    '<b>Dara</b> proposed a first version on 2026-10-23T09:00:00+00:00 — “Wrote the single-minded proposition on your ask.”',
  ])
  assert.doesNotMatch(f.history(SMP), /\bd_[A-Z0-9]/)

  // Another person's accept.
  const ana = { ...youAccept, who: { kind: 'person', id: 'ana', name: 'ana' } }
  assert.equal(drawerEnv([ana, secondDraft, judeNo, firstDraft]).provenance(SMP), 'drafted by Dara · accepted')
})

test('an older brief’s accept reads the same, without the id it named', () => {
  const f = drawerEnv([oldAccept, secondDraft, judeNo, firstDraft])
  assert.equal(f.acceptOf(oldAccept)?.decision.id, 'd_P2')
  assert.equal(f.provenance(SMP), 'drafted by Dara · you accepted')
  assert.match(f.writerBlock(SMP), /^<p class="clf-by"><b>Dara<\/b> wrote this on 2026-10-23T09:02:00\+00:00, on your ask; <b>You<\/b> accepted it on 2026-10-23T09:05:00\+00:00\.<\/p>/)
  assert.match(f.history(SMP), /<b>You<\/b> accepted Dara’s new version on 2026-10-23T09:05:00\+00:00 — “Accepted Dara’s proposal for single-minded proposition\.”/)
  assert.doesNotMatch(f.history(SMP), /d_P2/)
  // The proposal gone from the chain: still Dara's, by the crew's draft work.
  const gone = drawerEnv([oldAccept])
  assert.equal(gone.provenance(SMP), 'drafted by Dara · you accepted')
  assert.match(gone.writerBlock(SMP), /^<p class="clf-by"><b>Dara<\/b> wrote this; <b>You<\/b> accepted it on 2026-10-23T09:05:00\+00:00\.<\/p>/)
})

test('the drawer offers the second draft, never the first Jude sent back', () => {
  assert.equal(drawerEnv([secondDraft, judeNo, firstDraft], 'Two things.').proposalOf(SMP)?.decision.id, 'd_P2')
  assert.equal(drawerEnv([judeNo, firstDraft], 'Two things.').proposalOf(SMP), null)
})

test('the brief maker’s proposal is answered by the write that cites it', () => {
  type F = { proposalOf(key: string): { d: { id: string }; value: unknown } | null; actionWords(d: unknown): string; provHtml(f: { key: string }): string }
  const first = { id: 'd_P1', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', superseded_by: 'd_P2', proposed_value: 'One thing.', targets: [SMP_ADDR] }
  const no = { id: 'd_V', kind: 'verdict', polarity: 'bad', agent: 'napkin/brief/judge', cites: ['d_P1'], rationale: 'Say one thing.', targets: [SMP_ADDR] }
  const second = { id: 'd_P2', kind: 'edit', action: 'propose', agent: 'draft_brief@1.0/drafter', cites: ['d_V'], proposed_value: 'One thing, said once.', targets: [SMP_ADDR] }
  const accept = { id: 'd_A', kind: 'edit', agent: 'human', actor: 'human:me', action: `accept proposal ${SMP}`, rationale: 'Accepted Dara’s new version of single-minded proposition.',
    reasoning: { decided: 'Accepted it.', because: [{ point: 'Dara proposed it.', cites: ['d_P2'] }] } }
  const stillNo = { id: 'd_V2', kind: 'verdict', polarity: 'bad', agent: 'napkin/brief/judge', cites: ['d_P2'], rationale: 'Still two things.', targets: [SMP_ADDR] }
  const old = { id: 'd_O', kind: 'edit', agent: 'human', actor: 'human:me', action: `edit ${SMP}`, rationale: 'Accepted d_P2: Dara’s proposal for single-minded proposition.' }
  const make = (decisions: unknown[], writer: unknown = null) => lift<F>(BM, ['about', 'names', 'pathOf', 'isVerdict', 'isProposal', 'isWrite', 'newer', 'proposalOf', 'citesOf',
    'hasReasoning', 'acceptOf', 'isAccept', 'proposerOf', 'actionWords', 'provHtml', 'isHuman'], {
    CHAIN: { state: 'ok', decisions }, arr, esc, docId: () => 'brief', dismissed: () => [], LAST_PROPOSALS: [], OPEN_WHY: {}, JUDE: 'Jude',
    AGENT_NAME: { drafter: 'Dara', judge: 'Jude' }, agentKeyOf: (d: { agent?: string }) => (/judge/.test(String(d.agent)) ? 'judge' : 'drafter'),
    get: () => 'x', hasVal: () => true, verdictOf: () => null, decisionsFor: () => (writer ? [writer] : []),
    whoName: (d: { agent?: string }) => (/^human/.test(String(d.agent)) ? 'You' : 'Dara'), whoMark: () => '<you>', fig: (k: string) => `<fig ${k}>`,
  })
  // Newest first, as the chain is read.
  assert.equal(make([second, no, first]).proposalOf(SMP)?.d.id, 'd_P2')
  assert.equal(make([no, first]).proposalOf(SMP), null, 'a first draft Jude sent back is never offered')
  assert.equal(make([accept, second, no, first]).proposalOf(SMP), null, 'the accept cites it')
  assert.equal(make([old, second, no, first]).proposalOf(SMP), null, 'an older accept named it')
  assert.equal(make([stillNo, second, no, first]).proposalOf(SMP)?.d.id, 'd_P2', 'a proposal Jude still fails stays offered')

  // The chip and the rows: Dara's figure and name, the accept as a note.
  const f = make([accept, second, no, first], accept)
  assert.equal(f.provHtml({ key: SMP }), '<button type="button" class="prov act-why" aria-expanded="false" title="Where did this come from?"><fig drafter>Dara<span class="acc">you accepted</span><span class="q">why?</span></button>')
  assert.equal(f.actionWords(accept), 'accepted Dara’s new version')
  assert.equal(f.actionWords(old), 'accepted Dara’s new version')
  assert.equal(f.actionWords(first), 'proposed a first version')
  assert.equal(f.actionWords(second), 'proposed a new version')
  assert.equal(f.actionWords({ action: 'edit background' }), 'edit background')
  // The accept records the proposal as a cite on its reasoning, and names Dara, not the id.
  const src = fn(BM, 'acceptProposal')
  assert.match(src, /said='Accepted '\+who\+'’s new version of '\+part\+'\.'/)
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

test('the brief’s exports wait for the decision chain and say so when it cannot read it', () => {
  const src = fn(BM, 'chainForExport')
  assert.match(src, /CHAIN\.state==='ok'\|\|CHAIN\.state==='unavailable'\)\s*return Promise\.resolve\(\)/)
  assert.match(src, /CHAIN=\{state:'unavailable'/)
  const plain = fn(BM, 'buildPlainExportHTML')
  assert.match(plain, /Promise\.all\(\[inlineImages\(\), chainForExport\(\)\]\)/)
  assert.match(plain, /Sources could not be read for this export\./)
  assert.match(plain, /CHAIN\.state==='ok'\?exportCitations/)
  const grid = fn(BM, 'buildGridExportHTML')
  assert.match(grid, /return chainForExport\(\)\.then/)
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
  assert.equal((bare.html.match(/Missing: ask Dara to write this part\./g) || []).length, 19, 'every box but the open questions reads missing')
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
  assert.match(out.html, /<b>03<\/b>The barrier<\/div><div class="bd"><p class="todo">Missing: ask Dara to write this part\.<\/p>/)
  assert.match(out.html, /The objection it has to beat: <i>missing: ask Dara to write it<\/i>/)
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
  assert.match(out.html, /<p class="todo">Missing: ask Dara to write this part\.<\/p>/, 'a part nobody has written yet is not left blank')
})

test('a brief leaves with nothing empty: the gate names every empty part, the header holds suggestions, and Dara writes first', () => {
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
  // The export: the grid asks Dara for what is missing and stops, saying so, if it is still missing; the plain export never waits.
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

test('an export never prints a clipped sheet: it is measured, Dara tightens the long parts once, and otherwise it stops', () => {
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
    LAST_GRID_OVERFLOW: OVER, LAST_GRID_WARNINGS: WARN, docLocked: () => false, noMiddleware: () => false, DARA: 'Dara', get: () => 'p',
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
  // too full, nothing over a limit: one tight render, and it goes out. Dara is not asked.
  await run.runExport('pdf', 'grid')
  assert.deepEqual(built, [undefined, [1]], 'measured, then drawn tight on sheet 1')
  assert.deepEqual(exported, ['<tight/>'])
  assert.deepEqual(filled, [], 'no rewrite for a sheet that only needed a step')
  assert.ok(!toasts.some(t => /Not exported/.test(t)))
  // still too full after the step: it goes on to the old retry once, then stops naming the sheet, never looping
  built.length = 0; exported.length = 0; toasts.length = 0; stillOver = true
  await run.runExport('pdf', 'grid')
  assert.deepEqual(exported, [])
  assert.equal(filled.length, 1, 'Dara tightens the longest parts once')
  assert.ok(toasts.some(t => /Not exported: sheet 1 is too full\./.test(t)))
  assert.ok(built.length <= 6, 'a bounded number of renders')
  // a part over its limit is the old path: Dara first, no tight step
  built.length = 0; filled.length = 0; toasts.length = 0; WARN.push({ key: 'job', label: 'The job', words: 60, limit: 30, step: 3 })
  await run.runExport('pdf', 'grid')
  assert.equal(filled[0]?.[0], 'job')
  assert.ok(!built.some(t => Array.isArray(t)), 'no tight step when a part is over its limit')
})

// The overflow decision with the real pieces: the real runExport, buildGridExportHTML, gridBody and gridCss. Only the browser's
// measure (gridOverflow) is a stand-in, and it reads the HTML that was really built: a sheet overflows unless it was drawn
// tight, so a step that did nothing to the document leaves it over.
test('the real overflow decision: a sheet with no part over its limit is redrawn tight, and one that still overflows goes to Dara, then stops naming the sheet', async () => {
  const g = grid()
  const NAMES = ['exportMarkHtml', 'exportSourcesList', 'gridContentSheets', 'gridSheets', 'gridKeys', 'gridLimit', 'gridText', 'gridItems', 'gridHas', 'gridFlag', 'gridWords', 'gridStep', 'gridCell', 'gridChunks', 'gridAppendix', 'gridClientName', 'gridHeaderInfo', 'gridInfo', 'gridSheet', 'gridBody', 'gridCss', 'gridLongest', 'measureGrid', 'buildGridExportHTML', 'buildExportHTML', 'runExport']
  const setup = (vals: Record<string, unknown>, alwaysOver: boolean) => {
    const toasts: string[] = [], exported: string[] = [], renders: string[] = [], filled: string[][] = []
    const env = {
      arr, esc, GRID_MEDIA_ROW: false, hasVal, toast: (m: string) => toasts.push(m), listWords: listJoin, DARA: 'Dara',
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
  // 1. too full with no part over its limit: drawn again with sheet 1 tight, exported, Dara never asked
  const a = setup(AT_LIMIT(g), false)
  await a.f.runExport('pdf', 'grid')
  assert.deepEqual(a.renders, ['plain', 'tight'], 'measured plain, then redrawn tight')
  assert.equal(a.exported.length, 1)
  assert.match(a.exported[0], /^<!DOCTYPE html>.*<div class="sheet tight">/s, 'the document that went out has sheet 1 drawn tight')
  assert.equal((a.exported[0].match(/class="sheet tight"/g) || []).length, 1, 'and only sheet 1')
  assert.deepEqual(a.filled, [], 'no rewrite for a step')
  assert.ok(!a.toasts.some(t => /Not exported|Printed smaller/.test(t)))
  // 2. still too full when tight: Dara tightens the longest parts once, and then it refuses, naming the sheet
  const b = setup(AT_LIMIT(g), true)
  await b.f.runExport('pdf', 'grid')
  assert.equal(b.exported.length, 0, 'nothing goes out')
  assert.equal(b.renders[0], 'plain'); assert.equal(b.renders[1], 'tight', 'the step is tried before Dara is asked')
  assert.equal(b.filled.length, 1, 'then Dara tightens, once')
  assert.ok(b.filled[0].length > 0 && b.toasts.some(t => /Dara is tightening/.test(t)))
  assert.ok(b.toasts.some(t => /Not exported: sheet 1 is too full\./.test(t)), 'and it stops naming the sheet')
  assert.ok(b.toasts.indexOf(b.toasts.find(t => /Dara is tightening/.test(t))!) < b.toasts.findIndex(t => /Not exported/.test(t)))
  assert.ok(b.renders.length <= 4, `bounded: ${b.renders}`)
  // 3. a part over its limit is the old path: Dara first, no tight step before her
  const c = setup({ ...AT_LIMIT(g), job: words(60) }, false)
  await c.f.runExport('pdf', 'grid')
  assert.equal(c.renders[0], 'plain')
  assert.equal(c.filled.length, 1, 'a part over its limit goes to Dara, not to the step')
  assert.equal(c.filled[0][0], 'job')
  assert.equal(c.renders[1], 'plain', 'the first redraw after Dara is the plain one, then the step')
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
    docLocked: () => false, noMiddleware: () => false, DARA: 'Dara', fillParts: () => Promise.resolve(), gridLimit: () => 0,
    get: () => 'x', window: { clan: { exportDoc: () => { printed++; return Promise.resolve({ ok: true }) } } },
  }
  const r = lift<{ runExport: (k: string, s?: string) => Promise<unknown> }>(BM, ['runExport'], env)
  await r.runExport('pdf')
  assert.equal(printed, 0, 'an unmeasured sheet never reaches print')
  assert.match(said, /^Not exported: .*Plain PDF or Plain HTML/)
  await r.runExport('pdf', 'plain')
  assert.equal(printed, 1, 'the plain export is unaffected')
})

test('a part Jude rejected is exported as to confirm, and the export says it was written, not approved', async () => {
  const mark = lift<{ confirmMarked(v: unknown): unknown }>(BM, ['confirmMarked'], {}).confirmMarked
  assert.equal(mark('Families who cook.'), 'To confirm: Families who cook.')
  assert.equal(mark('To confirm: Families.'), 'To confirm: Families.', 'a part already marked is left alone')
  assert.deepEqual(mark(['a', 'b']), ['To confirm: a', 'b'], 'a list marks its first line')
  assert.equal(mark(''), '')
  // fillParts: Jude passes one part and rejects the other. Only the rejected one is marked in the brief.
  const data: Record<string, unknown> = { audience: 'Families who cook.', insight: 'People skip dinner.' }
  const patched: Array<[string, unknown]> = []
  const FIELDS = [{ key: 'audience', label: 'Audience' }, { key: 'insight', label: 'The insight' }]
  const state: Record<string, string> = { audience: 'done', insight: 'failed' }
  const env = {
    FIELDS, JUDE: 'Jude', hasVal, confirmMarked: mark, get: (k: string) => data[k],
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
  const words = lift<{ notApprovedWords(l: string[]): string }>(BM, ['notApprovedWords'], { JUDE: 'Jude', listWords: listJoin }).notApprovedWords
  assert.equal(words(['The insight', 'Audience']), 'Written, not approved by Jude: the insight and audience.')
  assert.equal(words([]), '')
  // the export passes them on and says so once the export has started
  let said = ''
  const run = lift<{ runExport(k: string, s: string, r?: boolean, t?: number[], rej?: string[]): Promise<unknown> }>(BM, ['runExport'], {
    LAST_GRID_OVERFLOW: [], LAST_GRID_WARNINGS: [], toast: (m: string) => { said = m }, buildExportHTML: () => Promise.resolve('<html>'),
    get: () => 'x', notApprovedWords: words, window: { clan: { exportDoc: () => Promise.resolve({ ok: true }) } },
  })
  await run.runExport('pdf', 'grid', false, undefined, ['The insight'])
  assert.equal(said, 'Written, not approved by Jude: the insight.')
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

test('the grid prints on A4 sheets that break cleanly, and is the default export beside a plain one', () => {
  const css = grid().gridCss()
  assert.match(css, /@page\{size:A4;margin:0\}/)
  assert.match(css, /\.sheet\{width:210mm;height:297mm;[^}]*break-after:page\}/)
  assert.match(fn(BM, 'buildExportHTML'), /style==='plain'\?buildPlainExportHTML\(\):buildGridExportHTML\(tight\)/)
  assert.match(fn(BM, 'runExport'), /buildExportHTML\(style, tight\)/)
  assert.match(BM, /id="exHtml"[\s\S]*id="exPdf"[\s\S]*id="exHtmlPlain"[\s\S]*id="exPdfPlain"/)
  assert.match(BM, /doExport\('html','plain'\)[\s\S]*doExport\('pdf','plain'\)/)
  assert.match(BM, /doExport\('html'\); \}\);\s*\$\('exPdf'\)/, 'the shell’s Export and the two main buttons are the grid')
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
