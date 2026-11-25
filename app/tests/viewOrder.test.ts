// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Final UAT gate, 2026-11-25: after Fix this with the agents settled the last call, the first Lock click did not take.
// Several reads of the host's decision view were in flight at once and answered out of order; an older answer, from
// before the call was settled, set can_lock back to false, the button went off under the click, and the click was lost.
// Only the newest read may set the view.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

let root = new URL('.', import.meta.url)
while (!root.pathname.endsWith('/app/')) root = new URL('..', root)
const CLF = readFileSync(new URL('templates/shared/clan-fields.html', root), 'utf8')

function fn(name: string): string {
  const at = CLF.indexOf(`function ${name}(`)
  assert.ok(at >= 0, `${name} is in clan-fields`)
  let depth = 0
  for (let i = CLF.indexOf('{', at); i < CLF.length; i++) {
    if (CLF[i] === '{') depth++
    else if (CLF[i] === '}' && --depth === 0) return CLF.slice(at, i + 1)
  }
  throw new Error('unbalanced')
}

test('an older read that answers last does not set the view back', async () => {
  const pending: ((v: unknown) => void)[] = []
  const events: string[] = []
  const ctx: Record<string, unknown> = {
    SCHEME: 'clan://localhost', VIEW: null,
    fetch: () => new Promise(res => pending.push(v => res({ ok: true, json: async () => v }))),
    window: { dispatchEvent: (e: { type: string }) => events.push(e.type) },
    CustomEvent: class { type: string; constructor(t: string) { this.type = t } },
  }
  vm.createContext(ctx)
  vm.runInContext(`var VIEW_SEQ=0; ${fn('loadView')}; this.loadView=loadView; this.view=function(){ return VIEW; };`, ctx)
  const load = ctx.loadView as () => Promise<void>, view = ctx.view as () => { lock: { can_lock: boolean } } | null
  const older = load(), newer = load()                                 // the first read was sent before the settle landed
  pending[1]({ lock: { can_lock: true } }); await newer               // the newer one answers first: the lock is free
  assert.equal(view()!.lock.can_lock, true)
  pending[0]({ lock: { can_lock: false } }); await older              // then the older one, from before the settle
  assert.equal(view()!.lock.can_lock, true, 'the stale answer is dropped: the button stays on')
  assert.deepEqual(events, ['clan:viewloaded'], 'only the newest read tells the page')
  // in order, every read sets it as before
  const a = load(); pending[2]({ lock: { can_lock: false } }); await a
  assert.equal(view()!.lock.can_lock, false)
})
