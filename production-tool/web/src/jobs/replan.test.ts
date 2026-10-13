// Re-planning is a merge keyed by shot id (features/contract-v3.clan): on the real .clan engine, a re-plan
// with new words keeps the shots whose words are still there (ids, frames, picks, status), adds the new
// ones after, marks a changed shot's frame 'Script changed', asks before removing a left-out shot that
// has frames, and is one undo step.

import { describe, expect, it } from 'vitest'
import type { Job, ProductionDocument } from '../contracts/types'
import { deleteFrom, removeShot } from '../doc/remove'
import { systemUpdate, updateDoc } from '../doc/store'
import { currentFrame, framesOf, openAsks, scriptText, shotsOf, staleList } from '../model/selectors'
import type { ModelStore } from '../model/store'
import { mockShotList } from '../relay/mock'
import { answerShotAsk, writeScript } from '../stages/storyboardEdits'
import { addFrame, job, MAYA, modelStore, SHA } from '../test/model'
import { askedShot, landShotList, SCRIPT_CHANGED } from './plan'
import { jobShot } from './select'

const me = `human:${MAYA.id}`

/** Dex plans (or re-plans) the main storyboard from the words there now, as the mock relay would. */
async function plan(s: ModelStore, edit?: (shots: ReturnType<typeof mockShotList>) => ReturnType<typeof mockShotList>) {
  const d = s.get()
  const sent = shotsOf(d).map((x) => jobShot(d, x, false))
  let shots = mockShotList(scriptText(d), 15, [], sent)
  if (edit) shots = edit(shots)
  const j = job(d, 'shot_list', [], null, { crew: 'dex' })
  await systemUpdate(s, (x) => { x.jobs[j.id] = j }, 'sync')
  await landShotList(s, { jobId: j.id, shots } as unknown as Job)
  await s.flush()
  return s.get()
}

async function planned(): Promise<{ s: ModelStore; d: ProductionDocument }> {
  const s = modelStore()
  await s.create(MAYA, 'Soup')
  await updateDoc(s, (d) => writeScript(d, 'Maya walks into a sunny kitchen and smiles. She tastes the soup and nods.'), 'edit')
  await plan(s)
  // Frames for every shot, picked; the storyboard locked.
  await systemUpdate(s, (d) => {
    shotsOf(d).forEach((shot, i) => addFrame(d, d.shots[shot.id], SHA(String(i + 1)), { pick: true }))
    for (const shot of shotsOf(d)) d.shots[shot.id].status = 'locked'
  }, 'sync')
  await s.flush()
  return { s, d: s.get() }
}

describe('a re-plan', () => {
  it('keeps a surviving shot\'s id, frames, pick and status, and adds the new words after, as one undo step', async () => {
    const { s, d: before } = await planned()
    const was = shotsOf(before)
    expect(was.map((x) => x.action)).toEqual(['Maya walks into a sunny kitchen and smiles.', 'She tastes the soup and nods.'])
    await updateDoc(s, (d) => writeScript(d, 'She waves goodbye at the door.'), 'edit')
    const d = await plan(s)
    const now = shotsOf(d)
    expect(now.slice(0, 2).map((x) => x.id)).toEqual(was.map((x) => x.id))
    expect(now[2].action).toBe('She waves goodbye at the door.')
    for (const x of was) {
      expect(framesOf(d, x.id)).toHaveLength(1)
      expect(currentFrame(d, x.id)?.id).toBe(x.pick!.current)
      expect(d.shots[x.id].status).toBe('locked')
    }
    expect(openAsks(d)).toEqual([])
    // Words and framing unchanged: no frame is out of date (only the clips, which there are none of yet).
    expect(staleList(d).filter((m) => m.target.kind === 'frame')).toEqual([])
    // One undo takes the whole re-plan back: the new shot goes, the words return to the script.
    expect(s.undoLabels().undo).toMatch(/^plan /)
    await s.undo()
    await s.flush()
    const back = s.get()
    expect(shotsOf(back).map((x) => x.id)).toEqual(was.map((x) => x.id))
    expect(scriptText(back)).toContain('She waves goodbye at the door.')
    for (const x of was) expect(currentFrame(back, x.id)?.id).toBe(x.pick!.current)
  })

  it('marks a changed shot\'s frame "Script changed"', async () => {
    const { s, d: before } = await planned()
    const [first] = shotsOf(before)
    const d = await plan(s, (shots) => shots.map((x) => (x.id === first.id ? { ...x, camera: { ...x.camera, size: 'close' } } : x)))
    const marks = staleList(d).filter((m) => m.target.kind === 'frame')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ target: { kind: 'frame', id: first.pick!.current }, caused_by: { kind: 'shot', id: first.id }, reason: SCRIPT_CHANGED })
  })

  it('asks before removing a left-out shot that has frames; Remove takes it out, Keep leaves it', async () => {
    const { s, d: before } = await planned()
    const [first, second] = shotsOf(before)
    const d = await plan(s, (shots) => shots.filter((x) => x.id !== second.id))
    expect(d.shots[second.id]).toBeDefined() // not deleted silently
    expect(framesOf(d, second.id)).toHaveLength(1)
    const [ask] = openAsks(d)
    expect(ask).toMatchObject({ crew: 'dex', node: { kind: 'storyboard' }, question: { kind: 'block', text: 'Shot 2 no longer has a scene. Keep it or remove it?' } })
    expect(ask.job_id).toBeUndefined()
    expect(ask.question.options.map((o) => o.label)).toEqual(['Keep', 'Remove'])
    expect(askedShot(ask)).toBe(second.id)
    // A second re-plan does not ask again.
    expect(openAsks(await plan(s, (shots) => shots.filter((x) => x.id !== second.id)))).toHaveLength(1)
    await deleteFrom(s, (x) => { answerShotAsk(x, ask.id, 'remove', me); return removeShot(x, second.id) })
    await s.flush()
    const after = s.get()
    expect(after.shots[second.id]).toBeUndefined()
    expect(after.asks[ask.id]).toMatchObject({ state: 'answered', answers: [{ option_id: 'remove', by: me }] })
    expect(after.shots[first.id]).toBeDefined()
  })

  it('a left-out shot with nothing made from it may go', async () => {
    const s = modelStore()
    await s.create(MAYA, 'Soup')
    await updateDoc(s, (d) => writeScript(d, 'One thing. Another thing.'), 'edit')
    const first = shotsOf(await plan(s))
    const d = await plan(s, (shots) => shots.filter((x) => x.id !== first[1].id))
    expect(d.shots[first[1].id]).toBeUndefined()
    expect(openAsks(d)).toEqual([])
  })
})
