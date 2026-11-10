// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Just enough of a page for modules that touch it when they load (theme.ts
// sets data-theme on <html>). Import it first, before the module under test.

const g = globalThis as Record<string, unknown>
const props = new Map<string, string>()
const head: { children: unknown[]; appendChild: (el: unknown) => void } = { children: [], appendChild(el) { head.children.push(el) } }
const byId = new Map<string, { id: string; textContent: string }>()
g.window ??= g
// Modules that listen for the page's messages when they load (the host bridge).
if (typeof g.addEventListener !== 'function') g.addEventListener = () => {}
if (typeof g.removeEventListener !== 'function') g.removeEventListener = () => {}
g.document ??= {
  documentElement: {
    dataset: {} as Record<string, string>,
    style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k), getPropertyValue: (k: string) => props.get(k) ?? '' },
  },
  head,
  getElementById: (id: string) => byId.get(id) ?? null,
  createElement: () => {
    const el = { id: '', textContent: '' }
    return new Proxy(el, { set(t, k, v) { (t as Record<string, unknown>)[k as string] = v; if (k === 'id') byId.set(v as string, t); return true } })
  },
}
