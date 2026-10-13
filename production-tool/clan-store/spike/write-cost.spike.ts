// Where a write's time goes on a large contract-3 document (the worst case of store.test.ts).
import { it } from 'vitest'
import { integrity, mergePatch, problems, ranksBetween } from '../src/index'
import { route } from '../src/host'
import { MAYA, defaults, id, jobValue, sha, shotValue, store } from '../test/fixtures'

it('times the parts of a write', async () => {
  const s = store({ persistence: null })
  await s.create({ person: MAYA })
  const { storyboard } = defaults(s)
  const shots: Record<string, unknown> = {}
  const jobs: Record<string, unknown> = {}
  const frames: Record<string, unknown> = {}
  for (let i = 0; i < 60; i++) {
    const sid = id('shot', i)
    shots[sid] = { id: sid, v: 1, field_v: {}, ...shotValue(storyboard, ranksBetween(null, null, 60)[i]) }
    for (let f = 0; f < 6; f++) {
      const fid = id('frame', i * 10 + f)
      frames[fid] = { id: fid, v: 1, field_v: {}, shot_id: sid, version: f + 1, kind: 'generated', asset: sha(i * 10 + f), crew: 'wren' }
      jobs[id('job', i * 10 + f)] = { id: id('job', i * 10 + f), v: 1, field_v: {}, ...jobValue(i * 10 + f) }
    }
  }
  await s.patch({ shots, jobs, frames }, { action: 'fill', quiet: true })
  const d = s.get()
  const sid = id('shot', 3)
  const body = { shots: { [sid]: { camera: { size: 'wide' } } } }
  const time = (label: string, f: () => unknown, n = 10) => {
    const t = performance.now()
    for (let i = 0; i < n; i++) f()
    console.log(`${label}: ${((performance.now() - t) / n).toFixed(1)} ms`)
  }
  time('mergePatch', () => mergePatch(d, body))
  time('ajv', () => problems(d))
  time('integrity', () => integrity(d))
  const h = (s as unknown as { host: Parameters<typeof route>[0] }).host
  let n = 0
  time('wasm /patch-data quiet', () => route(h, '/patch-data', { patch: { shots: { [sid]: { duration_s: 3 + (n++ % 5) * 0.5 } } } }))
  time('wasm /patch-data attributed', () => route(h, '/patch-data', { patch: { shots: { [sid]: { duration_s: 3 + (n++ % 5) * 0.5 } } }, agent: 'dex', action: 'set' }))
  time('wasm entry(data.yaml)', () => h.entry('shared/data.yaml'))
  const t = performance.now()
  for (let i = 0; i < 10; i++) await s.patch({ shots: { [sid]: { duration_s: 3 + (i % 5) * 0.5 } } }, { action: 'set', agent: 'dex' })
  console.log(`store.patch: ${((performance.now() - t) / 10).toFixed(1)} ms`)
}, 120_000)
