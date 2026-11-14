// The Phase 3 burn-down (features/j001-phase3-suite.clan, done_when 2): counts the Phase 3 tests (74 to 111) still marked
// test.fixme in the j001-p3-*.spec.ts files and prints the feature record that turns each on. Phase 3's tests are done
// when the count is 0 (the gate is then a review by a person, not this count).
//
//   node e2e/phase3-fixme.mjs                     print the list and the count
//   node e2e/phase3-fixme.mjs --gate              the same, and exit 1 while the count is above 0
//   node e2e/phase3-fixme.mjs --slug radio-tool    one record's burn-down
//   node e2e/phase3-fixme.mjs --by-record         the fixme count of each record
//
// Exit 2 when the files are inconsistent (a number declared twice, a missing file, a record with live tests and no page).

import { fileURLToPath } from 'node:url'
import { countDir } from './phase3/count.mjs'
import { PHASE3 } from './phase3/tests.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const only = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null
if (args.includes('--slug') && !PHASE3.some(t => t.slug === only)) {
  console.error(`phase 3: no record called ${only} in the registry`)
  process.exit(2)
}

const { problems, fixme, total } = countDir(dir)
if (problems.length) {
  for (const p of problems) console.error(`phase 3: ${p}`)
  process.exit(2)
}

if (args.includes('--by-record')) {
  const per = new Map()
  for (const t of PHASE3) per.set(t.slug, [...(per.get(t.slug) ?? [0, 0])].map((v, i) => v + (i === 0 ? (fixme.has(t.n) ? 1 : 0) : 1)))
  for (const [slug, [f, all]] of [...per].sort()) console.log(`  ${slug.padEnd(26)} ${f} fixme of ${all}`)
}

const shown = PHASE3.filter(t => fixme.has(t.n) && (!only || t.slug === only))
for (const t of shown) console.log(`  test ${String(t.n).padStart(2)}  ${t.slug.padEnd(26)} ${t.short}`)
const of = only ? PHASE3.filter(t => t.slug === only).length : total
console.log(`phase 3${only ? ` ${only}` : ''}: ${shown.length} fixme of ${of} (${of - shown.length} run now)`)
if (shown.length > 0 && args.includes('--gate')) process.exit(1)
