// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Territories redesign (features/territories-redesign.clan; owner, 2026-11-24): the house patterns of Brief, Research and Production.
// One primary per step, top right of its step header, with its reason or its effect beside it; the Booth's agent Brief's size; cites in
// plain words; the look-up box folded and not on Greenlight; a route's World with its primary in its header and a dark palette in dark.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const dir = new URL('templates/territories/', root)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const block = (id: string) => new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(html)![1]
const sphereDir = new URL('templates/shared/agent-sphere/', root)
const engine = `(function (window) {\n${['finish.js', 'agent-view.js', 'extra.js', 'roles.js'].map(f => readFileSync(new URL(f, sphereDir), 'utf8')).join('\n')}\n})(globalThis);\n`
const helper = /<script>([\s\S]*?var NapkinSource[\s\S]*?)<\/script>/.exec(readFileSync(new URL('templates/shared/source-card.html', root), 'utf8'))![1]
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const L = vm.runInNewContext(`${engine}${helper}\n${block('territories-logic')};\n${block('territories-lookups-logic')};\n${block('territories-world-logic')};\n${block('territories-pictures-logic')}; TerritoriesLogic`) as {
  view(d: Doc, ui?: Doc): string
  citeWords(c: string, d: Doc): string
  palDark(p: Doc): Doc
  stageOf(d: Doc, ui: Doc): string | null
}
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8')) as Doc
const plain = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const head = (h: string) => /<header class="sheet-head act">[\s\S]*?<\/header>/.exec(h)?.[0] ?? ''
// the step's primary is the Booth's first control (owner, 2026-11-24: "Into booth"; Brief's Lock the brief)
const slot = (h: string) => h.split('<div class="b-lockslot bt-act">')[1]?.split('</div>')[0] ?? ''
const firstInBooth = (h: string) => { const b = /<aside class="booth-col[\s\S]*?<\/aside>/.exec(h)![0]; const i = b.indexOf('b-lockslot'); return i > b.indexOf('side-agent') && (b.indexOf('class="bc"') < 0 || i < b.indexOf('class="bc"')) && (b.indexOf('lqfold') < 0 || i < b.indexOf('lqfold')) }
const primaries = (h: string) => (h.match(/class="b pri lg[^"]*"/g) ?? []).length

test('every step has its one primary as the Booth\'s first control, with what it does or why it cannot under it', () => {
  const pick = json('example/states/pick.json')
  const arrived = { ...pick, focus: { ...pick.focus, insights: [] }, run: {} }
  for (const [d, label, words] of [
    [arrived, 'Find the insights', /About 40 seconds/],
    [pick, 'Explore \\d+ insights? →', /Usually 2 to 3 minutes/],
    [json('example/states/explore_back.json'), 'Review and greenlight →', /optional/],
  ] as [Doc, string, RegExp][]) {
    const page = L.view(d, {}), h = slot(page)
    assert.equal(primaries(page), 1, `${label}: one primary on the page`)
    assert.match(h, new RegExp(`class="b pri lg"[^>]*>${label}</button>`), `${label} is in the Booth`)
    assert.ok(firstInBooth(page), `${label}: first in the Booth, right under its agent`)
    assert.doesNotMatch(head(page), /class="b pri/, 'the step header carries no button')
    assert.match(plain(h), words)
  }
  // Greenlight has no button of its own: Continue in (the shell's, in the top bar) takes the greenlit routes on (owner, 2026-11-24)
  const gp = L.view(json('example/states/greenlight_open.json'), {})
  assert.equal(primaries(gp), 0); assert.match(plain(slot(gp)), /Greenlight at least one route\. Continue in, in the top bar, takes the greenlit ones on/); assert.ok(firstInBooth(gp))
  // disabled keeps its place and says why
  const none = json('example/states/pick.json'); none.focus.insights.forEach((i: Doc) => { i.ticked = false })
  assert.match(slot(L.view(none, {})), /disabled>Explore →<\/button><span class="why lock">Tick at least one insight/)
})

test('the stage while the engine works: no Booth, the agent big, the step honest, and Back leaves the job running', () => {
  const d = json('example/states/pick.json'); d.focus.insights = []; d.run = {}
  assert.equal(L.stageOf(d, { job: { state: 'running' } }), 'finding')
  assert.equal(L.stageOf(d, { job: { state: 'running' }, view: 0 }), null)
  assert.equal(L.stageOf(d, { job: { state: 'done' } }), null)
  const page = L.view(d, { job: { state: 'running', started: Date.now() - 12000 } })
  assert.doesNotMatch(page, /class="booth-col/); assert.match(plain(page), /Finding the insights/)
  // Brief's stage sphere: the live view is mounted over #aglBox (runtime, as Brief's tellSphere), told this envelope; the still is Brief's 150
  const env = JSON.parse(/id="aglBox" data-env="([^"]+)"/.exec(page)![1].replace(/&quot;/g, '"'))
  assert.equal(env.agent, 'strategy'); assert.equal(env.at, 1); assert.equal(env.steps.length, 3); assert.equal(env.failed, false)
  assert.match(page, /id="aglBox"[^>]*><span class="nk-ag"[^>]*data-nk-size="150"/)
  assert.match(plain(page), /Step 2 of 3 · Reading [^.]+ for tensions and truths/, 'Brief\'s caption: Step N of M · what it is doing')
  assert.match(plain(page), /Usually about 40 seconds · 1[12] s so far/)
  assert.match(page, /class="side-link" data-step="pick">← Back to what arrived/)
})

test('the Booth\'s agent is Brief\'s size, still when nothing runs, and the Booth no longer repeats the crew list', () => {
  const page = L.view(json('example/states/pick.json'), {})
  const booth = /<aside class="booth-col[\s\S]*?<\/aside>/.exec(page)![0]
  assert.match(booth, /<div class="side-agent bt-side idle"><div class="nk-job">/)
  assert.match(booth, /data-nk-size="110"/, 'NapkinRoles.side at SIDE 88: its box is 110')
  assert.match(booth, /data-nk-state="idle"/)
  const back = L.view(json('example/states/explore_back.json'), {})
  const eb = /<aside class="booth-col[\s\S]*?<\/aside>/.exec(back)![0]
  assert.doesNotMatch(eb, /class="crewlist"/, 'the crew is on the sheet, not again in the Booth')
})

test('cites read as plain words; the id stays only in the title and the window', () => {
  const d = json('example/states/pick.json'), page = L.view(d, {})
  const chips = [...page.matchAll(/<button type="button" class="ref[^"]*" data-src="([^"]+)" title="([^"]*)">([^<]*)<\/button>/g)]
  assert.ok(chips.length > 0)
  for (const [, id, title, label] of chips) {
    assert.ok(!label.includes(id), `${id} shows as words, not the id`)
    assert.match(label, /^(Fact|Finding|Find|Brief: [a-z -]+|Source)( \d+)?$/)
    assert.ok(title.includes(id), 'the id is still in the title')
  }
  assert.doesNotMatch(plain(page), /\bfi_[A-Z0-9]{4,}|\bf_[A-Z0-9]{4,}/, 'no raw id in the words on the page')
})

test('the look-up box is a closed fold on Pick and Explore, not on Greenlight; nothing before the engine has written', () => {
  assert.match(L.view(json('example/states/pick.json'), {}), /<details class="fold lqfold"><summary>/)
  assert.match(L.view(json('example/states/pick.json'), { lq: 'Which pubs pour it?' }), /<details class="fold lqfold" open>/)
  assert.doesNotMatch(L.view(json('example/states/greenlight_open.json'), {}), /lqfold|data-lq-draft/)
  // a typed question makes Look it up the primary style (CSS on the live button, the runtime only toggles disabled)
  assert.match(html, /\.bt-box \.btn\[data-act="lookup"\]:not\(:disabled\)\{background:var\(--ag-act\)/)
})

test('a route\'s World: its primary first in its Booth, the toggle as a link, and a dark palette for the dark theme', () => {
  const d = json('example/states/greenlight_open.json'), id = 't_started'
  const off = L.view(d, { world: id })
  assert.match(slot(off), /class="b pri lg" data-green="t_started" aria-pressed="false">Greenlight this route/); assert.ok(firstInBooth(off))
  assert.doesNotMatch(/<header class="whead2">[\s\S]*?<\/header>/.exec(off)![0], /<button/)
  assert.doesNotMatch(off, /class="big" data-green/, 'no second toggle in the Booth')
  const on = JSON.parse(JSON.stringify(d)); on.greenlit = [{ territory_id: id, by: 'Shrey', at: '2026-11-24T10:00:00Z' }]
  const wh = slot(L.view(on, { world: id }))
  assert.match(plain(wh), /This route is greenlit\. Continue in, in the top bar, takes it on\./); assert.doesNotMatch(wh, /data-send/); assert.match(wh, /class="lnk" data-green="t_started" aria-pressed="true">Take it off the list/)
  assert.match(off, /--t-bg-d:#[0-9a-f]{6};--t-ink-d:#[0-9a-f]{6}/)
  const dk = L.palDark({ bg: '#F4B942', ink: '#141413', soft: '#C9C0AE' })
  const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 }
  assert.ok(lum(dk.bg) < 0.25 && lum(dk.ink) > 0.6, 'a dark ground and a light ink')
  eq(L.palDark({ bg: '#12321F', ink: '#F2EBD3', soft: '#1E4A30' }), { bg: '#12321F', ink: '#F2EBD3', soft: '#1E4A30' })
  assert.match(html, /:root\[data-color-scheme="dark"\] \.sheet\.world\{--t-bg:var\(--t-bg-d\)!important/)
})

test('Greenlight has no floating dock over the cards: its tools are a row above the ranked list', () => {
  const page = L.view(json('example/states/greenlight_open.json'), {})
  assert.doesNotMatch(page, /class="dock"/)
  assert.match(page, /<div class="toolrow" role="toolbar" aria-label="Gallery tools">[\s\S]*data-dock="present"[\s\S]*data-dock="compare"[\s\S]*data-dock="rank"[\s\S]*data-dock="export"/)
  assert.ok(page.indexOf('class="toolrow"') < page.indexOf('class="rrows"'))
})

test('the stage keeps to the mock: agent-and-verb pills, what was left out, the real counts, and Stop on the right (owner, 2026-11-24)', () => {
  const d = json('example/states/pick.json'); d.focus.insights = []; d.run = {}
  const up = d.upstream[Object.keys(d.upstream).find((k: string) => d.upstream[k].projection) ?? Object.keys(d.upstream)[0]]
  const page = L.view(d, { job: { state: 'running', id: 'j1', started: Date.now() } }), t = plain(page)
  assert.match(t, /1\. Knowledge \(read\) 2\. Strategy \(find the insights\) 3\. Review \(check\)/)
  // the counts are the document's own, as the mock reads them
  const sn = (L as unknown as { seen(d: Doc): Doc }).seen(d)
  const counted = sn.research && sn.research.pins != null ? `the ${sn.research.pins} pin${sn.research.pins === 1 ? '' : 's'} and ${sn.research.findings} finding${sn.research.findings === 1 ? '' : 's'}` : 'the research'
  assert.ok(t.includes(`Reading ${sn.brief ? 'the brief and ' : ''}${counted} for tensions and truths.`), 'the caption reads the real counts: ' + (/Reading [^.]*\./.exec(t) ?? [''])[0])
  const withCounts = JSON.parse(JSON.stringify(d)); const rk = Object.keys(withCounts.upstream).find((k: string) => k === sn.research?.id)
  if (rk) { const pr = withCounts.upstream[rk]; pr.pins = pr.pins ?? {}; }
  assert.doesNotMatch(t, /the and|the for|and the for/, 'never an empty count')
  const left = () => { const x = JSON.parse(JSON.stringify(d)); (L as unknown as { seen(d: Doc): Doc }).seen(x); return plain(L.view(x, { job: { state: 'running', id: 'j1' } })) }
  if (sn.research && sn.research.rejected > 0) assert.match(left(), new RegExp(`Left out ${sn.research.rejected} rejected finding`))
  else assert.doesNotMatch(left(), /Left out/, 'nothing left out, no slip')
  void up
  // Stop: on the right of the run bar, live once the engine has the job, off (with why) before it does, "Stopping…" while it goes
  assert.match(page, /<span class="sp"><\/span><span class="procActs"><button type="button" class="sp-btn" data-act="stop">Stop<\/button>/)
  assert.match(L.view(d, { job: { state: 'sending' } }), /data-act="stop" disabled title="Starting/)
  assert.match(L.view(d, { job: { state: 'running', id: 'j1', stopping: true } }), /data-act="stop" disabled>Stopping…/)
  // stopped: Brief's stopped stage (not red), what happened, nothing lost, Try again
  const st = L.view(d, { job: { state: 'cancelled', id: 'j1' } })
  assert.equal(L.stageOf(d, { job: { state: 'cancelled' } }), 'finding-stopped')
  assert.match(plain(st), /You stopped it at strategy\. Nothing was lost\./); assert.match(st, /data-act="first">Try again/); assert.doesNotMatch(st, /data-act="stop"/)
  assert.doesNotMatch(st, /class="l2 err"/)
  const failed = L.view(d, { job: { state: 'failed', error: 'The model took too long to answer.' } })
  assert.match(plain(failed), /Failed at step 2 of 3\./)
  // the crew: the same Stop, and its own stopped words
  const ap = json('example/states/pick.json'); ap.run = { ...ap.run, approvals: { pick: { by: 'Shrey', at: '2026-11-24T10:00:00Z', decision: 'approve' } } }
  assert.match(L.view(ap, { job: { state: 'running', id: 'j2', crewRun: true } }), /data-act="stop">Stop/)
  const xs = plain(L.view(ap, { job: { state: 'cancelled', id: 'j2', crewRun: true } }))
  assert.match(xs, /You stopped the crew/); assert.match(xs, /Stopped while exploring\./); assert.match(xs, /Send the crew out again/)
  assert.match(plain(L.view(ap, { job: { state: 'failed', crewRun: true } })), /Failed while exploring\./)
})

test('Stop reaches the middleware: the page sends cancel_job for the running job, and a late poll does not undo the stop', () => {
  // the runtime (the page's last script) is not loaded here; its two pieces are checked in its source, and the middleware side is
  // server/tests/test_territories.py (cancel stops before the next call, writes nothing)
  const rt = html.slice(html.lastIndexOf('<script>'))
  assert.match(rt, /function stopRun\(\) \{[\s\S]*?window\.clan\.apiProxy\('middleware', \{ task: 'cancel_job', input: \{ job_id: j\.id \} \}\)/)
  assert.match(rt, /if \(!j \|\| j\.state === 'cancelled'\) return;/)
  assert.match(rt, /closest\('\[data-act="stop"\]'\)\)\) \{ if \(!b\.disabled\) stopRun\(\); return; \}/)
})

test('the live test\'s findings stay fixed (territories-live, 2026-11-24)', () => {
  const rt = html.slice(html.lastIndexOf('<script>'))
  // T2: a reload picks up the live run from the shell's clan:jobs; a stopped job is never the current one again
  assert.match(rt, /if \(m\.type === 'clan:jobs'\) resumeJobs\(m\.jobs\)/)
  assert.match(rt, /function resumeJobs\(ids\) \{[\s\S]*?task: L\.TASKS\.status[\s\S]*?if \(!j \|\| !BUSY\[j\.state\]/)
  // T1: with no stage on screen the sphere's view is let go, so the next stage (Explore after Find) makes a new one
  assert.match(rt, /if \(!box\) \{[^\n]*SPH = \{ view: null, tried: false/)
  // T11: with the crew's lanes the stage gives up their height, so the run bar stays in view at 1280 x 800
  assert.match(html, /\.pwrap:has\(\.lane\) \.sstage\{height:clamp\(300px,calc\(100vh - 340px\),560px\)\}/)
  // T4: Export off says why beside it
  const gl = json('example/states/greenlight_open.json'); gl.greenlit = []
  const page = L.view(gl, {}), tools = /<div class="toolrow" role="toolbar"[\s\S]*?<\/div>/.exec(page)![0]
  if (/data-dock="export"[^>]*aria-disabled="true"/.test(tools)) assert.match(tools, /Export…<\/button><span class="why lock">[^<]+<\/span>/)
  // T8: the look-up's OK is a plain button, so the step keeps its one primary
  assert.match(html, /btn\('OK, look it up', 'data-lq-ok="' \+ esc\(q\.id\) \+ '"', false, dis\)/)
  // T3: the compass labels are big enough to read at a laptop width, and the compass stacks above the crew below 1180 px
  assert.match(html, /#compass \.tn\{font:800 15px/); assert.match(html, /@media \(max-width:1180px\)\{\.exgrid\{grid-template-columns:minmax\(0,1fr\)\}\}/)
})

test('the acceptance run\'s findings stay fixed (territories-accept, 2026-11-25)', () => {
  // A13: a refused save shows Brief's failed stage with the engine's words and Try again; with insights kept, Pick shows them and the reason
  const d = json('example/states/pick.json'); d.focus.insights = []
  d.run = { state: 'failed', stage: 'pick', error: { stage: 'pick', message: 'The result could not be saved because it did not fit what the app can show. 1 thing to fix.', retryable: true, refused: ['The pick has 103 sources; the most allowed is 80.'] } }
  const st = L.view(d, {})
  assert.match(plain(st), /did not fit what the app can show\. 1 thing to fix\. The pick has 103 sources; the most allowed is 80\. Nothing was lost\./)
  assert.match(st, /data-act="first">Try again/); assert.doesNotMatch(plain(st), /a list/)
  const kept = json('example/states/pick.json'); kept.run = { ...d.run }
  const kv = L.view(kept, {})
  assert.match(plain(kv), /Which insights should the crew explore\?[\s\S]*did not fit what the app can show/)
  assert.match(kv, /data-act="first">Try again/, 'kept insights: the Booth offers Try again')
  assert.doesNotMatch(plain(kv), /Your pick is in/, 'a pick that was not saved never reads as in')
  assert.match(plain(kv), /but the pick could not be saved\. They are kept here/); assert.doesNotMatch(plain(kv), /are ticked for you/)
  assert.ok(L.act(kept, {}, { a: 'first' }, {})?.start, 'Try again starts the run, which rebuilds the Pick from the kept insights')
  // A11: the carried sources' state is the host's (GET /upstream): locked reads Locked, not Draft
  const a = json('example/states/pick.json'); a.focus.insights = []; a.run = {}
  const ids = Object.keys(a.upstream)
  const entries = ids.map((id: string) => ({ document_id: id, locked: true, status: 'current', version: '1.2' }))
  const locked = L.view(a, { upEntries: entries })
  assert.match(locked, /✓ Locked/); assert.doesNotMatch(locked, /nsrc-chip draft/)
  assert.match(L.view(a, {}), /nsrc-chip draft/, 'with no word from the host, a card stays honest: Draft')
  // the crew's whole quote list scrolls: hundreds of sources, the Pick stays usable
  assert.match(html, /\.evlist\{[^}]*max-height:min\(420px,50vh\);overflow-y:auto/)
})

test('a result the host did not save fails in words with Try again, never sits on What arrived (A25, 2026-11-25)', () => {
  // the host's answer to job_status when the document's own (older) schema refused the engine's change
  const reason = 'agent output rejected: ["focus.sources: [{...}] has more than 80 items"]'
  const words = L.changeRefusal({ applied: false, reason })
  assert.match(words, /^The result could not be saved: this document’s own rules refused it \(the sources the crew may quote: more than it allows\)\./)
  assert.doesNotMatch(words, /agent output|\[|maxItems|focus\.sources/, 'plain words, no machine text')
  assert.equal(L.changeRefusal({ applied: true }), null); assert.equal(L.changeRefusal(undefined), null)
  assert.match(L.changeRefusal({ applied: false, reason: 'stale base' }), /^The result could not be saved: this document’s own rules refused it\. /)
  // the page's job turns failed with those words: Brief's failed stage, the reason, Try again, and the step stays Pick
  const d = json('example/states/pick.json'); d.focus.insights = []; d.run = {}
  const st = L.view(d, { job: { state: 'failed', error: words, crewRun: false } })
  assert.match(plain(st), /could not be saved: this document’s own rules refused it[\s\S]*Nothing was lost\./)
  assert.match(st, /data-act="first">Try again/)
  assert.ok(L.act(d, {}, { a: 'first' }, {})?.start, 'Try again starts the run again (the engine reuses the insights it already paid for)')
  // the runtime reads the host's change on every job_status and on a step's answer
  assert.match(html, /var refusedW = j\.state === 'done' \? L\.changeRefusal\(b\.change\) : null;\s*if \(refusedW\) \{ j\.state = 'failed'; j\.error = refusedW; \}/)
  assert.match(html, /if \(r\.state === 'done' && L\.changeRefusal\(b\.change\)\) \{ reqFailed\(r,/)
})

function eq(a: unknown, b: unknown) { assert.deepEqual(JSON.parse(JSON.stringify(a)), b) }
