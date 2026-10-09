import { describe, expect, it } from 'vitest'
import type { DocJob, JobInput, JobRequest, ModelChoice, ProductionDocument } from '../contracts/types'
import { emptyDocument } from '../doc/store'
import type { UiState } from '../doc/ui'
import { arrowCard, cardLines, directorPrompt, regionWords, type NodeKind } from './arrowCard'

const SHA = (c: string) => `sha256:${c.repeat(64)}`
const asset = (c: string) => ({ sha256: SHA(c), url: `https://x/${c}`, mime: 'image/png' as const })
const fmtTime = (iso: string) => iso.slice(11, 16)

function setup(job: Partial<DocJob> & { id: string; op: DocJob['op'] }, input: JobInput, modelChoice?: ModelChoice) {
  const doc: ProductionDocument = emptyDocument()
  doc.keys.push({ key: 'maya', role: 'character' })
  doc.refs.push({ id: 'ref_maya', key: 'maya', variant: 'front', asset: SHA('m'), node: 'node_maya' })
  doc.jobs.push({ state: 'completed', parent_ids: [], input_hashes: [], created_at: '2026-10-09T14:05:00.000Z', updated_at: '2026-10-09T14:05:12.000Z', ...job })
  const request: JobRequest = { contractVersion: '2', jobId: job.id, op: job.op, parentIds: [], input, ...(modelChoice ? { modelChoice } : {}) }
  const ui: Pick<UiState, 'jobCtx'> = { jobCtx: { [job.id]: { for: 'canvas', request } } }
  return { doc, ui }
}

const kinds: Record<string, NodeKind> = { node_draw: { kind: 'drawn' }, node_note: { kind: 'note', text: 'make her wave' } }
const kindOf = (id: string) => kinds[id]

describe('arrowCard: what the step behind an arrow did', () => {
  it('a generate with named inputs, a drawing and words', () => {
    const { doc, ui } = setup(
      {
        id: 'job_g', op: 'generate', provider: 'fal', model: 'nano-banana-pro-edit',
        agent: { model: 'claude', promptVersion: 'director.v3', rationale: 'kept her coat', output: { op: 'generate', providerJob: { prompt: '@maya_front waving, pose from @image2' } } },
        cost: { confirmed: 0.15, currency: 'USD', unknown: false },
      },
      { text: 'make her wave', refs: [{ id: 'ref_maya', name: 'maya_front', role: 'character', kind: 'picture', asset: asset('m') }, { id: 'node_draw', role: 'character', kind: 'drawing', asset: asset('d') }] },
    )
    const card = arrowCard(doc, ui, { from: 'node_draw', to: 'job_g' }, { kindOf, fmtTime })
    expect(card.who).toBe('Dex · Nano Banana Pro (fal)')
    expect(card.from).toEqual([{ label: '@maya_front', here: false }, { label: 'drawing', here: true }])
    expect(card.words).toBe('make her wave')
    expect(card.told).toBe('@maya_front waving, pose from @image2')
    expect(card.passthrough).toBeUndefined()
    expect(card.fallback).toBeUndefined()
    expect(card.state).toBeUndefined()
    expect(card.when).toBe('Ran at 14:05 · took 12 s')
    expect(card.cost).toBe('$0.15')
    // The arrow from the named image marks that one.
    expect(arrowCard(doc, ui, { from: 'node_maya', to: 'job_g' }, { kindOf }).from[0]).toEqual({ label: '@maya_front', here: true })
    // An arrow from a text box names its words.
    const fromNote = arrowCard(doc, ui, { from: 'node_note', to: 'job_g' }, { kindOf })
    expect(fromNote.from.at(-1)).toEqual({ label: '“make her wave”', here: true })
    expect(cardLines(card)).toContain('From: @maya_front, drawing')
  })

  it('a view says which view, from the front', () => {
    const { doc, ui } = setup(
      { id: 'job_v', op: 'view', provider: 'fal', model: 'qwen-image-edit-2511-multiple-angles' },
      { view: 'side', image: asset('m'), ratio: '4:5' },
    )
    const card = arrowCard(doc, ui, { from: 'node_maya', to: 'job_v' }, { fmtTime })
    expect(card.title).toBe('The side view')
    expect(card.changed).toBe('Turned @maya_front to the side view')
    expect(card.from).toEqual([{ label: '@maya_front', here: true }])
    expect(card.who).toBe('Dex · Qwen multi-angle (fal)')
  })

  it('a region edit names the box and its note', () => {
    const { doc, ui } = setup(
      { id: 'job_r', op: 'region_edit', provider: 'fal', model: 'nano-banana-pro-edit', region: { x: 0.05, y: 0.05, w: 0.4, h: 0.25 }, text: 'a red hat' },
      { image: asset('m'), region: { x: 0.05, y: 0.05, w: 0.4, h: 0.25 }, text: 'a red hat' },
    )
    const card = arrowCard(doc, ui, { from: 'node_maya', to: 'job_r' })
    expect(card.title).toBe('A change in a box')
    expect(card.changed).toBe('Changed a box at the top left, about 40% × 25% of the picture of @maya_front: “a red hat”. A new version; the old one stays.')
    expect(card.words).toBeUndefined() // the note is in what it changed
    expect(regionWords({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 })).toBe('a box at the middle, about 40% × 40% of the picture')
  })

  it('a job picked for fal that ran on Runway says so', () => {
    const { doc, ui } = setup(
      { id: 'job_f', op: 'generate', provider: 'runway', model: 'gemini_image3_pro' },
      { text: 'a cat', refs: [] },
      { provider: 'fal', model: 'nano-banana-pro-edit' },
    )
    const card = arrowCard(doc, ui, { from: 'node_note', to: 'job_f' }, { kindOf })
    expect(card.who).toBe('Dex · Gemini 3 Pro (runway)')
    expect(card.fallback).toBe('Made on Runway: fal could not take Nano Banana Pro')
    expect(cardLines(card)[2]).toBe(card.fallback)
  })

  it('a job with no director block went as written', () => {
    const { doc, ui } = setup({ id: 'job_p', op: 'generate', provider: 'mock', model: 'mock', cost: { currency: 'USD', unknown: true } }, { text: 'a cat' })
    const card = arrowCard(doc, ui, { from: 'node_note', to: 'job_p' }, { kindOf })
    expect(card.told).toBeUndefined()
    expect(card.passthrough).toBe('No director: your words went to the model as written.')
    expect(card.who).toBe('Dex · the mock (no model)')
    expect(card.cost).toBeUndefined()
    doc.jobs[0].cost = { confirmed: 0, currency: 'USD', unknown: false }
    expect(arrowCard(doc, ui, { from: 'node_note', to: 'job_p' }).cost).toBeUndefined()
    doc.jobs[0].cost = { estimate: 0.04, currency: 'USD', unknown: false }
    expect(arrowCard(doc, ui, { from: 'node_note', to: 'job_p' }).cost).toBe('about $0.040')
  })

  it('a step still running, or with no record, says so', () => {
    const { doc, ui } = setup({ id: 'job_q', op: 'generate', state: 'queued' }, { text: 'a cat' })
    const running = arrowCard(doc, ui, { from: 'node_note', to: 'job_q' }, { kindOf })
    expect(running.state).toBe('Still being made.')
    expect(running.who).toBe('Dex · model not known yet')
    expect(running.passthrough).toBeUndefined()
    const missing = arrowCard(doc, { jobCtx: {} }, { from: 'node_x', to: 'job_gone' })
    expect(missing.state).toBe('No record of this step in the document.')
    expect(missing.from).toEqual([{ label: 'a node', here: true }])
  })

  it('reads the director prompt from the provider job, or a bare prompt', () => {
    expect(directorPrompt({ model: 'm', promptVersion: 'director.v3', rationale: '', output: { prompt: ' hi ' } })).toBe('hi')
    expect(directorPrompt({ model: 'm', promptVersion: 'director.v3', rationale: '', output: {} })).toBeUndefined()
    expect(directorPrompt(undefined)).toBeUndefined()
  })
})
