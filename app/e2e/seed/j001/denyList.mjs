// The de-identification check for the J001 seed (features/j001-pilot-suite.clan, done_when 2).
//
// The seed says "Client A, an Irish whiskey" and never a real brand or client. The list of the
// real names is NOT in this repo: a person keeps it in a file outside the clone and points
// NAPKIN_DENY_LIST at it (one string per line; blank lines and lines starting with # are
// ignored; matching ignores case). The check reads every text file under the seed folder, and
// under any extra path given, and fails on the first string it finds. With no list supplied it
// passes and says so, so a clone without the list still runs the suite.
//
//   NAPKIN_DENY_LIST=/path/outside/repo/deny.txt node e2e/seed/j001/denyList.mjs [extra paths]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(here, '../../../..')

/** The strings in a list file: trimmed, lower-cased, no blanks or comments. */
export function parseList(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.toLowerCase())
}

function* files(path) {
  const st = statSync(path)
  if (st.isDirectory()) {
    for (const f of readdirSync(path)) yield* files(join(path, f))
  } else if (st.size < 2_000_000) {
    yield path
  }
}

/**
 * Scan `paths` (files or folders) for any string of `list`. Returns [{ file, string }].
 * A string is reported, not echoed back in a message by callers: it is a real name.
 */
export function scan(paths, list) {
  const hits = []
  for (const p of paths) {
    for (const file of files(p)) {
      const text = readFileSync(file, 'utf8').toLowerCase()
      for (const s of list) if (text.includes(s)) hits.push({ file, string: s })
    }
  }
  return hits
}

/**
 * The seed step's gate. Returns { checked: false, note } when no list is supplied,
 * { checked: true } when the seed is clean, and throws when a string is found or the
 * list sits inside the repo (it must stay outside).
 */
export function assertDeIdentified({ listPath = process.env.NAPKIN_DENY_LIST, paths = [here] } = {}) {
  if (!listPath) {
    return { checked: false, note: 'no deny list supplied (set NAPKIN_DENY_LIST=<file outside the repo>): de-identification not checked' }
  }
  const abs = resolve(listPath)
  if (!existsSync(abs)) throw new Error(`deny list not found at the path given in NAPKIN_DENY_LIST`)
  if (abs === repoRoot || abs.startsWith(repoRoot + sep)) {
    throw new Error('the deny list is inside the repo: keep it outside, it holds real names')
  }
  const list = parseList(readFileSync(abs, 'utf8'))
  if (list.length === 0) throw new Error('the deny list is empty')
  const hits = scan(paths, list)
  if (hits.length) {
    const where = [...new Set(hits.map(h => relative(repoRoot, h.file)))].join(', ')
    throw new Error(`the seed holds ${hits.length} string(s) from the deny list, in: ${where}`)
  }
  return { checked: true, note: `de-identified: ${list.length} strings checked` }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const extra = process.argv.slice(2).map(p => resolve(p))
    const r = assertDeIdentified({ paths: [here, ...extra] })
    console.log(`j001 seed: ${r.note}`)
  } catch (e) {
    console.error(`j001 seed: FAIL ${e.message}`)
    process.exit(1)
  }
}
