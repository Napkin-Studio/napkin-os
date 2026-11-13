// finish.js: the ONE light and finish shared by the Deep O mark and the agent spheres (round 4, after review).
// BOTH shaders paste NapkinFinish.glsl() in and call nkBody / nkSheen, so a number changed here moves the mark
// and every agent together (lib/mark-r4.js shadeSolid, agents/lib/agent-view.js at level >= 1).
//
// Round 3 satin (Deep O):  body = base * (.80 + .24 * key * wrap), sheen = pow(N.H, 16) * .26 + pow(N.H, 5) * .05
// Round 4 "matte satin":   the mark track's numbers (the ones the owner looks at) are now the shared ones:
//                          wide wrap (.55), body .76 + .26 * key * wrap + .06 soft fill from the lower right,
//                          silhouette falloff to .88, sheen a broad, dim lift (no hotspot). Owner: "more flatter".
//                          On a dark page the shadow side drops by DARK_DROP so the orb does not read as a flat disc.
(function (root) {
  'use strict';
  const FINISH = {
    key: [-.45, .62, .64],   // key light, y up (the sphere engine uses the same light with y down)
    fillDir: [.6, -.35, .7], // soft fill from the lower right
    wrap: .55,               // wrap lighting: the shadow side never goes dark (anodised, not lacquer)
    lo: .76, hi: .26,        // body range: base x (lo + hi * key * wrap + fill * fillAmt)
    fill: .06,
    darkDrop: .06,           // dark page: the shadow-side floor falls .76 -> .70
    edge: .88, edgePow: 2.4, // falloff toward the silhouette
    s1: [10, .035],          // narrow-ish sheen, very dim (round 3: 16, .26)
    s2: [4, .03],            // broad lift (round 3: 5, .05)
    env: .05,                // grazing reflection of the studio (round 3: .16)
  };
  const f = x => Number(x).toFixed(4);
  const v = a => `vec3(${a.map(f).join(', ')})`;
  function glsl() {
    return `
// ── shared Napkin finish (finish.js) ──
const float NK_W = ${f(FINISH.wrap)}, NK_LO = ${f(FINISH.lo)}, NK_HI = ${f(FINISH.hi)}, NK_FILL = ${f(FINISH.fill)}, NK_DROP = ${f(FINISH.darkDrop)};
const float NK_EDGE = ${f(FINISH.edge)}, NK_EDGEP = ${f(FINISH.edgePow)};
const float NK_S1E = ${f(FINISH.s1[0])}, NK_S1A = ${f(FINISH.s1[1])}, NK_S2E = ${f(FINISH.s2[0])}, NK_S2A = ${f(FINISH.s2[1])}, NK_ENV = ${f(FINISH.env)};
float nkWrap(vec3 n, vec3 L){ return clamp((dot(n, L) + NK_W) / (1. + NK_W), 0., 1.); }
// light multiplier for a base colour. key = room light 0..1, sh = shadowing 0..1, dark = 1 on a dark page
float nkLift(vec3 n, vec3 v, vec3 L, vec3 F, float key, float sh, float dark){
  float nv = clamp(dot(n, v), 0., 1.);
  float fill = clamp(dot(n, normalize(F)), 0., 1.);
  float w = nkWrap(n, L) * sh;
  float lo = NK_LO - NK_DROP * dark * (1. - w);
  return (lo + NK_HI * key * w + NK_FILL * fill) * mix(1., NK_EDGE, pow(1. - nv, NK_EDGEP));
}
vec3 nkBody(vec3 base, vec3 n, vec3 v, vec3 L, vec3 F, float key, float sh, float dark){ return base * nkLift(n, v, L, F, key, sh, dark); }
float nkSheen(vec3 n, vec3 v, vec3 L){ float nh = max(dot(n, normalize(L + v)), 0.); return pow(nh, NK_S1E) * NK_S1A + pow(nh, NK_S2E) * NK_S2A; }
vec3 nkSheenCol(vec3 base){ return mix(vec3(1.), base, .5); }
const vec3 NK_FILLDIR = ${v(FINISH.fillDir)};
`;
  }
  root.NapkinFinish = { FINISH, glsl };
})(typeof window !== 'undefined' ? window : globalThis);
