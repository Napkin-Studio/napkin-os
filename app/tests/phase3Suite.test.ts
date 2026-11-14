// The Phase 3 acceptance suite's own checks (features/j001-phase3-suite.clan, test plan): the table in docs/design/phase3-acceptance.md names an
// owner and a gate line for every number from 74 to 111 and uses none twice; the registry matches it; the counter refuses a number declared twice
// or a fixme with no slug; the media fixtures prove their hashes and refuse a file not on the list or one that comes from client_briefs/; the five
// manual gate checks are written down and nothing in app/e2e calls a provider. Run from app/ (npm test).

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { count } from '../e2e/phase3/count.mjs'
import { checkTable, parseTable } from '../e2e/phase3/table.mjs'
import { LINES, PHASE3, SLUGS } from '../e2e/phase3/tests.mjs'
import { MEDIA, MEDIA_DIR, MEDIA_FILES, SITES, mediaJson } from '../e2e/seed/j001/media/index.mjs'
import { verifyMedia } from '../e2e/seed/j001/media/verify.mjs'

const root = join(process.cwd(), '..')
const e2e = join(process.cwd(), 'e2e')
const doc = readFileSync(join(root, 'docs/design/phase3-acceptance.md'), 'utf8')
const hasRecord = (slug: string) => existsSync(join(root, 'features', `${slug}.clan`))

test('the table lists tests 74 to 111, each with an owning record and a gate line, none twice', () => {
  const rows = parseTable(doc)
  assert.equal(rows.length, 38)
  assert.deepEqual(checkTable(rows, { hasRecord }), [])
  assert.deepEqual(rows.map(r => r.n), Array.from({ length: 38 }, (_, i) => 74 + i))
})

test('the table check fails on a missing owner, an unknown record, a number used twice, a gap and a gate line it does not know', () => {
  const ok = [{ n: 74, slug: 'a', line: 'still', fact: 'x' }, { n: 75, slug: 'b', line: 'film', fact: 'y' }]
  const only = (rows: typeof ok) => checkTable(rows, { first: 74, last: 75, hasRecord: s => s !== 'ghost' })
  assert.deepEqual(only(ok), [])
  assert.ok(only([ok[0], { ...ok[1], slug: '' }]).some(p => /test 75 has no owning record/.test(p)))
  assert.ok(only([ok[0], { ...ok[1], slug: 'ghost' }]).some(p => /ghost, which is not a feature record/.test(p)))
  assert.ok(only([ok[0], { ...ok[0] }]).some(p => /test 74 is used 2 times/.test(p)))
  assert.ok(only([ok[0], { ...ok[0] }]).some(p => /test 75 is missing/.test(p)))
  assert.ok(only([ok[0], { ...ok[1], line: 'banner' }]).some(p => /gate line "banner"/.test(p)))
  assert.ok(only([ok[0], { ...ok[1], n: 76 }]).some(p => /outside 74 to 75/.test(p)))
})

test('the registry lists the same numbers, records, gate lines and facts as the document, and every spec file exists', () => {
  const rows = parseTable(doc)
  assert.deepEqual(PHASE3.map(r => ({ n: r.n, slug: r.slug, line: r.line, fact: r.fact })), rows)
  assert.equal(SLUGS.length, 30)
  for (const r of PHASE3) {
    assert.equal(r.file, `j001-p3-${r.slug}.spec.ts`)
    assert.ok(existsSync(join(e2e, r.file)), `${r.file} exists`)
    assert.ok(LINES.includes(r.line))
    assert.ok(!/—/.test(r.short + r.fact), `test ${r.n} has no em dash`)
  }
  // The gate sentence's six lines are all served.
  for (const line of ['still', 'film', 'radio', 'poster', 'pack', 'scored']) assert.ok(PHASE3.some(r => r.line === line), `a test serves ${line}`)
})

test('the counter: a number declared twice, a wrong file, a missing test or a live test with no page is refused', () => {
  const reg = [
    { n: 1, slug: 'a', file: 'j001-p3-a.spec.ts', short: 'x', fact: 'x' },
    { n: 2, slug: 'a', file: 'j001-p3-a.spec.ts', short: 'y', fact: 'y' },
    { n: 3, slug: 'b', file: 'j001-p3-b.spec.ts', short: 'z', fact: 'z' },
  ]
  const files = (m: Record<string, string>) => (f: string) => (f in m ? m[f] : null)
  const ok = count(files({ 'j001-p3-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)', 'j001-p3-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.fixme.size, 3)
  const twice = count(files({ 'j001-p3-a.spec.ts': 'test.fixme(t(1), a)\ntest(t(1), a)\ntest.fixme(t(2), b)', 'j001-p3-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.ok(twice.problems.some((p: string) => /test 1 is declared 2 times/.test(p)))
  const wrong = count(files({ 'j001-p3-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)\ntest.fixme(t(3), c)', 'j001-p3-b.spec.ts': '' }), reg)
  assert.ok(wrong.problems.some((p: string) => /test 3 is in j001-p3-a.spec.ts/.test(p)))
  const missing = count(files({ 'j001-p3-a.spec.ts': 'test.fixme(t(1), a)' }), reg)
  assert.ok(missing.problems.some((p: string) => /test 2 is not declared/.test(p)))
  assert.ok(missing.problems.some((p: string) => /j001-p3-b.spec.ts is missing/.test(p)))
  const noSlug = count(files({ 'j001-p3-a.spec.ts': 'test.fixme(t(1), a)\ntest.fixme(t(2), b)', 'j001-p3-b.spec.ts': 'test.fixme(t(3), c)' }), [reg[0], reg[1], { ...reg[2], slug: '' }])
  assert.ok(noSlug.problems.some((p: string) => /test 3 is fixme but names no feature slug/.test(p)))
  const noPage = count(files({ 'j001-p3-a.spec.ts': 'test(t(1), a)\ntest.fixme(t(2), b)', 'j001-p3-b.spec.ts': 'test.fixme(t(3), c)' }), reg)
  assert.ok(noPage.problems.some((p: string) => /a has live tests but exports no page/.test(p)))
  const withPage = count(files({ 'j001-p3-a.spec.ts': 'test(t(1), a)\ntest.fixme(t(2), b)', 'j001-p3-b.spec.ts': 'test.fixme(t(3), c)', 'j001-p3-a.pages.ts': "{ name: 'x' }" }), reg)
  assert.deepEqual(withPage.problems, [])
})

test('the real spec files are consistent: 37 of 38 are fixme on the first day, and test 111 runs', () => {
  const r = count((f: string) => (existsSync(join(e2e, f)) ? readFileSync(join(e2e, f), 'utf8') : null))
  assert.deepEqual(r.problems, [])
  assert.deepEqual([...r.live.keys()], [111])
  assert.equal(r.fixme.size, 37)
})

test('the document ends with the five manual gate checks, each with its command, cap and the person who watches', () => {
  const last = doc.slice(doc.lastIndexOf('\n## ') + 1)
  assert.match(last, /^## The five manual gate checks/)
  for (const g of ['G1 a real still', 'G2 a real 10 second film', 'G3 a real voiced spot', 'G4 a poster a person believes', "G5 the pack's paid sizes"]) {
    const row = last.split('\n').find(l => l.startsWith(`| ${g} |`))
    assert.ok(row, `${g} is listed`)
    const cells = row.split('|').map(c => c.trim()).filter(Boolean)
    assert.equal(cells.length, 6, `${g} has check, what, record, command, cap and watcher`)
    assert.match(cells[3], /scripts\/gate-g\d\.sh/)
    assert.match(cells[4], /\d+ euro/)
    assert.ok(cells[5].length > 3)
  }
  assert.ok(!/—/.test(doc), 'the document holds no em dash')
})

test('nothing in app/e2e calls a provider, reads a provider key or names a provider address', () => {
  const files: string[] = []
  const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|mjs|mts|py|json)$/.test(f.name)) files.push(p) } }
  walk(e2e)
  assert.ok(files.length > 30)
  const addresses = /api\.(runwayml|elevenlabs|anthropic|openai)\.(com|io)|api\.(us\.)?bfl\.(ai|ml)|api\.lumalabs\.ai|generativelanguage\.googleapis\.com/
  const keys = /(RUNWAY|ELEVENLABS|ELEVEN_LABS|BFL|ANTHROPIC|OPENAI|GEMINI|LUMA)[A-Z_]*(API_)?KEY/
  for (const f of files) {
    if (f.endsWith('phase3Suite.test.ts')) continue
    const text = readFileSync(f, 'utf8')
    assert.ok(!addresses.test(text), `${f} names a provider address`)
    // A canary key is a test's own made-up string, set by the stack: it is read as NAPKIN_E2E_CANARY_KEY, never a provider's variable.
    assert.ok(!keys.test(text), `${f} reads a provider key`)
  }
})

test('the media fixtures: every file proves its hash, is on the list, and none is from client_briefs/', () => {
  const r = verifyMedia()
  assert.deepEqual(r.problems, [])
  assert.equal(r.checked, MEDIA_FILES.length)
  assert.equal(MEDIA_FILES.length, 10)
  for (const f of MEDIA_FILES) assert.ok(existsSync(join(MEDIA_DIR, f.name)))
})

test('the media check refuses a file not on the list, a hash that moved and a file that comes from client_briefs/', () => {
  const work = mkdtempSync(join(tmpdir(), 'j001-media-'))
  try {
    const dir = join(work, 'media')
    cpSync(MEDIA_DIR, dir, { recursive: true })
    const fake = join(work, 'repo')
    assert.deepEqual(verifyMedia({ dir, repoRoot: fake }).problems, [])
    writeFileSync(join(dir, 'extra.png'), 'not listed')
    assert.ok(verifyMedia({ dir, repoRoot: fake }).problems.some(p => /extra\.png is in the folder but not in manifest\.json/.test(p)))
    rmSync(join(dir, 'extra.png'))
    writeFileSync(join(dir, 'bottle.png'), 'a different file')
    assert.ok(verifyMedia({ dir, repoRoot: fake }).problems.some(p => /bottle\.png hash moved/.test(p)))
    cpSync(join(MEDIA_DIR, 'bottle.png'), join(dir, 'bottle.png'))
    // A client folder that holds the same bytes as a fixture.
    cpSync(join(MEDIA_DIR, 'scamp.png'), join(fake, 'client_briefs', 'scamp-copy.png'), { recursive: true })
    const r = verifyMedia({ dir, repoRoot: fake })
    assert.ok(r.clientBriefsChecked)
    assert.ok(r.problems.some(p => /scamp\.png comes from client_briefs\//.test(p)))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

const pngSize = (name: string) => {
  const b = readFileSync(join(MEDIA_DIR, name))
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

test('the media content: the photo, the scamp, the two scripts, the layout and five sites with corners', () => {
  assert.deepEqual(pngSize(MEDIA.bottle.name), { w: 600, h: 900 })
  assert.deepEqual(pngSize(MEDIA.scamp.name), { w: 800, h: 500 })
  const radio = mediaJson(MEDIA.radio.name) as { slot_s: number; est_total_s: number; beats: { id: string; est_s: number }[] }
  assert.equal(radio.slot_s, 30)
  assert.equal(radio.beats.reduce((s, b) => s + b.est_s, 0), 30)
  assert.equal(radio.est_total_s, 30)
  const tv = mediaJson(MEDIA.tv.name) as { slot_s: number; beats: { id: string; duration_s: number }[] }
  assert.equal(tv.slot_s, 10)
  assert.equal(tv.beats.reduce((s, b) => s + b.duration_s, 0), 10)
  for (const s of [radio, tv]) {
    const ids = s.beats.map(b => b.id)
    assert.equal(new Set(ids).size, ids.length, 'beat ids are unique')
    assert.ok(ids.every(i => /^[rt]\d+$/.test(i)))
  }
  const layout = mediaJson(MEDIA.layout.name) as { status: string; layers: { id: string; type: string; asset?: string }[]; protected: string[] }
  assert.equal(layout.status, 'approved')
  assert.ok(layout.layers.some(l => l.type === 'picture' && l.asset === MEDIA.bottle.name))
  for (const id of layout.protected) assert.ok(layout.layers.some(l => l.id === id))
  assert.deepEqual(SITES.map(s => s.site).sort(), ['48 sheet', '6 sheet', 'bus shelter', 'digital screen', 'station panel'])
  for (const s of SITES) {
    assert.equal(s.corners!.length, 4)
    const { w, h } = pngSize(s.name)
    for (const [x, y] of s.corners!) assert.ok(x > 0 && x < w && y > 0 && y < h, `${s.name} corner inside the picture`)
  }
  for (const f of MEDIA_FILES.filter(x => x.name.endsWith('.json'))) assert.ok(!/—/.test(readFileSync(join(MEDIA_DIR, f.name), 'utf8')))
})
