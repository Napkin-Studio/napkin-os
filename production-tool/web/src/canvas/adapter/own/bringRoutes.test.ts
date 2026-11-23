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
import { bringCarriedRoutes, carriedRoutes, isTerritories, picturesLine, RIGHTS_TO_SUPPLY, routeWords } from '../../../brief/routes'

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
  z['manifest.yaml'] = new TextEncoder().encode(text('manifest.yaml').replace('title: Lumen Water', 'title: Rail territories').replaceAll('2accccdf-85fc-43a3-8e78-d35837370a77', TERR_ID))
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
    expect(routeWords(got.routes[0])).toContain(line)
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
  it('puts one Text per greenlit route on the blank canvas, nothing selected, and records what came from where', async () => {
    const d = withFrames()
    const { s, a, env, doc } = await born(d)
    const from = (await s.clan.spunOffFrom())!
    const out = await bringCarriedRoutes(env, from)
    expect(out!.made).toBe((d.greenlit as unknown[]).length)
    const els = a.elements().filter((e) => !e.isDeleted)
    expect(els.map((e) => e.type)).toEqual(Array(out!.made).fill('text'))
    const words = els.map((e) => (e as unknown as { text: string }).text)
    for (const name of greenNames(d)) expect(words.some((w) => w.startsWith(name.toUpperCase()))).toBe(true)
    expect(words.join('\n')).toContain('Pictures: 1 mock-up sketch')
    expect(a.view().selectedIds).toHaveLength(0)
    // the canvas sync records each text; the page's own record says where they came from
    const spin = Object.values(doc().spin_ins!)
    expect(spin).toHaveLength(1)
    expect(spin[0]).toMatchObject({ state: 'brought_in', source: { document_id: from.document_id, app: 'ie.napkin.territories', title: 'Rail territories' } })
    expect(spin[0].plan.map((p) => p.title)).toEqual(expect.arrayContaining(greenNames(d)))
    // no Script, Brief or link was made for the person
    expect(Object.keys(doc().scripts)).toHaveLength(0)
    expect(Object.keys(doc().briefs ?? {})).toHaveLength(0)
    expect(Object.values(doc().links)).toHaveLength(0)
    // pictures stay links: the project holds hashes only, no asset bytes were made for them
    expect(Object.keys(doc().assets ?? {})).toHaveLength(0)
  })

  it('once: the second time, and after a reload, adds nothing', async () => {
    const { s, a, env, doc } = await born(withFrames())
    const from = await s.clan.spunOffFrom()
    await bringCarriedRoutes(env, from)
    const n = a.elements().length
    expect(await bringCarriedRoutes(env, from)).toBeNull()
    expect(a.elements()).toHaveLength(n)
    expect(Object.keys(doc().spin_ins!)).toHaveLength(1)
  })

  it('a project that was not spun off brings nothing', async () => {
    const { env } = await born(example())
    expect(await bringCarriedRoutes(env, null)).toBeNull()
  })
})
