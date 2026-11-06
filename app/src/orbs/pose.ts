// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The agent's own idle motion and the hand-off blend, ported from the Deck
// Maker template's `Orbs` block (same arithmetic, typed). app/tests/orbsDrift.test.ts
// runs the template's functions and these on the same inputs and compares the
// numbers, so a change on either side shows. A client pseudo-agent has no arcs
// and no circles (na = nc = 0), so for it these write zeros and the sphere stays blank.

export interface Pose {
  type: string
  sp: number
  na: number
  nc: number
  arcF: Float32Array
  cirF: Float32Array
}

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export const ease = (x: number) => .5 - .5 * Math.cos(Math.PI * x)
const angDiff = (a: number, b: number) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d }

export const PA = new Float32Array(28), PB = new Float32Array(28), CA = new Float32Array(12), CB = new Float32Array(12)
export const arc0 = new Float32Array(16), arc1 = new Float32Array(16), cir0 = new Float32Array(8), cir1 = new Float32Array(8)

function rotC(arr: Float32Array, o: number, x: number, y: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang)
  arr[o] = x * c - y * s
  arr[o + 1] = x * s + y * c
}

export function poseSpan(a: Pose, t: number, outA: Float32Array, outC: Float32Array) {
  outA.set(a.arcF); outC.set(a.cirF)
  const sp = a.sp
  for (let i = 0; i < a.na; i++) {
    const o = i * 7
    switch (a.type) {
      case 'scan': outA[o + 3] += .6 * Math.sin(t * .7 * sp + i * 1.7) * (i % 2 ? -1 : 1); break
      case 'unfold': outA[o + 4] = Math.min(outA[o + 4] * (1 + .26 * Math.sin(t * .8 * sp + i * 1.1)), 6.2); outA[o + 3] += .14 * Math.sin(t * .4 * sp + i); break
      case 'sweep': outA[o + 3] += t * sp * (.5 + .35 * i) * (i % 2 ? -1 : 1); break
      case 'hold': outA[o + 3] += .04 * Math.sin(t * .6 * sp + i); break
      case 'align': outA[o + 3] += .55 * Math.sin(t * .45 * sp) * (1 - i * .3); break
      case 'pulse': outA[o + 5] *= 1 + .3 * Math.sin(t * 2.4 * sp + i); outA[o + 4] *= 1 + .08 * Math.sin(t * 2.4 * sp); break
    }
  }
  for (let i = 0; i < a.nc; i++) {
    const o = i * 6, x = outC[o], y = outC[o + 1]
    switch (a.type) {
      case 'scan': rotC(outC, o, x, y, .5 * Math.sin(t * .6 * sp + i)); break
      case 'unfold': outC[o + 2] *= 1 + .3 * Math.sin(t * .9 * sp + i * 2); break
      case 'sweep': rotC(outC, o, x, y, t * sp * .6 * (i % 2 ? -1 : 1)); break
      case 'hold': outC[o + 1] = y + .01 * Math.sin(t * .7 * sp); break
      case 'align': rotC(outC, o, x, y, .4 * Math.sin(t * .45 * sp)); break
      case 'pulse': outC[o + 1] = y + .045 * Math.sin(t * 2.4 * sp + i); break
    }
  }
}

/** p = 0: no second pose, no blending. */
export function writeStatic(A: Float32Array, C: Float32Array) {
  for (let i = 0; i < 4; i++) {
    const o = i * 7, q = i * 4
    arc0[q] = A[o]; arc0[q + 1] = A[o + 1]; arc0[q + 2] = A[o + 2]; arc0[q + 3] = A[o + 3]
    arc1[q] = i < 4 ? A[o + 4] : 0; arc1[q + 1] = A[o + 5]; arc1[q + 2] = A[o + 6]; arc1[q + 3] = 0
  }
  for (let i = 0; i < 2; i++) {
    const o = i * 6, q = i * 4
    cir0[q] = C[o]; cir0[q + 1] = C[o + 1]; cir0[q + 2] = C[o + 2]; cir0[q + 3] = C[o + 3]; cir1[q] = C[o + 4]; cir1[q + 1] = C[o + 5]; cir1[q + 2] = 0; cir1[q + 3] = 0
  }
}

/** The flow: staggered, arcs spin through, circles orbit. */
export function writeMix(a: Pose, na: number, b: Pose, nb: number, p: number, flow: number) {
  for (let i = 0; i < 4; i++) {
    const ha = i < na, hb = i < nb, oa = i * 7, ob = i * 7
    const q = ease(clamp(p * 1.3 - i * .1, 0, 1)), spin = flow * Math.sin(Math.PI * q) * 2.2 * (i % 2 ? -1 : 1), k = i * 4
    const ax = ha ? PA[oa] : PB[ob], ay = ha ? PA[oa + 1] : PB[ob + 1], ar = ha ? PA[oa + 2] : PB[ob + 2], aa = ha ? PA[oa + 3] : PB[ob + 3]
    const bx = hb ? PB[ob] : PA[oa], by = hb ? PB[ob + 1] : PA[oa + 1], br = hb ? PB[ob + 2] : PA[oa + 2], ba = hb ? PB[ob + 3] : PA[oa + 3]
    const asw = ha ? PA[oa + 4] : 0, aw = ha ? PA[oa + 5] : 0, at = ha ? PA[oa + 6] : (hb ? PB[ob + 6] : 1)
    const bsw = hb ? PB[ob + 4] : 0, bw = hb ? PB[ob + 5] : 0, bt = hb ? PB[ob + 6] : at
    arc0[k] = ax + (bx - ax) * q; arc0[k + 1] = ay + (by - ay) * q; arc0[k + 2] = ar + (br - ar) * q; arc0[k + 3] = aa + angDiff(aa, ba) * q + spin
    arc1[k] = asw + (bsw - asw) * q; arc1[k + 1] = (aw + (bw - aw) * q) * (1 - .25 * flow * Math.sin(Math.PI * q)); arc1[k + 2] = at + (bt - at) * q; arc1[k + 3] = 0
  }
  for (let i = 0; i < 2; i++) {
    const ha = i < a.nc, hb = i < b.nc, oa = i * 6, ob = i * 6, k = i * 4, q = ease(clamp(p * 1.3 - i * .15, 0, 1))
    const ax = ha ? CA[oa] : CB[ob], ay = ha ? CA[oa + 1] : CB[ob + 1], bx = hb ? CB[ob] : CA[oa], by = hb ? CB[ob + 1] : CA[oa + 1]
    const ra = Math.hypot(ax, ay), rb = Math.hypot(bx, by)
    const ta = ra > .02 ? Math.atan2(ay, ax) : Math.atan2(by, bx), tb = rb > .02 ? Math.atan2(by, bx) : ta
    const th = ta + angDiff(ta, tb) * q + flow * Math.sin(Math.PI * q) * 1.6 * (i % 2 ? -1 : 1), rad = ra + (rb - ra) * q
    const aR = ha ? CA[oa + 2] : 0, bR = hb ? CB[ob + 2] : 0, aW = ha ? CA[oa + 3] : (hb ? CB[ob + 3] : 0), bW = hb ? CB[ob + 3] : aW
    const aS = ha ? CA[oa + 4] : (hb ? CB[ob + 4] : 0), bS = hb ? CB[ob + 4] : aS, aT = ha ? CA[oa + 5] : (hb ? CB[ob + 5] : 1), bT = hb ? CB[ob + 5] : aT
    cir0[k] = rad * Math.cos(th); cir0[k + 1] = rad * Math.sin(th); cir0[k + 2] = aR + (bR - aR) * q; cir0[k + 3] = aW + (bW - aW) * q
    cir1[k] = aS + (bS - aS) * q; cir1[k + 1] = aT + (bT - aT) * q; cir1[k + 2] = 0; cir1[k + 3] = 0
  }
}
