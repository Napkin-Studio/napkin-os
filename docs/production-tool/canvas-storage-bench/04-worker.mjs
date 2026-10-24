// The checkpoint worker for 04: holds the napkin-wasm host (and, in replica
// mode, a Y.Doc fed by the live updates) and does the whole checkpoint here.
import { parentPort, workerData } from 'node:worker_threads'
import * as Y from 'yjs'
import zlib from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { wasmHost, route, now } from './lib.mjs'

const OUT = new URL('./out/', import.meta.url).pathname
const zs = (b) => zlib.zstdCompressSync(b, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } })
const host = await wasmHost()
host.newDocument('production-tool', 'Bench')
const replica = workerData.replica ? new Y.Doc() : null
parentPort.on('message', (m) => {
  if (m.t === 'update') { Y.applyUpdate(replica, m.u, 'main'); return }
  if (m.t === 'checkpoint') {
    const t = now()
    const u = m.u ?? Y.encodeStateAsUpdate(replica)
    route(host, '/upload-asset', zs(u), 'name=canvas.ybin.zst')
    const bytes = host.download()
    writeFileSync(`${OUT}worker.clan`, bytes)
    parentPort.postMessage({ t: 'saved', ms: now() - t, bytes: bytes.length })
  }
})
parentPort.postMessage({ t: 'ready' })
