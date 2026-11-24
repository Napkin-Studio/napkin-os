// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// UAT round 4 (Copperell, fictional), Brief Maker: Yes / No was offered on open "what/which" questions (F2), and two
// Review notes on the same parts read as one card twice, because the card showed "The Review agent suggests a change."
// instead of what the note said (F3).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!root.pathname.endsWith('/app/')) root = new URL('..', root)
const html = readFileSync(new URL('templates/brief-maker/index.html', root), 'utf8')

function fn(name: string): string {
  const at = html.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `${name} is in the page`)
  let depth = 0
  for (let i = html.indexOf('{', at); i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) return html.slice(at, i + 1)
  }
  throw new Error('unbalanced')
}

const closedQ = vm.runInNewContext(`${fn('closedQ')}; closedQ`) as (q: string) => boolean

test('Yes / No only on a closed question', () => {
  for (const q of ['Is the budget fixed?', 'Does the £200k include media?', 'Can we use the lab report?', '[high] Should the film run in cinema? — It sets the cut.'])
    assert.equal(closedQ(q), true, q)
  for (const q of ['What is the budget, does it include VAT, and does media sit inside it?',
    'Which line does the board prefer, ‘Clean, without the plastic’ or ‘Refill. Not landfill’?',
    'When is the lab report due?',
    'Do you want existing Copperell liquid customers to switch, or is the aim new buyers and those leaving single-use plastic sprays?',
    'Is the aim to switch existing customers, or should we target new buyers?',
    'Does the board know which audience leads?', 'How will the board judge success?'])
    assert.equal(closedQ(q), false, q)
})

test('the Your call markup offers Yes / No only through closedQ', () => {
  assert.match(html, /\(closedQ\(o\.q\)\?'<button type="button" data-ans="'\+o\.i\+'" data-v="Yes">Yes<\/button>/)
})

const reasonFix = vm.runInNewContext(
  `var ANSWER_TAIL=/\\s*A person answers this before the brief locks\\.\\s*$/; function arr(x){ return Array.isArray(x)?x:[]; }
   ${fn('hasReasoning')} ${fn('reasonFix')}; reasonFix`) as
  (d: unknown) => { reason: string; fix: string; rule: string }

test('a Review note says what it found, not only who found it', () => {
  const note = (said: string) => ({ id: 'd_x', reasoning: { decided: said, attention: 'The Review agent suggests a change.', because: [{ point: said }] } })
  const a = reasonFix(note('The proposition promises beauty and easy refill, but the barrier is about cleaning performance.'))
  const b = reasonFix(note("The barrier lists several doubts and the 'Not landfill' half adds a planet message."))
  assert.match(a.reason, /^The proposition promises beauty/)
  assert.match(b.reason, /^The barrier lists several doubts/)
  assert.notEqual(a.reason, b.reason, 'two notes on the same parts read as two cards')
  // a verdict whose attention carries the reason and the fix keeps them, as before
  const old = reasonFix({ reasoning: { decided: 'Insight fails is_tension.', attention: 'is_tension: no tension in it. Fix: name the tension.', because: [] } })
  assert.deepEqual({ reason: old.reason, fix: old.fix }, { reason: 'no tension in it.', fix: 'name the tension.' })
})
