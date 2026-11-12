// One-bar search's fixtures (features/one-bar-search.clan): what is typed and what must open.
import { deflateRawSync } from 'node:zlib'

export const QUERY = 'J001 brief'
export const SCOPE_QUERY = 'J001 scope'
// seedJ001({ fresh: true }) opens a new client and the next job number each time (J001, J002, ...), so a test types its own job's number.
export const queryOf = job => QUERY.replace('J001', job.job)
export const scopeQueryOf = job => SCOPE_QUERY.replace('J001', job.job)

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** A zip of `files` (name to text), deflated, with the first entry first: the shape a .clan is. */
function zip(files) {
  const locals = []
  const central = []
  let offset = 0
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8')
    const packed = deflateRawSync(data)
    const n = Buffer.from(name, 'utf8')
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt32LE(crc32(data), 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26)
    const entry = Buffer.concat([head, n, packed])
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([dir, n]))
    locals.push(entry)
    offset += entry.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/**
 * A Scope document for the job, the way Phase 3's Scope tool will make one (app id `ie.napkin.scope`): the host's search
 * files it under the Money group by that id (napkin-host searchindex MONEY), so a role that cannot open money never finds it.
 * Uploaded through `POST /documents/upload`; it holds no hours and no words, only the manifest.
 */
export function scopeClan(job, client) {
  const now = '2026-03-14T10:00:00+00:00'
  const manifest = [
    'clan_version: 1', 'clan_version_minor: 2', 'id: 6b8f2a0e-1c1d-4e55-9a77-0b1c2d3e4f50', `title: ${job.job} scope`,
    `created_at: ${now}`, `updated_at: ${now}`,
    'app:', '  name: Scope', '  app_id: ie.napkin.scope', '  version: 1.0.0', '  entry: human/index.html',
    'client:', `  id: ${client.id}`, `  name: ${client.name}`,
    `job: ${job.job}`, 'files: []', '',
  ].join('\n')
  return zip([['manifest.yaml', manifest], ['shared/data.yaml', 'hours: {}\n'], ['agent/decision-chain.yaml', 'decisions: []\n']])
}
