// The Phase 2 counter's logic (features/j001-phase2-suite.clan, done_when 3). Reads the registry (tests.mjs) and every
// j001-p2-*.spec.ts, and reports which tests still run as `test.fixme`. The registry is never edited to turn a test on:
// live or fixme comes from the spec file alone. Rules it checks, each a problem string:
//   - a test is declared once, as `test(t(N), ...)` or `test.fixme(t(N), ...)`, in the file the registry names;
//   - a number outside the registry, or declared in the wrong file, is refused;
//   - a record with a live test exports at least one page (`name: '...'` in its j001-p2-<slug>.pages.ts) for tests 71 to 73.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PHASE2 } from './tests.mjs'

const fixmeRe = /test\.fixme\(\s*t\((\d+)\)/g
const liveRe = /(?<![.\w])test\(\s*t\((\d+)\)/g

/** Parse one spec's text into the sets of numbers it declares. */
export function declared(text) {
  return {
    fixme: [...text.matchAll(fixmeRe)].map(m => Number(m[1])),
    live: [...text.matchAll(liveRe)].map(m => Number(m[1])),
  }
}

/** `read(file)` returns a spec file's text, or null when the file is missing. */
export function count(read, registry = PHASE2) {
  const problems = []
  const fixme = new Map() // n -> slug
  const live = new Map()
  const seen = new Map() // n -> times declared, across every file
  const files = [...new Set(registry.map(t => t.file))]
  for (const file of files) {
    const text = read(file)
    if (text === null) {
      problems.push(`${file} is missing`)
      continue
    }
    const d = declared(text)
    for (const n of [...d.fixme, ...d.live]) {
      seen.set(n, (seen.get(n) ?? 0) + 1)
      const entry = registry.find(t => t.n === n)
      if (!entry) problems.push(`${file} declares test ${n}, which the registry does not list`)
      else if (entry.file !== file) problems.push(`test ${n} is in ${file}; the registry puts it in ${entry.file}`)
    }
    for (const n of d.fixme) { const e = registry.find(t => t.n === n); if (e && e.file === file) fixme.set(n, e.slug) }
    for (const n of d.live) { const e = registry.find(t => t.n === n); if (e && e.file === file) live.set(n, e.slug) }
  }
  for (const t of registry) {
    const times = seen.get(t.n) ?? 0
    if (times === 0) problems.push(`test ${t.n} is not declared in ${t.file}`)
    if (times > 1) problems.push(`test ${t.n} is declared ${times} times`)
    if (fixme.has(t.n) && !t.slug) problems.push(`test ${t.n} is fixme but names no feature slug`)
  }
  // A record with live tests shows its pages to the suite's axe, 44 px and em dash checks (tests 72 and 73).
  for (const slug of new Set([...live.values()])) {
    const text = read(`j001-p2-${slug}.pages.ts`)
    if (text === null || !/\bname: '/.test(text)) problems.push(`${slug} has live tests but exports no page (j001-p2-${slug}.pages.ts)`)
  }
  return { problems, fixme, live, total: registry.length }
}

/** Count over the real files in `dir` (the e2e folder). */
export function countDir(dir) {
  return count(file => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : null))
}
