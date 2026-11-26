// A job that finishes after the project was closed lands once when it is opened again (features/production-jobs-via-host.clan,
// S3-3): the session reads the project's inbox on open and when the host says one is waiting, through the runner's own
// landing, and stops listening when the project closes. On the real .clan engine and the real snapshot store; the host's
// inbox is the stand-in (its once-only rules are tested in Rust against the real store).

import { describe, expect, it, vi } from 'vitest'

vi.mock('../canvas/adapter/excalidraw/serialize', () => ({
  serializeScene: (elements: unknown[], files: unknown) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files }),
}))
import { ClanDocumentStore } from '../../../clan-store/src'
import type { Job } from '../contracts/types'
import { SnapshotStore } from '../doc/store'
import { initialAppUi, type AppUi } from '../doc/ui'
import { ModelStore } from '../model/store'
import { MockRelay, type MockRenderer } from '../relay/mock'
import type { InboxEntry } from '../relay/types'
import { MAYA, wasm } from '../test/model'
import { ProjectIndex } from './projectIndex'
import type { MakeClan } from './session'
import { Shell } from './shell'
import { memoryStorage } from './storage'

const makeClan: MakeClan = (persistence, opts = {}) =>
  new ModelStore(new ClanDocumentStore({ wasm: wasm(), persistence, saveDebounceMs: 0, person: opts.person }), { debounceMs: 1, undo: opts.undo })

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise<void>((r) => setImmediate(r))
}

const ME = { participantId: MAYA.id, handle: 'maya', team: 'napkin', workspace: MAYA.tenant_id, tenant: { id: MAYA.tenant_id, agency: 'napkin' }, allow: { claude: true, makers: ['runway', 'google'] }, quotas: null, projects: 0 }

/** The mock relay with the host's inbox in front of it: the host reads a job from the relay when it settles it
 *  (put-if-absent), and keeps the outcome until the tool acknowledges it. */
function setup() {
  const storage = memoryStorage()
  const index = new ProjectIndex(storage)
  const app = new SnapshotStore<AppUi>({ ...initialAppUi(), me: ME }, null)
  const renderer: MockRenderer = { async render() { return [{ blob: new Blob([`pic-${Math.random()}`], { type: 'image/png' }), mime: 'image/png', w: 9, h: 16 }] } }
  let rt = 1_000_000
  const mock = new MockRelay({ renderer, now: () => rt, delayMs: 2000, persistKey: null })
  const inbox = new Map<string, InboxEntry>()
  const acked = new Set<string>()
  const listeners = new Set<{ doc: string; f: () => void }>()
  let stopped = 0
  const relay = Object.assign(mock, {
    inbox: async () => [...inbox.values()].filter((e) => !acked.has(e.job)),
    ackJob: async (id: string) => { acked.add(id); inbox.delete(id) },
    onSettled: (doc: string, f: () => void) => {
      const l = { doc, f }
      listeners.add(l)
      return () => { stopped++; listeners.delete(l) }
    },
  })
  /** The host's library watcher: read the job, keep a finished one's outcome once, tell the open tab. */
  const hostSettles = async (jobId: string, doc: string) => {
    await mock.getJob(jobId) // the mock starts finishing a job when it is asked about it
    await mock.settled()
    const job: Job = await mock.getJob(jobId)
    if (job.state !== 'completed' || acked.has(jobId) || inbox.has(jobId)) return false
    inbox.set(jobId, { job: jobId, state: 'completed', outcome: job, at: '2026-11-23T10:00:00Z' })
    for (const l of listeners) if (l.doc === doc) l.f()
    return true
  }
  const shell = new Shell({ relay, app, index, storage, remoteConfig: null, makeClan, summaryDelayMs: 1 })
  return { shell, relay: mock, inbox, acked, listeners, hostSettles, advance: (ms: number) => { rt += ms }, stopped: () => stopped }
}

const open = (shell: Shell) => {
  const s = shell.get().session
  if (!s) throw new Error('no project open')
  return s.services
}

describe('closing the tab on a running job and reopening the project', () => {
  it('lands the finished job from the inbox once, acknowledges it, and a second settle brings nothing', async () => {
    const t = setup()
    const a = await t.shell.newProject()
    const jobId = await open(t.shell).runner.submit('generate', { text: 'a red fox' }, [], { for: 'canvas' })
    await t.shell.index.keep(a.id)
    await t.shell.goHome() // the tab is closed
    expect(t.listeners.size).toBe(0)
    expect(t.stopped()).toBe(1)

    t.advance(10_000)
    await t.relay.settled() // the relay finishes it
    expect(await t.hostSettles(jobId, a.id)).toBe(true) // the watcher keeps its outcome
    expect(await t.hostSettles(jobId, a.id)).toBe(false) // twice is nothing
    expect(t.inbox.size).toBe(1)

    await t.shell.open(a.id) // reopen: the session lands the inbox
    await settle()
    const s = open(t.shell)
    expect(s.doc.get().jobs[jobId].state).toBe('completed')
    expect(Object.keys(s.doc.get().assets)).toHaveLength(1)
    expect(t.acked.has(jobId)).toBe(true)
    expect(t.inbox.size).toBe(0)
    // the watcher comes round again: nothing is offered, nothing is added
    expect(await t.hostSettles(jobId, a.id)).toBe(false)
    await s.runner.landInbox()
    await settle()
    expect(Object.keys(s.doc.get().assets)).toHaveLength(1)
    expect(Object.keys(s.doc.get().jobs)).toEqual([jobId])
  })

  it('lands what the host reports while the project is open, and stops listening when it is closed', async () => {
    const t = setup()
    const a = await t.shell.newProject()
    const s = open(t.shell)
    const jobId = await s.runner.submit('generate', { text: 'a red fox' }, [], { for: 'canvas' })
    expect(t.listeners.size).toBe(1)
    expect([...t.listeners][0].doc).toBe(a.id)
    t.advance(10_000)
    await t.relay.settled()
    await t.hostSettles(jobId, a.id) // the event reaches the session
    await settle()
    expect(s.doc.get().jobs[jobId].state).toBe('completed')
    expect(Object.keys(s.doc.get().assets)).toHaveLength(1)
    expect(t.acked.has(jobId)).toBe(true)
    await t.shell.index.keep(a.id)
    await t.shell.goHome()
    expect(t.listeners.size).toBe(0)
  })

  it("an outcome of another project's job is not written into this one", async () => {
    const t = setup()
    const a = await t.shell.newProject()
    await t.shell.index.keep(a.id)
    t.inbox.set('job_01K6XA7Q3M9V2D4R8T0B5C1E6F', { job: 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F', state: 'completed', at: '', outcome: { jobId: 'job_01K6XA7Q3M9V2D4R8T0B5C1E6F', state: 'completed', op: 'generate', outputs: [] } as unknown as Job })
    await t.shell.goHome()
    await t.shell.open(a.id)
    await settle()
    expect(open(t.shell).doc.get().jobs).toEqual({})
    expect(Object.keys(open(t.shell).doc.get().assets)).toEqual([])
    expect(t.acked.has('job_01K6XA7Q3M9V2D4R8T0B5C1E6F')).toBe(true)
  })
})
