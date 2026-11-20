// One Make on a box whose clip needs its frame first (UAT 2026-11-21, F7): when the frame lands, its clip is made on
// the model the box showed, once.
import { describe, expect, it, vi } from 'vitest'

const makeClip = vi.fn(async () => 'job_clip')
vi.mock('./clips', () => ({ makeClip: (...a: unknown[]) => (makeClip as (...x: unknown[]) => Promise<string>)(...a) }))

describe('the clip after a frame drawn first', () => {
  it('is made once, on the box model, when the frame lands', async () => {
    const { clipAfterFrame } = await import('./wire')
    let ui = { jobs: { job_f: { clipAfter: { videoId: 'video_1', modelChoice: { provider: 'runway', model: 'veo3.1' } } } } } as Record<string, never>
    const deps = {
      doc: { get: () => ({ shots: { shot_1: { id: 'shot_1' } } }) },
      ui: { get: () => ui, update: (fn: (u: never) => void) => { const n = structuredClone(ui); fn(n as never); ui = n } },
    } as never
    expect(await clipAfterFrame(deps, 'job_f', 'shot_1')).toBe(true)
    expect(makeClip).toHaveBeenCalledWith(deps, 'shot_1', { videoId: 'video_1', modelChoice: { provider: 'runway', model: 'veo3.1' } })
    expect(await clipAfterFrame(deps, 'job_f', 'shot_1')).toBe(false)
    expect(makeClip).toHaveBeenCalledTimes(1)
  })
})
