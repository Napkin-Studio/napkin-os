// 01: scene encodings (JSON / Y binary, float vs quantised points, gzip / zstd)
// and the BESIDE path: save the scene as its own file (write + fsync), open it.
import * as Y from 'yjs'
import zlib from 'node:zlib'
import { openSync, writeSync, fsyncSync, closeSync, readFileSync, mkdirSync } from 'node:fs'
import { generateScene, quantize, toYDoc, readAll, bench, kb, ms, med } from './lib.mjs'

const OUT = new URL('./out/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const gz = (b) => zlib.gzipSync(b, { level: 6 })
const zs = (b) => zlib.zstdCompressSync(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
const unzs = (b) => zlib.zstdDecompressSync(b)
function writeDurable(path, bytes) { const fd = openSync(path, 'w'); writeSync(fd, bytes); fsyncSync(fd); closeSync(fd) }

const recs = generateScene(1)
const qrecs = recs.map(quantize)
const counts = recs.reduce((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {})
const pts = recs.filter((r) => r.kind === 'stroke').reduce((n, r) => n + r.points.length / 3, 0)
console.log('scene', counts, 'stroke points', pts, 'mean', (pts / counts.stroke).toFixed(1))

const rows = []
for (const [label, rs] of [['float points', recs], ['quantised int points', qrecs]]) {
  // JSON
  const js = bench(() => Buffer.from(JSON.stringify(rs)))
  const jbytes = js.v
  const jgz = bench(() => gz(jbytes)); const jzs = bench(() => zs(jbytes))
  const jparse = bench(() => JSON.parse(jbytes.toString()))
  const jzsOpen = bench(() => JSON.parse(unzs(jzs.v).toString()))
  // Y
  const ybuild = bench(() => toYDoc(rs), 5, 1)
  const ydoc = ybuild.v
  const yenc = bench(() => Y.encodeStateAsUpdate(ydoc))
  const ybytes = yenc.v
  const ygz = bench(() => gz(ybytes)); const yzs = bench(() => zs(ybytes))
  const yopen = bench(() => { const d = new Y.Doc(); Y.applyUpdate(d, ybytes); return d }, 7, 1)
  const yhydrate = bench(() => { const d = new Y.Doc(); Y.applyUpdate(d, unzs(yzs.v)); return readAll(d).length }, 7, 1)
  // BESIDE: durable write of each form
  const wJ = bench(() => writeDurable(`${OUT}scene.json`, jbytes))
  const wJz = bench(() => writeDurable(`${OUT}scene.json.zst`, zs(jbytes)))
  const wY = bench(() => writeDurable(`${OUT}scene.ybin`, Y.encodeStateAsUpdate(ydoc)))
  const wYz = bench(() => writeDurable(`${OUT}scene.ybin.zst`, zs(Y.encodeStateAsUpdate(ydoc))))
  const rJ = bench(() => JSON.parse(readFileSync(`${OUT}scene.json`).toString()).length)
  const rYz = bench(() => { const d = new Y.Doc(); Y.applyUpdate(d, unzs(readFileSync(`${OUT}scene.ybin.zst`))); return readAll(d).length }, 7, 1)
  rows.push({ label,
    json: { raw: jbytes.length, gz: jgz.v.length, zstd: jzs.v.length, stringify: js.med, gzip: jgz.med, zstd_ms: jzs.med, parse: jparse.med, open_zstd: jzsOpen.med },
    y: { raw: ybytes.length, gz: ygz.v.length, zstd: yzs.v.length, build: ybuild.med, encode: yenc.med, gzip: ygz.med, zstd_ms: yzs.med, apply: yopen.med, hydrate_zstd_readAll: yhydrate.med },
    beside: { write_json: wJ.med, write_json_zstd: wJz.med, write_y: wY.med, write_y_zstd: wYz.med, open_json: rJ.med, open_y_zstd: rYz.med },
  })
}
for (const r of rows) {
  console.log(`\n## ${r.label}`)
  console.log(`JSON  raw ${kb(r.json.raw)}  gzip ${kb(r.json.gz)}  zstd ${kb(r.json.zstd)} | stringify ${ms(r.json.stringify)} gzip ${ms(r.json.gzip)} zstd ${ms(r.json.zstd_ms)} parse ${ms(r.json.parse)} open(zstd+parse) ${ms(r.json.open_zstd)}`)
  console.log(`Y     raw ${kb(r.y.raw)}  gzip ${kb(r.y.gz)}  zstd ${kb(r.y.zstd)} | build ${ms(r.y.build)} encodeStateAsUpdate ${ms(r.y.encode)} gzip ${ms(r.y.gzip)} zstd ${ms(r.y.zstd_ms)} applyUpdate ${ms(r.y.apply)} open(zstd+apply+readAll) ${ms(r.y.hydrate_zstd_readAll)}`)
  console.log(`BESIDE durable write: json ${ms(r.beside.write_json)} json.zst ${ms(r.beside.write_json_zstd)} ybin ${ms(r.beside.write_y)} ybin.zst ${ms(r.beside.write_y_zstd)} | open json ${ms(r.beside.open_json)} open ybin.zst ${ms(r.beside.open_y_zstd)}`)
}
console.log('\nJSON:' + JSON.stringify(rows))
