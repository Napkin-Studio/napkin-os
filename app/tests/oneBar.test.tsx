// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The one bar (features/one-bar-search.clan): which keys are its own, the command list per role, the shortcuts sheet
// read from the same table, the combobox and listbox roles, and the provider seam with a fake provider.

import './domFakes.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { HomeView } from '../src/host/http.ts'
import { BarList } from '../src/shell/bar/BarList.tsx'
import { BarInput } from '../src/shell/bar/BarField.tsx'
import { ShortcutRows } from '../src/shell/bar/Shortcuts.tsx'
import { commandsFor, keysText, matchCommands, shortcutRows, type BarEnv, type Command } from '../src/shell/bar/commands.ts'
import { barKeyOf, type KeyLike } from '../src/shell/bar/keys.ts'
import { flatten, optionId, optionName } from '../src/shell/bar/listModel.ts'
import { commandResult, runProviders, type BarGroup, type BarProvider } from '../src/shell/bar/providers.ts'

const key = (o: Partial<KeyLike>): KeyLike => ({ key: 'k', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null, ...o })
/** A node that says whether it is, or sits in, a field, as keepsItsOwnUndo asks (it reads `instanceof Element`). */
class FakeElement { constructor(private readonly field: boolean) {} closest() { return this.field ? this : null } }
globalThis.Element = FakeElement as unknown as typeof Element

test('Cmd or Ctrl K opens the bar, in a text field too, and takes no other key', () => {
  assert.equal(barKeyOf(key({ metaKey: true })), 'open')
  assert.equal(barKeyOf(key({ ctrlKey: true })), 'open')
  assert.equal(barKeyOf(key({ metaKey: true, key: 'K' })), 'open')
  assert.equal(barKeyOf(key({ metaKey: true, target: new FakeElement(true) as unknown as EventTarget })), 'open', 'in a field')
  for (const other of [key({}), key({ metaKey: true, key: 'z' }), key({ metaKey: true, key: 'c' }), key({ metaKey: true, shiftKey: true }), key({ metaKey: true, altKey: true }), key({ key: 'Tab' }), key({ ctrlKey: true, key: 'a' })]) {
    assert.equal(barKeyOf(other), null, JSON.stringify(other))
  }
})

test('? opens the shortcuts sheet only where no text field owns the key', () => {
  const question = (target: EventTarget | null) => barKeyOf(key({ key: '?', shiftKey: true, target }))
  assert.equal(question(null), 'shortcuts')
  assert.equal(question(new FakeElement(false) as unknown as EventTarget), 'shortcuts', 'a button, the page')
  // an input, a textarea and a contenteditable are all fields to keepsItsOwnUndo: the question mark is typed there
  assert.equal(question(new FakeElement(true) as unknown as EventTarget), null)
  assert.equal(barKeyOf(key({ key: '?', metaKey: true })), null)
  assert.equal(barKeyOf(key({ key: '?', ctrlKey: true })), null)
})

const home = (doors: string[], more: string[] = [], restricted = true): HomeView => ({
  roles: [], restricted, title: '', viewing: null,
  doors: doors.map(n => ({ id: n.toLowerCase().replace(/\W+/g, '-'), name: n })),
  more: more.map(n => ({ id: n.toLowerCase().replace(/\W+/g, '-'), name: n })),
  map: { circles: [], other: [] }, switcher: null, jobs: { open: true, change: true, budget: false } as unknown as HomeView['jobs'],
})
const noop = () => {}
const env = (h: HomeView | null, extra: Partial<BarEnv> = {}): BarEnv => ({ home: h, go: noop, openBar: noop, openShortcuts: noop, signedIn: true, signOut: noop, ...extra })
const titles = (cs: readonly Command[]) => cs.filter(c => c.available).map(c => c.title)

const PLANNER = home(['Brief', 'Research', 'Territories', 'Client brains', 'Presentations'], ['Ideas (read only)', 'Case study builder (read only)'])
const COPYWRITER = home(['Ideas', 'Script editor', 'Radio', 'Video and motion', 'Formats and in situ'], ['Shopper stands', 'Experiential', 'Presentations'])

test('the command list is built from the person\'s own home: a door they do not have is not offered', () => {
  const planner = titles(commandsFor(env(PLANNER)))
  const copy = titles(commandsFor(env(COPYWRITER)))
  assert.ok(planner.includes('Open Research') && planner.includes('Open Brief') && planner.includes('Open Ideas (read only)'))
  assert.ok(!planner.includes('Open Script editor') && !planner.includes('Open Radio'), 'a planner has no Script editor')
  assert.ok(copy.includes('Open Script editor') && copy.includes('Open Shopper stands'))
  assert.ok(!copy.includes('Open Research') && !copy.includes('Open Brief'), 'a copywriter has no Research door')
  for (const list of [planner, copy]) for (const always of ['Home', 'The map', 'Your timesheet', 'Keyboard shortcuts', 'Sign out']) assert.ok(list.includes(always), always)
  assert.deepEqual(titles(commandsFor(env(null, { signedIn: false, signOut: null }))), ['Home', 'Keyboard shortcuts'], 'no home, no account: only what always works')
})

test('typing a tool\'s name finds its door for the person who has it, and nothing for the person who has not', () => {
  const planner = commandsFor(env(PLANNER))
  assert.deepEqual(matchCommands(planner, 'research').map(c => c.id), ['door-research'])
  assert.deepEqual(matchCommands(commandsFor(env(COPYWRITER)), 'research'), [])
  assert.deepEqual(matchCommands(planner, 'sign out').map(c => c.id), ['sign-out'])
  assert.deepEqual(matchCommands(planner, 'J001 brief'), [], 'a job number is not a command')
  assert.deepEqual(matchCommands(planner, ''), [])
})

test('undo and redo are offered only where there is something to undo; sign out cannot be undone and says so', () => {
  const cmds = (e: Partial<BarEnv>) => commandsFor(env(PLANNER, e))
  assert.ok(!titles(cmds({})).includes('Undo') && !titles(cmds({})).includes('Redo'))
  assert.ok(titles(cmds({ undo: noop })).includes('Undo') && !titles(cmds({ undo: noop })).includes('Redo'))
  const signOut = cmds({}).find(c => c.id === 'sign-out')!
  assert.equal(signOut.undoable, false)
  assert.ok(signOut.warns && !signOut.warns.includes('—'))
  assert.ok(cmds({}).filter(c => c.id !== 'sign-out').every(c => c.undoable))
})

test('the shortcuts sheet prints every key from the same table, so a new command with a key is listed with no edit', () => {
  const rows = shortcutRows(commandsFor(env(null, { signedIn: false })))
  assert.deepEqual(rows.map(r => r.title), ['Search or type a command', 'Undo', 'Redo', 'Keyboard shortcuts', 'Close the bar, or a sheet'], 'undo and redo are listed with no document open')
  assert.equal(keysText('mod K', true), '⌘K')
  assert.equal(keysText('mod K', false), 'Ctrl K')
  assert.equal(keysText('shift mod Z', true), '⇧⌘Z')
  assert.equal(keysText('shift mod Z', false), 'Shift Ctrl Z')
  const mine: Command = { id: 'new', title: 'A new thing', keywords: [], shortcut: 'mod J', undoable: true, available: true, run: noop }
  const html = renderToStaticMarkup(createElement(ShortcutRows, { commands: [...commandsFor(env(null)), mine], mac: false }))
  for (const w of ['Search or type a command', 'Ctrl K', 'Undo', 'Ctrl Z', 'Redo', 'Shift Ctrl Z', 'Keyboard shortcuts', '?', 'A new thing', 'Ctrl J', 'Esc']) assert.ok(html.includes(w), w)
  assert.ok(!html.includes('—'))
})

const groups: BarGroup[] = [
  { id: 'brief', label: 'Briefs', items: [{ key: 'brief:1', kind: 'brief', title: 'J001 brief', line: 'Brief Maker · Client A', act: { type: 'document', path: 'doc-1' } }] },
  { id: 'person', label: 'People', items: [{ key: 'person:a', kind: 'person', title: 'Aoife Test', line: 'Planning', act: { type: 'person', name: 'Aoife Test', line: 'Planning', jobs: ['J001'] } }] },
]

test('the results are a listbox of options: the active one is selected and each is announced with its kind', () => {
  const html = renderToStaticMarkup(createElement(BarList, { groups, active: 1, onPick: noop, onHover: noop }))
  assert.match(html, /role="listbox"/)
  assert.equal((html.match(/role="group"/g) ?? []).length, 2)
  assert.equal((html.match(/role="option"/g) ?? []).length, 2)
  assert.match(html, /id="bar-opt-0"[^>]*aria-selected="false"|aria-selected="false"[^>]*id="bar-opt-0"/)
  assert.match(html, /aria-selected="true"/)
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1)
  assert.ok(html.includes('aria-label="Brief: J001 brief, Brief Maker · Client A"'))
  assert.ok(html.includes('aria-label="Person: Aoife Test, Planning"'))
  assert.deepEqual(flatten(groups).map(optionName), ['Brief: J001 brief, Brief Maker · Client A', 'Person: Aoife Test, Planning'])
  assert.equal(optionId(1), 'bar-opt-1')
})

test('the field is a combobox with a name, and says it is collapsed until the bar opens', () => {
  const html = renderToStaticMarkup(createElement(BarInput, {}))
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-label="Search or type a command"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /aria-autocomplete="list"/)
  assert.ok(!html.includes('aria-controls') && !html.includes('aria-activedescendant'), 'nothing points at a list that is not there')
})

test('the provider seam: a fake provider adds a group, a failing one is silent, groups of one id are joined', async () => {
  const fake: BarProvider = { id: 'fake', results: q => [{ id: 'ask', label: 'Ask Nap', items: [{ key: 'ask:1', kind: 'command', title: `Ask about ${q}`, line: '', act: { type: 'command', command: commandsFor(env(null))[0] } }] }] }
  const broken: BarProvider = { id: 'broken', results: () => { throw new Error('down') } }
  const rejects: BarProvider = { id: 'rejects', results: () => Promise.reject(new Error('down')) }
  const more: BarProvider = { id: 'more', results: () => [{ id: 'ask', label: 'Ask Nap', items: [{ key: 'ask:2', kind: 'command', title: 'Another', line: '', act: { type: 'command', command: commandsFor(env(null))[0] } }] }] }
  const out = await runProviders('radio', { commands: [] }, new AbortController().signal, [fake, broken, rejects, more])
  assert.deepEqual(out.map(g => [g.id, g.items.map(i => i.title)]), [['ask', ['Ask about radio', 'Another']]])
  assert.equal(commandResult(commandsFor(env(PLANNER))[0]).kind, 'command')
})
