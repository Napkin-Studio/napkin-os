// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Shrey's sphere + ring shader, as the Deck Maker template carries it
// (app/templates/deck-maker/index.html, the `Orbs` block). Do NOT edit the text:
// app/tests/orbsDrift.test.ts compares it with the template and fails on any
// difference except the one marked `PORT` (the cheap circle shadow is switched
// off, because the landing's circles are controls and design system v0.4 says
// controls are flat). features/landing-circles.clan, phase 4.

export const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }'

export const FRAG = `
precision highp float;
uniform vec2 uRes, uC, uRC, uDir, uLight; uniform vec4 uWob;
uniform float uDpr, uTime, uR, uBreath, uP, uTw, uSlosh, uRingR, uRT, uSwell, uRipOn, uPingOn;
uniform vec3 uBaseA, uInkA, uMatA, uBaseB, uInkB, uMatB, uAccent, uRingCol, uBg, uTrack;   // PORT: + uTrack
uniform vec4 uArc0[4], uArc1[4], uCir0[2], uCir1[2], uRip[4], uRS, uRFx, uRG, uPing;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y); }

float ripH(vec2 p){
  float h = 0.;
  for (int i = 0; i < 4; i++) {
    float age = uRip[i].z;
    if (age >= 0. && uRip[i].w > .001) {
      float d = length(p - uRip[i].xy), front = age * uR * 1.4, x = (d - front) / (uR * .55);
      h += exp(-age * 1.7) * uRip[i].w * exp(-x * x) * cos((d - front) / (uR * .13));
    }
  }
  return h;
}
float body(vec2 p){
  vec2 q = p - uC;
  float qd = dot(q, uDir), qp = dot(q, vec2(-uDir.y, uDir.x));
  vec2 qq = vec2(qd / (1. + uSlosh), qp * (1. + uSlosh * .5));
  float ang = atan(qq.y, qq.x);
  float w = uWob.x * sin(2. * ang + uTime * .9) + uWob.y * sin(3. * ang - uTime * 1.3 + 1.) + uWob.z * sin(4. * ang + uTime * 1.7 + 2.) + uWob.w * sin(5. * ang - uTime * 2.1 + .5);
  float d = length(qq) - uR * uBreath * (1. + w);
  if (uRipOn > .5) d -= uR * .06 * ripH(p);
  return d;
}
vec2 arcCov(vec2 u, vec4 A, vec4 B, float aa){
  if (B.y < .001) return vec2(0.);
  vec2 q = u - A.xy; float d = length(q);
  float rel = mod(atan(q.y, q.x) - A.w, 6.2831853), w = B.y * .5, dist;
  if (rel <= B.x) dist = abs(d - A.z);
  else { vec2 e0 = A.xy + A.z * vec2(cos(A.w), sin(A.w)), e1 = A.xy + A.z * vec2(cos(A.w + B.x), sin(A.w + B.x)); dist = min(length(u - e0), length(u - e1)); }
  float c = 1. - smoothstep(w - aa, w + aa, dist);
  return B.z > 1.5 ? vec2(0., c) : vec2(c * B.z, 0.);
}
vec2 cirCov(vec2 u, vec4 C0, vec4 C1, float aa){
  if (C0.z < .001) return vec2(0.);
  float d = length(u - C0.xy);
  float c = C1.x > .5 ? 1. - smoothstep(C0.z - aa, C0.z + aa, d) : 1. - smoothstep(C0.w * .5 - aa, C0.w * .5 + aa, abs(d - C0.z));
  return C1.y > 1.5 ? vec2(0., c) : vec2(c * C1.y, 0.);
}

// The ring: a travelling arc. It turns (uRG.y is where its tail is), its LENGTH is how complete the run is (uRG.x, in turns),
// and its look is a set of numbers that ease from step to step: texture (dash period and duty), breadth (thickness), colour.
// uRS = (dash period px, duty 0-1, breadth px, scroll px/s). uRFx = (head glow, shimmer, two-beat, ticks flowing in). uRG = (length, tail, broken flag).
vec4 ringLayer(vec2 p){
  vec2 q = p - uRC; float r = length(q), rr = uRingR, band = abs(r - rr);
  if (band > 16. && uPingOn < .5) return vec4(0.);
  float t = fract((atan(q.y, q.x) + 1.5707963) / 6.2831853), circ = 6.2831853 * rr;
  float aa = 1.1, th = uRS.z * .5 + .9 * uSwell;
  vec3 neutral = uTrack;   // PORT: was vec3(.827, .839, .863), the light track; a uniform so the dark theme works
  float track = 1. - smoothstep(.75, .75 + aa, band);
  vec4 o = vec4(neutral * track, track);
  float u = fract(t - uRG.y) * circ, Lpx = uRG.x * circ;                                           // u: distance along the ring from the arc's tail
  float dEnd = u <= Lpx ? 0. : min(u - Lpx, circ - u);
  float dArc = length(vec2(dEnd, band));                                                            // a capsule: round ends
  float P = max(uRS.x, 1.), Lg = P * uRS.y, x = mod(u - uRT * uRS.w + P * .5, P) - P * .5;
  float dDash = length(vec2(max(abs(x) - max(Lg * .5 - th, 0.), 0.), band));                        // the texture, flowing along the arc
  float stroke = 1. - smoothstep(th, th + aa, max(dArc, dDash));
  float f = clamp(u / max(Lpx, 1.), 0., 1.);                                                       // 0 at the tail, 1 at the head
  stroke *= mix(1., .28 + .72 * f * f, uRFx.x);                                                    // writing: the head glows, the tail fades
  stroke *= 1. - uRFx.y * (.5 - .5 * sin(u / 40. - uRT * 2.5)) * .6;                               // shimmer
  float beat = max(exp(-pow((fract(uRT * .9) - .1) * 7., 2.)), exp(-pow((fract(uRT * .9) - .4) * 7., 2.)));
  stroke *= mix(1., .28 + .72 * beat, uRFx.z);                                                     // checking: two ticks
  float loc = mod(u, 9.) - 4.5, rd = r - rr, inArc = 1. - smoothstep(0., 2., dEnd);
  float tick = (1. - smoothstep(.8, 1.7, abs(loc))) * step(-2., rd) * step(rd, 8.) * pow(1. - fract((rd + 2.) / 10. + uRT * .8), 3.) * inArc;
  stroke = mix(stroke, max(tick, stroke * .3), uRFx.w);                                            // reading: ticks flowing in
  float brk = 1. - smoothstep(1.6, 2.6, length(vec2(u - Lpx - 24., band)));
  stroke = clamp(stroke + brk * uRG.z, 0., 1.);                                                    // error: a dot beyond the broken arc
  o = vec4(uRingCol * stroke, stroke) + o * (1. - stroke);
  if (uPingOn > .5) {                                                                                // search pings: rings that leave, one per query
    for (int i = 0; i < 4; i++) {
      float age = uPing[i];
      if (age >= 0.) { float pa = (1. - smoothstep(.6, 1.6, abs(r - (rr + 6. + age * 55.)))) * exp(-age * 2.4) * .8; o = vec4(uRingCol * pa, pa) + o * (1. - pa); }
    }
  }
  return o;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float sh = .0 /* PORT: shadow off, controls are flat */ * (1. - smoothstep(-uR * .05, uR * .32, length(p - uC - vec2(0., uR * .22)) - uR));   // a cheap circle shadow
  vec4 acc = vec4(vec3(.08, .10, .20) * sh, sh);
  vec4 rg = ringLayer(p); acc = rg + acc * (1. - rg.a);

  float d = body(p);
  if (d < 1.5) {
    vec2 uv = (p - uC) / uR;
    float t = clamp(-d / uR, 0., 1.);
    vec2 g = vec2(body(p + vec2(1., 0.)) - body(p - vec2(1., 0.)), body(p + vec2(0., 1.)) - body(p - vec2(0., 1.)));
    vec2 gd = g / max(length(g), 1e-4);
    float rim = 1. - t;
    vec3 n = normalize(vec3(gd * rim, sqrt(max(1. - rim * rim, .02))));
    vec2 rgrad = vec2(0.);
    if (uRipOn > .5) {
      float re = uR * .017;
      rgrad = vec2(ripH(p + vec2(re, 0.)) - ripH(p - vec2(re, 0.)), ripH(p + vec2(0., re)) - ripH(p - vec2(0., re)));
      n = normalize(n + vec3(-rgrad * 2.8, 0.));
    }
    float s = dot(uv, uDir) * .5 + .5 + .55 * (vnoise(uv * 2.1 + vec2(uTime * .22, -uTime * .17)) - .5);
    float f = -.7 + 2.4 * uP, m = 1. - smoothstep(f - .2, f + .2, s);
    float edge = exp(-pow((s - f) / .07, 2.)) * sin(3.14159 * uP);
    vec3 base = mix(uBaseA, uBaseB, m), inkc = mix(uInkA, uInkB, m), mat = mix(uMatA, uMatB, m);
    float gloss = mat.x, metal = mat.y, glass = mat.z;
    vec3 L = normalize(vec3(-.45 + uLight.x, -.62 + uLight.y, .64));
    float diff = clamp(dot(n, L), 0., 1.);
    vec3 H = normalize(L + vec3(0., 0., 1.));
    float spec = pow(max(dot(n, H), 0.), mix(18., 110., gloss)) * mix(.25, 1.1, gloss), fres = pow(1. - n.z, 3.);
    vec3 lit = base * (.50 + .62 * diff);
    vec3 env = mix(vec3(.95, .97, 1.), vec3(.18, .20, .26), smoothstep(-.5, .6, n.y)); env += .25 * smoothstep(.3, 0., abs(n.x + .35));
    lit = mix(lit, env * mix(base, vec3(1.), .35), metal * .75);
    vec3 gl = mix(uBg, base, .35) + .2 * diff;
    lit = mix(lit, gl, glass * (.35 + .4 * n.z));
    lit = mix(lit, base * .75 + uAccent * .12, glass * fres * .8);
    lit = mix(lit, lit * .84 + vec3(0., .02, .06), fres * .5);
    lit += edge * .12;
    float tw = uTw * (1. - smoothstep(0., 1.1, length(uv))), cs = cos(tw), sn = sin(tw);
    vec2 ug = vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y) + rgrad * .22;
    float aa = 1.5 / uR; vec2 cov = vec2(0.);
    for (int i = 0; i < 4; i++) cov += arcCov(ug, uArc0[i], uArc1[i], aa);
    for (int i = 0; i < 2; i++) cov += cirCov(ug, uCir0[i], uCir1[i], aa);
    cov = clamp(cov, 0., 1.);
    lit = mix(lit, inkc * (.88 + .2 * diff), cov.x * .95);
    lit = mix(lit, uAccent, cov.y * .95);
    lit += spec * (1. - .7 * max(cov.x, cov.y));
    float aB = 1. - smoothstep(-.7, .7, d);
    acc = vec4(lit * aB, aB) + acc * (1. - aB);
  }
  gl_FragColor = acc;
}`;
