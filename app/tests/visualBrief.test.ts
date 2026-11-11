// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The visual brief (features/visual-brief.clan), one page from a chosen territory. Each `done_when` line has
// its test, here or beside the code it proves:
//
//  1. Choosing a territory spins off a one-page brief that carries the proposition, the territory, tone, must
//     show and never show, and its lineage names the brief version and the territory: the packer's contract
//     (below), crates/clan-sdk/tests/visual_brief.rs (the spin-off) and the e2e spec (the real path).
//  2. The creative director approves one version and it locks; a write after it is a 409:
//     crates/napkin-host/tests/visual_brief.rs, and the lock control below.
//  3. A later change makes a new version and the approved one stays: the host test, and the version words below.
//  4. Every image sits in a rectangle: the CSS lint below.
//  5. Territories uses no Cannes material: e2e/visual-brief.spec.ts runs the engine's retrieval trace.
//
// The page is run as it ships, in jsdom, against the host's own shapes (the decisions view, the upstream view).

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const HTML = read('templates/visual-brief/index.html')

type Json = Record<string, unknown>

const EXAMPLE: Json = {
  territory: { name: 'Permission to stop', line: 'The evening does not start until something says the day is over.', source: 'typed', chosen_by: 'Dara' },
  proposition: 'The whiskey that waits for you.',
  tone: ['Unhurried', 'Dry', 'Never nostalgic'],
  must_show: ['The 70 cl bottle, label forward', 'The age statement, readable'],
  never_show: ['Anyone who looks under 25', 'Driving', 'Sport'],
  reference_frames: {},
  upstream: { doc_brief: { signers: [{ role: 'planner', person: 'aoife@wk' }, { role: 'creative_director', person: 'dara@wk' }] } },
}

const here = (extra: Json = {}) => ({ targets: [{ here: true, path: '', address: 'doc#', label: '', kind: 'document' }], ...extra })
const approve = (id: string) => ({ decision: { id, kind: 'approve', agent: 'human', action: 'approve' }, superseded: false, ...here() })
const carried = (id: string) => ({ decision: { id, kind: 'approve', agent: 'human', action: 'approve' }, superseded: false, targets: [{ here: false, path: '', address: 'brief#', label: '', kind: 'document' }] })
const view = (decisions: unknown[], locked: boolean) => ({ document_id: 'doc', version: 'v', decisions, attention: [], lock: { can_lock: true, blockers: 0, locked, reopened: [] } })
const UP = { document_id: 'doc', carried: { document_id: 'brief' }, upstream: [{ document_id: 'brief', direct: true, in_store: true, title: 'J001 brief', path: '/b.clan', how: 'made_from', locked: true, status: 'current' }] }

/** Run the page with the host's answers; resolves once it has read them. */
async function page(opts: { data?: Json; decisions?: unknown; up?: unknown; me?: string | null } = {}) {
  const writes: { path: unknown; value: unknown; opts: Json }[] = []
  const posts: string[] = []
  const html = HTML.replace(/<link[^>]*>/g, '').replace('<!-- @napkin:clan-fields -->', '')
  const dom = new JSDOM(html, {
    url: 'https://napkin.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, unknown>
      win.__CLAN__ = { data: opts.data ?? EXAMPLE }
      win.clan = {
        patchData: (path: unknown, value: unknown, o: Json) => { writes.push({ path, value, opts: o }); return Promise.resolve() },
        me: () => Promise.resolve(opts.me === null ? null : { actor: `human:${opts.me ?? 'dara@wk'}`, id: opts.me ?? 'dara@wk', name: 'Dara' }),
      }
      win.fetch = (url: string, init?: { method?: string }) => {
        const u = String(url)
        if (init?.method === 'POST') { posts.push(u.replace(/^.*localhost/, '')); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }) }
        const body = u.endsWith('/decisions') ? (opts.decisions ?? view([carried('c1')], false)) : u.endsWith('/upstream') ? (opts.up ?? UP) : null
        return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body) })
      }
    },
  })
  await new Promise(r => setTimeout(r, 30))
  const d = dom.window.document
  return { dom, d, writes, posts, text: (sel: string) => d.querySelector(sel)?.textContent?.trim() ?? null, all: (sel: string) => [...d.querySelectorAll(sel)] }
}

// ── the template renders from its example data ─────────────────────────────────────────────────────

test('the page renders the territory, the proposition and the three lists from the example data', async () => {
  const p = await page()
  assert.equal(p.text('#tname'), 'Permission to stop')
  assert.match(p.text('#tline')!, /evening does not start/)
  assert.equal(p.text('#eyebrow'), 'Territory · written by hand · Dara')
  assert.equal(p.all('.row').length, 4)
  assert.equal(p.text('.row[data-key="proposition"] .val'), 'The whiskey that waits for you.')
  assert.deepEqual(p.all('.row[data-key="tone"] li').map(x => x.textContent), ['Unhurried', 'Dry', 'Never nostalgic'])
  assert.equal(p.all('.row[data-key="must_show"] li').length, 2)
  assert.equal(p.all('.row[data-key="never_show"] li').length, 3)
  assert.equal(p.all('.frame.empty').length, 3, 'three empty slots, nothing generated')
})

test('the example data covers every field the page reads', () => {
  const yaml = read('templates/visual-brief/example/data.yaml')
  for (const key of ['territory:', 'name:', 'line:', 'source:', 'proposition:', 'tone:', 'must_show:', 'never_show:', 'reference_frames:']) assert.ok(yaml.includes(key), key)
  const schema = JSON.parse(read('templates/visual-brief/schema.json')) as { properties: Record<string, unknown> }
  for (const key of ['territory', 'proposition', 'tone', 'must_show', 'never_show', 'reference_frames']) assert.ok(key in schema.properties, `schema: ${key}`)
})

test('a page with no territory says what is missing and cannot be approved', async () => {
  const p = await page({ data: { upstream: EXAMPLE.upstream } })
  assert.equal(p.text('#tname'), 'Name the territory')
  assert.equal(p.d.querySelector('#approve')?.getAttribute('aria-disabled'), 'true')
  assert.match(p.text('#approveReason')!, /Name the territory first/)
})

test('a frame uploaded shows in a rectangle with its caption, and an empty slot offers to add one', async () => {
  const data = { ...EXAMPLE, reference_frames: { a: { asset: 'frame-a-1.png', path: 'human/assets/frame-a-1.png', caption: 'Low sun on the bar' } } }
  const p = await page({ data })
  assert.equal(p.all('.frame img').length, 1)
  assert.equal(p.d.querySelector('.frame img')?.getAttribute('alt'), 'Low sun on the bar')
  assert.match(p.d.querySelector('.frame img')!.getAttribute('src')!, /\/assets\/frame-a-1\.png$/)
  assert.equal(p.all('.frame.empty').length, 2)
})

// ── the lock control ───────────────────────────────────────────────────────────────────────────────

test('open: Approve version 1, and the page is editable', async () => {
  const p = await page()
  assert.equal(p.text('#vnum'), '1')
  assert.equal(p.text('#approve'), 'Approve version 1')
  assert.equal(p.d.querySelector('#approve')?.getAttribute('aria-disabled'), 'false')
  assert.equal(p.d.querySelector('[data-testid="locked-stamp"]'), null)
  assert.ok(p.all('[data-edit]').length >= 6)
})

test('approving posts one /approve that names the version, and nothing else', async () => {
  const p = await page()
  p.d.querySelector<HTMLButtonElement>('#approve')!.click()
  await new Promise(r => setTimeout(r, 30))
  assert.deepEqual(p.posts, ['/approve'])
})

test('locked: a stamp names the version, nothing is editable, and a new version is one press away', async () => {
  const p = await page({ decisions: view([approve('a1'), carried('c1')], true) })
  assert.equal(p.text('#vnum'), '1')
  assert.match(p.text('#stamp')!, /Locked · version 1/)
  assert.equal(p.d.querySelector('#approve'), null)
  assert.deepEqual(p.all('button[data-edit],button[data-add],button[data-drop],button[data-swap],button[data-cap]').map(e => e.outerHTML), [], 'no edit buttons')
  assert.equal(p.text('#newv'), 'Start version 2')
  p.d.querySelector<HTMLButtonElement>('#newv')!.click()
  await new Promise(r => setTimeout(r, 30))
  assert.deepEqual(p.posts, ['/unapprove'])
})

test('a carried approve is the brief\'s, not this page\'s: it makes no version here', async () => {
  const p = await page({ decisions: view([carried('c1'), carried('c2')], false) })
  assert.equal(p.text('#vnum'), '1')
  assert.equal(p.text('#approve'), 'Approve version 1')
})

test('reopened after one approval: the next version is 2, and approving it is version 2', async () => {
  const p = await page({ decisions: view([approve('a1'), carried('c1')], false) })
  assert.equal(p.text('#vnum'), '2')
  assert.equal(p.text('#approve'), 'Approve version 2')
  assert.match(p.text('#approveReason')!, /makes version 3/)
})

test('approved twice: version 2 is the one locked, and the history holds both', async () => {
  const p = await page({ decisions: view([approve('a2'), approve('a1'), carried('c1')], true) })
  assert.equal(p.text('#vnum'), '2')
  assert.match(p.text('#stamp')!, /version 2/)
  assert.equal(p.text('#newv'), 'Start version 3')
})

test('only the creative director the brief names may approve: anyone else sees why', async () => {
  const p = await page({ me: 'aoife@wk' })
  assert.equal(p.d.querySelector('#approve')?.getAttribute('aria-disabled'), 'true')
  assert.match(p.text('#approveReason')!, /Only dara@wk, the creative director on the brief, approves it/)
  p.d.querySelector<HTMLButtonElement>('#approve')!.click()
  await new Promise(r => setTimeout(r, 30))
  assert.deepEqual(p.posts, [], 'a refused press sends nothing')
})

test('the brief it answers is named, with a way back to it', async () => {
  const p = await page()
  assert.match(p.d.querySelector('.card')!.textContent!, /Answers the brief J001 brief, signed/)
  assert.equal(p.d.querySelector('[data-open]')?.getAttribute('data-open'), '/b.clan')
})

test('a write names an agent and an action', async () => {
  const p = await page()
  p.d.querySelector<HTMLElement>('[data-edit="proposition"]')!.click()
  const ta = p.d.querySelector<HTMLTextAreaElement>('#ed')!
  assert.equal(ta.getAttribute('aria-label'), 'Write Proposition')
  ta.value = 'The whiskey that waits.'
  p.d.querySelector<HTMLButtonElement>('[data-done]')!.click()
  await new Promise(r => setTimeout(r, 30))
  assert.equal(p.writes.length, 1)
  assert.equal(p.writes[0].path, 'proposition')
  assert.equal(p.writes[0].value, 'The whiskey that waits.')
  assert.equal(p.writes[0].opts.actor, 'human')
  assert.equal(p.writes[0].opts.action, 'edit proposition')
})

test('a list is written one line to a row, blanks dropped', async () => {
  const p = await page()
  p.d.querySelector<HTMLElement>('[data-edit="never_show"]')!.click()
  p.d.querySelector<HTMLTextAreaElement>('#ed')!.value = 'Driving\n\n  Sport  \n'
  p.d.querySelector<HTMLButtonElement>('[data-done]')!.click()
  await new Promise(r => setTimeout(r, 30))
  assert.equal(JSON.stringify(p.writes[0].value), JSON.stringify(['Driving', 'Sport']))
})

// ── done_when 4: every image sits in a rectangle ───────────────────────────────────────────────────

/** The largest border-radius, in px, a CSS value names; Infinity for a percentage, em or a pill. */
function radiusPx(value: string): number {
  const nums = [...value.matchAll(/(-?[\d.]+)\s*(px|%|em|rem|vw|vh)?/g)].map(m => (m[2] && m[2] !== 'px' ? Infinity : Number(m[1])))
  return nums.length ? Math.max(...nums) : 0
}

/** Rules in `css` whose selector names an img or a video and that set a border-radius above `max` px. */
function roundedMedia(css: string, max = 2): string[] {
  const bad: string[] = []
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim()
    if (!/\b(img|video)\b/.test(selector)) continue
    for (const d of m[2].matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;}]+)/g)) {
      if (radiusPx(d[1]) > max) bad.push(`${selector} { border-radius: ${d[1].trim()} }`)
    }
  }
  return bad
}

test('the lint: no img or video in the template has a border-radius above 2 px', () => {
  const css = [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  assert.ok(css.length > 1000, 'the template has its own CSS')
  assert.deepEqual(roundedMedia(css), [])
  // Nor inline, in the markup or in the script that draws it.
  const inline = [...HTML.matchAll(/<(img|video)\b[^>]*style=["'][^"']*border-radius\s*:\s*([^;"']+)/g)].filter(m => radiusPx(m[2]) > 2)
  assert.deepEqual(inline.map(m => m[0]), [])
  // The frame the image sits in is a rectangle too.
  const box = css.match(/\.frame \.box\{([^}]*)\}/)![1]
  assert.ok(radiusPx(box.match(/border-radius\s*:\s*([^;]+)/)![1]) <= 2)
})

test('the lint refuses what it should', () => {
  assert.equal(roundedMedia('img{border-radius:50%}').length, 1)
  assert.equal(roundedMedia('.a img, .b{border-radius:999px}').length, 1)
  assert.equal(roundedMedia('video { border-top-left-radius: 8px }').length, 1)
  assert.equal(roundedMedia('img,video{border-radius:0}').length, 0)
  assert.equal(roundedMedia('.frame .box img{border-radius:2px}').length, 0)
  assert.equal(roundedMedia('.btn{border-radius:999px}').length, 0, 'a button is not an image')
})

// ── words and money: no em dash, no real names, no generated image ─────────────────────────────────

test('the page has no em dash and calls no paid or model route', () => {
  assert.ok(!HTML.includes('—'), 'no em dash in the template')
  for (const f of ['context.md', 'schema.json', 'agent/requirements.yaml', 'app/pipeline.yaml']) assert.ok(!read(`templates/visual-brief/${f}`).includes('—'), f)
  assert.ok(!/api-proxy|middleware|apiProxy/.test(HTML), 'the page makes no model or paid call')
  assert.match(read('templates/visual-brief/agent/requirements.yaml'), /tools:\s*\[\]/)
})

// ── the packer's spin-off contract ────────────────────────────────────────────────────────────────

test('the packer declares the spin-off: the brief carried whole, its proposition and tone lifted', () => {
  const rs = read('../crates/clan-sdk/examples/make_visual_brief.rs')
  assert.ok(rs.includes('"ie.napkin.visual-brief"'))
  assert.ok(rs.includes('upstream: true'))
  const flat = rs.replace(/\s+/g, '')
  assert.ok(flat.includes('"single_minded_proposition".to_string(),"proposition".to_string()'))
  assert.ok(flat.includes('"tone_and_world".to_string(),"tone".to_string()'))
})
