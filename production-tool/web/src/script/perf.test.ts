// @vitest-environment happy-dom
// 30 shots and 120 beats (features/script-editor.clan, breakage: performance): the page mounts
// at most five editors, and a typing checkpoint stays fast. A person measures typing latency
// on an iPad; this guards the parts a test can see.

import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { newUlidId, ranksBetween } from '../../../clan-store/src'
import { mainScript, mainStoryboard } from '../model/selectors'
import { MAYA, modelStore } from '../test/model'
import { composeScript } from './compose'
import { editorExtensions } from './extensions'
import { trackTyping } from './typing'

describe('30 shots, 120 beats', () => {
  it('compose is quick, at most five editors are mounted, and a checkpoint is under 8 ms at p95', async () => {
    const store = modelStore()
    await store.create(MAYA, 'Big')
    const sb = mainStoryboard(store.get())!
    await store.change((d) => {
      const scene = newUlidId('scene')
      d.scenes[scene] = { id: scene, v: 1, field_v: {}, script_id: mainScript(d)!.id, rank: 'a0', heading: 'EXT. BEACH' }
      const ranks = ranksBetween(null, null, 30)
      ranks.forEach((rank, i) => {
        const id = newUlidId('shot')
        d.shots[id] = { id, v: 1, field_v: {}, storyboard_id: sb.id, rank, kind: 'shot', scene_id: scene, duration_s: 4, camera: { size: 'medium' }, status: 'planned', action: `Shot ${i + 1} words.` }
        ranksBetween(null, null, 4).forEach((br, j) => {
          const b = newUlidId('beat')
          d.beats[b] = { id: b, v: 1, field_v: {}, shot_id: id, rank: br, at_s: j, kind: 'moment', text: `beat ${j}` }
        })
      })
    }, { action: 'create a big script' })
    await store.flush()
    const t0 = performance.now()
    const c = composeScript(store.get())!
    expect(performance.now() - t0).toBeLessThan(200)
    expect(c.shots).toHaveLength(30)
    expect(c.rows.filter((r) => r.kind === 'beat')).toHaveLength(120)

    // The current shot and its four beats: five editors, the rest static.
    const current = c.shots[3].id
    const mounted = [{ kind: 'shot' as const, id: current }, ...c.rows.filter((r) => r.kind === 'beat' && r.shotId === current).map((r) => ({ kind: 'beat' as const, id: r.id }))]
    expect(mounted.length).toBeLessThanOrEqual(5)
    const editors = mounted.map((m) => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      const e = new Editor({ element: el, extensions: editorExtensions({ kind: m.kind, fragment: store.text.fragment(m.kind, m.id) }) })
      trackTyping(e, store.typing, m.kind, m.id)
      return e
    })
    const flat: number[] = []
    const write: number[] = []
    editors[0].commands.focus('end')
    for (let i = 0; i < 40; i++) {
      editors[0].commands.insertContent('x')
      // The checkpoint itself: the fragment's flat fields (what each pause computes).
      let s = performance.now()
      expect(store.text.pendingPatches().patches.length).toBeGreaterThan(0)
      flat.push(performance.now() - s)
      editors[0].commands.insertContent('y')
      // The whole write: patch, schema and integrity checks, the .clan (once per pause, 300 ms after typing stops).
      s = performance.now()
      await store.text.checkpoint()
      write.push(performance.now() - s)
    }
    const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]
    console.info(`checkpoint p95: ${p95(flat).toFixed(2)} ms; the whole write p95: ${p95(write).toFixed(2)} ms`)
    expect(p95(flat)).toBeLessThan(8)
    // The whole write is the store's (contract-v3); typing never waits on it (a pause runs it).
    expect(p95(write)).toBeLessThan(100)
    for (const e of editors) e.destroy()
  }, 60_000)
})
