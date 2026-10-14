// The canvas engine's PR bench (features/engine-ci.clan, under canvas-engine's
// test plan "Bench on PRs" and "Storage checks"), on the seed-1 G3 scene:
//
// - the scene is the spikes' scene (fingerprint f8082c81);
// - storage bytes, exact: the G3 Y state at most 3.0 MB raw (2.0 MB compressed), a move at most 200 B,
//   a finished 60-point stroke at most 900 B, at most 16 B left behind per move
//   (ported from docs/production-tool/canvas-storage-bench 01, storage/ybench2, 03);
// - memory caps: a scripted pan keeps the preview bitmap cache under the iPad cap
//   and the canvases at viewport size and capped ratio;
// - draw-time CPU at three cameras, as a ratio to a control workload timed in the
//   same process, under 2x bench/baseline.json. BENCH_RECORD=1 rewrites the
//   baseline (say why in the PR).

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SceneStore } from '../src/model/store'
import { BitmapCache } from '../src/render/bitmaps'
import { backingBytes, BITMAP_CACHE_BYTES, FULL_RES_MIN_ZOOM, MAX_DPR } from '../src/render/caps'
import { Renderer, type Camera } from '../src/render/renderer'
import { controlWorkload, CountingPath, fullBitmap, median, nullContext, smallBitmap, timeMedian } from './fakes'
import { BOARD_H, BOARD_W, g3Records, generateScene, rng, sceneFingerprint, SEED, SEED_FINGERPRINT, strokeRecord } from './scene'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASELINE = resolve(HERE, 'baseline.json')
const VIEWPORT = { width: 1440, height: 900 }
const IPAD = { width: 1366, height: 1024 }

const scene = generateScene(SEED)
let g3: ReturnType<typeof g3Records>
let doc: Y.Doc
let store: SceneStore

beforeAll(() => {
  g3 = g3Records(scene)
  doc = new Y.Doc()
  store = new SceneStore(doc)
  store.seed(g3.records, g3.points)
})

describe('the G3 scene', () => {
  it('is the spikes’ seed-1 scene', () => {
    expect(sceneFingerprint(scene)).toBe(SEED_FINGERPRINT)
    expect([scene.boards.length, scene.previews.length, scene.strokes.length, scene.nodes.length]).toEqual([10, 300, 5000, 500])
    expect(store.all()).toHaveLength(5810)
  })
})

describe('storage bytes (exact; canvas-storage-bench 01, ybench2, 03)', () => {
  // 3.0 MB, not the umbrella's first 2.6: the per-field layout costs about 0.5 MB raw over a
  // whole-element JSON (decision on features/engine-ci.clan, 2026-10-14). Compressed it stays
  // far under the 2.0 MB checkpoint ceiling; gzip stands in for zstd until engine-store.
  it('the G3 Y state is at most 3.0 MB raw and 2.0 MB compressed', () => {
    const update = Y.encodeStateAsUpdate(doc)
    const packed = gzipSync(update, { level: 6 }).byteLength
    process.stderr.write(`bench: G3 Y state ${(update.byteLength / 1e6).toFixed(2)} MB raw, ${(packed / 1e6).toFixed(2)} MB gzip\n`)
    expect(update.byteLength).toBeLessThanOrEqual(3.0e6)
    expect(packed).toBeLessThanOrEqual(2.0e6)
  })

  it('a move is at most 200 B, a finished 60-point stroke at most 900 B, and a move leaves at most 16 B behind', () => {
    const d = new Y.Doc()
    Y.applyUpdate(d, Y.encodeStateAsUpdate(doc))
    const s = new SceneStore(d)
    const ids = s.all().map((r) => r.id)
    const r = rng(7)
    let last: Uint8Array | null = null
    d.on('update', (u: Uint8Array) => { last = u })
    const before = Y.encodeStateAsUpdate(d).byteLength
    const moves: number[] = []
    const N = 2000
    for (let i = 0; i < N; i++) {
      const id = ids[Math.floor(r.next() * ids.length)]
      s.change((tx) => {
        const e = tx.get(id)!
        tx.put([{ ...e, x: e.x + 3, y: e.y - 2 }])
      })
      moves.push(last!.byteLength)
    }
    const leftPerMove = (Y.encodeStateAsUpdate(d).byteLength - before) / N
    const strokes: number[] = []
    for (let i = 0; i < 300; i++) {
      const pts: [number, number, number][] = Array.from({ length: 60 }, (_, k) => [k * 4.3, Math.sin(k / 5) * 20, 0.5])
      const { rec, pts: bytes } = strokeRecord({ id: `new${i}`, x: 100 + i, y: 100, points: pts, size: 3, color: '#1e1e1e', z: 100000 + i })
      s.change((tx) => {
        tx.put([rec])
        tx.setPoints(rec.id, bytes)
      })
      strokes.push(last!.byteLength)
    }
    process.stderr.write(`bench: move median ${median(moves)} B; stroke median ${median(strokes)} B; left behind ${leftPerMove.toFixed(1)} B/move\n`)
    expect(median(moves)).toBeLessThanOrEqual(200)
    expect(median(strokes)).toBeLessThanOrEqual(900)
    expect(leftPerMove).toBeLessThanOrEqual(16)
  })
})

/** A renderer over the G3 store whose previews come from a capped cache, loaded on first ask. */
function renderer(cache: BitmapCache) {
  return new Renderer(store, {
    newPath: () => new CountingPath(),
    bitmap: (sha, level) => {
      const b = cache.get(sha, level)
      if (b) return b
      cache.put(sha, level, level === 'full' ? fullBitmap() : smallBitmap())
      return undefined
    },
  })
}

const CAMERAS: Record<string, Camera> = {
  overview: { zoom: VIEWPORT.width / scene.bounds.w, scrollX: 0, scrollY: 0 },
  board: { zoom: VIEWPORT.width / BOARD_W, scrollX: 0, scrollY: 0 },
  close: { zoom: 1.5, scrollX: -(BOARD_W / 2 - VIEWPORT.width / 3), scrollY: -(BOARD_H / 2 - VIEWPORT.height / 3) },
}

describe('memory caps', () => {
  it('a pan over every board at three zooms keeps the preview cache under the iPad cap', () => {
    const cache = new BitmapCache(BITMAP_CACHE_BYTES.ipad)
    const r = renderer(cache)
    const ctx = nullContext()
    for (const zoom of [1, FULL_RES_MIN_ZOOM + 0.05, 0.2]) {
      for (let x = 0; x < scene.bounds.w; x += IPAD.width / zoom / 2) {
        for (let y = 0; y < scene.bounds.h; y += IPAD.height / zoom / 2) {
          r.draw(ctx, { zoom, scrollX: -x, scrollY: -y }, IPAD, MAX_DPR)
          r.draw(ctx, { zoom, scrollX: -x, scrollY: -y }, IPAD, MAX_DPR)
        }
      }
    }
    process.stderr.write(`bench: preview cache peak ${(cache.peak / 1e6).toFixed(1)} MB of ${(cache.cap / 1e6).toFixed(0)} MB\n`)
    expect(cache.peak).toBeLessThanOrEqual(BITMAP_CACHE_BYTES.ipad)
    expect(cache.peak).toBeGreaterThan(0)
    r.destroy()
  })

  it('the canvases are viewport-sized at a ratio of at most 2', () => {
    expect(backingBytes(IPAD, 3)).toBe(backingBytes(IPAD, MAX_DPR))
    expect(backingBytes(IPAD, 3)).toBe(1366 * 2 * 1024 * 2 * 4 * 2)
  })
})

interface Baseline {
  note: string
  controlMs: number
  ratios: Record<string, number>
}

describe('draw-time CPU, relative to the control', () => {
  it('stays under 2x the baseline at every camera', () => {
    controlWorkload()
    const control = timeMedian(5, controlWorkload)
    const ratios: Record<string, number> = {}
    // Cold: the first paint of the overview builds every stroke's outline.
    ratios.coldOverview = timeMedian(3, () => {
      const r = renderer(new BitmapCache(BITMAP_CACHE_BYTES.desktop))
      r.draw(nullContext(), CAMERAS.overview, VIEWPORT, 1)
      r.destroy()
    }) / control
    const warm = renderer(new BitmapCache(BITMAP_CACHE_BYTES.desktop))
    const ctx = nullContext()
    for (const [name, cam] of Object.entries(CAMERAS)) {
      warm.draw(ctx, cam, VIEWPORT, 1)
      ratios[name] = timeMedian(5, () => warm.draw(ctx, cam, VIEWPORT, 1)) / control
    }
    warm.destroy()
    process.stderr.write(`bench: control ${control.toFixed(1)} ms; ratios ${JSON.stringify(Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, +v.toFixed(3)])))}\n`)
    if (process.env.BENCH_RECORD) {
      const out: Baseline = { note: `Recorded ${new Date().toISOString().slice(0, 10)}: draw time / control, median of runs (bench/g3.bench.ts).`, controlMs: +control.toFixed(1), ratios: Object.fromEntries(Object.entries(ratios).map(([k, v]) => [k, +v.toFixed(4)])) }
      writeFileSync(BASELINE, JSON.stringify(out, null, 2) + '\n')
      return
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
    for (const [name, ratio] of Object.entries(ratios)) {
      expect(base.ratios[name], `baseline for ${name}`).toBeTypeOf('number')
      // A frame of well under a millisecond is timer noise: the floor is 1 ms of the baseline's control.
      const limit = 2 * Math.max(base.ratios[name], 1 / base.controlMs)
      expect(ratio, `${name}: ${ratio.toFixed(3)} against baseline ${base.ratios[name]} (limit ${limit.toFixed(3)})`).toBeLessThanOrEqual(limit)
    }
  })
})

