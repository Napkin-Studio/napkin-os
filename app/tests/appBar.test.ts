// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What an app asks the OS bar to show (features/app-bar-actions.clan): the list
// the bar will take, and how it draws it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BAR_LIMITS, barFrom, overflowButtons } from '../src/shell/appBar.ts'
import { BarButtons, BarChips, BarTabs } from '../src/components/AppBarItems.tsx'

const tab = (id: string, extra = {}) => ({ kind: 'tab', id, label: id, ...extra })

test('a good list comes through as it was sent', () => {
  const got = barFrom({ v: 1, items: [tab('a', { current: true }), { kind: 'button', id: 'go', label: 'Build', primary: true, title: 'Starts it' }, { kind: 'chip', label: '0 errors', tone: 'ok' }] })
  assert.deepEqual(got, [
    { kind: 'tab', id: 'a', label: 'a', current: true, disabled: false },
    { kind: 'button', id: 'go', label: 'Build', primary: true, disabled: false, title: 'Starts it' },
    { kind: 'chip', label: '0 errors', tone: 'ok', title: '' },
  ])
})

test('anything but version 1 with a list is empty', () => {
  for (const m of [null, 'x', {}, { v: 2, items: [tab('a')] }, { v: 1 }, { v: 1, items: 'a' }]) assert.deepEqual(barFrom(m), [])
})

test('a kind from the future is left out, the rest stay', () => {
  const got = barFrom({ v: 1, items: [{ kind: 'menu', id: 'm', label: 'Menu' }, tab('a')] })
  assert.deepEqual(got.map(i => i.kind), ['tab'])
})

test('labels and titles are text, trimmed and cut; markup is not markup', () => {
  const [b] = barFrom({ v: 1, items: [{ kind: 'button', id: 'x', label: '  <b>Hi</b>   there  '.padEnd(80, 'z'), title: 7 }] })
  assert.ok(b.kind === 'button' && b.label.length === BAR_LIMITS.label && b.label.startsWith('<b>Hi</b> there'))
  assert.equal((b as { title: string }).title, '')
  const html = renderToStaticMarkup(createElement('span', null, b.label))
  assert.ok(html.includes('&lt;b&gt;'), 'drawn as text')
})

test('an item with no label, or a tab or button with no usable or a repeated id, is left out', () => {
  const got = barFrom({ v: 1, items: [tab('a'), tab('a'), { kind: 'tab', label: 'No id' }, { kind: 'tab', id: 7, label: 'Number' }, { kind: 'tab', id: 'x'.repeat(80), label: 'Long' }, { kind: 'button', id: 'b', label: '' }, tab('c')] })
  assert.deepEqual(got.map(i => (i.kind === 'chip' ? '' : i.id)), ['a', 'c'])
})

test('a bar takes at most 6 tabs, 6 buttons and 4 chips, and one current tab', () => {
  const items = [
    ...Array.from({ length: 9 }, (_, i) => tab(`t${i}`, { current: true })),
    ...Array.from({ length: 9 }, (_, i) => ({ kind: 'button', id: `b${i}`, label: `b${i}` })),
    ...Array.from({ length: 9 }, (_, i) => ({ kind: 'chip', label: `c${i}` })),
  ]
  const got = barFrom({ v: 1, items })
  assert.equal(got.filter(i => i.kind === 'tab').length, 6)
  assert.equal(got.filter(i => i.kind === 'button').length, 6)
  assert.equal(got.filter(i => i.kind === 'chip').length, 4)
  assert.deepEqual(got.filter(i => i.kind === 'tab' && i.current).map(i => (i as { id: string }).id), ['t0'])
})

const draw = (bar: ReturnType<typeof barFrom>) => renderToStaticMarkup(createElement('div', null, createElement(BarChips, { bar }), createElement(BarTabs, { bar }), createElement(BarButtons, { bar })))

test('a bar with nothing asked for draws nothing', () => {
  assert.equal(draw([]), '<div></div>')
  assert.deepEqual(overflowButtons([]), [])
})

test('tabs, buttons and chips are drawn: the current tab marked, two buttons shown, the rest for More', () => {
  const bar = barFrom({ v: 1, items: [
    tab('start'), tab('build', { current: true }),
    { kind: 'button', id: 'one', label: 'One', primary: true }, { kind: 'button', id: 'two', label: 'Two' },
    { kind: 'button', id: 'three', label: 'Three' }, { kind: 'button', id: 'four', label: 'Four', disabled: true },
    { kind: 'chip', label: '2 to supply', tone: 'warn' },
  ] })
  const html = draw(bar)
  assert.match(html, /<button[^>]*aria-current="step"[^>]*>build<\/button>/)
  assert.ok(!/aria-current[^>]*>start</.test(html))
  assert.ok(html.includes('ch-chip ch-chip-warn') && html.includes('2 to supply'))
  assert.ok(html.includes('ch-btn ch-btn-primary') && html.includes('>One</button>') && html.includes('>Two</button>'))
  assert.ok(!html.includes('>Three</button>'))
  assert.deepEqual(overflowButtons(bar).map(b => b.id), ['three'], 'a disabled button is not carried into More')
})
