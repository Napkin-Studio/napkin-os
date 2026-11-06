// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Two copies of Shrey's sphere + ring code exist: the `Orbs` block inside the
// Deck Maker template (a sandboxed single file cannot import a shell module), and
// app/src/orbs (typed, tested, the shell's). This test holds them together. It
// reads the template's own text and runs it, so a change on EITHER side that is
// not mirrored on the other fails here:
//   - the shader (vertex and fragment) line by line: only lines marked `PORT` on
//     the shell's side may differ, and exactly the ones listed below do;
//   - the material, type and ring-style tables, value by value (the shell adds
//     only the `idle` ring, marked PORT);
//   - the pose functions (the agent's idle motion, the hand-off blend), by running
//     both on the same inputs and comparing every number.
// features/landing-circles.clan, phase 4. The clan's agents are not touched.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { FRAG, VERT } from '../src/orbs/shader.ts'
import { MATS, STYLE, TYPE_OF, TYPES } from '../src/orbs/tables.ts'
import * as ours from '../src/orbs/pose.ts'

let root = new URL('.', import.meta.url)
while (!existsSync(new URL('package.json', root))) root = new URL('..', root)
const html = readFileSync(new URL('templates/deck-maker/index.html', root), 'utf8')

const START = html.indexOf('var Orbs = (function () {')
const END = html.indexOf('})();', html.indexOf('// ── end of the verbatim copy ──', START))
assert.ok(START > 0 && END > START, 'the template still has its Orbs block')
const block = html.slice(START, END)

const between = (from: string, to: string) => {
  const a = block.indexOf(from), b = block.indexOf(to, a)
  assert.ok(a >= 0 && b > a, `template markers ${from} .. ${to}`)
  return block.slice(a, b)
}

test('the vertex shader is the template\'s, character for character', () => {
  const m = /const VERT = '([^']*)';/.exec(block)
  assert.ok(m)
  assert.equal(VERT, m[1])
})

/** The only lines of the fragment shader the shell may change, and why. */
const PORTED = [
  'uniform vec3 uBaseA', // + uTrack (the template already carries this one)
  'vec3 neutral = uTrack', // the track colour is a uniform so dark works (the template carries this one too)
  'float sh = ', // the circle shadow is off: controls are flat
]

test('the fragment shader is the template\'s, line by line; only the marked PORT lines differ', () => {
  const m = /const FRAG = `([\s\S]*?)`;/.exec(block)
  assert.ok(m)
  const theirs = m[1].split('\n'), mine = FRAG.split('\n')
  assert.equal(mine.length, theirs.length, 'the same number of lines: a line added or dropped on one side')
  const differing: number[] = []
  for (let i = 0; i < theirs.length; i++) if (theirs[i] !== mine[i]) differing.push(i)
  for (const i of differing) {
    assert.match(mine[i], /PORT/, `line ${i + 1} differs from the template and is not marked PORT:\n  shell:    ${mine[i]}\n  template: ${theirs[i]}`)
    assert.ok(PORTED.some(p => mine[i].includes(p)), `line ${i + 1} is marked PORT but is not one of the agreed differences`)
  }
  // the agreed shadow-off line really is the only difference today
  assert.equal(differing.length, 1)
  assert.ok(mine[differing[0]].trim().startsWith('float sh = .0 /* PORT'))
})

// ── the tables ──
const tablesSrc = between('const rgb =', 'const PA =')
const theirTables = new Function(`${tablesSrc}; return { MATS, TYPES, TYPE_OF, STYLE };`)() as {
  MATS: typeof MATS; TYPES: typeof TYPES; TYPE_OF: typeof TYPE_OF; STYLE: typeof STYLE
}

test('materials are the template\'s, value by value', () => assert.deepEqual(MATS, theirTables.MATS))
test('agent types (wobble and breath) are the template\'s', () => assert.deepEqual(TYPES, theirTables.TYPES))
test('the type of each agent name is the template\'s', () => assert.deepEqual(TYPE_OF, theirTables.TYPE_OF))
test('ring styles are the template\'s; the shell adds only `idle`', () => {
  for (const k of Object.keys(theirTables.STYLE)) assert.deepEqual(STYLE[k], theirTables.STYLE[k], `style ${k}`)
  assert.deepEqual(Object.keys(STYLE).filter(k => !(k in theirTables.STYLE)), ['idle'])
})

// ── the pose functions, run on the same inputs ──
const poseSrc = between('const PA =', 'const VERT =')
const prelude = [
  'const clamp = (x, a, b) => Math.min(b, Math.max(a, x));',
  'const ease = x => .5 - .5 * Math.cos(Math.PI * x);',
  'const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };',
].join('\n')
const theirs = new Function(`${prelude}\n${poseSrc}\nreturn { POSE_SPAN, writeStatic, writeMix, PA, PB, CA, CB, arc0, arc1, cir0, cir1 };`)() as {
  POSE_SPAN: (a: unknown, t: number, oa: Float32Array, oc: Float32Array) => void
  writeStatic: (A: Float32Array, C: Float32Array) => void
  writeMix: (a: unknown, na: number, b: unknown, nb: number, p: number, flow: number) => void
  PA: Float32Array; PB: Float32Array; CA: Float32Array; CB: Float32Array
  arc0: Float32Array; arc1: Float32Array; cir0: Float32Array; cir1: Float32Array
}

// A small deterministic generator, so the inputs are the same on every run.
let seed = 12345
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const agent = (type: string, na: number, nc: number) => {
  const arcF = new Float32Array(28), cirF = new Float32Array(12)
  for (let i = 0; i < na * 7; i++) arcF[i] = rnd() * 3
  for (let i = 0; i < nc * 6; i++) cirF[i] = rnd() * 2 - 1
  return { type, sp: 0.8 + rnd() * 0.5, na, nc, arcF, cirF }
}
const same = (a: Float32Array, b: Float32Array, what: string) => assert.deepEqual(Array.from(a), Array.from(b), what)

test('the agent\'s idle motion is the template\'s, for every type, at many times', () => {
  for (const type of Object.keys(TYPES)) {
    for (const [na, nc] of [[0, 0], [1, 1], [4, 2], [3, 0]]) {
      const a = agent(type, na, nc)
      for (const t of [0, 0.37, 4.2, 91.5]) {
        theirs.POSE_SPAN(a, t, theirs.PA, theirs.CA)
        ours.poseSpan(a, t, ours.PA, ours.CA)
        same(ours.PA, theirs.PA, `${type} arcs na=${na} t=${t}`)
        same(ours.CA, theirs.CA, `${type} circles nc=${nc} t=${t}`)
      }
    }
  }
})

test('writing a pose to the shader\'s arrays is the template\'s', () => {
  const a = agent('sweep', 4, 2)
  theirs.POSE_SPAN(a, 2.5, theirs.PA, theirs.CA); ours.poseSpan(a, 2.5, ours.PA, ours.CA)
  theirs.writeStatic(theirs.PA, theirs.CA); ours.writeStatic(ours.PA, ours.CA)
  same(ours.arc0, theirs.arc0, 'arc0'); same(ours.arc1, theirs.arc1, 'arc1'); same(ours.cir0, theirs.cir0, 'cir0'); same(ours.cir1, theirs.cir1, 'cir1')
})

test('the hand-off blend is the template\'s, along the whole pour', () => {
  const a = agent('scan', 3, 2), b = agent('pulse', 4, 1)
  for (const flow of [0, 1]) {
    for (const p of [0, 0.1, 0.33, 0.5, 0.8, 1]) {
      theirs.POSE_SPAN(a, 3.1, theirs.PA, theirs.CA); theirs.POSE_SPAN(b, 3.1, theirs.PB, theirs.CB)
      ours.poseSpan(a, 3.1, ours.PA, ours.CA); ours.poseSpan(b, 3.1, ours.PB, ours.CB)
      theirs.writeMix(a, a.na, b, b.na, p, flow); ours.writeMix(a, a.na, b, b.na, p, flow)
      same(ours.arc0, theirs.arc0, `arc0 p=${p} flow=${flow}`); same(ours.arc1, theirs.arc1, `arc1 p=${p}`)
      same(ours.cir0, theirs.cir0, `cir0 p=${p}`); same(ours.cir1, theirs.cir1, `cir1 p=${p}`)
    }
  }
})

test('the drift test can fail: a changed table or shader line is seen', () => {
  const tweaked = { ...MATS, pearl: { ...MATS.pearl, gloss: MATS.pearl.gloss + 0.01 } }
  assert.notDeepEqual(tweaked, theirTables.MATS)
  const m = /const FRAG = `([\s\S]*?)`;/.exec(block)!
  assert.notEqual(m[1].replace('smoothstep', 'smoothstop'), FRAG)
})
