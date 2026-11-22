// A project born as a spin-off (features/production-spinoff.clan): napkin-web writes it to the relay
// from a brief, and the tool opens it, edits it and saves it again. The manifest the spin-off wrote
// (what it carries, from where, the decisions) must survive that round trip: provenance that the first
// autosave drops is provenance nobody has.
//
// The fixture is `cargo run -p clan-sdk --example make_production -- /dev/null brief-spun-off.clan`:
// a Brief Maker document spun off into the Production template with source_uri clan-store:doc-lumen-brief.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { LocalPatchBus } from '../src/index'
import { MAYA, id, store } from './fixtures'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = () => new Uint8Array(readFileSync(join(here, 'fixtures', 'brief-spun-off.clan')))

function entries(bytes: Uint8Array): { manifest: Record<string, any>; data: Record<string, any>; chain: { decisions: Record<string, any>[] } } {
  const z = unzipSync(bytes)
  const text = (p: string) => new TextDecoder().decode(z[p])
  return { manifest: parseYaml(text('manifest.yaml')), data: parseYaml(text('shared/data.yaml')), chain: parseYaml(text('agent/decision-chain.yaml')) }
}

describe('a project born as a spin-off', () => {
  it('opens as a new blank project that still carries the brief', async () => {
    const s = store()
    const doc = await s.open(fixture())
    expect(doc.contract_version).toBe('3')
    expect(doc.project.title).toBe('Lumen Water')
    expect(Object.keys(doc.scripts)).toEqual([])
    expect(Object.keys(doc.storyboards)).toEqual([])
    const before = entries(fixture())
    const briefId = before.manifest.lineage.carried.document_id
    expect((doc as any).upstream[briefId].brief.title).toBe('Lumen Water')
    // starting the project is a decision of the person who opened it, after the carried ones
    const chain = await s.chain()
    expect(chain[0].action).toBe('start the project')
    expect(chain.some((d) => String(d.action).startsWith('spin off'))).toBe(true)
  })

  it('keeps the manifest, the carried brief and the carried decisions through open, edit and save', async () => {
    const s = store()
    await s.open(fixture())
    const bus = new LocalPatchBus(s)
    const r = await bus.apply({
      patches: [{ op: 'create', entity: 'keys', id: id('key', 0), value: { key: 'hero', role: 'character' }, base_version: 0 }],
      why: { action: 'name @hero', rationale: 'the lead' },
    })
    expect(r.applied).toBe(true)
    const saved = entries(await s.exportClan())
    const first = entries(fixture())

    // what it carries, and where from
    expect(saved.manifest.lineage.carried).toEqual(first.manifest.lineage.carried)
    expect(saved.manifest.document_id).toBe(first.manifest.document_id)
    expect(saved.manifest.app.app_id).toBe('ie.napkin.production')
    // the brief, frozen
    expect(saved.data.upstream).toEqual(first.data.upstream)
    // every carried decision, pinned, in order, and the spin-off marker
    const carried = (c: typeof first.chain) => c.decisions.filter((d) => d.pinned)
    expect(carried(saved.chain).map((d) => d.action)).toEqual(carried(first.chain).map((d) => d.action))
    expect(saved.chain.decisions.map((d) => d.action)).toContain('name @hero')
    // the spin-off's own address of the source: the first revision's lineage
    expect(first.manifest.lineage.parent_uri).toBe('clan-store:doc-lumen-brief')
  })

  it('a second open and save of the saved bytes changes nothing it carries', async () => {
    const s = store()
    await s.open(fixture())
    const once = await s.exportClan()
    const t = store()
    await t.open(once)
    const twice = await t.exportClan()
    expect(entries(twice).data.upstream).toEqual(entries(once).data.upstream)
    expect(entries(twice).manifest.lineage.carried).toEqual(entries(once).manifest.lineage.carried)
    // not started a second time
    const starts = (await t.chain()).filter((d) => d.action === 'start the project')
    expect(starts).toHaveLength(1)
    expect(MAYA.id).toBeTruthy()
  })
})
