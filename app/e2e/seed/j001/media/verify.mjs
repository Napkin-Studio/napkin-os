// Proves J001's media fixtures (features/j001-phase3-suite.clan, done_when 3):
//   - every file in this folder is on the list in SOURCES.md and in manifest.json, and nothing listed is missing;
//   - each file's sha256 and size are the manifest's;
//   - no file's hash matches a file under client_briefs/ (when that folder is in the clone), and no path names it;
//   - every file says Napkin owns it and make_media.py drew it.
//
//   node app/e2e/seed/j001/media/verify.mjs        exit 1 and one line per problem, or one line of OK

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const own = resolve(fileURLToPath(new URL('.', import.meta.url)))
// A bundle (app/tests/run.mjs) moves import.meta.url, so the folder is also looked for under the app's working directory.
const here = existsSync(join(own, 'manifest.json')) ? own : resolve(process.cwd(), 'e2e/seed/j001/media')
const defaultRoot = resolve(here, '../../../../..')
// The folder's own tools and notes are not fixtures: they are named here, and nothing else is exempt.
const TOOLS = new Set(['make_media.py', 'manifest.json', 'SOURCES.md', 'index.mjs', 'index.d.mts', 'verify.mjs', 'verify.d.mts'])

const sha = buf => createHash('sha256').update(buf).digest('hex')
const walk = dir => readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

export function verifyMedia({ dir = here, repoRoot = defaultRoot } = {}) {
  const problems = []
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  const sources = readFileSync(join(dir, 'SOURCES.md'), 'utf8')
  const listed = new Set(manifest.files.map(f => f.name))
  for (const f of readdirSync(dir)) {
    if (TOOLS.has(f)) continue
    if (!listed.has(f)) problems.push(`${f} is in the folder but not in manifest.json`)
    if (!sources.includes(`| ${f} |`)) problems.push(`${f} is in the folder but not on the list in SOURCES.md`)
  }
  const briefs = join(repoRoot, 'client_briefs')
  const briefHashes = existsSync(briefs) ? new Set(walk(briefs).map(p => sha(readFileSync(p)))) : new Set()
  for (const f of manifest.files) {
    const path = join(dir, f.name)
    if (!existsSync(path)) { problems.push(`${f.name} is in manifest.json but missing`); continue }
    const body = readFileSync(path)
    if (sha(body) !== f.sha256) problems.push(`${f.name} hash moved: manifest ${f.sha256.slice(0, 12)}, file ${sha(body).slice(0, 12)}`)
    if (body.length !== f.bytes) problems.push(`${f.name} is ${body.length} bytes; manifest says ${f.bytes}`)
    if (f.owner !== 'Napkin' || f.drawn_by !== 'make_media.py') problems.push(`${f.name} is not marked as Napkin's and drawn by make_media.py`)
    if (/client_briefs/i.test(f.name) || briefHashes.has(sha(body))) problems.push(`${f.name} comes from client_briefs/`)
    if (!sources.includes(`| ${f.name} |`)) problems.push(`${f.name} is not on the list in SOURCES.md`)
  }
  return { problems, checked: manifest.files.length, clientBriefsChecked: existsSync(briefs) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = verifyMedia()
  if (r.problems.length) {
    for (const p of r.problems) console.error(`media: ${p}`)
    process.exit(1)
  }
  console.log(`media: OK, ${r.checked} files proved${r.clientBriefsChecked ? '' : ' (no client_briefs/ in this clone, so no cross-check against it)'}`)
}
