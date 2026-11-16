// The UI on the CLAN store (contract 3): the real napkin-wasm (built by
// `npm run clan-store`) behind ModelStore, the panels' writes through updateDoc
// and systemUpdate, the decisions and undo steps they leave, and the bytes the
// real `clan` CLI reads.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SerializedUndo } from '../../../clan-store/src'
import type { ProductionDocument } from '../contracts/types'
import { describeWrite } from '../doc/describe'
import { emptyDocument, landUpdate, systemUpdate, updateDoc } from '../doc/store'
import { addShots, addTake, id, job, MAYA, modelStore, SHA, T } from '../test/model'
import { makeAjv, SCHEMA } from '../test/schemas'
import { mainScript, mainStoryboard, mainVideo, shotsOf } from './selectors'
import type { ModelStore } from './store'

const tmp = mkdtempSync(join(tmpdir(), 'pt-web-model-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const validate = makeAjv().getSchema(SCHEMA('document'))!
const me = `human:${MAYA.id}`

function hasClanCli(): boolean {
  try {
    execFileSync(process.env.CLAN_BIN || 'clan', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function fresh(undo?: { saved: SerializedUndo | null | undefined; save: (s: SerializedUndo) => void }) {
  const s = modelStore({ undo })
  await s.create(MAYA, 'Rain')
  return s
}

/** The person's decisions, oldest first. */
const mine = async (s: ModelStore) => (await s.chain()).filter((e) => e.agent === me).reverse()

describe('the UI on the CLAN store', () => {
  it('a new project has one script, one storyboard and one video, linked', async () => {
    const s = await fresh()
    const d = s.get()
    expect(d.contract_version).toBe('3')
    expect(Object.keys(d.scripts)).toHaveLength(1)
    expect(Object.keys(d.storyboards)).toHaveLength(1)
    expect(Object.keys(d.videos)).toHaveLength(1)
    const links = Object.values(d.links).map((l) => [l.from.kind, l.from.id, l.role, l.to.kind, l.to.id])
    expect(links).toEqual(expect.arrayContaining([
      ['script', mainScript(d)!.id, 'drives', 'storyboard', mainStoryboard(d)!.id],
      ['storyboard', mainStoryboard(d)!.id, 'renders', 'video', mainVideo(d)!.id],
    ]))
    expect(d.project).toMatchObject({ title: 'Rain', created_by: me, tenant_id: MAYA.tenant_id })
    expect(validate(d), JSON.stringify(validate.errors)).toBe(true)
  })

  it('a person\'s change is one decision with its targets, and one undo step that survives a reload', async () => {
    let saved: SerializedUndo | null = null
    const s = await fresh({ saved: null, save: (x) => { saved = x } })
    let shotId = ''
    await systemUpdate(s, (d) => { shotId = addShots(d, 1)[0].id }, 'sync')
    await s.flush()
    const before = (await mine(s)).length
    await updateDoc(s, (d) => {
      d.shots[shotId].duration_s = 4
      d.shots[shotId].camera.size = 'close'
    }, 'edit shot')
    await s.flush()
    const entries = (await mine(s)).slice(before)
    expect(entries.map((e) => e.action)).toEqual(['set shot 1'])
    const docId = s.documentId()
    expect(entries[0].targets).toEqual(expect.arrayContaining([`${docId}#shots[${shotId}]`, `${docId}#shots[${shotId}].duration_s`, `${docId}#shots[${shotId}].camera.size`]))
    expect(saved!.undo).toHaveLength(1)
    expect(s.undoLabels().undo).toBe('set shot 1')

    // A reload: the bytes into a new store, with the undo steps the UI kept.
    const bytes = await s.exportClan()
    await s.close()
    const again = modelStore({ undo: { saved: structuredClone(saved), save: (x) => { saved = x } } })
    await again.open(bytes)
    expect(again.get().shots[shotId].duration_s).toBe(4)
    expect(again.undoLabels().undo).toBe('set shot 1')
    expect(await again.undo()).toMatchObject({ done: true, label: 'set shot 1' })
    expect(again.get().shots[shotId]).toMatchObject({ duration_s: 5, camera: { size: 'medium' } })
    expect(saved!.redo).toHaveLength(1)
  })

  it('bookkeeping is quiet: no decision and no undo step', async () => {
    const s = await fresh()
    const before = (await s.chain()).length
    const j = job(s.get(), 'generate', [SHA('a')], null, { state: 'queued' })
    await systemUpdate(s, (d) => { d.jobs[j.id] = j }, 'sync')
    await systemUpdate(s, (d) => { d.jobs[j.id].state = 'submitted' }, 'sync')
    await systemUpdate(s, (d) => {
      d.jobs[j.id].state = 'completed'
      d.jobs[j.id].outputs = [SHA('b')]
      d.assets[SHA('b')] = { sha256: SHA('b'), kind: 'image', mime: 'image/png', origin: 'generated', job_id: j.id, locations: [] }
    }, 'complete generate')
    await s.flush()
    expect(s.get().jobs[j.id].state).toBe('completed')
    expect((await s.chain()).length).toBe(before)
    expect(s.undoLabels()).toEqual({ undo: null, redo: null })
  })

  it('a job that ended with no result is the crew\'s decision, once, even after a reload', async () => {
    const s = await fresh()
    const j = job(s.get(), 'frame', [], null, { state: 'failed', crew: 'wren' })
    await systemUpdate(s, (d) => { d.jobs[j.id] = j }, 'sync')
    const outcome = async (x: ModelStore) => (await x.chain()).filter((e) => e.action.endsWith(j.id))
    expect((await outcome(s)).map((e) => e.agent)).toEqual(['wren'])
    const again = modelStore()
    await again.open(await s.exportClan())
    expect(await outcome(again)).toHaveLength(1)
  })

  it('a crew landing cites its job and is no one\'s undo step', async () => {
    const s = await fresh()
    let shotId = ''
    await systemUpdate(s, (d) => { shotId = addShots(d, 1)[0].id }, 'sync')
    const j = job(s.get(), 'shot_list', [], null)
    await systemUpdate(s, (d) => { d.jobs[j.id] = j }, 'sync')
    const cite = `${s.documentId()}#jobs[${j.id}]`
    await landUpdate(s, (d) => { d.shots[shotId].status = 'needs_review' }, { action: 'plan 1 shot', agent: 'dex', cites: [cite] })
    const [e] = (await s.chain()).filter((x) => x.action === 'plan 1 shot')
    expect(e).toMatchObject({ agent: 'dex', cites: [cite] })
    expect(s.undoLabels().undo).toBeNull()
  })

  it('a text change to a shot\'s action goes through the text bus: prose, mentions and last writer', async () => {
    const s = await fresh()
    let shotId = ''
    const refId = id('ref')
    await systemUpdate(s, (d) => {
      shotId = addShots(d, 1)[0].id
      d.assets[SHA('a')] = { sha256: SHA('a'), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }
      d.refs[refId] = { id: refId, v: 1, field_v: {}, key: 'maya', variant: 'front', role: 'character', asset: SHA('a') }
    }, 'sync')
    await updateDoc(s, (d) => { d.shots[shotId].action = '@maya_front runs for the bus.' }, 'edit shot')
    await s.flush()
    const shot = s.get().shots[shotId]
    expect(shot.action).toBe('@maya_front runs for the bus.')
    expect(shot.last_writer).toBe(me)
    expect(shot.refs).toEqual([refId])
    expect(JSON.stringify(shot.prose)).toContain('"mention"')
    expect(s.text.prose('shot', shotId)).toEqual(shot.prose)
    expect(s.undoLabels().undo).toBe('set shot 1')
    await s.undo()
    expect(s.get().shots[shotId].action ?? '').toBe('')
  })

  it('a write the contract refuses is rolled back and said', async () => {
    const s = await fresh()
    let shotId = ''
    await systemUpdate(s, (d) => { shotId = addShots(d, 1)[0].id }, 'sync')
    await s.flush()
    const seen: string[] = []
    s.onTrouble((m) => seen.push(m))
    await updateDoc(s, (d) => { (d.shots[shotId].camera as { size: string }).size = 'enormous' }, 'edit shot')
    expect(s.get().shots[shotId].camera.size).toBe('enormous') // shown at once…
    await s.flush()
    expect(seen).toHaveLength(1)
    expect(s.get().shots[shotId].camera.size).toBe('medium') // …and taken back
    expect(s.trouble).toBe(seen[0])
  })

  it('the cut\'s last item can go, and the video keeps its (empty) cut', async () => {
    const s = await fresh()
    await systemUpdate(s, (d) => {
      const [shot] = addShots(d, 1)
      const j = job(d, 'clip', [], SHA('1'))
      d.jobs[j.id] = j
      addTake(d, shot, SHA('1'), j, { pick: true })
    }, 'sync')
    await s.flush()
    await updateDoc(s, (d) => { for (const v of Object.values(d.videos)) for (const k of Object.keys(v.timeline)) delete v.timeline[k] }, 'set')
    await s.flush()
    expect(s.trouble).toBeNull()
    expect(mainVideo(s.get())!.timeline).toEqual({})
  })

  it('the bytes are a .clan the CLI reads', async () => {
    if (!hasClanCli()) return
    const s = await fresh()
    await systemUpdate(s, (d) => { addShots(d, 2) }, 'sync')
    await updateDoc(s, (d) => { shotsOf(d)[0].duration_s = 3 }, 'edit shot')
    const file = join(tmp, 'maya.clan')
    writeFileSync(file, await s.exportClan())
    const read = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'read', 'chain', file], { encoding: 'utf8' })
    expect(read).toContain('set shot 1')
    const ok = execFileSync(process.env.CLAN_BIN || 'clan', ['--quiet', 'validate', '--strict', file], { encoding: 'utf8' })
    expect(ok).toMatch(/^OK$/m)
  })
})

describe('describeWrite', () => {
  const at = (d: ProductionDocument) => structuredClone(d)

  it('keeps bookkeeping out of the chain', () => {
    const d = emptyDocument(MAYA)
    for (const a of ['edit', 'stage', 'add picture', 'complete generate', 'frame', 'take', 'shot list', 'sync']) expect(describeWrite(a, d, d)).toBeNull()
  })

  it('names names given, renamed, moved, re-roled and taken off', () => {
    const a = emptyDocument(MAYA)
    const b = at(a)
    const k = id('key')
    const r = id('ref')
    b.keys[k] = { id: k, v: 1, field_v: {}, key: 'maya', role: 'character' }
    b.refs[r] = { id: r, v: 1, field_v: {}, key: 'maya', variant: 'eyes', role: 'character', asset: SHA('a') }
    expect(describeWrite('name', a, b)!.action).toBe('name @maya_eyes')
    const c = at(b)
    c.refs[r].variant = 'laughing'
    expect(describeWrite('name', b, c)!.action).toBe('name @maya_eyes @maya_laughing')
    const d = at(c)
    d.refs[r].asset = SHA('b')
    expect(describeWrite('name', c, d)!.action).toBe('set @maya_laughing to another image')
    const e = at(d)
    e.keys[k].role = 'prop'
    expect(describeWrite('name', d, e)!.action).toBe('set maya as prop')
    expect(describeWrite('name', e, a)!.action).toBe('delete the name @maya_laughing')
  })

  it('names a clean-up and a library update', () => {
    const a = emptyDocument(MAYA)
    for (const c of 'ab') a.assets[SHA(c)] = { sha256: SHA(c), kind: 'image', mime: 'image/png', origin: 'uploaded', locations: [] }
    const b = at(a)
    delete b.assets[SHA('a')]
    expect(describeWrite('clean up', a, b)!.action).toBe('delete 1 unused picture')
    const c = at(a)
    const k = id('key')
    const r = id('ref')
    c.keys[k] = { id: k, v: 1, field_v: {}, key: 'lamp', role: 'prop', library: { shelf: 'agency', key: 'lamp', ver: 3, by: 'human:p_cat01', at: T } }
    c.refs[r] = { id: r, v: 1, field_v: {}, key: 'lamp', variant: 'on', role: 'prop', asset: SHA('a') }
    const said = describeWrite('import', a, c)!
    expect(said.action).toBe('update_from_library lamp')
    expect(said.rationale).toContain('version 3')
    expect(said.rationale).toContain('@lamp_on')
  })
})
