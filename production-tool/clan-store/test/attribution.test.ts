import { describe, expect, it } from 'vitest'
import { CREW, HostRefused, LocalPatchBus, MIGRATION_AGENT, agentKind, cardsFromRationale, crewFor, jobRationale, landingWhy, opVerb, recordJobOutcome, sawPart, type Doc, type JobEntry } from '../src/index'
import { APP_ID, freshHost, route } from '../src/host'
import { AT, MAYA, defaults, example, id, jobValue, sha, store, wasmBytes } from './fixtures'

/** patch.schema.json Why.rationale maxLength. */
const RATIONALE_MAX = 2000

function realJob(): JobEntry {
  const j = { id: id('job', 0), ...jobValue(0) } as unknown as JobEntry
  j.op = 'generate'
  j.provider = 'runway'
  j.model = 'gen4_image'
  j.updated_at = '2026-10-13T10:40:41Z'
  j.created_at = '2026-10-13T10:40:00Z'
  j.director = {
    model: 'claude-sonnet-5-5',
    promptVersion: 'director.v6',
    rationale: 'The sketch sets the pose; the photo gives the coat.',
    latencyMs: 2300,
    output: {
      op: 'generate',
      providerJob: { provider: 'runway', model: 'gen4_image', prompt: '@hero in a yellow raincoat, front view', refs: [{ sha256: sha(7), name: 'hero', role: 'character' }, { sha256: sha(8), name: 'coat', role: 'object' }] },
      question: null,
    },
  }
  j.cost = { estimate: 0.08, confirmed: 0.07, currency: 'USD', unknown: false }
  return j
}

describe('attribution: people and the crew', () => {
  it('names people and crew', () => {
    expect(agentKind('human:p_maya001')).toBe('person')
    expect(agentKind('dex')).toBe('crew')
    expect(agentKind('maya')).toBe('other')
  })

  it('gives each op its verb and its crew member', () => {
    expect([opVerb('shot_list'), crewFor('shot_list')]).toEqual(['plan', 'dex'])
    expect([opVerb('clip'), crewFor('clip')]).toEqual(['render', 'wren'])
    expect([opVerb('clip_patch'), crewFor('clip_patch')]).toEqual(['edit', 'edie'])
    expect([opVerb('cutout'), crewFor('cutout')]).toEqual(['retouch', 'rhea'])
    expect([opVerb('check'), crewFor('check')]).toEqual(['check', 'jude'])
    expect([opVerb('read'), crewFor('read')]).toEqual(['read', 'ellis'])
    expect([opVerb('write'), crewFor('write')]).toEqual(['write', 'skye'])
  })

  it('says what the director decided and what the provider made, in one line', () => {
    const r = jobRationale(realJob())
    expect(r).toContain('The sketch sets the pose')
    expect(r).toContain('hero as character')
    expect(r).toContain('prompt: "@hero in a yellow raincoat')
    expect(r).toContain('director claude-sonnet-5-5 · director.v6 · 2.3 s')
    expect(r).toContain('gen4_image on runway')
    expect(r).toContain('41 s')
    // No cost in the words a person reads (the owner's rule; review finding 3): the figure stays on the job (jobs[].cost).
    expect(r).not.toMatch(/\$|cost|0\.07|0\.08|confirmed|estimated/)
  })

  it('names each reference Dex added beyond what the shot asked for, with why (owner 2026-10-15)', () => {
    const j = realJob()
    ;(j.director!.output as { added?: unknown }).added = [{ name: 'coat', why: 'the words ask for the raincoat; only this photo shows it' }]
    expect(jobRationale(j)).toContain('Added by Dex: @coat, the words ask for the raincoat; only this photo shows it')
    expect(jobRationale(realJob())).not.toContain('Added by Dex')
  })

  it('a landing is the crew member\'s, citing the job', () => {
    const w = landingWhy('doc1', realJob(), `frames[${id('frame', 1)}]`)
    expect(w.agent).toBe('wren')
    expect(w.action).toBe(`render frames[${id('frame', 1)}]`)
    expect(w.cites).toEqual([`doc1#jobs[${id('job', 0)}]`])
  })

  it('cards ride at the end of a rationale and read back', () => {
    const cards = [{ tag: 'hero', sha256: sha(7), kind: 'character' as const, card: 'A woman, 30s.\nYellow coat / hood up.' }]
    const r = jobRationale(realJob(), cards)
    expect(r.endsWith(sawPart(cards))).toBe(true)
    const back = cardsFromRationale(r)
    expect(back.cards).toEqual([{ tag: 'hero', kind: 'character', lines: ['A woman, 30s.', 'Yellow coat, hood up.'] }])
  })

  it('a failed job is recorded once, as its crew member, with the job as its target', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const failed = { ...realJob(), state: 'failed', error: { code: 'provider_failed', message: 'Runway is busy.', retryable: true } }
    expect(await recordJobOutcome(s, failed)).toBe(true)
    expect(await recordJobOutcome(s, failed)).toBe(false)
    expect(await recordJobOutcome(s, { ...realJob(), state: 'completed' })).toBe(false)
    const [e] = await s.chain()
    expect(e.agent).toBe('wren')
    expect(e.action).toBe(`render failed generate ${id('job', 0)}`)
    expect(e.rationale).toContain('provider_failed: Runway is busy.')
    expect(e.targets).toEqual([`${s.documentId()}#jobs[${id('job', 0)}]`])
  })

  it('a quiet write names its agent and an action too (ADR-004): the person\'s plain sync line', async () => {
    const s = store()
    await s.create({ person: MAYA })
    await s.patch({ jobs: { [id('job', 0)]: { id: id('job', 0), v: 1, field_v: {}, ...jobValue(0) } } }, { action: 'set the job running', quiet: true, pinned: true })
    const quiet = (await s.chain()).filter((e) => e.action === 'sync')
    expect(quiet).toHaveLength(1)
    expect(quiet[0].agent).toBe(`human:${MAYA.id}`)
    expect(quiet[0].rationale).toBe('set the job running')
    expect(quiet[0].pinned).toBeFalsy()
    s.dispose()
  })

  describe('a long job still lands (2026-10-15: @pup with four views lost a paid frame)', () => {
    // A character key with four views, each with its sha, Dex's additions, several outputs and the cards:
    // together well past patch.schema.json's 2000 characters before the cap.
    function longJob(): JobEntry {
      const j = { id: id('job', 0), ...jobValue(0) } as unknown as JobEntry
      const views = ['front', 'three_quarter', 'side', 'back']
      const refs = [
        ...views.map((v, i) => ({ sha256: sha(100 + i), name: `pup_${v}`, role: 'character' })),
        ...views.map((v, i) => ({ sha256: sha(200 + i), name: `bowl_${v}`, role: 'object' })),
        { sha256: sha(300), name: 'kitchen', role: 'setting' },
      ]
      j.director = {
        model: 'claude-sonnet-5-5', promptVersion: 'director.v6', latencyMs: 4100,
        rationale: 'The front view sets the face and the side view the tail; the bowl is the hero product, so it stays in frame and in focus. '.repeat(3),
        output: {
          providerJob: { provider: 'runway', model: 'gen4_image', prompt: '@pup_front sits by @bowl_front on the kitchen floor, morning light. '.repeat(5), refs, firstFrame: sha(400) },
          added: views.map((v) => ({ name: `pup_${v}`, why: `the shot asks for @pup from the ${v}; only this view shows the markings on that side of the coat and the collar` })),
        },
      }
      j.outputs = [sha(500), sha(501), sha(502), sha(503)]
      return j
    }
    const cards = [
      { tag: 'pup', sha256: sha(100), kind: 'character' as const, card: 'A golden retriever pup, 10 weeks.\nWhite blaze on the chest.\nRed collar, brass tag.\nFloppy ears, one inside out.' },
      { tag: 'bowl', sha256: sha(200), kind: 'object' as const, card: 'Ceramic cereal bowl, cream glaze.\nLogo faces camera.\nFilled to the rim, milk splash.' },
      { tag: 'kitchen', sha256: sha(300), kind: 'setting' as const, card: 'Bright family kitchen.\nOak floor, white cupboards.\nWindow left, morning sun.' },
    ]

    it('caps the rationale at 2000 and keeps every card whole', () => {
      const j = longJob()
      expect(jobRationale(j).length).toBeLessThanOrEqual(RATIONALE_MAX)
      const r = jobRationale(j, cards)
      expect(r.length).toBeLessThanOrEqual(RATIONALE_MAX)
      expect(r.endsWith(sawPart(cards))).toBe(true)
      const back = cardsFromRationale(r)
      expect(back.cards.map((c) => c.tag)).toEqual(['pup', 'bowl', 'kitchen'])
      expect(back.cards[0].lines).toEqual(['A golden retriever pup, 10 weeks.', 'White blaze on the chest.', 'Red collar, brass tag.', 'Floppy ears, one inside out.'])
      expect(back.rest.startsWith('The front view sets the face')).toBe(true)
      expect(back.rest.endsWith('…')).toBe(true)
    })

    it('leaves a rationale that fits as it was', () => {
      const cards1 = cards.slice(0, 1)
      const r = jobRationale(realJob(), cards1)
      expect(r).not.toContain('…')
      expect(r.endsWith(sawPart(cards1))).toBe(true)
    })

    it('clips the whole string when the cards alone leave no room', () => {
      const many = Array.from({ length: 30 }, (_, i) => ({ tag: `extra${i}`, sha256: sha(600 + i), kind: 'object' as const, card: 'A thing on the counter, seen in the corner of the shot.\nKeep it soft.' }))
      const r = jobRationale(longJob(), many)
      expect(r.length).toBeLessThanOrEqual(RATIONALE_MAX)
      expect(r.startsWith('The front view sets the face')).toBe(true)
      expect(cardsFromRationale(r).cards.length).toBeGreaterThan(0)
    })

    it('a landing with that job is not refused by the bus', async () => {
      const s = store()
      await s.create({ person: MAYA })
      const j = longJob()
      const { id: jobId, ...value } = j as unknown as { id: string } & Record<string, unknown>
      const why = landingWhy(s.documentId(), j, `frames[${id('frame', 1)}]`, cards)
      const r = await new LocalPatchBus(s).apply({ patches: [{ op: 'create', entity: 'jobs', id: jobId, value, base_version: 0 }], why })
      expect(r.refused).toEqual([])
      expect(r.applied).toBe(true)
      const [e] = await s.chain()
      expect(e.rationale).toBe(why.rationale)
      expect(cardsFromRationale(e.rationale ?? '').cards).toHaveLength(3)
    })
  })
})

// Every write to a Production .clan names an agent and an action, for people and for the crew
// (features/production-platform-rules.clan, done_when 4): each write kind the Production line adds
// (format sizes, type layers, the timeline, takes), as a person and as a crew member, and a write
// that names neither, or names an agent that is neither a person nor the crew, is refused.
describe('every write kind the line adds names an agent and an action', () => {
  type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const ME = `human:${MAYA.id}`
  const named = (d: { agent?: string; action?: string }) => !!d.agent?.trim() && !!d.action?.trim()
  const known = (agent: string) => agent === ME || agent === MIGRATION_AGENT || (CREW as readonly string[]).includes(agent)

  async function campaign() {
    const ad = example<Doc>('document.campaign.json')
    const s = store()
    await s.create({ person: MAYA })
    const { upstream: _up, ...rest } = ad as Any
    const wipe = Object.fromEntries(['scripts', 'storyboards', 'videos', 'links'].map((m) => [m, Object.fromEntries(Object.keys(s.get()[m as 'links']).map((k) => [k, null]))]))
    await s.patch(wipe, { action: 'delete the defaults' })
    await s.patch({ project: rest.project, assets: rest.assets, boards: rest.boards }, { action: 'bring in the key visual' })
    await s.patch({ scripts: rest.scripts, storyboards: rest.storyboards, videos: rest.videos }, { action: 'plan the film' })
    return { s, rest, bus: new LocalPatchBus(s) }
  }

  it('format sizes and type layers, by a person and by the crew', async () => {
    const { s, rest, bus } = await campaign()
    await s.patch({ format_sets: rest.format_sets, sizes: rest.sizes, links: rest.links }, { action: 'make all sizes' })
    const size = Object.keys(rest.sizes)[0]
    const v = () => (s.get().sizes[size] as Any).v as number
    let r = await bus.apply({ patches: [{ op: 'set', entity: 'sizes', id: size, path: 'status', value: 'ready', base_version: v() }], why: { action: 'render size', agent: 'wren' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [{ op: 'set', entity: 'sizes', id: size, path: 'layers', value: { line: { text: 'First light.', scale: 1.1 } }, base_version: v() }], why: { action: 'set type layers' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [{ op: 'set', entity: 'sizes', id: size, path: 'layers', value: { legal: { hidden: false } }, base_version: v() }], why: { action: 'retouch type layers', agent: 'rhea' } })
    expect(r.refused).toEqual([])
    const chain = await s.chain()
    expect(chain.length).toBeGreaterThan(0)
    for (const d of chain) expect([d.agent, d.action, named(d) && known(d.agent)]).toEqual([d.agent, d.action, true])
    expect(chain.map((d) => [d.agent, d.action])).toEqual(expect.arrayContaining([
      [ME, 'make all sizes'], ['wren', 'render size'], [ME, 'set type layers'], ['rhea', 'retouch type layers'],
    ]))
  })

  it('takes and the timeline, by a person and by the crew', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const bus = new LocalPatchBus(s)
    const video = defaults(s).video
    const G = id('gen', 1)
    const ITEM = id('item', 1)
    const gen = { kind: 'clip', shot_ids: [id('shot', 1)], state: 'making', created_at: AT, by: ME }
    let r = await bus.apply({ patches: [{ op: 'create', entity: 'generations', id: G, value: gen, base_version: 0 }], why: { action: 'make box 1' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [
      { op: 'set', entity: 'generations', id: G, path: 'state', value: 'ready', base_version: 1 },
      { op: 'set', entity: 'generations', id: G, path: 'asset', value: sha(7), base_version: 1 },
      { op: 'set', entity: 'generations', id: G, path: 'duration_s', value: 4, base_version: 1 },
    ], why: { action: 'render take v1', agent: 'wren' } })
    expect(r.refused).toEqual([])
    const vv = () => (s.get().videos[video] as Any).v as number
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${ITEM}`, value: { track: 'V1', start_s: 0, source: { generation_id: G, in_s: 0, out_s: 2 } }, base_version: vv() }], why: { action: 'assemble first cut' } })
    expect(r.refused).toEqual([])
    r = await bus.apply({ patches: [{ op: 'set', entity: 'videos', id: video, path: `timeline/${ITEM}/source/out_s`, value: 3, base_version: vv() }], why: { action: 'edit the cut', agent: 'edie' } })
    expect(r.refused).toEqual([])
    const chain = await s.chain()
    for (const d of chain) expect([d.agent, d.action, named(d) && known(d.agent)]).toEqual([d.agent, d.action, true])
    expect(chain.map((d) => [d.agent, d.action])).toEqual(expect.arrayContaining([
      [ME, 'make box 1'], ['wren', 'render take v1'], [ME, 'assemble first cut'], ['edie', 'edit the cut'],
    ]))
  })

  it('a write with no action, or an agent that is neither a person nor the crew, is refused and leaves the chain as it was', async () => {
    const s = store()
    await s.create({ person: MAYA })
    const before = (await s.chain()).length
    await expect(s.patch({ project: { title: 'No action' } }, { action: ' ' })).rejects.toThrow(/action/)
    await expect(s.patch({ project: { title: 'Nobody' } }, { action: 'rename', agent: 'maya' })).rejects.toThrow(/agent/)
    await expect(s.record({ action: 'note', agent: 'somebody' })).rejects.toThrow(/agent/)
    await expect(s.record({ action: '' })).rejects.toThrow(/action/)
    const bus = new LocalPatchBus(s)
    const r = await bus.apply({ patches: [{ op: 'set', entity: 'project', id: 'project', path: 'title', value: 'Ghost', base_version: (s.get().project as Any).v ?? 0 }], why: { action: 'rename', agent: 'ghost' } })
    expect(r.applied).toBe(false)
    expect((await s.chain()).length).toBe(before)
    expect(s.get().project.title).not.toBe('Ghost')
  })

  it('the host itself refuses a write that names no agent or no action (ADR-004)', async () => {
    const h = await freshHost(wasmBytes())
    try {
      h.newDocument(APP_ID, 'Client A')
      expect(() => route(h, '/patch-data', { patch: { project: { title: 'x' } }, agent: '', action: 'rename' })).toThrow(HostRefused)
      expect(() => route(h, '/patch-data', { patch: { project: { title: 'x' } }, agent: 'human:p_maya001', action: '' })).toThrow(HostRefused)
    } finally {
      h.free()
    }
  })
})
