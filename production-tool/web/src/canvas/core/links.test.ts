// The linking rules of ui-behaviour.md 3.4 (features/canvas-core.clan): every
// row with an allowed and a refused case, the spec's refusal words, and the
// limits checkLink applies on a graph.

import { describe, expect, it } from 'vitest'
import { canLink, checkLink, LINK_TABLE, LOOP, REFUSALS, type LinkEnd, type LinkGraph, type LinkKind, type LinkRole } from './links'
import { GENERATING_KINDS } from './nodes'

type Case = [string, LinkKind | LinkEnd, LinkKind | LinkEnd, LinkRole[] | string, { system?: boolean }?]

const brand: LinkEnd = { kind: 'board', purpose: 'brand' }
const product: LinkEnd = { kind: 'picture', role: 'product' }
const keyVisual: LinkEnd = { kind: 'picture', role: 'key_visual' }

// [row, from, to, roles or the refusal's words]
const CASES: Case[] = [
  ['Script → Storyboard', 'script', 'storyboard', ['drives']],
  ['Script → Storyboard (refused)', 'script', 'shot', 'Not a target for a script'],
  // Owner ruling 2026-10-13: a script may drive a video straight.
  ['Script → Video', 'script', 'video', ['drives']],
  ['Script → Video (refused)', 'script', 'format_set', 'Not a target for a script'],
  ['Storyboard → Video', 'storyboard', 'video', ['renders']],
  ['Storyboard → Video (refused)', 'storyboard', 'script', 'Not a target for a storyboard'],
  ['Reference → generating node', 'picture', 'script', ['reference']],
  ['Reference → Shot', 'picture', 'shot', ['reference', 'frame', 'layout']],
  ['Reference → not generating (refused)', 'picture', 'note', 'Not a target for a reference'],
  ['Board → generating node', { kind: 'board', purpose: 'location' }, 'sketch', ['input']],
  ['Group → generating node', 'group', 'storyboard', ['input']],
  ['Board → Shot (refused)', 'board', 'shot', 'Not a target for a board'],
  ['Note → generating node', 'note', 'video', ['note']],
  ['Ink group → generating node', 'ink_group', 'script', ['note']],
  ['Document → generating node', 'document', 'format_set', ['context']],
  ['Note → Shot (refused)', 'note', 'shot', 'Not a target for a note'],
  ['Brand board → generating node', brand, 'script', ['brand']],
  ['Brand board → Shot (refused)', brand, 'shot', 'Not a target for a brand board'],
  ['Frame → Format set (system)', 'generated', 'format_set', ['master'], { system: true }],
  // A key visual is a reference too, and a format set is a generating node.
  ['Key visual → Format set (system)', keyVisual, 'format_set', ['reference', 'master'], { system: true }],
  ['Video → Format set (system)', 'video', 'format_set', ['master'], { system: true }],
  ['Frame → Format set, dragged (refused)', 'generated', 'format_set', 'Made only by Make all sizes.'],
  ['Any other picture → Format set: a reference, not a master', product, 'format_set', ['reference'], { system: true }],
  ['Image → Shot', 'drawing', 'shot', ['frame', 'layout']],
  ['Frame → Shot', 'generated', 'shot', ['frame', 'layout']],
  ['Drawing → Video (refused)', 'drawing', 'video', 'Not a target for a drawing'],
  ['Sketch area → Frame (system)', 'sketch', 'generated', ['made_from'], { system: true }],
  ['Sketch area → Frame, dragged (refused)', 'sketch', 'generated', 'Made only when a sketch area makes a frame.'],
  ['Ink group → Shot', 'ink_group', 'shot', ['note_on_shot']],
  ['Ink group → Frame (refused)', 'ink_group', 'generated', 'Not a target for an ink group'],
  ['Anything → Reference (refused)', 'script', 'picture', 'A script cannot feed a reference'],
  ['Anything → Product (refused)', 'script', product, 'A script cannot feed a product'],
  ['Anything → Document (refused)', 'note', 'document', 'A note cannot feed a document'],
  ['Anything → Brand board (refused)', 'picture', brand, 'A reference cannot feed a brand board'],
  ['Video → anything but a Format set (refused)', 'video', 'storyboard', 'A video cannot feed a storyboard'],
  ['Video → Shot (refused)', 'video', 'shot', 'A video cannot feed a shot'],
]

describe('canLink: every row of 3.4', () => {
  it.each(CASES)('%s', (_row, from, to, want, opts) => {
    const got = canLink(from, to, opts)
    if (typeof want === 'string') expect(got).toEqual({ ok: false, reason: want })
    else expect(got).toEqual({ ok: true, roles: want })
  })

  it('the table is 3.4 as written, plus the owner’s Script → Video row: eleven rows, three refusals', () => {
    expect(LINK_TABLE.map((r) => r.fromTo)).toEqual([
      'Script → Storyboard', 'Storyboard → Video', 'Script → Video', 'Reference → any generating node, or a Shot', 'Board or group → any generating node',
      'Note, ink group or Document → any generating node', 'Brand board → any generating node', 'Frame, key visual or Video → Format set',
      'Image, frame or generated picture → Shot', 'Sketch area → Frame', 'Ink group → Shot',
    ])
    expect(REFUSALS.map((r) => r.fromTo)).toEqual([
      'Anything → Reference, Product, Document or Brand board', 'Video → anything but a Format set', 'A link that would form a loop',
    ])
    expect(LINK_TABLE.find((r) => r.fromTo === 'Sketch area → Frame')!.allowed).toBe('Created by the system only')
  })

  it('a reference feeds every generating node', () => {
    for (const k of GENERATING_KINDS) expect(canLink('picture', k)).toEqual({ ok: true, roles: ['reference'] })
  })

  it('a video’s only link out is the master of a format set', () => {
    const out = (['script', 'storyboard', 'video', 'board', 'sketch', 'picture', 'drawing', 'generated', 'note', 'ink_group', 'group', 'document', 'format_set', 'shot'] as LinkKind[])
      .filter((k) => canLink('video', k, { system: true }).ok)
    expect(out).toEqual(['format_set'])
  })
})

const graph = (nodes: [string, LinkKind, string?][], links: [string, string, LinkRole][] = []): LinkGraph => ({
  nodes: nodes.map(([id, kind, purpose]) => ({ id, kind, ...(purpose ? { purpose } : {}) })),
  links: links.map(([from, to, role]) => ({ from, to, role })),
})

describe('checkLink: the limits', () => {
  it('one script per storyboard', () => {
    const g = graph([['s1', 'script'], ['s2', 'script'], ['sb', 'storyboard']], [['s1', 'sb', 'drives']])
    expect(checkLink(g, 's2', 'sb', 'drives')).toEqual({ ok: false, reason: 'This storyboard already has a script.' })
  })

  it('one script per video, and a script may drive a storyboard and a video at once', () => {
    const g = graph([['s1', 'script'], ['s2', 'script'], ['sb', 'storyboard'], ['v', 'video']], [['s1', 'v', 'drives']])
    expect(checkLink(g, 's2', 'v', 'drives')).toEqual({ ok: false, reason: 'This video already has a script.' })
    expect(checkLink(g, 's1', 'sb', 'drives')).toEqual({ ok: true })
    // The recommended path still works beside it: the storyboard renders the same video.
    const both: LinkGraph = { ...g, links: [...g.links, { from: 's1', to: 'sb', role: 'drives' }] }
    expect(checkLink(both, 'sb', 'v', 'renders')).toEqual({ ok: true })
  })

  it('one storyboard per video, while a storyboard renders many videos', () => {
    const g = graph([['a', 'storyboard'], ['b', 'storyboard'], ['v1', 'video'], ['v2', 'video']], [['a', 'v1', 'renders']])
    expect(checkLink(g, 'b', 'v1', 'renders')).toEqual({ ok: false, reason: 'This video already has a storyboard.' })
    expect(checkLink(g, 'a', 'v2', 'renders')).toEqual({ ok: true })
  })

  it('one master per set', () => {
    const g = graph([['f1', 'generated'], ['v', 'video'], ['set', 'format_set']], [['f1', 'set', 'master']])
    expect(checkLink(g, 'v', 'set', 'master', { system: true })).toEqual({ ok: false, reason: 'This set already has a master.' })
  })

  it('one frame and one layout per shot', () => {
    const g = graph([['a', 'generated'], ['b', 'picture'], ['shot', 'shot']], [['a', 'shot', 'frame']])
    expect(checkLink(g, 'b', 'shot', 'frame')).toEqual({ ok: false, reason: 'This shot already has a frame.' })
    expect(checkLink(g, 'b', 'shot', 'layout')).toEqual({ ok: true })
    const g2 = graph([['a', 'generated'], ['b', 'picture'], ['shot', 'shot']], [['a', 'shot', 'layout']])
    expect(checkLink(g2, 'b', 'shot', 'layout')).toEqual({ ok: false, reason: 'This shot already has a layout.' })
  })

  it('one brand link', () => {
    const g = graph([['b1', 'board', 'brand'], ['b2', 'board', 'brand'], ['s', 'script']], [['b1', 's', 'brand']])
    expect(checkLink(g, 'b2', 's', 'brand')).toEqual({ ok: false, reason: 'This already has a brand board.' })
  })

  it('one input link per board or group, while a node takes many boards', () => {
    const g = graph([['b1', 'board', 'location'], ['b2', 'board', 'character'], ['grp', 'group'], ['s', 'script']], [['b1', 's', 'input'], ['grp', 's', 'input']])
    expect(checkLink(g, 'b1', 's', 'input')).toEqual({ ok: false, reason: 'These are already linked.' })
    expect(checkLink(g, 'b2', 's', 'input')).toEqual({ ok: true })
  })

  it('one link per role on an input port unless the table says Many', () => {
    const g = graph([['sk1', 'sketch'], ['sk2', 'sketch'], ['f', 'generated']], [['sk1', 'f', 'made_from']])
    expect(checkLink(g, 'sk2', 'f', 'made_from', { system: true })).toEqual({ ok: false, reason: 'This already has a made from link.' })
    // Many: references, notes and documents.
    const many = graph([['p1', 'picture'], ['p2', 'picture'], ['n1', 'note'], ['n2', 'note'], ['s', 'script']], [['p1', 's', 'reference'], ['n1', 's', 'note']])
    expect(checkLink(many, 'p2', 's', 'reference')).toEqual({ ok: true })
    expect(checkLink(many, 'n2', 's', 'note')).toEqual({ ok: true })
  })

  it('a three-node loop is refused', () => {
    // A storyboard feeding (by its group) the script that drives it: script → storyboard → … → script.
    const g = graph([['sc', 'script'], ['sb', 'storyboard'], ['grp', 'group'], ['v', 'video']], [['sc', 'sb', 'drives'], ['sb', 'v', 'renders']])
    const loop: LinkGraph = { ...g, links: [...g.links, { from: 'v', to: 'grp', role: 'input' }] }
    // grp → sc would close sc → sb → v → grp → sc.
    expect(checkLink(loop, 'grp', 'sc', 'input')).toEqual({ ok: false, reason: LOOP })
    expect(LOOP).toBe('That would make a loop.')
  })

  it('made_from is refused unless the system makes it', () => {
    const g = graph([['sk', 'sketch'], ['f', 'generated']])
    expect(checkLink(g, 'sk', 'f', 'made_from')).toEqual({ ok: false, reason: 'Made only when a sketch area makes a frame.' })
    expect(checkLink(g, 'sk', 'f', 'made_from', { system: true })).toEqual({ ok: true })
  })

  it('a target with a running job refuses with the job’s line', () => {
    const g = graph([['p', 'picture'], ['v', 'video']])
    const busy = (id: string) => (id === 'v' ? 'Fin is still making clip 4.' : undefined)
    expect(checkLink(g, 'p', 'v', 'reference', { busy })).toEqual({ ok: false, reason: 'Fin is still making clip 4. Link it when that\'s done.' })
    expect(checkLink(g, 'p', 'v', 'reference')).toEqual({ ok: true })
  })

  it('Video → Format set (master) is the only link out of a video', () => {
    const g = graph([['v', 'video'], ['set', 'format_set'], ['s', 'script']])
    expect(checkLink(g, 'v', 'set', 'master', { system: true })).toEqual({ ok: true })
    expect(checkLink(g, 'v', 's', 'reference')).toEqual({ ok: false, reason: 'A video cannot feed a script' })
  })

  it('a role the pair does not take is refused', () => {
    const g = graph([['sc', 'script'], ['sb', 'storyboard']])
    expect(checkLink(g, 'sc', 'sb', 'renders')).toEqual({ ok: false, reason: 'A script feeds a storyboard as drives.' })
  })
})
