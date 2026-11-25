// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Brand Clan phase 2, lane C1 (mocks c1 and c2): the Brand Clan chip in Brief Maker and Research. It reads
// /attach-targets, shows the Brand Clan the document holds ("Tidewell · Zero ▾"), picks another (POST /attach:
// attach replaces the one held), offers Update only when the Brand Clan published a newer version (POST
// /attach/update), and starts new work on the client's default. Nothing changes until a person presses.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!root.pathname.endsWith('/app/')) root = new URL('..', root)
const brief = readFileSync(new URL('templates/brief-maker/index.html', root), 'utf8')
const research = readFileSync(new URL('templates/campaign-research/index.html', root), 'utf8')

function chipScript(html: string): string {
  const at = html.indexOf('<!-- BRAND CLAN CHIP')
  assert.ok(at >= 0, 'the chip block is in the page')
  const s = html.indexOf('<script>', at) + '<script>'.length
  return html.slice(s, html.indexOf('</script>', s))
}

interface Target { app_id: string; document_id: string; title: string; version: number | null; held_version: number | null; attached: boolean; default: boolean; locked: boolean; updated_at: string; client: { id: string; name: string } | null }
const T = (over: Partial<Target>): Target => ({ app_id: 'ie.napkin.brand', document_id: 'bc-zero', title: 'Zero', version: 2, held_version: null, attached: false, default: false, locked: false, updated_at: '2026-11-12T10:00:00Z', client: { id: 'c1', name: 'Tidewell' }, ...over })

function run(html: string, opts: { targets: Target[][]; data?: Record<string, unknown>; drafted?: string }) {
  const noun = html === brief ? 'brief' : 'research'
  const mount = { hidden: true, innerHTML: '', attrs: { 'data-bc-drafted': opts.drafted ?? 'objectives,audience', 'data-bc-noun': noun } as Record<string, string>, getAttribute(k: string) { return this.attrs[k] ?? null }, contains: () => false }
  const posts: { route: string; id: string }[] = []
  let calls = 0
  const listeners: Record<string, ((e: unknown) => void)[]> = {}
  const fetch = (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      posts.push({ route: url.replace(/^clan:\/\/localhost/, ''), id: JSON.parse(init.body ?? '{}').document_id })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
    }
    const list = opts.targets[Math.min(calls++, opts.targets.length - 1)]
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(list) })
  }
  const document = {
    readyState: 'complete', documentElement: { getAttribute: () => null },
    getElementById: (id: string) => (id === 'bcChip' ? mount : null),
    addEventListener: (t: string, f: (e: unknown) => void) => { (listeners[t] ??= []).push(f) },
  }
  const window: Record<string, unknown> = { __CLAN__: { data: opts.data ?? {} }, addEventListener: () => {} }
  vm.runInNewContext(chipScript(html), { document, window, navigator: { userAgent: 'Linux' }, fetch, Promise, JSON, Date, isNaN, Array, Object, String })
  const chip = window.__bcChip as { reload: () => Promise<void>; poll: () => Promise<boolean>; state: { open: boolean } }
  const click = (sel: { attr: string; value?: string }) => {
    const target = { closest: () => ({ getAttribute: (k: string) => (k === sel.attr ? sel.value ?? '' : null), hasAttribute: (k: string) => k === sel.attr }) }
    mount.contains = () => true
    listeners.click.forEach(f => f({ target }))
  }
  return { mount, posts, chip, click }
}
const settle = () => new Promise(r => setTimeout(r, 20))

for (const [name, html] of [['Brief Maker', brief], ['Research', research]] as const) {
  test(`${name}: no Brand Clan for the client, no chip`, async () => {
    const { mount } = run(html, { targets: [[{ ...T({}), app_id: 'ie.napkin.campaign-research' }]] })
    await settle()
    assert.equal(mount.hidden, true)
    assert.equal(mount.innerHTML, '')
  })

  test(`${name}: the chip names the client and the Brand Clan held; the menu marks the default and the one held`, async () => {
    const list = [T({ document_id: 'bc-orig', title: 'Original', version: 3, default: true }), T({ attached: true, held_version: 2 }), T({ document_id: 'bc-s26', title: 'Summer 26', version: 1 })]
    const { mount, chip } = run(html, { targets: [list] })
    await settle()
    assert.equal(mount.hidden, false)
    assert.match(mount.innerHTML, /Tidewell · Zero/)
    assert.doesNotMatch(mount.innerHTML, /Brand Clan updated/, 'held v2 of v2: nothing to update')
    chip.state.open = true
    await chip.reload()
    assert.match(mount.innerHTML, /Brand Clan for this (brief|research)/)
    assert.match(mount.innerHTML, /Original <small>· default<\/small>/)
    assert.match(mount.innerHTML, /aria-checked="true" data-bc-pick="bc-zero"/)
    assert.match(mount.innerHTML, /v3 · Updated 12 Nov\./)
    assert.match(mount.innerHTML, /keeps the version it has\. A newer one shows an Update chip\./)
  })

  test(`${name}: a Brand Clan titled with its client reads by its own name under the client (the host titles it "Tidewell · Zero")`, async () => {
    const { mount, chip } = run(html, { targets: [[T({ title: 'Tidewell · Zero', attached: true, held_version: 2 }), T({ document_id: 'bc-orig', title: 'Tidewell · Original', default: true })]] })
    await settle()
    assert.match(mount.innerHTML, /<span>Tidewell · Zero<\/span>/)
    assert.doesNotMatch(mount.innerHTML, /Tidewell · Tidewell/)
    chip.state.open = true
    await chip.reload()
    assert.match(mount.innerHTML, /<span class="nm">Original <small>· default<\/small><\/span>/)
  })

  test(`${name}: picking another Brand Clan is one attach, as a person; Update appears only for a newer version`, async () => {
    const list = [T({ document_id: 'bc-orig', title: 'Original', version: 3, default: true }), T({ attached: true, held_version: 1, version: 2 })]
    const { mount, posts, click } = run(html, { targets: [list] })
    await settle()
    assert.match(mount.innerHTML, /Brand Clan updated <button type="button" data-bc="update">Update<\/button>/)
    assert.equal(posts.length, 0, 'nothing is written until a person presses')
    click({ attr: 'data-bc', value: 'update' })
    await settle()
    assert.deepEqual(posts, [{ route: '/attach/update', id: 'bc-zero' }])
    click({ attr: 'data-bc-pick', value: 'bc-orig' })
    await settle()
    assert.deepEqual(posts[1], { route: '/attach', id: 'bc-orig' })
  })

  test(`${name}: new work starts on the client's default; work already under way is never changed`, async () => {
    const list = [T({ document_id: 'bc-orig', title: 'Original', version: 3, default: true }), T({})]
    const fresh = run(html, { targets: [list, list.map(t => t.default ? { ...t, attached: true, held_version: 3 } : t)], data: {} })
    await settle()
    assert.deepEqual(fresh.posts, [{ route: '/attach', id: 'bc-orig' }])
    const keys = html === brief ? { objectives: ['Sell 60,000 bottles'] } : { report: { sections: [{ id: 'a' }] } }
    const begun = run(html, { targets: [list], data: keys, drafted: html === brief ? 'objectives,audience' : 'report,asks' })
    await settle()
    assert.equal(begun.posts.length, 0, 'a document with work in it is not re-linked')
  })

  test(`${name}: a locked document keeps its Brand Clan: the menu says why and offers nothing`, async () => {
    const list = [T({ attached: true, held_version: 1, version: 2, locked: true }), T({ document_id: 'bc-orig', title: 'Original', locked: true })]
    const { mount, chip, posts } = run(html, { targets: [list] })
    await settle()
    assert.match(mount.innerHTML, /data-bc="update" disabled title="The (brief|research) is locked"/)
    chip.state.open = true
    await chip.reload()
    assert.match(mount.innerHTML, /is locked, so its Brand Clan stays as it is/)
    assert.equal((mount.innerHTML.match(/data-bc-pick="[^"]+" disabled/g) ?? []).length, 2)
    assert.equal(posts.length, 0)
  })
}

test('the chip is the same block in Brief Maker and Research (one component, two pages)', () => {
  assert.equal(chipScript(brief), chipScript(research))
  assert.match(brief, /<div class="bcchip-wrap" id="bcChip" hidden data-bc-noun="brief" data-bc-drafted="[^"]+"><\/div>\n {4}<h2 class="isec" id="introH">/)
})

test('Brief Maker tells the shell when it stored a file (clan:file-added, the brand flow\'s contract)', () => {
  assert.match(brief, /window\.parent\.postMessage\(\{type:'clan:file-added',name:name,label:file\.name\},'\*'\)/)
})

for (const [name, html] of [['Brief Maker', brief], ['Research', research]] as const) {
  test(`${name}: a Brand Clan published while the document is open shows Update without a reload (A33)`, async () => {
    const held = T({ attached: true, version: 2, held_version: 2 })
    const { mount, chip } = run(html, { targets: [[held], [held], [{ ...held, version: 3 }]] })
    await settle()
    assert.doesNotMatch(mount.innerHTML, /data-bc-upd/)
    assert.equal(await chip.poll(), false, 'nothing new: the chip is not redrawn')
    assert.equal(await chip.poll(), true)
    assert.match(mount.innerHTML, /Brand Clan updated/)
    assert.match(mount.innerHTML, /data-bc="update"/)
  })
}
