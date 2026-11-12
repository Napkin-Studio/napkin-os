// The Phase 2 burn-down (features/j001-phase2-suite.clan, done_when 3): counts the Phase 2 tests (19 to 73) still marked
// test.fixme in the j001-p2-*.spec.ts files and prints the feature record that turns each on. Phase 2's tests are done
// when the count is 0 (the gate is then a review by a person, not this count).
//
//   node e2e/phase2-fixme.mjs                     print the list and the count
//   node e2e/phase2-fixme.mjs --gate              the same, and exit 1 while the count is above 0
//   node e2e/phase2-fixme.mjs --slug idea-room    one record's burn-down
//
// Exit 2 when the files are inconsistent (a number declared twice, a missing file, a record with live tests and no page).

import { fileURLToPath } from 'node:url'
import { countDir } from './phase2/count.mjs'
import { PHASE2 } from './phase2/tests.mjs'

const dir = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const only = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null
if (args.includes('--slug') && !PHASE2.some(t => t.slug === only)) {
  console.error(`phase 2: no record called ${only} in the registry`)
  process.exit(2)
}

const { problems, fixme, total } = countDir(dir)
if (problems.length) {
  for (const p of problems) console.error(`phase 2: ${p}`)
  process.exit(2)
}

const shown = PHASE2.filter(t => fixme.has(t.n) && (!only || t.slug === only))
for (const t of shown) console.log(`  test ${String(t.n).padStart(2)}  ${t.slug.padEnd(20)} ${t.short}`)
const of = only ? PHASE2.filter(t => t.slug === only).length : total
console.log(`phase 2${only ? ` ${only}` : ''}: ${shown.length} fixme of ${of} (${of - shown.length} run now)`)
if (shown.length > 0 && args.includes('--gate')) process.exit(1)
