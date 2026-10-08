import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  ClanDocumentStore, agentKind, directorRecord, memoryPersistence, providerRecord, recordJobOutcome, type JobEntry,
} from '../src/index'
import { id, job, sha, wasmBytes } from './fixtures'

const wasm = wasmBytes()
const maya = { participant: { id: 'p_a1b2c3', handle: 'maya' } }
const tmp = mkdtempSync(join(tmpdir(), 'clan-attr-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function store(persistence = memoryPersistence()) {
  return new ClanDocumentStore({ wasm, persistence, saveDebounceMs: 10 })
}

function realJob(): JobEntry {
  const j = job(0) as unknown as JobEntry
  j.op = 'generate'
  j.provider = 'runway'
  j.model = 'gen4_image'
  j.updated_at = '2026-10-07T10:40:41Z'
  j.agent = {
    model: 'claude-sonnet-4-5',
    promptVersion: 'director.v1',
    rationale: 'The sketch sets the pose; the photo gives the coat.',
    latencyMs: 2300,
    output: {
      op: 'generate',
      providerJob: {
        provider: 'runway', model: 'gen4_image', prompt: '@hero in a yellow raincoat, front view, full body, plain studio background',
        refs: [{ sha256: sha(7), name: 'hero', role: 'character' }, { sha256: sha(8), name: 'coat', role: 'object' }],
      },
      needsUser: null, rationale: 'x', confidence: 0.8,
    },
  }
  j.cost = { estimate: 0.08, confirmed: 0.07, currency: 'USD', unknown: false }
  return j
}

describe('attribution: participant, director, provider', () => {
  it('names the three kinds of author', () => {
    expect(agentKind('maya')).toBe('participant')
    expect(agentKind('director · claude-sonnet-4-5 · director.v1')).toBe('director')
    expect(agentKind('runway · gen4_image')).toBe('provider')
  })

  it('builds the director and provider entries from the job', () => {
    const j = realJob()
    const d = directorRecord(j)!
    expect(d.agent).toBe('director · claude-sonnet-4-5 · director.v1')
    expect(d.action).toBe(`directed generate ${j.id}`)
    expect(d.rationale).toContain('The sketch sets the pose')
    expect(d.rationale).toContain('hero as character')
    expect(d.rationale).toContain('coat as object')
    expect(d.rationale).toContain('prompt: "@hero in a yellow raincoat')
    const p = providerRecord(j)!
    expect(p.agent).toBe('runway · gen4_image')
    expect(p.action).toBe(`made generate ${j.id}`)
    expect(p.rationale).toContain('cost $0.07 confirmed')
    expect(p.rationale).toContain('41 s')
    expect(p.rationale).toContain(`out ${j.outputs![0]}`)

    const failed = { ...j, state: 'failed', outputs: [], error: { code: 'moderated', message: 'The provider refused the picture.', retryable: false, providerCode: 'SAFETY.INPUT.IMAGE' } }
    const pf = providerRecord(failed)!
    expect(pf.action).toBe(`failed generate ${j.id}`)
    expect(pf.rationale).toMatch(/^moderated \(SAFETY.INPUT.IMAGE\): The provider refused/)
    expect(providerRecord({ ...j, state: 'running' })).toBeNull()
  })

  it('writes the job entries once, across repeats and a reload', async () => {
    const s = store()
    await s.create(maya)
    const j = realJob()
    await s.patch({ jobs: [j] }, { action: 'job', quiet: true })
    expect(await recordJobOutcome(s, { ...j, state: 'running' })).toBe(0)
    expect(await recordJobOutcome(s, j)).toBe(2)
    expect(await recordJobOutcome(s, j)).toBe(0)

    const again = store()
    await again.open(await s.exportClan())
    expect(await recordJobOutcome(again, j)).toBe(0)

    const chain = await again.chain()
    expect(chain.filter((e) => e.action.endsWith(j.id))).toHaveLength(2)
    // The quiet write left no entry.
    expect(chain.map((e) => e.action)).not.toContain('job')
    const kinds = chain.map((e) => agentKind(e.agent))
    expect(kinds).toContain('director')
    expect(kinds).toContain('provider')
    expect(kinds).toContain('participant')
    s.dispose()
    again.dispose()
  })

  it('a patch can name its agent, and pins locks', async () => {
    const s = store()
    await s.create(maya)
    await s.patch({ keys: [{ key: 'hero', role: 'character', library: { workspace: 'acme', ver: 1, by: 'maya', at: '2026-10-07T10:41:00Z' } }] }, { action: 'published hero', pinned: true })
    await s.patch({ stage: { current: 'storyboard' } }, { action: 'moved on', agent: 'director · m · director.v1' })
    const [moved, locked] = await s.chain()
    expect(moved.agent).toBe('director · m · director.v1')
    expect(locked.agent).toBe('maya')
    expect(locked.pinned).toBe(true)
    expect(locked.fields_changed).toEqual(['keys'])
  })

  it('the real clan CLI reads all three authors from the exported bytes', async () => {
    const s = store()
    await s.create(maya)
    const j = realJob()
    await s.patch({ jobs: [j] }, { action: `generated front view`, rationale: 'from @ref_a' })
    await recordJobOutcome(s, j)
    const file = join(tmp, 'maya.clan')
    writeFileSync(file, await s.exportClan())
    const chain = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'read', 'chain', file], { encoding: 'utf8' })
    expect(chain).toContain('director · claude-sonnet-4-5 · director.v1')
    expect(chain).toContain('runway · gen4_image')
    expect(chain).toContain('generated front view')
    expect(chain).toContain(id('job', 0))
    const report = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'validate', '--strict', file], { encoding: 'utf8' })
    expect(report).toMatch(/^OK$/m)
  })
})
