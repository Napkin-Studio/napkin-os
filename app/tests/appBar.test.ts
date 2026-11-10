// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What an app asks the OS bar to show (features/app-bar-actions.clan): the list
// the bar will take, and how it draws it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BAR_LIMITS, barFrom, overflowButtons, statusOf } from '../src/shell/appBar.ts'
import { BarButtons, BarChips } from '../src/components/AppBarItems.tsx'

const btn = (id: string, extra = {}) => ({ kind: 'button', id, label: id, ...extra })

test('a good list comes through as it was sent', () => {
  const got = barFrom({ v: 1, items: [{ kind: 'button', id: 'go', label: 'Build', primary: true, title: 'Starts it' }, { kind: 'chip', label: '0 errors', tone: 'ok' }, { kind: 'status', label: 'Ready to lock', tone: 'ok' }] })
  assert.deepEqual(got, [
    { kind: 'button', id: 'go', label: 'Build', primary: true, disabled: false, title: 'Starts it' },
    { kind: 'chip', label: '0 errors', tone: 'ok', title: '' },
    { kind: 'status', label: 'Ready to lock', tone: 'ok', locked: false },
  ])
})

test('anything but version 1 with a list is empty', () => {
  for (const m of [null, 'x', {}, { v: 2, items: [btn('a')] }, { v: 1 }, { v: 1, items: 'a' }]) assert.deepEqual(barFrom(m), [])
})

test('a kind from the future, and a retired tab, are left out; the rest stay', () => {
  const got = barFrom({ v: 1, items: [{ kind: 'menu', id: 'm', label: 'Menu' }, { kind: 'tab', id: 't', label: 'Step', current: true }, btn('a')] })
  assert.deepEqual(got.map(i => i.kind), ['button'])
})

test('the status is the app\'s word for the state: one only, locked said, tone ok or warn or none', () => {
  const got = barFrom({ v: 1, items: [
    { kind: 'status', label: 'Locked', tone: 'ok', locked: true },
    { kind: 'status', label: 'Second', tone: 'warn' },
    { kind: 'status', label: '' },
  ] })
  assert.deepEqual(got, [{ kind: 'status', label: 'Locked', tone: 'ok', locked: true }])
  assert.deepEqual(statusOf(got), { kind: 'status', label: 'Locked', tone: 'ok', locked: true })
  assert.equal(statusOf(barFrom({ v: 1, items: [{ kind: 'status', label: 'Draft', tone: 'red' }] }))?.tone, null)
  assert.equal(statusOf([]), null)
})

test('labels and titles are text, trimmed and cut; markup is not markup', () => {
  const [b] = barFrom({ v: 1, items: [{ kind: 'button', id: 'x', label: '  <b>Hi</b>   there  '.padEnd(80, 'z'), title: 7 }] })
  assert.ok(b.kind === 'button' && b.label.length === BAR_LIMITS.label && b.label.startsWith('<b>Hi</b> there'))
  assert.equal((b as { title: string }).title, '')
  const html = renderToStaticMarkup(createElement('span', null, b.label))
  assert.ok(html.includes('&lt;b&gt;'), 'drawn as text')
})

test('an item with no label, or a button with no usable or a repeated id, is left out', () => {
  const got = barFrom({ v: 1, items: [btn('a'), btn('a'), { kind: 'button', label: 'No id' }, { kind: 'button', id: 7, label: 'Number' }, { kind: 'button', id: 'x'.repeat(80), label: 'Long' }, { kind: 'button', id: 'b', label: '' }, btn('c')] })
  assert.deepEqual(got.map(i => (i.kind === 'button' ? i.id : '')), ['a', 'c'])
})

test('a bar takes at most 10 buttons and 4 chips', () => {
  const items = [
    ...Array.from({ length: 13 }, (_, i) => btn(`b${i}`)),
    ...Array.from({ length: 9 }, (_, i) => ({ kind: 'chip', label: `c${i}` })),
  ]
  const got = barFrom({ v: 1, items })
  assert.equal(got.filter(i => i.kind === 'button').length, 10)
  assert.equal(got.filter(i => i.kind === 'chip').length, 4)
})

const draw = (bar: ReturnType<typeof barFrom>) => renderToStaticMarkup(createElement('div', null, createElement(BarChips, { bar }), createElement(BarButtons, { bar })))

test('a bar with nothing asked for draws nothing', () => {
  assert.equal(draw([]), '<div></div>')
  assert.deepEqual(overflowButtons([]), [])
})

test('buttons and chips are drawn: two buttons shown, the rest for More', () => {
  const bar = barFrom({ v: 1, items: [
    { kind: 'button', id: 'one', label: 'One', primary: true }, { kind: 'button', id: 'two', label: 'Two' },
    { kind: 'button', id: 'three', label: 'Three' }, { kind: 'button', id: 'four', label: 'Four', disabled: true },
    { kind: 'chip', label: '2 to supply', tone: 'warn' },
  ] })
  const html = draw(bar)
  assert.ok(html.includes('ch-chip ch-chip-warn') && html.includes('2 to supply'))
  assert.ok(html.includes('ch-btn ch-btn-primary') && html.includes('>One</button>') && html.includes('>Two</button>'))
  assert.ok(!html.includes('>Three</button>'))
  assert.deepEqual(overflowButtons(bar).map(b => b.id), ['three'], 'a disabled button is not carried into More')
})
