// A project born as a spin-off from a Territories document (features/territories-spinoff-out-production.clan): the OS wrote the
// document into it whole under data.upstream.<its id>, and the page shows what came through on the blank canvas: one Text per
// greenlit route (name, line, their words, palette, checks, "not this", pictures as links with their rights). Real store helpers
// and the real own engine; the project is the brief-spun-off fixture with its carried document swapped for the Territories example.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ProductionDocument } from '../../../contracts/types'
import { modelStore } from '../../../test/model'
import { OwnAdapter } from './adapter'
import { bringCarriedBrief } from '../../../brief/start'
import { carriedRoutes, isTerritories, picturesLine, RIGHTS_TO_SUPPLY, territoriesVersion } from '../../../brief/routes'
import { briefApprovals, bringCarriedRoutes, carriedBeside } from '../../../brief/routeNode'
import { briefForJob, withBrief } from '../../../brief/model'
import { linkBrief } from '../../../brief/canvas'
import { createNode } from '../../nodes/nodes'
import { scopeOf } from '../../../model/scope'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = () => new Uint8Array(readFileSync(join(here, '../../../../../clan-store/test/fixtures/brief-spun-off.clan')))
const example = (): Record<string, unknown> => JSON.parse(readFileSync(join(here, '../../../../../../app/templates/territories/example/data.json'), 'utf8'))
const TERR_ID = '3f9c2d10-7a41-4b6e-9d52-0c8e1a7b5f33'
const SHA = 'a'.repeat(64)

/** The project the host makes from a Territories document: upstream.<its id> is the document (its own upstream hoisted beside it). */
function projectFrom(doc: Record<string, unknown>): Uint8Array {
  const z = unzipSync(fixture())
  const text = (p: string) => new TextDecoder().decode(z[p])
  const { upstream: older, ...own } = doc
  // YAML is a superset of JSON: the data is written as JSON, the manifest keeps its own text
  // the fixture's own carried source, whatever id it was built with (the fixture is regenerated: #318 gave it a new one)
  const carried = /carried:\s*\n\s*document_id:\s*([0-9a-f-]{36})/.exec(text('manifest.yaml'))![1]
  z['manifest.yaml'] = new TextEncoder().encode(text('manifest.yaml').replace('title: Lumen Water', 'title: Rail territories').replaceAll(carried, TERR_ID))
  z['shared/data.yaml'] = new TextEncoder().encode(JSON.stringify({ upstream: { ...(older as object), [TERR_ID]: own } }))
  return zipSync(z)
}

/** The example with frames by link on the first greenlit route: one with stated rights, one without; a Final with none. */
function withFrames(): Record<string, unknown> {
  const d = example() as { territories: { id: string; pictures?: unknown[] }[]; greenlit: { territory_id: string }[] }
  const t = d.territories.find((x) => x.id === d.greenlit[0].territory_id)!
  t.pictures = [
    { id: 'pic_a', touchpoint: 'tv', kind: 'frame', sha256: SHA, rights: 'generated' },
    { id: 'pic_b', touchpoint: 'poster', kind: 'frame', sha256: 'b'.repeat(64), final: true },
    { id: 'pic_c', touchpoint: 'seat', kind: 'sketch' },
  ]
  return d as unknown as Record<string, unknown>
}

async function born(doc: Record<string, unknown>) {
  const s = modelStore()
  await s.open(projectFrom(doc))
  const a = new OwnAdapter()
  a.resize(1600, 1000, 0, 0)
  return { s, a, env: { canvas: a, doc: s as never }, doc: () => s.get() as unknown as ProductionDocument }
}

const greenNames = (d: Record<string, unknown>) => {
  const g = (d.greenlit as { territory_id: string }[]).map((x) => x.territory_id)
  return (d.territories as { id: string; name: string }[]).filter((t) => g.includes(t.id)).map((t) => t.name)
}

describe('reading a carried Territories document', () => {
  it('is not mistaken for a brief', async () => {
    const { s, env, doc } = await born(example())
    const from = (await s.clan.spunOffFrom())!
    expect(isTerritories(doc().upstream![from.document_id])).toBe(true)
    expect(await bringCarriedBrief(env, from)).toBeNull()
    expect(Object.keys(doc().briefs ?? {})).toHaveLength(0)
  })

  it('reads the greenlit routes with their words, palette, checks and sources, in the order greenlit', async () => {
    const d = withFrames()
    const { s, doc } = await born(d)
    const got = carriedRoutes((await s.clan.spunOffFrom())!, doc().upstream)!
    expect(got.routes.map((r) => r.name)).toEqual(greenNames(d).length ? expect.arrayContaining(greenNames(d)) : [])
    expect(got.routes).toHaveLength((d.greenlit as unknown[]).length)
    const first = got.routes[0]
    expect(first.words.length).toBeGreaterThan(0)
    expect(first.palette.length).toBeGreaterThan(0)
    expect(first.thought).not.toBe('')
    expect(got.by).toBe('Shrey')
  })

  it('reads what was sent when a send was written, not everything greenlit', async () => {
    const d = withFrames() as { greenlit: { territory_id: string }[]; sends: unknown[] }
    const [one, two] = d.greenlit.map((g) => g.territory_id)
    d.sends = [{ id: 'send_x', to: 'production-tool', territory_ids: [two], not_chosen: [one], by: 'Aoife', at: '2026-11-23T10:00:00Z', status: 'sent' }]
    const { s, doc } = await born(d as never)
    const got = carriedRoutes((await s.clan.spunOffFrom())!, doc().upstream)!
    expect(got.routes.map((r) => r.id)).toEqual([two])
    expect(got.notChosen).toBe(1)
    expect(got.by).toBe('Aoife')
  })

  it('says pictures are links with their rights: unstated rights read "Rights to supply", a Final with none needs them, sketches are mock-ups', async () => {
    const d = withFrames()
    const { s, doc } = await born(d)
    const got = carriedRoutes((await s.clan.spunOffFrom())!, doc().upstream)!
    const pics = got.routes[0].pictures
    expect(pics.frames.map((f) => [f.sha256, f.rights, f.final])).toEqual([[SHA, 'Generated', false], ['b'.repeat(64), RIGHTS_TO_SUPPLY, true]])
    expect(pics.mockups).toBe(1)
    const line = picturesLine(pics)
    expect(line).toBe('Pictures: 1 mock-up sketch, not finished pictures; 2 pictures by link (rights: Generated, Rights to supply); a Final needs its rights.')
  })

  it('a document with no route greenlit brings nothing', async () => {
    const d = example() as { greenlit: unknown[] }
    d.greenlit = []
    const { s, a, env, doc } = await born(d as never)
    expect(carriedRoutes((await s.clan.spunOffFrom())!, doc().upstream)!.routes).toEqual([])
    expect(await bringCarriedRoutes(env, await s.clan.spunOffFrom())).toBeNull()
    expect(a.elements().filter((e) => !e.isDeleted)).toHaveLength(0)
    expect(Object.keys(doc().spin_ins ?? {})).toHaveLength(0)
  })

  it('a killed route is not brought', async () => {
    const d = example() as { territories: { id: string; status: string }[]; greenlit: { territory_id: string }[] }
    const gone = d.greenlit[0].territory_id
    d.territories.find((t) => t.id === gone)!.status = 'killed'
    const { s, doc } = await born(d as never)
    const got = carriedRoutes((await s.clan.spunOffFrom())!, doc().upstream)!
    expect(got.routes.map((r) => r.id)).not.toContain(gone)
  })

  it('a project spun off from a brief carries no routes', async () => {
    const s = modelStore()
    await s.open(fixture())
    const doc = s.get() as unknown as ProductionDocument
    expect(carriedRoutes((await s.clan.spunOffFrom())!, doc.upstream)).toBeNull()
  })
})

describe('a project spun off from Territories opens on its routes', () => {
  it('puts one Territories node per route sent on the blank canvas, nothing selected, and records what came from where', async () => {
    const d = withFrames()
    const { s, a, env, doc } = await born(d)
    const from = (await s.clan.spunOffFrom())!
    const out = await bringCarriedRoutes(env, from)
    expect(out!.made).toBe((d.greenlit as unknown[]).length)
    const briefs = Object.values(doc().briefs!)
    expect(briefs.map((b) => b.route!.name).sort()).toEqual(greenNames(d).sort())
    // each is a frozen copy on the canvas: a node card of kind brief, no loose Text
    const els = a.elements().filter((e) => !e.isDeleted)
    expect(els.map((e) => (e.customData as { kind?: string }).kind)).toEqual(Array(out!.made).fill('brief'))
    expect(els.map((e) => e.type)).not.toContain('text')
    expect(a.view().selectedIds).toHaveLength(0)
    expect(briefs.every((b) => b.source.app_id === 'ie.napkin.territories' && b.source.document_id === from.document_id && b.source.how === 'spinoff')).toBe(true)
    // the page's own record says where they came from
    const spin = Object.values(doc().spin_ins!)
    expect(spin).toHaveLength(1)
    expect(spin[0]).toMatchObject({ state: 'brought_in', source: { document_id: from.document_id, app: 'ie.napkin.territories', title: 'Rail territories' } })
    expect(spin[0].plan.map((p) => p.title)).toEqual(expect.arrayContaining(greenNames(d)))
    // no Script, no separate Brief Maker node, no link was made for the person
    expect(Object.keys(doc().scripts)).toHaveLength(0)
    expect(briefs.every((b) => b.route)).toBe(true)
    expect(Object.values(doc().links)).toHaveLength(0)
  })

  it('one node per route sent, not everything greenlit', async () => {
    const d = withFrames() as { greenlit: { territory_id: string }[]; sends: unknown[] }
    const [one, two] = d.greenlit.map((g) => g.territory_id)
    d.sends = [{ id: 'send_x', to: 'production-tool', territory_ids: [two], not_chosen: [one], by: 'Aoife', at: '2026-11-23T10:00:00Z', status: 'sent' }]
    const { s, env, doc } = await born(d as never)
    const out = await bringCarriedRoutes(env, await s.clan.spunOffFrom())
    expect(out!.made).toBe(1)
    expect(Object.values(doc().briefs!).map((b) => b.route!.id)).toEqual([two])
  })

  it('carries the brief and research: the brief is the spine, the research is named, no copy of either', async () => {
    const { s, env, doc } = await born(withFrames())
    await bringCarriedRoutes(env, await s.clan.spunOffFrom())
    for (const b of Object.values(doc().briefs!)) {
      expect(b.carries).toEqual({ brief: { title: expect.any(String), v: 1 }, research: { title: 'Linea: Weekend by Rail' } })
      expect(b.spine.proposition).toBe('The weekend starts when you sit down.')
      expect(b.spine.audience).toContain('Couples and young families')
      expect(b.spine.mandatories!.join(' ')).toContain('Weekend return fare')
      expect(b.spine.donts!.join(' ')).toContain('No anti-car tone')
    }
  })

  it('pictures are links by hash with their rights: unstated reads "Rights to supply", never bytes', async () => {
    const { s, env, doc } = await born(withFrames())
    await bringCarriedRoutes(env, await s.clan.spunOffFrom())
    const first = Object.values(doc().briefs!).find((b) => b.route!.pictures?.length)!
    expect(first.route!.pictures!.map((p) => [p.sha256, p.rights, !!p.final])).toEqual([[`sha256:${SHA}`, 'generated', false], [`sha256:${'b'.repeat(64)}`, undefined, true]])
    expect(first.route!.mockups).toBe(1)
    expect(Object.keys(doc().assets ?? {})).toHaveLength(0)
    expect(JSON.stringify(first)).not.toMatch(/data:image|base64/)
  })

  it('links to a Script like any node: the job input gets the route and the brief spine, only when linked', async () => {
    const { s, a, env, doc } = await born(withFrames())
    await bringCarriedRoutes(env, await s.clan.spunOffFrom())
    const node = Object.values(doc().briefs!).find((b) => b.route!.pictures?.length)!
    const script = (await createNode(env as never, 'script', { x: 900, y: 100 }))!
    const sid = (script.customData as { id: string }).id
    expect(briefForJob(doc(), { kind: 'script', id: sid })).toBeUndefined()
    expect(withBrief(doc(), 'write', { kind: 'script', id: sid }, { text: 'x' }).input.brief).toBeUndefined()
    const linked = await linkBrief(env as never, node.id, { kind: 'script', id: sid })
    expect(linked.ok).toBe(true)
    const { input, rows } = withBrief(doc(), 'write', { kind: 'script', id: sid }, { text: 'x' })
    expect(input.brief!.spine.proposition).toBe('The weekend starts when you sit down.')
    expect(input.brief!.route).toMatchObject({ name: node.route!.name, thought: node.route!.thought })
    expect(input.brief!.route!.pictures).toEqual([{ sha256: `sha256:${SHA}`, rights: 'Generated' }, { sha256: `sha256:${'b'.repeat(64)}`, rights: RIGHTS_TO_SUPPLY }])
    expect(rows[0]).toMatchObject({ kind: 'brief', ref: node.id, used_as: 'brief' })
    // the Script's chip for the linked route names the route's version, not the copy counter
    expect(scopeOf(doc(), sid).find((i) => i.kind === 'brief')!.label).toBe(`Territories · ${node.route!.name} · v${node.route!.version}`)
    // the same route node is the other routes' neighbour, not theirs: a second Script has none
    const other = (await createNode(env as never, 'script', { x: 900, y: 600 }))!
    expect(withBrief(doc(), 'write', { kind: 'script', id: (other.customData as { id: string }).id }, { text: 'x' }).input.brief).toBeUndefined()
    expect(a.elements().filter((e) => (e.customData as { kind?: string }).kind === 'brief')).toHaveLength(Object.keys(doc().briefs!).length)
  })

  it('once: the second time, and after a reload, adds nothing', async () => {
    const { s, a, env, doc } = await born(withFrames())
    const from = await s.clan.spunOffFrom()
    await bringCarriedRoutes(env, from)
    const n = a.elements().length
    const k = Object.keys(doc().briefs!).length
    expect(await bringCarriedRoutes(env, from)).toBeNull()
    expect(a.elements()).toHaveLength(n)
    expect(Object.keys(doc().briefs!)).toHaveLength(k)
    expect(Object.keys(doc().spin_ins!)).toHaveLength(1)
  })

  it('a project that was not spun off brings nothing', async () => {
    const { env } = await born(example())
    expect(await bringCarriedRoutes(env, null)).toBeNull()
  })
})

describe('the versions a Territories node names', () => {
  const greenlights = (n: number) => Array.from({ length: n }, (_, i) => ({ gate: 'greenlight', kind: 'approve', by: 'Shrey', at: `2026-11-18T1${i}:05:00Z` }))
  const pick = { gate: 'pick', kind: 'approve', by: 'Shrey', at: '2026-11-18T09:12:00Z' }
  const withDecisions = (decisions: unknown[]) => { const d = example() as { run: { decisions: unknown[] } }; d.run.decisions = decisions; return d as unknown as Record<string, unknown> }

  it('counts the Greenlight approvals, at least 1: a first send is v1 (Pick is a step of the same pass), none at all is v1', () => {
    expect(territoriesVersion(example())).toBe(1) // the example: Pick then Greenlight, once each
    expect(territoriesVersion(withDecisions([]))).toBe(1)
    expect(territoriesVersion(withDecisions([pick]))).toBe(1)
    expect(territoriesVersion(withDecisions([pick, ...greenlights(1), pick, ...greenlights(1)]))).toBe(2)
    expect(territoriesVersion(withDecisions([{ gate: 'greenlight', kind: 'edit', by: 'Shrey', at: '2026-11-18T09:12:00Z' }]))).toBe(1)
    expect(territoriesVersion({})).toBe(1)
  })

  it('the route node takes the version at the spin-off, and a later spin-off of a changed document takes the new one', async () => {
    const first = await born(example())
    await bringCarriedRoutes(first.env, await first.s.clan.spunOffFrom())
    const versions = (x: typeof first) => Object.values(x.doc().briefs!).map((b) => b.route!.version)
    expect(new Set(versions(first))).toEqual(new Set([1]))
    // the document was reopened, changed and greenlit again, twice more: a new project spun off from it says v3
    const changed = await born(withDecisions([pick, ...greenlights(3)]))
    await bringCarriedRoutes(changed.env, await changed.s.clan.spunOffFrom())
    expect(new Set(versions(changed))).toEqual(new Set([3]))
    // the first project's nodes are frozen: they still say v1
    expect(new Set(versions(first))).toEqual(new Set([1]))
  })

  it('the brief it carries is named at its own approves in the carried chain, not 1', async () => {
    const d = example()
    const { s, env, doc } = await born(d)
    const from = (await s.clan.spunOffFrom())!
    const briefId = carriedBeside(doc().upstream, from.document_id).brief!.id
    const approve = (t: string) => ({ agent: 'brief-maker', action: 'approve', timestamp: '2026-11-17T10:00:00Z', kind: 'approve', targets: [t] })
    const chain = [approve(`${briefId}#insight`), approve(`${briefId}#audience`), approve(`${briefId}#insight`), approve(`other-doc#insight`), { agent: 'x', action: 'edit', timestamp: '2026-11-17T10:00:00Z', kind: 'edit', targets: [`${briefId}#insight`] }]
    expect(briefApprovals(chain, briefId)).toBe(3)
    expect(briefApprovals([], briefId)).toBe(1)
    await bringCarriedRoutes(env, from, chain)
    for (const b of Object.values(doc().briefs!)) expect(b.carries!.brief!.v).toBe(3)
  })

  it('a lock the host records against the bare brief id counts too, and every route node says its version (UAT round 4 F24, schema source.version)', async () => {
    const d = example()
    const { s, env, doc } = await born(d)
    const from = (await s.clan.spunOffFrom())!
    const briefId = carriedBeside(doc().upstream, from.document_id).brief!.id
    const approve = (t: string) => ({ agent: 'brief-maker', action: 'approve', timestamp: '2026-11-17T10:00:00Z', kind: 'approve', targets: [t] })
    expect(briefApprovals([approve(briefId), approve(briefId)], briefId)).toBe(2)
    expect(briefApprovals([approve(briefId), approve(`${briefId}#insight`)], briefId)).toBe(2)
    expect(briefApprovals([approve(`${briefId}x`)], briefId)).toBe(1)
    await bringCarriedRoutes(env, from, [approve(briefId), approve(briefId)])
    const nodes = Object.values(doc().briefs!).filter((b) => b.route)
    expect(nodes.length).toBeGreaterThan(0)
    for (const b of nodes) {
      expect(b.carries!.brief!.v).toBe(2)
      expect(b.source.version).toBeGreaterThanOrEqual(1)
    }
  })
})
