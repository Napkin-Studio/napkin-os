// 04: HYBRID checkpoint and every save path, measured as main-thread blocking.
// The main thread runs a 60 Hz "frame" loop (a timer every 16.7 ms that does
// ~2 ms of work, standing in for input + canvas2d) while a person "draws" (one
// committed stroke every 250 ms, its Y update going to the live peer). Every 2 s
// a save runs. We record each frame's start lateness and count frames that
// missed their 16.7 ms slot (late > 16.7 ms) and the longest stall.
//
// Save paths:
//   none                 baseline
//   beside-json          JSON.stringify(scene) + write file            (on main)
//   beside-ybin          Y.encodeStateAsUpdate + zstd + write file     (on main)
//   inside-main          encode + zstd + napkin-wasm /upload-asset + download() + write  (all on main)
//   inside-encode-main   encode on main, transfer to a Worker that zstds + packs + writes
//   inside-worker        Worker holds a replica Y.Doc fed by the live updates; the whole
//                        checkpoint (encode, zstd, pack, download, write) runs in the Worker
import { Worker } from 'node:worker_threads'
import * as Y from 'yjs'
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { generateScene, quantize, toYDoc, writeEl, makeStroke, rng, readAll, wasmHost, route, med, pct, now } from './lib.mjs'

const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const FRAME = 1000 / 60
const DURATION = +(process.env.DURATION ?? 12000)
const zs = (b) => zlib.zstdCompressSync(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
const busy = (ms) => { const t = now(); while (now() - t < ms); }

const base = generateScene(1).map(quantize)

async function run(mode) {
  const doc = toYDoc(base)
  const map = doc.getMap('elements')
  const r = rng(11)
  let worker = null, host = null
  const pending = []
  if (mode === 'inside-main') {
    host = await wasmHost(); host.newDocument('production-tool', 'Bench')
  }
  if (mode === 'inside-worker' || mode === 'inside-encode-main') {
    worker = new Worker(new URL('./04-worker.mjs', import.meta.url), { workerData: { replica: mode === 'inside-worker' } })
    await new Promise((res) => worker.once('message', res)) // ready (wasm loaded)
    if (mode === 'inside-worker') {
      const u = Y.encodeStateAsUpdate(doc)
      worker.postMessage({ t: 'update', u }, [u.buffer])
    }
    worker.on('message', (m) => { if (m.t === 'saved') pending.push(m) })
  }
  const postMs = []
  doc.on('update', (u, origin) => {
    if (mode === 'inside-worker' && origin !== 'system') {
      const t = now(); worker.postMessage({ t: 'update', u }); postMs.push(now() - t)
    }
  })
  const saveMs = []
  function save() {
    const t = now()
    if (mode === 'beside-json') writeFileSync(`${OUT}live.json`, JSON.stringify(readAll(doc)))
    else if (mode === 'beside-ybin') writeFileSync(`${OUT}live.ybin.zst`, zs(Y.encodeStateAsUpdate(doc)))
    else if (mode === 'inside-main') {
      route(host, '/upload-asset', zs(Y.encodeStateAsUpdate(doc)), 'name=canvas.ybin.zst')
      writeFileSync(`${OUT}live.clan`, host.download())
    } else if (mode === 'inside-encode-main') {
      const u = Y.encodeStateAsUpdate(doc); worker.postMessage({ t: 'checkpoint', u }, [u.buffer])
    } else if (mode === 'inside-worker') worker.postMessage({ t: 'checkpoint' })
    saveMs.push(now() - t)
  }

  // the frame loop
  const late = []
  const t0 = now()
  let next = t0 + FRAME, frame = 0, skipped = 0, longest = 0, lastStroke = t0, lastSave = t0
  await new Promise((resolve) => {
    const tick = () => {
      const t = now()
      late.push(t - next)
      busy(2) // input + paint
      if (t - lastStroke > 250) { const s = quantize(makeStroke(r, 500000 + frame)); doc.transact(() => writeEl(map, s.id, s), 'local'); lastStroke = t }
      if (mode !== 'none' && t - lastSave > 2000) { save(); lastSave = now() }
      frame++
      const took = now() - t; if (took > longest) longest = took
      next += FRAME
      while (next < now()) { next += FRAME; skipped++ } // missed slots
      if (t - t0 > DURATION) return resolve()
      setTimeout(tick, Math.max(0, next - now()))
    }
    setTimeout(tick, FRAME)
  })
  if (worker) { await new Promise((r2) => setTimeout(r2, 1500)); await worker.terminate() }
  host?.free()
  const dropped = skipped + late.filter((x) => x > FRAME).length
  return {
    mode, frames: late.length, dropped, maxStall: Math.max(longest, ...late), p99Late: pct(late, 0.99),
    saves: saveMs.length, saveMain_med: saveMs.length ? med(saveMs) : 0, saveMain_max: saveMs.length ? Math.max(...saveMs) : 0,
    worker_ms_med: pending.length ? med(pending.map((p) => p.ms)) : null,
    worker_bytes: pending.length ? pending.at(-1).bytes : null,
    post_med_us: postMs.length ? med(postMs) * 1000 : null,
  }
}

const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['none', 'beside-json', 'beside-ybin', 'inside-main', 'inside-encode-main', 'inside-worker']
const res = []
for (const m of modes) {
  const x = await run(m)
  res.push(x)
  console.log(`${m.padEnd(20)} frames ${x.frames}  missed ${x.dropped}  longest stall ${x.maxStall.toFixed(1)} ms  p99 late ${x.p99Late.toFixed(1)} ms | ${x.saves} saves, main-thread cost per save median ${x.saveMain_med.toFixed(2)} ms max ${x.saveMain_max.toFixed(1)} ms` +
    (x.worker_ms_med != null ? ` | worker checkpoint median ${x.worker_ms_med.toFixed(1)} ms, .clan ${(x.worker_bytes / 1024).toFixed(0)} KB` : '') +
    (x.post_med_us != null ? ` | postMessage per update ${x.post_med_us.toFixed(1)} µs` : ''))
}
console.log('JSON:' + JSON.stringify(res))
