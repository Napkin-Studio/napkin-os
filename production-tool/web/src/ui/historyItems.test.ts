import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../doc/store'
import { aboutItem, historyItems, kindOf, readable, type ChainLike } from './historyItems'
import { HistoryList } from './HistoryList'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const J1 = 'job_01K6XA7Q3M9V2D4R8T0B000001'
const J2 = 'job_01K6XA7Q3M9V2D4R8T0B000002'
const T = (m: number) => `2026-10-07T10:${String(m).padStart(2, '0')}:00Z`

function doc() {
  const d = emptyDocument({ id: 'p_maya01', handle: 'maya' })
  d.jobs.push(
    { id: J1, op: 'generate', state: 'completed', parent_ids: [], input_hashes: [SHA('a')], outputs: [SHA('b')], created_at: T(40) },
    { id: J2, op: 'view', state: 'completed', parent_ids: [J1], input_hashes: [SHA('b')], outputs: [SHA('c')], created_at: T(45) },
  )
  d.keys.push({ key: 'hero', role: 'character' })
  d.refs.push(
    { id: 'ref_01K6XA7Q3M9V2D4R8T0B000001', key: 'hero', variant: 'front', asset: SHA('b'), node: J1 },
    { id: 'ref_01K6XA7Q3M9V2D4R8T0B000002', key: 'hero', variant: 'side', asset: SHA('c'), node: J2 },
  )
  return d
}

// Newest first, as the chain gives it.
const entries: ChainLike[] = [
  { agent: 'maya', action: 'named @hero_side', rationale: `ref_01K6XA7Q3M9V2D4R8T0B000002 · ${SHA('c')}`, timestamp: T(47), fields_changed: ['refs'] },
  { agent: 'fal · qwen-edit', action: `made view ${J2}`, rationale: `cost $0.03 confirmed · 20 s · out ${SHA('c')}`, timestamp: T(46) },
  { agent: 'maya', action: 'published hero to the acme library', rationale: 'version 1', timestamp: T(44), pinned: true, fields_changed: ['keys'] },
  { agent: 'runway · gen4_image', action: `made generate ${J1}`, rationale: `cost $0.07 confirmed · 41 s · out ${SHA('b')}`, timestamp: T(41) },
  { agent: 'director · claude-sonnet-4-5 · director.v1', action: `directed generate ${J1}`, rationale: 'The drawing sets the pose · prompt: "@hero_eyes, front view"', timestamp: T(41) },
  { agent: 'maya', action: 'generated from 1 input', rationale: `from @hero_eyes · ${J1}`, timestamp: T(40), fields_changed: ['jobs'] },
  { agent: 'maya', action: 'named @hero_eyes', rationale: `ref_01K6XA7Q3M9V2D4R8T0B000009 · ${SHA('a')}`, timestamp: T(39), fields_changed: ['refs'] },
  { agent: 'maya', action: 'signed in as @maya', timestamp: T(38) },
]

describe('History', () => {
  it('knows the three kinds of author', () => {
    expect(entries.map((e) => kindOf(e.agent))).toEqual(['participant', 'provider', 'participant', 'provider', 'director', 'participant', 'participant', 'participant'])
  })

  it('narrows to an item through the jobs that made it and the pictures they took in', () => {
    const items = historyItems(doc())
    expect(items.map((i) => i.label)).toEqual(['@hero_front', '@hero_side'])
    const front = items[0]
    expect(entries.filter((e) => aboutItem(e, front)).map((e) => e.action)).toEqual([
      `made generate ${J1}`, `directed generate ${J1}`, 'generated from 1 input', 'named @hero_eyes',
    ])
    // The side view came from the front: its history includes the front's.
    const side = items[1]
    const about = entries.filter((e) => aboutItem(e, side)).map((e) => e.action)
    expect(about).toContain('named @hero_side')
    expect(about).toContain(`made view ${J2}`)
    expect(about).toContain(`directed generate ${J1}`)
    expect(about).toContain('named @hero_eyes')
    expect(about).not.toContain('published hero to the acme library')
  })

  it('renders entries newest first with who, what, why and fields', () => {
    const html = renderToStaticMarkup(createElement(HistoryList, { entries, handle: 'maya' }))
    expect(html.indexOf('named @hero_side')).toBeLessThan(html.indexOf('signed in as @maya'))
    expect(html).toContain('data-kind="director"')
    expect(html).toContain('data-kind="provider"')
    expect(html).toContain('data-kind="participant"')
    expect(html).toContain('>You<')
    expect(html).toContain('>Director<')
    expect(html).toContain('claude-sonnet-4-5 · director.v1')
    expect(html).toContain('>runway<')
    expect(html).toContain('pinned')
    expect(html).toContain('history-field')
    expect(html).toContain(readable(`cost $0.07 confirmed · 41 s · out ${SHA('b')}`))
  })

  it('says so when nothing is about the item', () => {
    const html = renderToStaticMarkup(createElement(HistoryList, { entries: [], handle: 'maya', item: { key: 'ad', label: 'The ad', tokens: ['x'] } }))
    expect(html).toContain('Nothing recorded about this yet.')
  })
})
