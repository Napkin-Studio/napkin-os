// The Phase 2 acceptance suite's own checks (features/j001-phase2-suite.clan, test plan): the registry matches the acceptance document, the
// counter refuses a number declared twice or a fixme with no slug, every seed document carries every key its schema declares, the stand-in
// middleware answers a named task, fails one on request and keeps the old reply for the rest, and the seed holds no em dash.
// Run from app/ (npm test). The browser suite itself is `scripts/check.sh --only e2e`.

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { count } from '../e2e/phase2/count.mjs'
import { PHASE2, SLUGS } from '../e2e/phase2/tests.mjs'
import { answerFor, answeredTasks } from '../e2e/seed/j001/p2/answers.mjs'
import { P2_DOCS } from '../e2e/seed/j001/p2/documents.mjs'
import { CANARY_SENTENCE, plantCanary } from '../e2e/seed/j001/p2/wall.mjs'
import { standIn } from '../e2e/standin.mjs'
import { PEOPLE } from '../e2e/seed/j001/people.mjs'

const root = join(process.cwd(), '..')
const e2e = join(process.cwd(), 'e2e')
// bundled by tests/run.mjs, import.meta.url no longer points at e2e: the answers folder is given
const answers = join(e2e, 'seed/j001/p2/answers')

type Row = { n: number; slug: string; file: string; short: string; fact: string }
const registry = PHASE2 as Row[]

test('the registry lists the same numbers, records and facts as docs/design/phase2-acceptance.md', () => {
  const doc = readFileSync(join(root, 'docs/design/phase2-acceptance.md'), 'utf8')
  const rows = [...doc.matchAll(/^\| (\d+) \| ([a-z0-9-]+) \| (.*) \|$/gm)].map(m => ({ n: Number(m[1]), slug: m[2], fact: m[3] }))
  assert.equal(rows.length, 55)
  assert.deepEqual(registry.map(r => ({ n: r.n, slug: r.slug, fact: r.fact })), rows)
  assert.deepEqual(registry.map(r => r.n), Array.from({ length: 55 }, (_, i) => 19 + i))
  assert.equal(SLUGS.length, 17)
  for (const r of registry) {
    assert.equal(r.file, `j001-p2-${r.slug}.spec.ts`)
    assert.ok(existsSync(join(e2e, r.file)), `${r.file} exists`)
    assert.ok(!/—/.test(r.short + r.fact), `test ${r.n} has no em dash`)
  }
})

test('the counter: a number declared twice, a wrong file, a missing test or a live test with no page is refused', () => {
  const reg = [
    { n: 1, slug: 'a', file: 'j001-p2-a.spec.ts', short: 'x', fact: 'x' },
    { n: 2, slug: 'a', file: 'j001-p2-a.spec.ts', short: 'y', fact: 'y' },
    { n: 3, slug: 'b', file: 'j001-p2-b.spec.ts', short: 'z', fact: 'z' },
  ]
  const files = (m: Record<string, string>) => (f: string) => (f in m ? m[f] : null)
  const ok = count(files({ 'j001-p2-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)', 'j001-p2-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.fixme.size, 3)
  const twice = count(files({ 'j001-p2-a.spec.ts': 'test.fixme(t(1), a)\ntest(t(1), a)\ntest.fixme(t(2), b)', 'j001-p2-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.ok(twice.problems.some((p: string) => /test 1 is declared 2 times/.test(p)))
  const wrong = count(files({ 'j001-p2-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)\ntest.fixme(t(3), c)', 'j001-p2-b.spec.ts': '' }), reg)
  assert.ok(wrong.problems.some((p: string) => /test 3 is in j001-p2-a.spec.ts/.test(p)))
  const missing = count(files({ 'j001-p2-a.spec.ts': 'test.fixme(t(1), a)' }), reg)
  assert.ok(missing.problems.some((p: string) => /test 2 is not declared/.test(p)))
  assert.ok(missing.problems.some((p: string) => /j001-p2-b.spec.ts is missing/.test(p)))
  const noSlug = count(files({ 'j001-p2-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)', 'j001-p2-b.spec.ts': 'test.fixme(t(3), c)' }), [reg[0], reg[1], { ...reg[2], slug: '' }])
  assert.ok(noSlug.problems.some((p: string) => /test 3 is fixme but names no feature slug/.test(p)))
  const noPage = count(files({ 'j001-p2-a.spec.ts': 'test(t(1), a)\ntest.fixme(t(2), b)', 'j001-p2-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.ok(noPage.problems.some((p: string) => /a has live tests but exports no page/.test(p)))
  const withPage = count(files({ 'j001-p2-a.spec.ts': 'test(t(1), a)\ntest.fixme(t(2), b)', 'j001-p2-b.spec.ts': 'test.fixme(t(3), c)', 'j001-p2-a.pages.ts': "{ name: 'x' }" }), reg)
  assert.deepEqual(withPage.problems, [])
})

test('the real spec files are consistent and 52 of 55 are fixme on the first day', () => {
  const r = count((f: string) => (existsSync(join(e2e, f)) ? readFileSync(join(e2e, f), 'utf8') : null))
  assert.deepEqual(r.problems, [])
  assert.ok([71, 72, 73].every(n => r.live.has(n)), 'tests 71 to 73 run')
})

/** Every key a JSON schema declares (properties, through $ref, items and additionalProperties) is in `doc`. */
function missingKeys(schema: Record<string, unknown>, doc: unknown, root = schema, path = '$'): string[] {
  const ref = (s: Record<string, unknown>): Record<string, unknown> => {
    const r = s.$ref
    if (typeof r !== 'string' || !r.startsWith('#/')) return s
    return ref(r.slice(2).split('/').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], root) as Record<string, unknown>)
  }
  const s = ref(schema)
  const out: string[] = []
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    const obj = doc as Record<string, unknown>
    const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const [k, sub] of Object.entries(props)) {
      if (!(k in obj)) out.push(`${path}.${k}`)
      else out.push(...missingKeys(sub, obj[k], root, `${path}.${k}`))
    }
    const extra = s.additionalProperties
    if (extra && typeof extra === 'object') for (const [k, v] of Object.entries(obj)) if (!(k in props)) out.push(...missingKeys(extra as Record<string, unknown>, v, root, `${path}.${k}`))
  } else if (Array.isArray(doc) && s.items && typeof s.items === 'object') {
    doc.forEach((v, i) => out.push(...missingKeys(s.items as Record<string, unknown>, v, root, `${path}[${i}]`)))
  }
  return out
}

test('every seed document carries every key its template schema declares (once the schema exists)', () => {
  const checked: string[] = []
  for (const d of P2_DOCS as { slug: string; title: string; schema: string; data: unknown }[]) {
    const file = join(root, d.schema)
    if (!existsSync(file)) {
      // the owning record has not written its template yet: it lands with its schema, and this check starts then. A template
      // that is there with no schema at this path is not skipped quietly.
      assert.ok(!existsSync(dirname(file)), `${d.title}: ${dirname(d.schema)} exists but has no schema.json`)
      continue
    }
    const schema = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.deepEqual(missingKeys(schema, d.data), [], `${d.title} lacks keys its schema declares`)
    checked.push(d.title)
  }
  // The checker itself: a document that drops a key is refused.
  const schema = { properties: { a: { properties: { b: {} } }, list: { items: { properties: { c: {} } } } } }
  assert.deepEqual(missingKeys(schema, { a: { b: 1 }, list: [{ c: 1 }] }), [])
  assert.deepEqual(missingKeys(schema, { a: {}, list: [{}] }), ['$.a.b', '$.list[0].c'])
  assert.ok(checked.length > 0, 'at least one Phase 2 document is checked (the Idea room and the two scripts so far)')
})

test('the Phase 2 seed and its answers hold no em dash, name no model and use placeholder people only', () => {
  const files: string[] = []
  const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else files.push(p) } }
  walk(join(e2e, 'seed/j001'))
  for (const f of [...files, join(e2e, 'standin.mjs'), join(e2e, 'phase2-fixme.mjs')]) assert.ok(!/—/.test(readFileSync(f, 'utf8')), `an em dash in ${f}`)
  for (const task of answeredTasks(answers)) {
    const a = answerFor(task, null, answers)
    assert.equal(a.task, task)
    assert.ok(/^[a-z_]+@\d/.test(a.handler), `${task} names its handler`)
    assert.equal(a.result?.model ?? null, null, `${task} names no model`)
  }
  for (const p of Object.values(PEOPLE) as { username: string }[]) assert.match(p.username, /^[a-z0-9]+@(wk|bq|napkin|empty|cr|cs|bg)$/)
  assert.ok(files.some(f => f.endsWith('answers/judge_work.score22-idea7.json')))
})

test('plantCanary reaches every free-text string and leaves ids alone', () => {
  const { doc, planted } = plantCanary({ id: 'card_1', text: 'A line of words.', kind: 'team', list: [{ note: 'Another line.', by: 'maeve@wk' }], n: 3 })
  assert.equal(planted, 2)
  assert.ok(doc.text.endsWith(CANARY_SENTENCE) && doc.list[0].note.endsWith(CANARY_SENTENCE))
  assert.equal(doc.id, 'card_1')
  assert.equal(doc.list[0].by, 'maeve@wk')
})

test('the stand-in middleware: a named task, a failed task once, an unknown task keeps the old reply', async () => {
  const server = standIn(answers, join(e2e, '../../server/napkin/judge/rubric.json'))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ask = (task: string) => fetch(`${base}/v1/tasks`, { method: 'POST', body: JSON.stringify({ request_kind: 'middleware', payload: { task } }) })
  const control = (body: object) => fetch(`${base}/control`, { method: 'POST', body: JSON.stringify(body) })
  try {
    const named = await (await ask('ban_default')).json()
    assert.equal(named.task, 'ban_default')
    assert.equal(named.result.banned.length, 3)
    assert.equal((await ask('ban_default')).status, 200)
    await control({ fail: 'judge_work' })
    const failed = await ask('judge_work')
    assert.equal(failed.status, 502)
    assert.equal((await failed.json()).error.type, 'provider_error')
    assert.equal((await ask('judge_work')).status, 200) // once
    await control({ variant: { judge_work: 'score22-idea7' } })
    assert.equal((await (await ask('judge_work')).json()).result.fail.idea, 3)
    // Asked for a kind of work, the Judge fixture writes all thirty of its tests, and a refusal variant answers with its status.
    const judged = await fetch(`${base}/v1/tasks`, { method: 'POST', body: JSON.stringify({ request_kind: 'middleware', payload: { task: 'judge_work', input: { work: { kind: 'script' } } } }) })
    const tests = (await judged.json()).result.tests as { id: string; value: string }[]
    assert.equal(tests.length, 30)
    assert.equal(tests.filter(t => t.value === 'fail').length, 8)
    await control({ variant: { judge_work: 'ai-off' } })
    const refused = await ask('judge_work')
    assert.equal(refused.status, 403)
    assert.equal((await refused.json()).error.type, 'ai_off')
    await control({ variant: { judge_work: 'score24' } })
    // Any other task: the old canned reply, byte for byte.
    const unknown = await ask('start_campaign')
    assert.equal(await unknown.text(), JSON.stringify({
      api: 'napkin.middleware/1', task: 'start_campaign', handler: 'start_campaign@1.0',
      job: { id: 'job_e2e0001', state: 'running', stage: 'research', progress: { done: 2, total: 6 }, started_at: '2026-11-04T09:00:00Z' },
      result: { summary: 'e2e stand-in' }, change: null, trace: {},
    }))
    const log = await (await fetch(`${base}/control/log`)).json() as { task: string }[]
    assert.deepEqual(log.map(e => e.task), ['ban_default', 'ban_default', 'judge_work', 'judge_work', 'judge_work', 'judge_work', 'judge_work', 'start_campaign'])
    assert.ok(log.every(e => Object.keys(e).sort().join() === 'at,task'), 'the log holds the task and the time and nothing else')
  } finally {
    server.close()
  }
})
