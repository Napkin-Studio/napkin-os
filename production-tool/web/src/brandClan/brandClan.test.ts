// The Brand Clan node (Brand Clan phase 2; DESIGN 4a; mocks d1-d3): what it links to, the nearest link up the canvas winning
// for each step, what a job reads from it (only when linked), the person's update / keep / swap with one decision each, its
// removal with its links, the OS source, and the document contract.

import { describe, expect, it } from 'vitest'
import type { BrandClanNode, Link, ProductionDocument } from '../contracts/types'
import { loadJson, makeAjv, SCHEMA } from '../test/schemas'
import { MAYA, modelStore } from '../test/model'
import { canLink } from '../canvas/core/links'
import { linkRuleFor } from '../../../clan-store/src/integrity'
import { removeBrandClan } from '../doc/remove'
import { brandRows } from '../jobs/context'
import { scopeOf } from '../model/scope'
import { addBrandClan, brandClanForJob, brandClanOf, brandClanWords, fetchLogo, freshness, keepBrandClan, linkedLabel, logoAssetOf, newBrandClan, takeBrandClan, type LogoIn } from './model'
import { brandKit } from '../campaign/layout'
import { compileFor } from '../rooms/timeline'
import { roots } from '../doc/gc'
import { osBrandClanSource, type OsBrandClanRead } from './os'

const ex = loadJson<ProductionDocument>('examples/document.ad.json')
const SCRIPT = 'script_01K7A00000000000000000000Z'
const SB = 'storyboard_01K7A000000000000000000012'
const VIDEO = 'video_01K7A000000000000000000027'
const S15 = 'shot_01K7A000000000000000000015'

const ZERO = {
  name: 'Zero', kit: { version: 2 },
  visual: {
    logos: [{ id: 'wordmark-light', variant: 'light', asset: 'human/assets/logo-zero-light.svg' }],
    colours: [{ id: 'silver', name: 'Silver', hex: '#9AA7B1', role: 'other' }, { id: 'mint', name: 'Mint', hex: '#7FD6BD', role: 'accent' }],
    typography: [{ id: 'serif', family: 'Tidewell Serif', role: 'head', use: 'headlines' }, { id: 'sans', family: 'Tidewell Sans', role: 'body' }],
  },
  voice: { tone: 'Clear, cool, a little dry.', rules: [{ id: 'mint-accent', text: 'Mint only as an accent.', kind: 'dont' }] },
  imagery: { style: 'Daylight, cold metal and water.', bans: ['people drinking in cars'], examples: [{ id: 'ex1', asset: 'human/assets/img.svg' }] },
  gaps: ['photography'],
}
const read = (name = 'Zero', version = 2, data: Record<string, unknown> = ZERO, documentId = `doc-${name.toLowerCase()}`): OsBrandClanRead =>
  ({ documentId, path: documentId, name, version, client: { id: 'cli_tidewell', name: 'Tidewell' }, data })

let n = 0
const link = (from: string, to: Link['to']): Link => ({ id: `link_${String(n++).padStart(26, '0')}`, v: 1, field_v: {}, from: { kind: 'brand_clan', id: from }, to, role: 'brand' })
const withClans = (d: ProductionDocument, nodes: BrandClanNode[], ...links: Link[]) => {
  const x = structuredClone(d)
  x.brand_clans = Object.fromEntries(nodes.map((c) => [c.id, c]))
  for (const l of links) x.links[l.id] = l
  return x
}

describe('canLink: a Brand Clan → Script, Storyboard, Film or the sizes, and nothing into it', () => {
  it.each(['script', 'storyboard', 'video', 'format_set'] as const)('brand_clan → %s', (to) => {
    expect(canLink('brand_clan', to)).toEqual({ ok: true, roles: ['brand'] })
  })
  it.each(['shot', 'sketch', 'picture', 'brand_clan'] as const)('not → %s', (to) => {
    expect(canLink('brand_clan', to).ok).toBe(false)
  })
  it('nothing feeds a Brand Clan', () => {
    expect(canLink('script', 'brand_clan').ok).toBe(false)
  })
  it('the store refuses the same links (one rule, from the contract)', () => {
    expect('rule' in linkRuleFor('brand_clan', 'script', 'brand')).toBe(true)
    expect(linkRuleFor('script', 'brand_clan', 'drives')).toEqual({ refused: 'Nothing feeds a brand_clan: it is an input only.' })
  })
})

describe('the nearest link up the canvas wins (DESIGN 4a, mock d3)', () => {
  const original = { ...newBrandClan(read('Original', 3), 'default'), id: 'bclan_01K7A0000000000000000000OR' }
  const summer = { ...newBrandClan(read('Summer 26', 1), 'pick'), id: 'bclan_01K7A0000000000000000000SU' }

  it('placed, not linked: no node reads it, and the card says so', () => {
    const d = withClans(ex, [original])
    expect(brandClanOf(d, SCRIPT)).toBeUndefined()
    expect(brandClanForJob(d, { kind: 'shot', id: S15 })).toBeUndefined()
    expect(linkedLabel(d, original.id)).toBe('')
    expect(brandRows(d, 'frame', { kind: 'shot', id: S15 }, { text: 'a calm morning' }).some((r) => r.ref === original.id)).toBe(false)
  })

  it('linked to the Script, it carries to the Storyboard and the Film it drives', () => {
    const d = withClans(ex, [original], link(original.id, { kind: 'script', id: SCRIPT }))
    expect(brandClanOf(d, SCRIPT)).toMatchObject({ node: { id: original.id }, via: 'link', at: SCRIPT })
    expect(brandClanOf(d, SB)).toMatchObject({ node: { id: original.id }, via: 'upstream', at: SCRIPT })
    expect(brandClanOf(d, VIDEO)).toMatchObject({ node: { id: original.id }, via: 'upstream' })
    expect(brandClanForJob(d, { kind: 'shot', id: S15 })?.node.id).toBe(original.id)
    expect(linkedLabel(d, original.id)).toBe('Linked to the Script')
  })

  it('a Storyboard linked to another look uses it, and so does its Film; the Script keeps the first', () => {
    const d = withClans(ex, [original, summer], link(original.id, { kind: 'script', id: SCRIPT }), link(summer.id, { kind: 'storyboard', id: SB }))
    expect(brandClanOf(d, SCRIPT)?.node.id).toBe(original.id)
    expect(brandClanOf(d, SB)).toMatchObject({ node: { id: summer.id }, via: 'link' })
    expect(brandClanOf(d, VIDEO)).toMatchObject({ node: { id: summer.id }, via: 'upstream', at: SB })
    expect(brandClanForJob(d, { kind: 'shot', id: S15 })?.node.id).toBe(summer.id)
  })

  it('shows in the node’s inputs as "Brand Clan · Zero · v2"', () => {
    const zero = { ...newBrandClan(read(), 'pick'), id: 'bclan_01K7A0000000000000000000ZE' }
    const d = withClans(ex, [zero], link(zero.id, { kind: 'storyboard', id: SB }))
    expect(scopeOf(d, SB).find((x) => x.kind === 'brand_clan')).toMatchObject({ id: zero.id, label: 'Brand Clan · Zero · v2', via: 'link' })
  })
})

describe('what a job reads: its words and its look, only when linked', () => {
  const zero = { ...newBrandClan(read(), 'pick'), id: 'bclan_01K7A0000000000000000000ZE' }
  it('tone, rules and imagery bans as brand rules, the colours as a palette, the type', () => {
    expect(brandClanWords(zero).map((w) => [w.kind, w.text])).toEqual([
      ['brand_rule', 'Tone: Clear, cool, a little dry.'],
      ['brand_rule', "Don't: Mint only as an accent."],
      ['brand_rule', "Don't: people drinking in cars"],
      ['brand_rule', 'Imagery: Daylight, cold metal and water.'],
      ['palette', 'Silver #9AA7B1, Mint #7FD6BD'],
      ['typography', 'Tidewell Serif (headlines), Tidewell Sans'],
    ])
  })
  it('a frame job on a shot of a linked Storyboard carries them, each one a tray row the person can leave out', () => {
    const d = withClans(ex, [zero], link(zero.id, { kind: 'storyboard', id: SB }))
    const rows = brandRows(d, 'frame', { kind: 'shot', id: S15 }, { text: 'a calm morning' })
    const mine = rows.filter((r) => r.ref === zero.id)
    expect(mine.map((r) => [r.kind, r.on])).toEqual([['brand_rule', true], ['brand_rule', true], ['brand_rule', true], ['brand_rule', true], ['palette', true], ['typography', true]])
    expect(mine[0]).toMatchObject({ from: 'Zero v2', label: 'Zero · rule' })
    const left = brandRows(d, 'frame', { kind: 'shot', id: S15 }, { text: 'a calm morning' }, { leave: [`${zero.id}#palette`] })
    expect(left.find((r) => r.ref === zero.id && r.kind === 'palette')?.on).toBe(false)
  })
})

describe('the person’s choices, one decision each, and removal', () => {
  it('places it (system), takes a newer version, keeps one, swaps for another look', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Brand Clan project')
    const node = await addBrandClan(s, newBrandClan(read('Zero', 2), 'default'))
    const get = () => (s.get() as unknown as ProductionDocument).brand_clans![node.id]
    expect(get()).toMatchObject({ title: 'Zero', source: { version: 2, how: 'default', app_id: 'ie.napkin.brand' } })
    expect(get().bible).not.toHaveProperty('gaps')
    expect(freshness(get(), { version: 3 })).toBe('newer')
    await keepBrandClan(s, node.id, 3)
    expect(freshness(get(), { version: 3 })).toBe('kept')
    expect(freshness(get(), { version: 4 })).toBe('newer')
    await takeBrandClan(s, node.id, read('Zero', 4, { ...ZERO, voice: { tone: 'Cooler still.' } }))
    expect(get()).toMatchObject({ source: { version: 4 }, bible: { voice: { tone: 'Cooler still.' } } })
    expect(get().source.kept).toBeUndefined()
    await takeBrandClan(s, node.id, read('Summer 26', 1, { visual: { colours: [{ id: 'coral', hex: '#FF7F6A', role: 'accent' }] } }))
    expect(get()).toMatchObject({ title: 'Summer 26', source: { document_id: 'doc-summer 26', version: 1, how: 'pick' } })
    const chain = (await s.chain()).map((e) => e.action)
    expect(chain).toContain('place the Brand Clan “Zero” v2')
    expect(chain).toContain('keep_brand_clan v2')
    expect(chain).toContain('update_from_brand_clan “Zero” v2 → v4')
    expect(chain.some((a) => a.startsWith('swap_brand_clan “Zero” v4 → “Summer 26” v1'))).toBe(true)
    expect(Object.keys((s.get() as unknown as ProductionDocument).jobs)).toHaveLength(0)
  })

  it('leaving the canvas takes its copy and its links; the Brand Clan itself is untouched', () => {
    const zero = { ...newBrandClan(read(), 'pick'), id: 'bclan_01K7A0000000000000000000ZE' }
    const l = link(zero.id, { kind: 'script', id: SCRIPT })
    const d = withClans(ex, [zero], l)
    const r = removeBrandClan(d, zero.id)
    expect(d.brand_clans).toEqual({})
    expect(d.links[l.id]).toBeUndefined()
    expect(r.ids).toEqual([zero.id])
  })
})

describe('the document contract', () => {
  it('a document with Brand Clan nodes and their links validates', () => {
    const zero = { ...newBrandClan(read(), 'default'), id: 'bclan_01K7A0000000000000000000ZE' }
    const d = withClans(ex, [zero], { ...link(zero.id, { kind: 'script', id: SCRIPT }), id: 'link_01K7A0000000000000000000BC' })
    const ajv = makeAjv()
    const ok = ajv.validate(SCHEMA('document'), d)
    expect(ajv.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })
})

describe('the OS source', () => {
  it('lists the client’s Brand Clans and reads one, from the shell API on the same origin', async () => {
    const calls: string[] = []
    const fake = async (url: string) => {
      calls.push(url)
      const body = url.endsWith('/api/session') ? { tenant: 't1' }
        : url.endsWith('/clients/cli_tidewell/brand-clans') ? { items: [{ document_id: 'doc-zero', path: 'doc-zero', name: 'Zero', note: 'Silver and mint', version: 2, default: true, palette: ['#9AA7B1', 'mint'] }] }
        : { document_id: 'doc-zero', path: 'doc-zero', name: 'Zero', version: 2, client: { id: 'cli_tidewell', name: 'Tidewell' }, data: ZERO }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const src = osBrandClanSource('', fake)
    expect(await src.list('cli_tidewell')).toEqual([{ documentId: 'doc-zero', path: 'doc-zero', name: 'Zero', note: 'Silver and mint', version: 2, default: true, palette: ['#9AA7B1'] }])
    expect(await src.read('doc-zero')).toMatchObject({ name: 'Zero', version: 2, client: { id: 'cli_tidewell', name: 'Tidewell' } })
    expect(await src.assetUrl('doc-zero', 'human/assets/logo-zero-light.svg')).toBe('/api/t/t1/brand-clans/doc-zero/assets/logo-zero-light.svg')
    expect(calls).toContain('/api/t/t1/clients/cli_tidewell/brand-clans')
  })
})

describe('the client’s default, placed once for the person', () => {
  it('a project whose history ever placed or added a Brand Clan is never given one again (a removed default stays removed)', async () => {
    const { chainHadBrandClan, placeDefaultBrandClan } = await import('./canvas')
    expect(chainHadBrandClan(['start the project', 'place the Brand Clan “Zero” v2'])).toBe(true)
    expect(chainHadBrandClan(['add the Brand Clan “Summer 26” v1'])).toBe(true)
    expect(chainHadBrandClan(['start the project', 'link the brief'])).toBe(false)
    let asked = 0
    const src = { available: async () => { asked++; return true }, list: async () => [], read: async () => read(), assetUrl: async () => null, assetFile: async () => null, projectClient: async () => 'cli_tidewell' }
    const env = { doc: { get: () => structuredClone(ex) }, canvas: {} } as never
    expect(await placeDefaultBrandClan(env, true, src)).toBeNull()
    expect(asked).toBe(0)
  })

  it('no client, or a client with no default: nothing is placed', async () => {
    const { placeDefaultBrandClan } = await import('./canvas')
    const env = { doc: { get: () => structuredClone(ex) }, canvas: {} } as never
    const none = { available: async () => true, list: async () => [], read: async () => read(), assetUrl: async () => null, assetFile: async () => null, projectClient: async () => null }
    expect(await placeDefaultBrandClan(env, false, none)).toBeNull()
    const noDefault = { ...none, projectClient: async () => 'cli_tidewell', list: async () => [{ documentId: 'doc-zero', path: 'doc-zero', name: 'Zero', version: 2, default: false, palette: [] }] }
    expect(await placeDefaultBrandClan(env, false, noDefault, 'doc-ie-napkin-production-1')).toBeNull()
  })
})

describe('its logo reaches the end card and the sizes (owner 2026-11-24): linked, and only when the Brand board has none', () => {
  const PNG_SHA = 'sha256:' + 'ab'.repeat(32)
  const LOGO: LogoIn = { sha256: PNG_SHA, w: 960, h: 240, mime: 'image/png', bytes: 1234 }
  const FSET = 'fset_01K7A00000000000000000002K'
  const noBoardLogo = (d: ProductionDocument) => {
    for (const [k, r] of Object.entries(d.refs)) if (r.role === 'logo') delete d.refs[k]
    return d
  }

  it('takes the dark-ground logo, else the mark, else any', () => {
    const b = (logos: { variant: string; asset: string }[]) => ({ visual: { logos } }) as never
    expect(logoAssetOf(b([{ variant: 'light', asset: 'l.png' }, { variant: 'dark', asset: 'd.png' }]))).toBe('d.png')
    expect(logoAssetOf(b([{ variant: 'light', asset: 'l.png' }, { variant: 'mark', asset: 'm.png' }]))).toBe('m.png')
    expect(logoAssetOf(b([{ variant: 'other', asset: 'o.png' }]))).toBe('o.png')
    expect(logoAssetOf({})).toBeUndefined()
  })

  it('fetches a PNG, JPEG or WebP logo into this browser; an SVG, a missing file or no logo gives none', async () => {
    const withLogo = (asset: string) => read('Zero', 2, { ...ZERO, visual: { ...ZERO.visual, logos: [{ id: 'd', variant: 'dark', asset }] } })
    const src = (type: string | null) => ({ assetFile: async () => (type ? new Blob([new Uint8Array([1, 2, 3])], { type }) : null) })
    const measure = async () => ({ w: 960, h: 240 })
    const keep = async () => PNG_SHA
    expect(await fetchLogo(src('image/png'), withLogo('human/assets/a-logo.png'), measure, keep)).toEqual({ ...LOGO, bytes: 3 })
    expect(await fetchLogo(src('image/svg+xml'), withLogo('human/assets/a-logo.svg'), measure, keep)).toBeUndefined()
    expect(await fetchLogo(src(null), withLogo('human/assets/a-logo.png'), measure, keep)).toBeUndefined()
    expect(await fetchLogo({ assetFile: async () => { throw new Error('offline') } }, withLogo('human/assets/a-logo.png'), measure, keep)).toBeUndefined()
    expect(await fetchLogo(src('image/png'), read('Zero', 2, { ...ZERO, visual: { colours: [] } }), measure, keep)).toBeUndefined()
  })

  it('placing, swapping and updating write the logo as a project picture; a look with none clears it', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Brand Clan project')
    const node = await addBrandClan(s, newBrandClan(read('Zero', 2), 'default'), LOGO)
    const doc = () => s.get() as unknown as ProductionDocument
    expect(doc().brand_clans![node.id].logo).toEqual({ sha256: PNG_SHA, w: 960, h: 240 })
    expect(doc().assets[PNG_SHA]).toMatchObject({ kind: 'image', mime: 'image/png', w: 960, h: 240 })
    await takeBrandClan(s, node.id, read('Summer 26', 1, { visual: { colours: [] } }))
    expect(doc().brand_clans![node.id].logo).toBeUndefined()
  })

  it('the end card and the sizes use it when linked and there is no Brand board logo; the Brand board logo still wins', () => {
    const zero = { ...newBrandClan(read(), 'pick'), id: 'bclan_01K7A0000000000000000000ZE', logo: { sha256: PNG_SHA, w: 960, h: 240 } }
    const withAsset = (d: ProductionDocument) => { d.assets[PNG_SHA] = { sha256: PNG_SHA, kind: 'image', mime: 'image/png', bytes: 1234, w: 960, h: 240, origin: 'uploaded', rights: 'unknown' }; return d }
    const linked = withAsset(noBoardLogo(withClans(ex, [zero], link(zero.id, { kind: 'script', id: SCRIPT }))))
    // carried from the Script down to the Film and the Film's sizes
    expect(brandKit(linked, VIDEO).logo).toEqual({ sha256: PNG_SHA, w: 960, h: 240 })
    expect(brandKit(linked, FSET).logo?.sha256).toBe(PNG_SHA)
    expect(compileFor(linked, VIDEO).endCard?.logo_sha256).toBe(PNG_SHA)
    // placed but not linked: not used
    const placed = withAsset(noBoardLogo(withClans(ex, [zero])))
    expect(brandKit(placed, VIDEO).logo).toBeUndefined()
    expect(compileFor(placed, VIDEO).endCard?.logo_sha256).toBeUndefined()
    // the Brand board's logo wins
    const board = withAsset(withClans(ex, [zero], link(zero.id, { kind: 'script', id: SCRIPT })))
    expect(brandKit(board, VIDEO).logo?.sha256).toBe('sha256:c2b3a5f0b9e8a918bb5d240127759b0ec6f359ba4354e793d0e35778c9d51a3d')
    // the clean-up keeps it
    expect(roots(linked, []).has(PNG_SHA)).toBe(true)
  })

  it('a node with its logo validates against the document contract', () => {
    const zero = { ...newBrandClan(read(), 'default'), id: 'bclan_01K7A0000000000000000000ZE', logo: { sha256: PNG_SHA, w: 960, h: 240 } }
    const d = withClans(ex, [zero])
    const ajv = makeAjv()
    expect(ajv.validate(SCHEMA('document'), d)).toBe(true)
    expect(ajv.validate(SCHEMA('document'), withClans(ex, [{ ...zero, logo: { sha256: PNG_SHA } as never }]))).toBe(false)
  })
})
