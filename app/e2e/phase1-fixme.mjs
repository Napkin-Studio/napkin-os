// The Phase 1 burn-down (features/j001-pilot-suite.clan, done_when 3): counts the pilot tests
// still marked test.fixme in j001-pilot.spec.ts and prints the feature record that turns each on.
// Phase 1 is done when the count is 0.
//
//   node e2e/phase1-fixme.mjs           print the list and the count
//   node e2e/phase1-fixme.mjs --gate    the same, and exit 1 while the count is above 0

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const text = readFileSync(fileURLToPath(new URL('./j001-pilot.spec.ts', import.meta.url)), 'utf8')

// TESTS: `  8: { title: '...', slug: 'x' | null },`
const tests = new Map()
for (const m of text.matchAll(/^\s+(\d+): \{ title: '((?:[^'\\]|\\.)*)', slug: (?:'([a-z0-9-]+)'|null) \},$/gm)) {
  tests.set(Number(m[1]), { title: m[2], slug: m[3] ?? null })
}
const fixme = new Set([...text.matchAll(/test\.fixme\(\s*t\((\d+)\)/g)].map(m => Number(m[1])))
const live = new Set([...text.matchAll(/(?<![.\w])test\(\s*t\((\d+)\)/g)].map(m => Number(m[1])))

const problems = []
for (let n = 1; n <= 18; n++) {
  if (!tests.has(n)) problems.push(`test ${n} is missing from TESTS`)
  if (fixme.has(n) === live.has(n)) problems.push(`test ${n} must be declared once, as test or test.fixme`)
  if (fixme.has(n) && !tests.get(n)?.slug) problems.push(`test ${n} is fixme but names no feature slug`)
  if (live.has(n) && tests.get(n)?.slug) problems.push(`test ${n} runs but TESTS still names the slug ${tests.get(n).slug}`)
}
if (problems.length) {
  for (const p of problems) console.error(`phase 1: ${p}`)
  process.exit(2)
}

for (const n of [...fixme].sort((a, b) => a - b)) {
  console.log(`  test ${String(n).padStart(2)}  ${tests.get(n).slug.padEnd(22)} ${tests.get(n).title}`)
}
console.log(`phase 1: ${fixme.size} fixme of 18 (${18 - fixme.size} run now)`)
if (fixme.size > 0 && process.argv.includes('--gate')) process.exit(1)
