// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Idea room (features/idea-room.clan), slice 1: the page's card model. The rules that decide what the
// team sees are proved on the host (crates/napkin-host/tests/idea_room.rs); the page's own are proved here, run
// as it ships in jsdom against the host's own shapes (`GET /ideas/room`, `GET /ideas/routes`):
//
//  - every idea is a card, with its author, its brief link, its votes and its comments;
//  - votes are counted per card and never per person;
//  - a Banned card takes no vote and goes into no route;
//  - the humans-first count and what the page says about it;
//  - the creative director alone is offered the pick and the early opening;
//  - a write that fails keeps the typed words, and the shell's Try again sends it again once.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { after, test } from 'node:test'
import { JSDOM } from 'jsdom'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const HTML = read('templates/idea-room/index.html')

type Json = Record<string, unknown>

const BRIEF = { insight: 'Younger drinkers think Irish whiskey is for someone else.', single_minded_proposition: 'The easy way into Irish whiskey.', project_name: 'J001 Client A' }
const card = (n: number, extra: Json = {}) => ({
  text: `Idea ${n}`, by: n % 2 ? 'maeve@wk' : 'oisin@wk', kind: 'team', at: '2026-11-12T09:10:00Z',
  brief_link: { insight: BRIEF.insight, proposition: BRIEF.single_minded_proposition }, votes: [], comments: [], tests: {}, ...extra,
})
const cards = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i + 1}`, card(i + 1)]))
const gate = (team: number, extra: Json = {}) => ({
  team_cards: team, needed: 5, to_go: Math.max(0, 5 - team), open: team >= 5, opened_via: team >= 5 ? 'cards' : null, opened_by: null,
  creative_director: 'dara@wk', routes_out: [], chosen: null, ...extra,
})
const room = (data: Json, g: Json, brief: Json | null = { title: 'J001 brief', changed: false }) => ({ data: { upstream: { doc_brief: BRIEF }, ...data }, gate: g, brief })

// The page polls the host now and then; the windows are closed when the tests end so the runner can exit.
const windows: { close: () => void }[] = []
after(() => { for (const w of windows) w.close() })

async function page(opts: { room?: unknown; routes?: unknown; me?: string; post?: (path: string, body: Json) => { status: number; body: Json } | 'network' } = {}) {
  const posts: { path: string; body: Json }[] = []
  const messages: Json[] = []
  const html = HTML.replace(/<link[^>]*>/g, '').replace('<!-- @napkin:clan-fields -->', '')
  const dom = new JSDOM(html, {
    url: 'https://napkin.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      const win = w as unknown as Record<string, unknown>
      win.__CLAN__ = { data: {} }
      win.clan = { me: () => Promise.resolve({ actor: `human:${opts.me ?? 'maeve@wk'}`, id: opts.me ?? 'maeve@wk', name: null }) }
      // The page tells its parent how each write went; the shell shows the Failed save state from it.
      Object.defineProperty(w, 'parent', { value: { postMessage: (m: Json) => messages.push(m) } })
      win.fetch = (url: string, init?: { method?: string; body?: string }) => {
        const path = String(url).replace(/^.*localhost/, '')
        if (init?.method === 'POST') {
          const body = init.body ? JSON.parse(init.body) as Json : {}
          posts.push({ path, body })
          const out = opts.post?.(path, body) ?? { status: 200, body: { ok: true } }
          if (out === 'network') return Promise.reject(new TypeError('Failed to fetch'))
          return Promise.resolve({ ok: out.status < 300, status: out.status, json: () => Promise.resolve(out.body) })
        }
        const body = path === '/ideas/room' ? (opts.room ?? room({ cards: cards(2) }, gate(2))) : path === '/ideas/routes' ? (opts.routes ?? { routes: {} }) : null
        return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body) })
      }
    },
  })
  windows.push(dom.window)
  await new Promise(r => setTimeout(r, 40))
  const d = dom.window.document
  return {
    dom, d, posts, messages,
    text: (sel: string) => d.querySelector(sel)?.textContent?.trim() ?? null,
    all: (sel: string) => [...d.querySelectorAll<HTMLElement>(sel)],
    settle: () => new Promise(r => setTimeout(r, 40)),
  }
}

test('every idea is a card: its words, its author, its votes, and the brief it answers shown above', async () => {
  const p = await page({ room: room({ cards: { c1: card(1, { votes: ['dara@wk', 'oisin@wk'], comments: [{ by: 'oisin@wk', text: 'The pour is the film.', at: '2026-11-12T10:00:00Z' }] }), c2: card(2) } }, gate(2)) })
  assert.equal(p.all('[data-testid="card"]').length, 2)
  assert.match(p.text('[data-card="c1"] .idea-text')!, /^Idea 1$/)
  assert.match(p.text('[data-card="c1"] .meta')!, /^Maeve · 12 Nov$/)
  assert.match(p.text('[data-card="c1"] .comments')!, /Oisin The pour is the film\./)
  assert.equal(p.text('[data-testid="brief-insight"]'), BRIEF.insight)
  assert.equal(p.text('[data-testid="brief-proposition"]'), BRIEF.single_minded_proposition)
  assert.match(p.text('#eyebrow')!, /Idea room · J001 Client A/)
})

test('votes are counted per card and the page never names who voted', async () => {
  const p = await page({ room: room({ cards: { c1: card(1, { votes: ['rory@wk', 'tadhg@wk'] }), c2: card(2, { votes: ['rory@wk'] }) } }, gate(2)) })
  assert.deepEqual(p.all('[data-testid="votes"]').map(x => x.textContent), ['2', '1'])
  for (const who of ['rory', 'Rory', 'tadhg', 'Tadhg']) assert.ok(!p.text('#cards')!.includes(who), `${who} is not shown as a voter`)
  const api = (p.dom.window as unknown as { __ideaRoom: { votesOf: (c: unknown) => number } }).__ideaRoom
  assert.equal(api.votesOf({ votes: ['a', 'b', 'c'] }), 3)
  assert.equal(api.votesOf({}), 0)
})

test('pressing vote posts one /ideas/vote for that card', async () => {
  const p = await page()
  p.d.querySelector<HTMLButtonElement>('[data-vote="c2"]')!.click()
  await p.settle()
  assert.deepEqual(p.posts, [{ path: '/ideas/vote', body: { card: 'c2' } }])
})

test('humans first: four cards say one card to go, five say the room is open; no AI idea is ever drawn', async () => {
  const four = await page({ room: room({ cards: cards(4) }, gate(4)) })
  assert.equal(four.text('[data-testid="team-count"]'), '4')
  assert.match(four.text('[data-testid="to-go"]')!, /^One card to go\./)
  assert.equal(four.d.querySelector('[data-testid="ai-ideas"]'), null)
  assert.equal(four.all('.pips i.on').length, 4)
  const three = await page({ room: room({ cards: cards(3) }, gate(3)) })
  assert.match(three.text('[data-testid="to-go"]')!, /^Two cards to go\./)
  const five = await page({ room: room({ cards: cards(5) }, gate(5)) })
  assert.equal(five.d.querySelector('[data-testid="to-go"]'), null)
  assert.match(five.text('#gate')!, /The team's 5 cards are in\. The room is open\./)
  assert.equal(five.d.querySelector('[data-testid="ai-ideas"]'), null)
})

test('only the creative director is offered the early opening, and it asks for a reason', async () => {
  const writer = await page({ room: room({ cards: cards(2) }, gate(2)), me: 'maeve@wk' })
  assert.equal(writer.d.querySelector('[data-early]'), null)
  assert.match(writer.text('#gate')!, /Only Dara, the creative director on the brief, can open it early\./)
  const cd = await page({ room: room({ cards: cards(2) }, gate(2)), me: 'dara@wk' })
  cd.d.querySelector<HTMLButtonElement>('[data-early]')!.click()
  const open = cd.d.querySelector<HTMLButtonElement>('#openEarly')!
  assert.equal(open.getAttribute('aria-disabled'), 'true', 'no reason, no opening')
  cd.d.querySelector<HTMLButtonElement>('#openEarly')!.click()
  await cd.settle()
  assert.deepEqual(cd.posts, [])
  const ta = cd.d.querySelector<HTMLTextAreaElement>('#earlyWhy')!
  ta.value = 'The team asked for help.'
  ta.dispatchEvent(new cd.dom.window.Event('input', { bubbles: true }))
  cd.d.querySelector<HTMLButtonElement>('#openEarly')!.click()
  await cd.settle()
  assert.deepEqual(cd.posts, [{ path: '/ideas/open-early', body: { rationale: 'The team asked for help.' } }])
})

test('adding a card posts the words once; a failed save keeps them, reports it, and the shell retry sends them again', async () => {
  let down = true
  const p = await page({ post: () => (down ? 'network' : { status: 200, body: { ok: true, card: 'c3' } }) })
  const ta = p.d.querySelector<HTMLTextAreaElement>('#cardInput')!
  ta.value = 'A card written offline.'
  ta.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
  p.d.querySelector<HTMLButtonElement>('#addCard')!.click()
  await p.settle()
  const failed = p.messages.find(m => m.type === 'clan:write' && m.state === 'failed')
  assert.ok(failed, 'the page reports the failed write to the shell')
  assert.equal(failed!.text, 'A card written offline.')
  assert.equal(p.d.querySelector<HTMLTextAreaElement>('#cardInput')!.value, 'A card written offline.', 'the text stays')
  down = false
  // Try again, as the shell sends it, twice: one decision.
  p.dom.window.dispatchEvent(new p.dom.window.MessageEvent('message', { data: { type: 'clan:retry', id: failed!.id } }))
  p.dom.window.dispatchEvent(new p.dom.window.MessageEvent('message', { data: { type: 'clan:retry', id: failed!.id } }))
  await p.settle()
  assert.equal(p.posts.filter(x => x.path === '/ideas/card' && x.body.text === 'A card written offline.').length, 2, 'one failed send, one retry')
  assert.ok(p.messages.some(m => m.type === 'clan:write' && m.state === 'saved' && m.id === failed!.id))
  assert.equal(p.d.querySelector<HTMLTextAreaElement>('#cardInput')!.value, '', 'saved, so the composer is clear')
})

test('a refusal the host explains is shown in words and is not offered as a retry', async () => {
  const p = await page({ post: () => ({ status: 409, body: { ok: false, error: 'routes are out (route_1, route_2); merge them before changing the room' } }) })
  const ta = p.d.querySelector<HTMLTextAreaElement>('#cardInput')!
  ta.value = 'Too late.'
  ta.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }))
  p.d.querySelector<HTMLButtonElement>('#addCard')!.click()
  await p.settle()
  assert.match(p.text('#roomError')!, /routes are out/)
  assert.equal(p.messages.filter(m => m.state === 'failed').length, 0)
})

test('a Banned card takes no vote and cannot be put in a route', async () => {
  const banned = card(1, { kind: 'banned' })
  const p = await page({ room: room({ cards: { c1: banned, c2: card(2), c3: card(3) } }, gate(5, { team_cards: 5 })) })
  assert.equal(p.d.querySelector('[data-card="c1"] [data-vote]'), null)
  assert.ok(p.d.querySelector('[data-card="c2"] [data-vote]'))
})

test('routes: start needs two named routes and an open room', async () => {
  const closed = await page({ room: room({ cards: cards(2) }, gate(2)) })
  assert.equal(closed.d.querySelector('#startRoutes')?.getAttribute('aria-disabled'), 'true')
  assert.match(closed.text('#routes')!, /Routes start once the room is open\./)
  const p = await page({ room: room({ cards: cards(5) }, gate(5)) })
  const name = (i: number, v: string) => { const el = p.d.querySelector<HTMLInputElement>(`[data-b-name="${i}"]`)!; el.value = v; el.dispatchEvent(new p.dom.window.Event('input', { bubbles: true })) }
  assert.match(p.text('#routes')!, /Name at least two routes\./)
  name(0, 'One song')
  assert.equal(p.d.querySelector('#startRoutes')?.getAttribute('aria-disabled'), 'true')
  name(1, 'The long pour')
  assert.equal(p.d.querySelector('#startRoutes')?.getAttribute('aria-disabled'), 'false')
  p.d.querySelector<HTMLButtonElement>('[data-row="0"][data-b-card="c1"]')!.click()
  p.d.querySelector<HTMLButtonElement>('#startRoutes')!.click()
  await p.settle()
  assert.equal(p.posts.length, 1)
  assert.equal(p.posts[0].path, '/ideas/routes/start')
  assert.deepEqual((p.posts[0].body.routes as Json[]).map(r => r.name), ['One song', 'The long pour'])
  assert.deepEqual((p.posts[0].body.routes as Json[])[0].cards, ['c1'])
})

test('routes that are out can be worked on and merged; cards are held meanwhile', async () => {
  const p = await page({
    room: room({ cards: cards(5), routes_out: ['route_1', 'route_2'] }, gate(5, { routes_out: ['route_1', 'route_2'] })),
    routes: { routes: { route_1: { name: 'One song', bet: 'A bar goes quiet.', cards: ['c1'], notes: [], version: 1 }, route_2: { name: 'The long pour', bet: 'A slow pour.', cards: [], notes: [], version: 1 } } },
  })
  assert.equal(p.all('[data-testid="route"]').length, 2)
  assert.equal(p.d.querySelector('#cardInput'), null, 'the composer is gone while routes are out')
  assert.equal(p.d.querySelector('[data-vote]'), null)
  p.d.querySelector<HTMLButtonElement>('#mergeRoutes')!.click()
  await p.settle()
  assert.deepEqual(p.posts.map(x => x.path), ['/merge'])
})

test('after the merge the creative director picks; anyone else is told who does', async () => {
  const merged = { cards: cards(5), routes: { route_1: { name: 'One song', bet: 'b', cards: ['c1'], notes: [], version: 2 }, route_2: { name: 'The long pour', bet: 'b', cards: [], notes: [], version: 1 } } }
  const cd = await page({ room: room(merged, gate(5)), me: 'dara@wk' })
  assert.equal(cd.all('[data-pick]').length, 2)
  cd.d.querySelector<HTMLButtonElement>('[data-pick="route_1"]')!.click()
  await cd.settle()
  assert.equal(cd.posts[0].path, '/ideas/pick')
  assert.equal(cd.posts[0].body.route, 'route_1')
  const writer = await page({ room: room(merged, gate(5)), me: 'maeve@wk' })
  assert.equal(writer.all('[data-pick]').length, 0)
  assert.match(writer.text('[data-testid="pick-note"]')!, /Only Dara, the creative director on the brief, picks the route\./)
})

test('the chosen route is stamped with its version and who chose it, and reopening asks why', async () => {
  const data = { cards: cards(5), routes: { route_1: { name: 'One song', bet: 'b', cards: [], notes: [], version: 2 } }, chosen: { route: 'route_1', version: '2', decision: 'd_1', by: 'dara@wk', at: '2026-11-12T11:00:00Z' } }
  const p = await page({ room: room(data, gate(5, { chosen: data.chosen })), me: 'dara@wk' })
  assert.match(p.text('[data-testid="chosen-route"]')!, /Chosen · version 2 · Dara/)
  assert.equal(p.all('[data-pick]').length, 0)
  p.d.querySelector<HTMLButtonElement>('[data-reopen]')!.click()
  assert.equal(p.d.querySelector('#reopenGo')?.getAttribute('aria-disabled'), 'true')
})

test('Changed brief is asked of the shell with its own words, and the shell\'s update button takes the new version', async () => {
  const p = await page({ room: room({ cards: cards(2) }, gate(2), { title: 'J001 brief', changed: true, from: 1, to: 2 }) })
  const bar = p.messages.filter(m => m.type === 'clan:bar').pop() as { items: Json[] }
  assert.equal(JSON.stringify(bar.items.map(i => [i.kind, i.state, i.from, i.to])), JSON.stringify([['state', 'changed-brief', 'v1', 'v2']]))
  assert.equal(p.d.querySelector('[data-state="changed-brief"]'), null, 'the page draws none of its own: the shell does')
  p.dom.window.dispatchEvent(new p.dom.window.MessageEvent('message', { data: { type: 'clan:bar-action', id: 'state-update' } }))
  await p.settle()
  assert.deepEqual(p.posts.map(x => x.path), ['/upstream/update'])
  const calm = await page({ room: room({ cards: cards(2) }, gate(2)) })
  assert.equal(((calm.messages.filter(m => m.type === 'clan:bar').pop() as { items: Json[] } | undefined)?.items ?? []).length, 0)
})

test('the page and its copy hold no em dash, and no real brand or award name', () => {
  for (const file of ['templates/idea-room/index.html', 'templates/idea-room/context.md', 'templates/idea-room/example/data.yaml', 'templates/idea-room/schema.json']) {
    const text = read(file)
    assert.ok(!text.includes('—'), `${file} holds an em dash`)
    assert.ok(!/cannes|effie|warc/i.test(text.replace(/No Cannes, Effie or WARC material[^\n]*/g, '')), `${file} names an award archive`)
  }
})

test('the example data and the schema cover every field the page reads', () => {
  const yaml = read('templates/idea-room/example/data.yaml')
  for (const key of ['cards:', 'text:', 'by:', 'kind:', 'brief_link:', 'votes:', 'comments:', 'routes_out:', 'routes:', 'name:', 'bet:', 'version:']) assert.ok(yaml.includes(key), key)
  const schema = JSON.parse(read('templates/idea-room/schema.json')) as { properties: Record<string, unknown> }
  for (const key of ['cards', 'ai_open', 'routes_out', 'routes', 'chosen']) assert.ok(key in schema.properties, `schema: ${key}`)
})

test('every colour the page draws on a rectangle holds: cards are rectangles, never a circle', () => {
  const css = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'))
  for (const sel of ['.idea{', '.route{', '.pips i{', '.brief{']) {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
    const r = /border-radius:(\d+)px/.exec(rule)
    assert.ok(r && Number(r[1]) <= 2, `${sel} has a corner no rounder than 2 px`)
  }
})
