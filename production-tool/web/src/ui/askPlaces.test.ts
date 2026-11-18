// @vitest-environment happy-dom
// Every waiting question has a place (owner 2026-10-15): the dock shows what no card shows on its screen,
// and Show finds the card, or has the dock show it, with the focus on its first answer.

import { afterEach, describe, expect, it } from 'vitest'
import type { Ask, DocJob } from '../contracts/types'
import { dockAsks, focusAsk, hereOf, homeOf, placeAsk, showAsk, summonAsk, summonedAsk, waitingAsks, type WaitingAsk } from './askPlaces'
import { id, MAYA, modelStore } from '../test/model'
import { mainScript } from '../model/selectors'

afterEach(() => {
  document.body.innerHTML = ''
  summonAsk(null)
})

const ask = (jobId: string): Ask => ({ id: id('q'), v: 1, field_v: {}, node: { kind: 'script', id: 'script_x' }, job_id: jobId, crew: 'skye', state: 'open', answers: [],
  question: { id: 'q', kind: 'nudge', text: 'Which?', options: [{ id: 'a', label: 'A', value: 'a' }, { id: 'b', label: 'B', value: 'b' }], allow_text: false } })
const row = (op: DocJob['op'], node: DocJob['node']): WaitingAsk => {
  const j = { id: id('job'), op, node, state: 'needs_input' } as DocJob
  return { job: j, ask: ask(j.id) }
}

describe('where a waiting question belongs', () => {
  it("Skye's is her script's editor; a frame's is the storyboard; the canvas is 'character'", () => {
    expect(homeOf({ op: 'write', node: { kind: 'script', id: 's1' } }, undefined)).toEqual({ script: 's1' })
    expect(homeOf({ op: 'frame', node: { kind: 'shot', id: 'x' } }, { for: 'frame', shotId: 'x' })).toEqual({ stage: 'storyboard' })
    expect(hereOf({ kind: 'script', projectId: 'p', scriptId: 's1' }, 'character')).toEqual({ script: 's1' })
    expect(hereOf({ kind: 'none' }, 'character')).toEqual({ stage: 'character' })
  })

  it('the dock shows what belongs here and no card shows, and what Show summoned from anywhere', () => {
    const mine = row('write', { kind: 'script', id: 's1' })
    const other = row('write', { kind: 'script', id: 's2' })
    const frame = row('frame', { kind: 'shot', id: 'x' })
    const here = { script: 's1' }
    const none = () => undefined
    expect(dockAsks([mine, other, frame], here, none, () => false, null)).toEqual([mine])
    expect(dockAsks([mine, other, frame], here, none, (a) => a === mine.ask.id, null)).toEqual([])
    expect(dockAsks([mine, other, frame], here, none, () => false, frame.ask.id)).toEqual([mine, frame])
  })

  it('a card placing an ask takes it out of the dock until it goes', () => {
    const mine = row('write', { kind: 'script', id: 's1' })
    const off = placeAsk(mine.ask.id)
    expect(dockAsks([mine], { script: 's1' }, () => undefined)).toEqual([])
    off()
    expect(dockAsks([mine], { script: 's1' }, () => undefined)).toEqual([mine])
  })

  it('lists only jobs waiting at needs_input with an open ask, the live state first', async () => {
    const store = modelStore()
    await store.create(MAYA, 'First Light')
    const scriptId = mainScript(store.get())!.id
    const a = id('job')
    const b = id('job')
    const q = id('q')
    await store.change((d) => {
      const w = (jobId: string, state: string, extra = {}) => ({ id: jobId, v: 1, field_v: {}, op: 'write', state, node: { kind: 'script', id: scriptId }, started_by: `human:${MAYA.id}`, tenant_id: MAYA.tenant_id, nonce: 'n_yyyyyyyy', crew: 'skye', parent_ids: [], input_hashes: [], created_at: '2026-10-13T10:00:00Z', ...extra }) as never
      d.jobs[a] = w(a, 'needs_input', { ask_id: q })
      d.jobs[b] = w(b, 'submitted')
      d.asks[q] = { ...ask(a), id: q, node: { kind: 'script', id: scriptId }, question: { ...ask(a).question, id: q } }
    }, { action: 'sync', quiet: true, undo: false })
    await store.flush()
    expect(waitingAsks(store.get()).map((x) => x.job.id)).toEqual([a])
    expect(waitingAsks(store.get(), (j) => (j === a ? 'submitted' : undefined))).toEqual([])
  })
})

describe('Show', () => {
  const card = (askId: string, html = '<button class="askcard-latr">Later</button><button>First answer</button>') => {
    const el = document.createElement('section')
    el.setAttribute('data-ask', askId)
    el.innerHTML = html
    document.body.appendChild(el)
    return el
  }

  it('focuses the first answer of the card that shows the ask (not Later)', async () => {
    const el = card('q_1')
    expect(await showAsk('q_1', 2)).toBe(true)
    expect(document.activeElement).toBe(el.querySelectorAll('button')[1])
    expect(summonedAsk()).toBeNull()
  })

  it('a question put off with Later opens again', () => {
    const later = document.createElement('button')
    later.className = 'askcard-later'
    later.setAttribute('data-ask', 'q_2')
    let opened = false
    later.onclick = () => { opened = true }
    document.body.appendChild(later)
    expect(focusAsk('q_2')).toBe(false)
    expect(opened).toBe(true)
  })

  it('a question no card shows is summoned to the dock', async () => {
    expect(await showAsk('q_3', 2)).toBe(false)
    expect(summonedAsk()).toBe('q_3')
  })
})
