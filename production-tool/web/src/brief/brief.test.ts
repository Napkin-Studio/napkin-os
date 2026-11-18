// The Brief node (features/brief-node.clan): the spine projection, canLink, scope (its own link, the
// Script's brief carried upstream, an explicit link overriding it), what a job carries, the update
// notice and its decisions, removal with its card, Start from a brief, and that the spine stays in the
// project (export) but out of Napkin's own record.

import { describe, expect, it } from 'vitest'
import type { BriefNode, JobInput, Link, ProductionDocument } from '../contracts/types'
import { loadJson } from '../test/schemas'
import { MAYA, modelStore } from '../test/model'
import { canLink } from '../canvas/core/links'
import { scopeOf, inputChips } from '../model/scope'
import { removeBrief } from '../doc/remove'
import { BRIEF_SPINE, cutAtWord, isDont, projectSpine, spineLines, spineSummary } from './spine'
import {
  BRIEF_OPS, briefFeeds, briefFlagsOn, briefForJob, briefNotice, briefOf, briefSendRow, freshness, ignoreBriefFlag, keepVersion, newBrief,
  recordBriefFlags, takeNewer, withBrief,
} from './model'
import { osBriefSource, type OsBriefRead } from './os'
import { newId } from '../lib/ulid'
import { briefChoices, briefSpinoffOf, briefSpinoffUrl, offersStartFromBrief, withoutBriefSpinoff } from './start'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SB = 'storyboard_01K7A000000000000000000012'
const SCRIPT = 'script_01K7A00000000000000000000Z'
const VIDEO = 'video_01K7A000000000000000000027'
const S15 = 'shot_01K7A000000000000000000015'
const SHA = (c: string) => `sha256:${c.repeat(64)}`

/** A Brief Maker brief's data, as GET /data gives it. */
const BRIEF_DATA = {
  project_name: 'First Light',
  insight: 'People choose their drink at home, early in the day.',
  single_minded_proposition: 'Lumen is what the day starts with.',
  audience: 'Adults 25 to 40 who start the day at home.',
  tone_and_world: ['Quiet, warm, unhurried', 'Morning light'],
  desired_response: { think: 'Lumen is for mornings', feel: 'Calm and ready', do: 'Reach for Lumen first' },
  mandatories: ['Lumen name first', 'Morning moment', 'Don’t show a gym', 'Never use a sports-drink cliché'],
  media_roles: ['Film: 30 s hero, 6 s cut-downs'],
  budget_and_scope: '£200k',
  confidential_fields: ['audience'],
}
const read = (data: unknown = BRIEF_DATA, sha = SHA('b'), title = 'First Light brief'): OsBriefRead => ({ documentId: 'doc-first-light', title, appId: 'ie.napkin.brief-maker', dataSha256: sha, data })

const withBrief_ = (d: ProductionDocument, b: BriefNode, ...links: Link[]) => {
  const x = structuredClone(d)
  x.briefs = { ...(x.briefs ?? {}), [b.id]: b }
  for (const l of links) x.links[l.id] = l
  return x
}
let n = 0
const link = (briefId: string, to: Link['to']): Link => ({ id: `link_b${n++}`, v: 1, field_v: {}, from: { kind: 'brief', id: briefId }, to, role: 'brief' })

describe('the spine', () => {
  it('is projected from the brief by one declaration: proposition, audience, tone, feel, mandatories, don’ts, format', () => {
    const { spine, confidential } = projectSpine(BRIEF_DATA)
    expect(spine).toEqual({
      insight: 'People choose their drink at home, early in the day.',
      proposition: 'Lumen is what the day starts with.',
      audience: 'Adults 25 to 40 who start the day at home.',
      tone: 'Quiet, warm, unhurried; Morning light',
      feel: 'Calm and ready',
      mandatories: ['Lumen name first', 'Morning moment'],
      donts: ['Don’t show a gym', 'Never use a sports-drink cliché'],
      format: 'Film: 30 s hero, 6 s cut-downs',
    })
    // The budget is not part of the spine; the audience was marked Confidential in Brief Maker.
    expect(JSON.stringify(spine)).not.toContain('200k')
    expect(confidential).toEqual(['audience'])
  })

  it('leaves out what the brief does not have, skips unknown fields, reads filled-in fields ({value}) and cuts at a word', () => {
    const { spine } = projectSpine({ single_minded_proposition: { value: 'One line' }, audience: '', surprise: 'x', insight: 'word '.repeat(200) })
    expect(spine.proposition).toBe('One line')
    expect(spine.audience).toBeUndefined()
    expect(spine.insight!.length).toBeLessThanOrEqual(BRIEF_SPINE.insight.max)
    expect(spine.insight!.endsWith('…')).toBe(true)
    expect(projectSpine(null).spine).toEqual({})
    expect(cutAtWord('a b c d e f', 5)).toBe('a b…')
  })

  it('a don’t is a mandatory worded as a prohibition', () => {
    for (const l of ['Don’t show a gym', "don't", 'Do not swear', 'Never shout', 'Avoid blue', 'No children']) expect(isDont(l)).toBe(true)
    for (const l of ['Lumen name first', 'Nobody waits', 'Nevertheless calm']) expect(isDont(l)).toBe(false)
  })

  it('reads as the Booth’s lines and the card’s few words', () => {
    const { spine, confidential } = projectSpine(BRIEF_DATA)
    const lines = spineLines(spine, confidential)
    expect(lines.map((l) => l.label)).toEqual(['Insight', 'Proposition', 'Audience', 'Tone', 'What they should feel', 'Mandatories', 'Don’ts', 'Format'])
    expect(lines.find((l) => l.part === 'audience')!.confidential).toBe(true)
    expect(spineSummary(spine)).toBe('insight, proposition, audience, tone, feel, 2 mandatories, 2 don’ts, format')
  })
})

describe('canLink: brief → script, storyboard, video or format set only', () => {
  it.each(['script', 'storyboard', 'video', 'format_set'] as const)('brief → %s', (to) => {
    expect(canLink('brief', to)).toEqual({ ok: true, roles: ['brief'] })
  })
  it.each(['sketch', 'shot', 'generated', 'picture', 'note', 'document', 'brief'] as const)('brief → %s is refused', (to) => {
    expect(canLink('brief', to).ok).toBe(false)
  })
})

describe('scope', () => {
  const b1 = { ...newBrief(read(), 'link'), id: 'brief_01K7A0000000000000000000B1' }
  const b2 = { ...newBrief(read(BRIEF_DATA, SHA('c'), 'First Light DE'), 'link'), id: 'brief_01K7A0000000000000000000B2' }

  it('a brief linked into the Script is in its scope, and carries on to the Storyboard and Video it drives', () => {
    const d = withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT }))
    expect(briefOf(d, SCRIPT)).toMatchObject({ via: 'link', brief: { id: b1.id } })
    expect(inputChips(scopeOf(d, SCRIPT))[0].label).toBe('Brief · First Light brief · v1')
    expect(briefOf(d, SB)).toMatchObject({ via: 'upstream', through: SCRIPT, brief: { id: b1.id } })
    expect(briefOf(d, VIDEO)).toMatchObject({ via: 'upstream', brief: { id: b1.id } })
    // A frame or clip on a shot reads its storyboard's brief.
    expect(briefForJob(d, { kind: 'shot', id: S15 })?.brief.id).toBe(b1.id)
  })

  it('an explicit link downstream overrides the Script’s: one brief per node, the nearest', () => {
    const d = withBrief_(withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT })), b2, link(b2.id, { kind: 'video', id: VIDEO }))
    expect(briefOf(d, VIDEO)).toMatchObject({ via: 'link', brief: { id: b2.id } })
    expect(scopeOf(d, VIDEO).filter((i) => i.kind === 'brief').map((i) => i.id)).toEqual([b2.id])
    expect(briefOf(d, SB)?.brief.id).toBe(b1.id)
    expect(briefOf(d, SCRIPT)?.brief.id).toBe(b1.id)
  })

  it('a Format set made from a video reads that video\u2019s brief (also through an ad render); its own link overrides it', () => {
    const fs = (master: { kind: 'video' | 'render' | 'frame'; id: string }, id = 'fset_01K7A0000000000000000000F1') => ({
      id, v: 1, field_v: {}, master, pack: { pack_id: 'p', pack_version: '1' },
    }) as unknown as ProductionDocument['format_sets'][string]
    const d = withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT }))
    d.format_sets = { fset_01K7A0000000000000000000F1: fs({ kind: 'video', id: VIDEO }) }
    expect(briefOf(d, 'fset_01K7A0000000000000000000F1')).toMatchObject({ via: 'upstream', through: VIDEO, brief: { id: b1.id } })
    expect(briefSendRow(d, 'fset_01K7A0000000000000000000F1')!.detail).toMatch(/from Video/)
    expect(withBrief(d, 'resize', { kind: 'format_set', id: 'fset_01K7A0000000000000000000F1' }, {}).input.brief?.title).toBe('First Light brief')
    // Through an ad render of the video.
    d.renders = { ...d.renders, render_x: { id: 'render_x', v: 1, field_v: {}, video_id: VIDEO, version: 1, asset: SHA('a'), job_id: 'job_x' } as never }
    d.format_sets = { fset_01K7A0000000000000000000F1: fs({ kind: 'render', id: 'render_x' }) }
    expect(briefOf(d, 'fset_01K7A0000000000000000000F1')?.brief.id).toBe(b1.id)
    // A still's set (a frame master) carries none; an explicit link overrides the video's.
    d.format_sets = { fset_01K7A0000000000000000000F1: fs({ kind: 'frame', id: 'frame_x' }) }
    expect(briefOf(d, 'fset_01K7A0000000000000000000F1')).toBeUndefined()
    d.format_sets = { fset_01K7A0000000000000000000F1: fs({ kind: 'video', id: VIDEO }) }
    const own = withBrief_(d, b2, link(b2.id, { kind: 'format_set', id: 'fset_01K7A0000000000000000000F1' }))
    expect(briefOf(own, 'fset_01K7A0000000000000000000F1')).toMatchObject({ via: 'link', brief: { id: b2.id } })
    expect(scopeOf(own, 'fset_01K7A0000000000000000000F1').filter((i) => i.kind === 'brief')).toHaveLength(1)
  })

  it('no brief: nothing in scope, and a job is sent exactly as before', () => {
    const input: JobInput = { script: 'A runner at dawn.', targetS: 15 }
    const out = withBrief(ex, 'shot_list', { kind: 'storyboard', id: SB }, input)
    expect(out.input).toBe(input)
    expect(out.rows).toEqual([])
    expect(briefOf(ex, SB)).toBeUndefined()
  })

  it('a job on a director-backed op carries the spine (title and spine only) and an inputs row; other ops do not', () => {
    const d = withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT }))
    const out = withBrief(d, 'frame', { kind: 'shot', id: S15 }, { text: 'wide' })
    expect(out.input.brief).toEqual({ title: 'First Light brief', spine: b1.spine })
    expect(Object.keys(out.input.brief!)).toEqual(['title', 'spine'])
    expect(out.rows).toEqual([{ kind: 'brief', ref: b1.id, link_id: expect.any(String), used_as: 'brief (from its script)', included: true, text: 'First Light brief v1' }])
    for (const op of BRIEF_OPS) expect(withBrief(d, op, { kind: 'shot', id: S15 }, {}).input.brief).toBeTruthy()
    for (const op of ['generate', 'view', 'stitch', 'upscale', 'cutout', 'transcribe'] as const) expect(withBrief(d, op, { kind: 'shot', id: S15 }, {}).input.brief).toBeUndefined()
  })

  it('"What Dex will send" lists it, with where it comes from', () => {
    const d = withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT }))
    expect(briefSendRow(d, SB)).toEqual({
      key: `brief:${b1.id}`, briefId: b1.id, label: 'Brief · First Light brief · v1', via: 'upstream',
      detail: 'insight, proposition, audience, tone, feel, 2 mandatories, 2 don’ts, format · from Script · First Light',
    })
    expect(briefSendRow(d, SCRIPT)!.detail.endsWith('· linked')).toBe(true)
    expect(briefFeeds(d, b1.id)).toEqual([{ kind: 'script', id: SCRIPT }])
  })

  it('a card’s delete takes the copy out with its links and the marks it caused; the brief in Brief Maker is untouched', () => {
    const d = withBrief_(ex, b1, link(b1.id, { kind: 'script', id: SCRIPT }))
    d.stale.stale_x = { id: 'stale_x', v: 1, field_v: {}, target: { kind: 'script', id: SCRIPT }, caused_by: { kind: 'brief', id: b1.id }, reason: 'The brief changed' }
    const r = removeBrief(d, b1.id)
    expect(d.briefs?.[b1.id]).toBeUndefined()
    expect(Object.values(d.links).some((l) => l.from.kind === 'brief')).toBe(false)
    expect(d.stale.stale_x).toBeUndefined()
    expect(r.ids).toEqual([b1.id])
  })
})

describe('Brief changed: update?', () => {
  const newer = { ...BRIEF_DATA, single_minded_proposition: 'Lumen is the first thing you reach for.', tone_and_world: ['Bright, brisk'] }

  it('is offered only when the brief’s data changed, and not again for a version kept', () => {
    const b = newBrief(read(), 'link')
    expect(freshness(b, read())).toBe('same')
    expect(briefNotice(b, read())).toBeNull()
    const notice = briefNotice(b, read(newer, SHA('e')))!
    expect(notice).toMatchObject({ text: 'Brief changed: update?', changes: ['proposition', 'tone'], detail: 'Proposition and tone changed in Brief Maker (would be v2).' })
    expect(freshness({ ...b, source: { ...b.source, kept: SHA('e') as never } }, read(newer, SHA('e')))).toBe('kept')
  })

  it('updating is the person’s decision: one update_from_brief decision, then what it feeds is marked out of date; keeping is one decision too', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Brief project')
    const d0 = s.get() as unknown as ProductionDocument
    const script = Object.keys(d0.scripts)[0]
    const b = newBrief(read(), 'link')
    await s.change((d) => {
      d.briefs ??= {}
      d.briefs[b.id] = b
      const l = { ...link(b.id, { kind: 'script', id: script }), id: newId('link') }
      d.links[l.id] = l
    }, { action: 'seed', quiet: true })
    // Keep this version: the notice goes, one decision.
    await keepVersion(s, b.id, read(newer, SHA('e')))
    expect((s.get() as unknown as ProductionDocument).briefs![b.id].source.kept).toBe(SHA('e'))
    expect(briefNotice((s.get() as unknown as ProductionDocument).briefs![b.id], read(newer, SHA('e')))).toBeNull()
    // It changes again: offered again; take it.
    const again = read(newer, SHA('f'), 'First Light brief (2)')
    expect(briefNotice((s.get() as unknown as ProductionDocument).briefs![b.id], again)).not.toBeNull()
    await takeNewer(s, b.id, again)
    const d = s.get() as unknown as ProductionDocument
    expect(d.briefs![b.id]).toMatchObject({ title: 'First Light brief (2)', source: { taken: 2, data_sha256: SHA('f') }, spine: { proposition: 'Lumen is the first thing you reach for.', tone: 'Bright, brisk' } })
    expect(d.briefs![b.id].source.kept).toBeUndefined()
    const marks = Object.values(d.stale).filter((m) => m.caused_by.kind === 'brief')
    expect(marks.map((m) => m.target.id).sort()).toEqual([script, ...Object.keys(d.storyboards), ...Object.keys(d.videos)].sort())
    expect(marks[0].reason).toBe('The brief changed (v1 → v2): proposition, tone.')
    const chain = (await s.chain()).map((e) => e.action)
    expect(chain).toContain('keep the brief “First Light brief” v1')
    expect(chain).toContain('update_from_brief “First Light brief (2)” v2')
    // Nothing was made again by itself.
    expect(Object.keys(d.jobs)).toHaveLength(0)
  })
})

describe('the Review flags', () => {
  it('a job that breaks a line becomes Jude\u2019s check on its node, one decision, never a block; once per job; Ignore takes the mark away', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Flags')
    const d0 = s.get() as unknown as ProductionDocument
    const video = Object.keys(d0.videos)[0]
    const b = newBrief(read(), 'link')
    const jobId = newId('job')
    await s.change((d) => {
      d.briefs ??= {}
      d.briefs[b.id] = b
      d.jobs[jobId] = {
        id: jobId, v: 1, field_v: {}, op: 'cutdown', state: 'completed', node: { kind: 'video', id: video }, started_by: `human:${MAYA.id}`,
        tenant_id: MAYA.tenant_id, nonce: 'n_brief0001', crew: 'dex', parent_ids: [], input_hashes: [], created_at: '2026-11-17T10:00:00Z',
        inputs: [{ kind: 'brief', ref: b.id, used_as: 'brief', included: true }],
      }
    }, { action: 'seed', quiet: true })
    const job = { jobId, director: { model: 'm', promptVersion: 'cutter.v2', rationale: 'r', output: { briefFlags: [{ kind: 'mandatory', line: 'Lumen name first', note: 'The 6 s cut has no shot with the Lumen name.' }] } } }
    const made = await recordBriefFlags(s, job as never)
    expect(made).toHaveLength(1)
    let d = s.get() as unknown as ProductionDocument
    expect(d.checks[made[0].id]).toMatchObject({ crew: 'jude', result: 'flag', reason_code: 'brief_mandatory', brief_id: b.id, target: { kind: 'video', id: video }, job_id: jobId })
    expect(briefFlagsOn(d, video)).toHaveLength(1)
    expect(await recordBriefFlags(s, job as never)).toEqual([]) // once per job
    const jude = (await s.chain()).filter((e) => e.agent === 'jude')
    expect(jude.map((e) => e.action)).toEqual(['flag a line of the brief \u201cFirst Light brief\u201d v1'])
    await ignoreBriefFlag(s, made[0].id, `human:${MAYA.id}`)
    d = s.get() as unknown as ProductionDocument
    expect(briefFlagsOn(d, video)).toEqual([])
    expect(d.checks[made[0].id].ignored?.by).toBe(`human:${MAYA.id}`)
  })
})

describe('the OS source', () => {
  it('lists the agency’s briefs and reads one with its hash; off the OS it is not available', async () => {
    const calls: string[] = []
    const fake = async (url: string) => {
      calls.push(url)
      const body = url.endsWith('/api/session') ? { tenant: 't1' }
        : url.includes('/library?') ? { items: [{ path: 'doc-a', app_id: 'ie.napkin.brief-maker', title: 'A', updated_at: '2026-11-17T10:00:00Z', client: { name: 'Lumen' } }, { path: 'doc-b', app_id: 'ie.napkin.deck-maker', title: 'B', updated_at: 'x', client: null }] }
          : { path: 'doc-a', title: 'A', app_id: 'ie.napkin.brief-maker', data_sha256: SHA('a'), data: BRIEF_DATA }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const src = osBriefSource('', fake)
    expect(await src.available()).toBe(true)
    expect(await src.list()).toEqual([{ documentId: 'doc-a', title: 'A', updatedAt: '2026-11-17T10:00:00Z', client: { name: 'Lumen' } }])
    expect(await src.read('doc-a')).toMatchObject({ documentId: 'doc-a', dataSha256: SHA('a') })
    expect(calls).toContain('/api/t/t1/library?app=ie.napkin.brief-maker')
    expect(calls).toContain('/api/t/t1/d/doc-a/data')
    expect(src.openUrl('doc-a')).toBe('/?open=doc-a')
    const off = osBriefSource('', async () => new Response('', { status: 404 }))
    expect(await off.available()).toBe(false)
    await expect(off.list()).rejects.toThrow('not signed in')
  })
})

describe('confidentiality', () => {
  it('the spine stays in the project (the agency and the client see it) and leaves the browser only as JobInput.brief', () => {
    const b = newBrief(read(), 'link')
    const d = withBrief_(ex, b, link(b.id, { kind: 'script', id: SCRIPT }))
    // In the document the export packs: all of it, Confidential parts too.
    expect(JSON.stringify(d.briefs)).toContain('Adults 25 to 40')
    expect(d.briefs![b.id].confidential).toEqual(['audience'])
    // A job carries the spine, never the brief's other parts (budget) or its confidential list.
    const job = withBrief(d, 'write', { kind: 'script', id: SCRIPT }, {}).input
    expect(JSON.stringify(job)).not.toContain('200k')
    expect(JSON.stringify(job)).not.toContain('confidential')
  })
})

describe('Start from a brief: the data path', () => {
  const src = (ok: boolean, items: { documentId: string; title: string; updatedAt: string }[] = []) => ({
    available: async () => ok, list: async () => items, read: async () => read(), openUrl: (id: string) => `/?open=${id}`,
  })
  it('is offered only with the flag on and Napkin\u2019s briefs readable', async () => {
    expect(await offersStartFromBrief({ briefNode: true }, src(true))).toBe(true)
    expect(await offersStartFromBrief({ briefNode: false }, src(true))).toBe(false)
    expect(await offersStartFromBrief(undefined, src(true))).toBe(false)
    expect(await offersStartFromBrief({ briefNode: true }, src(false))).toBe(false)
  })
  it('lists the briefs newest first, and says what to do when there are none', async () => {
    const got = await briefChoices(src(true, [{ documentId: 'doc-a', title: 'A', updatedAt: '2026-11-01' }, { documentId: 'doc-b', title: 'B', updatedAt: '2026-11-17' }]))
    expect(got.items.map((i) => i.documentId)).toEqual(['doc-b', 'doc-a'])
    expect((await briefChoices(src(true))).empty).toMatch(/Brief Maker/)
  })
  it('a spin-off from Brief Maker arrives as ?brief=<doc id>, taken once', () => {
    expect(briefSpinoffOf('?brief=doc-first-light&engine=own')).toBe('doc-first-light')
    expect(briefSpinoffOf('?brief=../../etc')).toBeNull()
    expect(briefSpinoffOf('')).toBeNull()
    expect(withoutBriefSpinoff('?brief=doc-a&engine=own')).toBe('?engine=own')
    expect(withoutBriefSpinoff('?brief=doc-a')).toBe('')
    expect(briefSpinoffUrl('doc-a')).toBe('/production/?brief=doc-a')
  })
})
