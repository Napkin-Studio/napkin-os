// agent-view.js: the agent sphere + ring, round 4. A port of napkin-sphere-engine.js (itself the exact port of
// sphere-ring-v1, frozen 2026-10-29) onto the page's ONE shared WebGL context (scene.js).
//
// Verbatim from the engine: FRAG body / arcCov / cirCov / ripH / ringLayer, STYLE, MATS/MAT_OF, TYPES/TYPE_OF,
// POSE_SPAN, writeStatic, writeMix, the ring and easing maths in render(), the interact() spring, the phase clocks
// (hold 1.5 s, pour 2.4 s), setEnvelope.
// Changed, and only these:
//  1. Geometry for Strategy, Deck and Orchestrator added (verbatim rows of sphere-ring-v1/source/agents.json).
//  2. Shared context: the view draws into its element's box on the scene canvas; time is the scene clock, not
//     performance.now(), so a scripted flow can be fast-forwarded exactly.
//  3. BELONGING LEVEL (the round-4 question). level 0 = v1 exactly. Each level adds one hint taken from Deep O:
//       1 FINISH   the shared matte-satin finish and key light (finish.js), and Deep O's floor shadow. Each agent keeps
//                  its own material (pearl, glass, paper, onyx ...) inside that one finish.
//       2 HORIZON  + one thin (1.5 px) line across the sphere, below centre where the O's horizon sits, ALWAYS in
//                  Napkin's line colour (#515BFF lifted, about #BCBFF5) at 35 %: a sign of belonging, not of the step.
//                  It waves gently while working, lifts for needs-you, falls for error. (Round 4 first cut: a soft
//                  smear in the ring's step colour; the review read it as a lens flare.)
//       3 RING     + the ring's track takes the O's inner-wall tone. Option: ring at the O's proportion
//                  (sphere radius = .60 x ring radius, as the O's window is .60 of the orb).
//  4. ANY SIZE (Napkin Studio, 2026-11-09): opts.ringGap (px between sphere and ring, default 20) and
//     opts.ringScale (ring and track width, default 1), so the same view draws a 26 px bar avatar.
(function (root) {
  'use strict';
  const RAW = [
    { "n": 1, "name": "Brief", "arcs": [[0.0001, 0.0001, 0.7941, 0.5585, 1.2567, 0.0941, 1.0], [0.0003, -0.0002, 0.5588, -2.5488, 0.8382, 0.0471, 0.4]], "circs": [[0.0, 0.0, 0.2353, 0.0588, 0, 1.0]], "role": "Shapes the ask" },
    { "n": 2, "name": "Research", "arcs": [[-0.0001, 0.0, 0.7941, 1.7974, 1.4839, 0.0941, 1.0], [-0.0013, 0.0091, 0.4118, -2.9795, 3.0969, 0.0971, 1.0]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0], [-0.3824, -0.3824, 0.0735, 0.0, 1, 1.0]], "role": "Finds evidence" },
    { "n": 3, "name": "Strategy", "arcs": [[0.0001, 0.0001, 0.7941, 3.0371, 1.71, 0.0941, 1.0], [0.0007, -0.0007, 0.4706, 0.9446, 2.8757, 0.0735, 1.0], [0.0016, -0.0037, 0.2647, -2.7728, 3.2069, 0.0735, 1.0]], "circs": [[0.3824, 0.2941, 0.0882, 0.0353, 0, 1.0]], "role": "Builds territories" },
    { "n": 21, "name": "Deck", "arcs": [[-0.0, -0.0001, 0.7941, 0.2094, 1.2568, 0.0941, 1.0], [-0.0001, -0.0, 0.5588, -2.8971, 0.8379, 0.0471, 0.4]], "circs": [[0.0, 0.0, 0.2353, 0.0588, 0, 1.0]], "role": "Builds pitches" },
    { "n": 30, "name": "Orchestrator", "arcs": [[0.0003, -0.0, 0.7941, -1.2045, 2.1647, 0.0941, 1.0], [0.0, 0.0, 0.4118, 0.2793, 3.1416, 0.0971, 1.0]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0], [0.0, 0.0, 0.0882, 0.0, 1, 1.0]], "role": "Routes the work" },
  ];
  const MATS = {
    pearl:    { base: '#EEECE7', ink: '#16191D', gloss: .70, metal: 0,   glass: 0 },
    graphite: { base: '#242936', ink: '#EEF0F4', gloss: .50, metal: .15, glass: 0 },
    chrome:   { base: '#C9CED8', ink: '#16191D', gloss: 1,   metal: .95, glass: 0 },
    glass:    { base: '#DCE6F2', ink: '#16191D', gloss: 1,   metal: 0,   glass: .85 },
    ceramic:  { base: '#E4DCCF', ink: '#2A2622', gloss: .40, metal: 0,   glass: 0 },
    stone:    { base: '#B9BCC3', ink: '#16191D', gloss: .25, metal: 0,   glass: 0 },
    onyx:     { base: '#12141A', ink: '#F1F2F5', gloss: .95, metal: .25, glass: 0 },
    paper:    { base: '#F7F7F5', ink: '#16191D', gloss: .15, metal: 0,   glass: 0 },
  };
  const MAT_OF = { Brief: 'pearl', Research: 'glass', Strategy: 'graphite', Audience: 'chrome', Culture: 'ceramic', Competitor: 'stone', Idea: 'glass', Concept: 'ceramic',
    Copy: 'paper', 'Art Director': 'onyx', Character: 'ceramic', Storyboard: 'paper', Image: 'chrome', Video: 'onyx', Motion: 'chrome', Voice: 'pearl', Music: 'graphite',
    Edit: 'stone', Adapt: 'pearl', Upscale: 'glass', Deck: 'paper', Compliance: 'stone', Review: 'pearl', Approval: 'paper', Asset: 'graphite', Knowledge: 'onyx',
    Performance: 'stone', Job: 'graphite', Client: 'pearl', Orchestrator: 'onyx' };
  const TYPES = { scan: { wob: [0, .006, 0, .004], breath: .004 }, unfold: { wob: [.012, .014, .006, 0], breath: .022 }, sweep: { wob: [0, .008, .012, .006], breath: .006 },
    hold: { wob: [.003, .002, 0, 0], breath: .004 }, align: { wob: [.005, 0, .005, 0], breath: .008 }, pulse: { wob: [.006, 0, .004, 0], breath: .028 } };
  const TYPE_OF = {};
  for (const n of ['Research', 'Competitor', 'Culture', 'Audience', 'Knowledge']) TYPE_OF[n] = 'scan';
  for (const n of ['Idea', 'Concept', 'Character', 'Strategy', 'Storyboard']) TYPE_OF[n] = 'unfold';
  for (const n of ['Video', 'Motion', 'Image', 'Edit', 'Upscale', 'Adapt']) TYPE_OF[n] = 'sweep';
  for (const n of ['Review', 'Compliance', 'Approval', 'Asset', 'Client']) TYPE_OF[n] = 'hold';
  for (const n of ['Orchestrator', 'Job', 'Performance', 'Art Director']) TYPE_OF[n] = 'align';
  for (const n of ['Brief', 'Copy', 'Deck', 'Voice', 'Music']) TYPE_OF[n] = 'pulse';

  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = x => .5 - .5 * Math.cos(Math.PI * x);
  const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

  const AG = {}, ORDER = [];
  for (const a of RAW) {
    a.key = a.name.toLowerCase();
    const m = MATS[MAT_OF[a.name]];
    a.matName = MAT_OF[a.name];
    a.base = rgb(m.base); a.ink = rgb(m.ink); a.mat = [m.gloss, m.metal, m.glass];
    a.type = TYPE_OF[a.name]; a.t = TYPES[a.type]; a.sp = .8 + ((a.n * 37) % 11) / 20;
    a.arcs.sort((x, y) => y[2] - x[2]); a.circs.sort((x, y) => y[2] - x[2]);
    a.na = a.arcs.length; a.nc = a.circs.length;
    a.arcF = new Float32Array(28); a.arcs.forEach((r, i) => a.arcF.set(r, i * 7));
    a.cirF = new Float32Array(12); a.circs.forEach((r, i) => a.cirF.set(r, i * 6));
    AG[a.key] = a; ORDER.push(a.key);
  }

  const FRAG = () => `
precision highp float;
uniform vec2 uRes, uC, uRC, uDir, uLight; uniform vec4 uWob;
uniform float uDpr, uTime, uR, uBreath, uP, uTw, uSlosh, uRingR, uRT, uSwell, uRipOn, uPingOn;
uniform vec3 uBaseA, uInkA, uMatA, uBaseB, uInkB, uMatB, uAccent, uRingCol, uBg;
uniform vec4 uArc0[4], uArc1[4], uCir0[2], uCir1[2], uRip[4], uRS, uRFx, uRG, uPing;
// round 4: belonging
uniform float uSatin, uHz, uHzY, uHzWave, uHzDrift, uHzWarm, uTrackW, uFade, uDarkBg;
uniform vec3 uTrack, uHzCol;
${root.NapkinFinish.glsl()}
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
vec4 ringLayer(vec2 p){
  vec2 q = p - uRC; float r = length(q), rr = uRingR, band = abs(r - rr);
  if (band > 16. && uPingOn < .5) return vec4(0.);
  float t = fract((atan(q.y, q.x) + 1.5707963) / 6.2831853), circ = 6.2831853 * rr;
  float aa = 1.1, th = uRS.z * .5 + .9 * uSwell;
  float track = 1. - smoothstep(uTrackW, uTrackW + aa, band);
  vec4 o = vec4(uTrack * track, track);
  float u = fract(t - uRG.y) * circ, Lpx = uRG.x * circ;
  float dEnd = u <= Lpx ? 0. : min(u - Lpx, circ - u);
  float dArc = length(vec2(dEnd, band));
  float P = max(uRS.x, 1.), Lg = P * uRS.y, x = mod(u - uRT * uRS.w + P * .5, P) - P * .5;
  float dDash = length(vec2(max(abs(x) - max(Lg * .5 - th, 0.), 0.), band));
  float stroke = 1. - smoothstep(th, th + aa, max(dArc, dDash));
  float f = clamp(u / max(Lpx, 1.), 0., 1.);
  stroke *= mix(1., .28 + .72 * f * f, uRFx.x);
  stroke *= 1. - uRFx.y * (.5 - .5 * sin(u / 40. - uRT * 2.5)) * .6;
  float beat = max(exp(-pow((fract(uRT * .9) - .1) * 7., 2.)), exp(-pow((fract(uRT * .9) - .4) * 7., 2.)));
  stroke *= mix(1., .28 + .72 * beat, uRFx.z);
  float loc = mod(u, 9.) - 4.5, rd = r - rr, inArc = 1. - smoothstep(0., 2., dEnd);
  float tick = (1. - smoothstep(.8, 1.7, abs(loc))) * step(-2., rd) * step(rd, 8.) * pow(1. - fract((rd + 2.) / 10. + uRT * .8), 3.) * inArc;
  stroke = mix(stroke, max(tick, stroke * .3), uRFx.w);
  float brk = 1. - smoothstep(1.6, 2.6, length(vec2(u - Lpx - 24., band)));
  stroke = clamp(stroke + brk * uRG.z, 0., 1.);
  o = vec4(uRingCol * stroke, stroke) + o * (1. - stroke);
  if (uPingOn > .5) {
    for (int i = 0; i < 4; i++) {
      float age = uPing[i];
      if (age >= 0.) { float pa = (1. - smoothstep(.6, 1.6, abs(r - (rr + 6. + age * 55.)))) * exp(-age * 2.4) * .8; o = vec4(uRingCol * pa, pa) + o * (1. - pa); }
    }
  }
  return o;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec4 acc;
  if (uSatin > .5) {
    // Deep O's floor shadow: the object rests on the same stage under the same light
    vec2 sp = (p - uC) / uR - vec2(.10, 1.07);
    float shade = .20 * exp(-pow(length(sp * vec2(1., 6.)) / .70, 2.)) + .06 * exp(-pow(length(sp * vec2(1.6, 4.)) / .98, 2.));
    acc = vec4(0., 0., 0., shade);
  } else {
    float sh = .10 * (1. - smoothstep(-uR * .05, uR * .32, length(p - uC - vec2(0., uR * .22)) - uR));
    acc = vec4(vec3(.08, .10, .20) * sh, sh);
  }
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
    float fres = pow(1. - n.z, 3.);
    vec3 env = mix(vec3(.95, .97, 1.), vec3(.18, .20, .26), smoothstep(-.5, .6, n.y)); env += .25 * smoothstep(.3, 0., abs(n.x + .35));
    vec3 lit; float spec, inkL;
    if (uSatin > .5) {
      // the shared matte satin (finish.js). The material survives as a register inside it:
      // metal keeps a soft studio reflection, glass keeps its see-through body, gloss sets how wide the sheen is.
      vec3 V = vec3(0., 0., 1.);
      lit = nkBody(base, n, V, L, vec3(NK_FILLDIR.x, -NK_FILLDIR.y, NK_FILLDIR.z), 1., 1., uDarkBg);   // y down here
      // A pale material on a dark stage (pearl, paper, ceramic, glass) reads as a flat glaring disc under the
      // matte satin: there it keeps a shaded side and a darker rim, so it stays a sphere (owner, 2026-11-11).
      float pale = uDarkBg * smoothstep(.55, .9, dot(base, vec3(.299, .587, .114)));
      lit *= 1. - pale * (.20 * (1. - nkWrap(n, L)) + .16 * pow(1. - n.z, 1.6) + .05);
      lit = mix(lit, env * mix(base, vec3(1.), .35) * .95, metal * .45);
      vec3 glc = mix(uBg, base, .35) + .14 * nkWrap(n, L);
      lit = mix(lit, glc, glass * (.30 + .35 * n.z));
      lit = mix(lit, base * .8 + uAccent * .10, glass * fres * .55);
      lit += env * fres * NK_ENV * .8;
      lit += edge * .10;
      spec = nkSheen(n, V, L) * mix(.75, 1.35, gloss);
      inkL = .86 + .18 * nkWrap(n, L);
      // the horizon (level 2): a faint line of light below centre, where the O's horizon sits, in the ring's colour
      if (uHz > .001) {
        float y = uv.y - uHzY + uHzWave * .018 * sin(uv.x * 4.2 - uTime * .55);
        float th = .75 / uR;                                   // half of a 1.5 px line, in sphere units
        float line = 1. - smoothstep(th, th + 1. / uR, abs(y));
        float span = smoothstep(.97, .80, length(uv));         // across the face, fading before the silhouette
        lit = mix(lit, uHzCol, clamp(line * span * uHz, 0., .35));
      }
    } else {
      spec = pow(max(dot(n, H), 0.), mix(18., 110., gloss)) * mix(.25, 1.1, gloss);
      lit = base * (.50 + .62 * diff);
      lit = mix(lit, env * mix(base, vec3(1.), .35), metal * .75);
      vec3 glc = mix(uBg, base, .35) + .2 * diff;
      lit = mix(lit, glc, glass * (.35 + .4 * n.z));
      lit = mix(lit, base * .75 + uAccent * .12, glass * fres * .8);
      lit = mix(lit, lit * .84 + vec3(0., .02, .06), fres * .5);
      lit += edge * .12;
      inkL = .88 + .2 * diff;
    }
    float tw = uTw * (1. - smoothstep(0., 1.1, length(uv))), cs = cos(tw), sn = sin(tw);
    // the role mark scales with the sphere: full at avatar size, a subtler mark at stage size
    float big = smoothstep(40., 110., uR), mk = mix(1., .8, big);
    vec2 ug = (vec2(cs * uv.x - sn * uv.y, sn * uv.x + cs * uv.y) + rgrad * .22) / mk;
    float aa = 1.5 / uR / mk; vec2 cov = vec2(0.);
    for (int i = 0; i < 4; i++) cov += arcCov(ug, uArc0[i], uArc1[i], aa);
    for (int i = 0; i < 2; i++) cov += cirCov(ug, uCir0[i], uCir1[i], aa);
    cov = clamp(cov, 0., 1.);
    lit = mix(lit, inkc * inkL, cov.x * mix(.95, .78, big));
    lit = mix(lit, uAccent, cov.y * .95);
    lit += (uSatin > .5 ? nkSheenCol(base) : vec3(1.)) * spec * (1. - .7 * max(cov.x, cov.y));
    float aB = 1. - smoothstep(-.7, .7, d);
    acc = vec4(lit * aB, aB) + acc * (1. - aB);
  }
  gl_FragColor = acc * uFade;
}`;

  const STYLE = {
    work:     [100, 1,   3.5, 0,  0, .35, 0, 0, 0, 70],
    write:    [100, 1,   3.5, 0,  1, 0,   0, 0, 0, 90],
    think:    [7,   .28, 3.2, 6,  0, 0,   0, 0, 0, 40],
    search:   [14,  .57, 3.4, 10, 0, 0,   0, 0, 0, 110],
    read:     [100, 1,   2.2, 0,  0, 0,   0, 1, 0, 60],
    provider: [100, 1,   6.0, 0,  0, .5,  0, 0, 0, 55],
    check:    [100, 1,   2.4, 0,  0, 0,   1, 0, 0, 120],
    human:    [100, 1,   6.5, 0,  0, .6,  0, 0, 0, 25],
    queue:    [24,  .55, 2.4, 4,  0, 0,   0, 0, 0, 18],
    error:    [100, 1,   3.5, 0,  0, 0,   0, 0, 1, 0],
    complete: [100, 1,   4.5, 0,  0, 0,   0, 0, 0, 0],
  };
  const L_MIN = 0;   // after review: no 10 % floor; zero progress is a round start dot
  const STREAM_KINDS = ['think', 'write', 'search', 'read'];
  const K_FIXED = { think: '#7A5AF8', search: '#0A8F9C', read: '#B87100', provider: '#D6336C', check: '#238A55', human: '#E0560C', queue: '#6F757F', error: '#16191D' };
  const ST_FALLBACK = { label: '', kind: 'work', lo: 0, hi: 0 };
  const TRACK_V1 = [.827, .839, .863];
  const WOBK = [.7, .6, .5, .35];

  // level -> the hints it switches on (cumulative)
  const LEVELS = {
    0: { satin: 0, hz: 0, track: 0 },
    1: { satin: 1, hz: 0, track: 0 },
    2: { satin: 1, hz: 1, track: 0 },
    3: { satin: 1, hz: 1, track: 1 },
    4: { satin: 1, hz: 0, track: 1 },   // no horizon line on the agent: satin finish + O-tone ring track only
  };

  function create(scene, el, opts) {
    opts = opts || {};
    const gl = scene.gl;
    const P = gl ? scene.program('sphere', FRAG()) : null;
    const E = { hasEnv: false, steps: [], si: 0, stepStartedAt: 0, polled: -1, streaming: false, errorRetrying: false, forceComplete: false, lastQ: null, pings: new Float32Array(4).fill(-1), pingIx: 0 };
    const PH = { agent: null, next: null, phase: 'run', holdT: 0, ho: 0, arrive: -99, dir: [1, 0], pendingEnv: null };
    const phaseCbs = [];
    const LV = { level: opts.level ?? 0, proportion: !!opts.proportion, hz: 0, hzY: .31, hzWarm: 0, hzWave: 0, drift: -.4, fade: 1, fadeT: 1 };
    let clk = 0;
    function firePhase(phase) { for (const cb of phaseCbs) { try { cb({ phase, agentKey: PH.agent.key, nextAgentKey: PH.next && PH.next !== PH.agent ? PH.next.key : undefined }); } catch (e) { console.error(e); } } }

    const PA = new Float32Array(28), PB = new Float32Array(28), CA = new Float32Array(12), CB = new Float32Array(12);
    const arc0 = new Float32Array(16), arc1 = new Float32Array(16), cir0 = new Float32Array(8), cir1 = new Float32Array(8);
    const v2 = new Float32Array(2), v3 = new Float32Array(3), rip = new Float32Array(16), pingV = new Float32Array(4);
    const rs = new Float32Array(4), rf = new Float32Array(4), rg = new Float32Array(4);
    const wobV = new Float32Array(4), accV = new Float32Array(3), trackV = new Float32Array(TRACK_V1), bgV = new Float32Array(3);
    function rotC(arr, o, x, y, ang) { const c = Math.cos(ang), s = Math.sin(ang); arr[o] = x * c - y * s; arr[o + 1] = x * s + y * c; }
    const POSE_SPAN = (a, t, outA, outC) => {
      outA.set(a.arcF); outC.set(a.cirF);
      const sp = a.sp;
      for (let i = 0; i < a.na; i++) { const o = i * 7;
        switch (a.type) {
          case 'scan': outA[o + 3] += .6 * Math.sin(t * .7 * sp + i * 1.7) * (i % 2 ? -1 : 1); break;
          case 'unfold': outA[o + 4] = Math.min(outA[o + 4] * (1 + .26 * Math.sin(t * .8 * sp + i * 1.1)), 6.2); outA[o + 3] += .14 * Math.sin(t * .4 * sp + i); break;
          case 'sweep': outA[o + 3] += t * sp * (.5 + .35 * i) * (i % 2 ? -1 : 1); break;
          case 'hold': outA[o + 3] += .04 * Math.sin(t * .6 * sp + i); break;
          case 'align': outA[o + 3] += .55 * Math.sin(t * .45 * sp) * (1 - i * .3); break;
          case 'pulse': outA[o + 5] *= 1 + .3 * Math.sin(t * 2.4 * sp + i); outA[o + 4] *= 1 + .08 * Math.sin(t * 2.4 * sp); break;
        } }
      for (let i = 0; i < a.nc; i++) { const o = i * 6, x = outC[o], y = outC[o + 1];
        switch (a.type) {
          case 'scan': rotC(outC, o, x, y, .5 * Math.sin(t * .6 * sp + i)); break;
          case 'unfold': outC[o + 2] *= 1 + .3 * Math.sin(t * .9 * sp + i * 2); break;
          case 'sweep': rotC(outC, o, x, y, t * sp * .6 * (i % 2 ? -1 : 1)); break;
          case 'hold': outC[o + 1] = y + .01 * Math.sin(t * .7 * sp); break;
          case 'align': rotC(outC, o, x, y, .4 * Math.sin(t * .45 * sp)); break;
          case 'pulse': outC[o + 1] = y + .045 * Math.sin(t * 2.4 * sp + i); break;
        } }
    };
    function writeStatic(A, C) {
      for (let i = 0; i < 4; i++) { const o = i * 7, q = i * 4; arc0[q] = A[o]; arc0[q + 1] = A[o + 1]; arc0[q + 2] = A[o + 2]; arc0[q + 3] = A[o + 3];
        arc1[q] = i < 4 ? A[o + 4] : 0; arc1[q + 1] = A[o + 5]; arc1[q + 2] = A[o + 6]; arc1[q + 3] = 0; }
      for (let i = 0; i < 2; i++) { const o = i * 6, q = i * 4; cir0[q] = C[o]; cir0[q + 1] = C[o + 1]; cir0[q + 2] = C[o + 2]; cir0[q + 3] = C[o + 3]; cir1[q] = C[o + 4]; cir1[q + 1] = C[o + 5]; cir1[q + 2] = 0; cir1[q + 3] = 0; }
    }
    function writeMix(a, na, b, nb, p, flow) {
      for (let i = 0; i < 4; i++) {
        const ha = i < na, hb = i < nb, oa = i * 7, ob = i * 7;
        const q = ease(clamp(p * 1.3 - i * .1, 0, 1)), spin = flow * Math.sin(Math.PI * q) * 2.2 * (i % 2 ? -1 : 1), k = i * 4;
        const ax = ha ? PA[oa] : PB[ob], ay = ha ? PA[oa + 1] : PB[ob + 1], ar = ha ? PA[oa + 2] : PB[ob + 2], aa = ha ? PA[oa + 3] : PB[ob + 3];
        const bx = hb ? PB[ob] : PA[oa], by = hb ? PB[ob + 1] : PA[oa + 1], br = hb ? PB[ob + 2] : PA[oa + 2], ba = hb ? PB[ob + 3] : PA[oa + 3];
        const asw = ha ? PA[oa + 4] : 0, aw = ha ? PA[oa + 5] : 0, at = ha ? PA[oa + 6] : (hb ? PB[ob + 6] : 1);
        const bsw = hb ? PB[ob + 4] : 0, bw = hb ? PB[ob + 5] : 0, bt = hb ? PB[ob + 6] : at;
        arc0[k] = ax + (bx - ax) * q; arc0[k + 1] = ay + (by - ay) * q; arc0[k + 2] = ar + (br - ar) * q; arc0[k + 3] = aa + angDiff(aa, ba) * q + spin;
        arc1[k] = asw + (bsw - asw) * q; arc1[k + 1] = (aw + (bw - aw) * q) * (1 - .25 * flow * Math.sin(Math.PI * q)); arc1[k + 2] = at + (bt - at) * q; arc1[k + 3] = 0;
      }
      for (let i = 0; i < 2; i++) {
        const ha = i < a.nc, hb = i < b.nc, oa = i * 6, ob = i * 6, k = i * 4, q = ease(clamp(p * 1.3 - i * .15, 0, 1));
        const ax = ha ? CA[oa] : CB[ob], ay = ha ? CA[oa + 1] : CB[ob + 1], bx = hb ? CB[ob] : CA[oa], by = hb ? CB[ob + 1] : CA[oa + 1];
        const ra = Math.hypot(ax, ay), rb = Math.hypot(bx, by);
        const ta = ra > .02 ? Math.atan2(ay, ax) : Math.atan2(by, bx), tb = rb > .02 ? Math.atan2(by, bx) : ta;
        const th = ta + angDiff(ta, tb) * q + flow * Math.sin(Math.PI * q) * 1.6 * (i % 2 ? -1 : 1), rad = ra + (rb - ra) * q;
        const aR = ha ? CA[oa + 2] : 0, bR = hb ? CB[ob + 2] : 0, aW = ha ? CA[oa + 3] : (hb ? CB[ob + 3] : 0), bW = hb ? CB[ob + 3] : aW;
        const aS = ha ? CA[oa + 4] : (hb ? CB[ob + 4] : 0), bS = hb ? CB[ob + 4] : aS, aT = ha ? CA[oa + 5] : (hb ? CB[ob + 5] : 1), bT = hb ? CB[ob + 5] : aT;
        cir0[k] = rad * Math.cos(th); cir0[k + 1] = rad * Math.sin(th); cir0[k + 2] = aR + (bR - aR) * q; cir0[k + 3] = aW + (bW - aW) * q;
        cir1[k] = aS + (bS - aS) * q; cir1[k + 1] = aT + (bT - aT) * q; cir1[k + 2] = 0; cir1[k + 3] = 0;
      }
    }

    // interaction (template lines 526-546), on the scene clock
    const I = { ox: 0, oy: 0, vx: 0, vy: 0, hov: 0, light: [0, 0], ptr: null, drag: null, rips: [], ripI: 0, cx: 0, cy: 0, R: 100, busy: true, ripOn: 0 };
    const rm = () => scene.motion.reduce;
    const stagePt = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const nearSphere = (q, k) => Math.hypot(q.x - I.cx, q.y - I.cy) < I.R * k;
    const addRipple = (x, y, amp) => { I.rips[I.ripI++ % 4] = { x, y, t0: clk, amp: amp * (rm() ? .4 : 1) }; scene.wake(); };
    if (opts.interactive !== false) {
      el.style.touchAction = 'none';
      el.addEventListener('pointermove', e => { I.ptr = stagePt(e); scene.wake(); });
      el.addEventListener('pointerleave', () => { if (!I.drag) I.ptr = null; scene.wake(); });
      el.addEventListener('pointerdown', e => { const q = stagePt(e); I.ptr = q; if (!nearSphere(q, 1.2)) return; el.setPointerCapture(e.pointerId); I.drag = { sx: q.x, sy: q.y }; addRipple(q.x, q.y, 1); });
      const rel = () => { if (I.drag) { I.drag = null; addRipple(I.cx + I.ox * .3, I.cy + I.oy * .3, .8); } };
      el.addEventListener('pointerup', rel); el.addEventListener('pointercancel', rel);
    }
    function interact(dt, wall) {
      const max = I.R * .22; let tx = 0, ty = 0;
      if (I.drag && I.ptr && !rm()) { tx = (I.ptr.x - I.drag.sx) * .6; ty = (I.ptr.y - I.drag.sy) * .6; const m = Math.hypot(tx, ty); if (m > max) { tx *= max / m; ty *= max / m; } }
      I.vx += (-170 * (I.ox - tx) - 10 * I.vx) * dt; I.vy += (-170 * (I.oy - ty) - 10 * I.vy) * dt; I.ox += I.vx * dt; I.oy += I.vy * dt;
      const near = I.ptr && nearSphere(I.ptr, 1.35); I.hov += ((near ? 1 : 0) - I.hov) * (1 - Math.exp(-dt * 8));
      const hit = I.R * 1.35, lk = 1 - Math.exp(-dt * 6);
      I.light[0] += ((near ? (I.ptr.x - I.cx) / hit * .9 : 0) - I.light[0]) * lk; I.light[1] += ((near ? (I.ptr.y - I.cy) / hit * .9 : 0) - I.light[1]) * lk;
      let alive = 0; for (let i = 0; i < 4; i++) { const r = I.rips[i]; if (r && wall - r.t0 < 3.2) alive = 1; }
      I.ripOn = alive;
    }

    const RING = { v: Float32Array.from(STYLE.work), c: new Float32Array(3), fill: -1, swell: 0, rt: 0, ringR: 150, len: .1, ang: 0 };
    const COLORS = {};
    let accRGB = [.32, .36, 1], accentRing = opts.accent || '#515BFF', accentInk = opts.inkAccent || accentRing, humanCol = opts.human || K_FIXED.human;
    const hzCol = new Float32Array(3);
    // round 4 board: a dark stage. The near-black error ring and the light grey v1 track would vanish or glare on it,
    // so on dark the error ring is a pale grey and the v1 track a faint lift of the stage.
    let darkBg = !!opts.dark;
    function buildColors() { for (const k of Object.keys(STYLE)) COLORS[k] = rgb(k === 'error' && darkBg ? '#C9CDD4' : k === 'human' ? humanCol : (K_FIXED[k] || accentRing)); accRGB = rgb(accentInk);
      // the belonging line: Napkin's own horizon-line tone (deep-o-grammar.js lineColor), never the step's colour
      const a = rgb(accentInk).map(x => x + (1 - x) * .66), V = Math.max(...a), m = Math.min(...a), S = (V - m) / V;
      let c = S > .32 ? a.map(x => V - (V - x) * .32 / S) : a; const V2 = Math.max(...c); if (V2 > .96) c = c.map(x => x * .96 / V2); hzCol.set(c);
      setTrack(); }
    function setTrack() {
      // level 3: the track takes the O's inner-wall tone (Deep O: accent x .30-.62), lifted toward the stage so a
      // 1.5-2 px line stays a quiet track, not a second ring
      const a = rgb(accentRing), bg = rgb(opts.bg || '#F4F5F7');
      const wall = a.map(x => x * .46);
      const t = LV.level >= 3 ? wall.map((x, i) => x + (bg[i] - x) * (darkBg ? .30 : .52)) : darkBg ? bg.map(x => x + (1 - x) * .16) : TRACK_V1;
      trackV[0] = t[0]; trackV[1] = t[1]; trackV[2] = t[2];
      bgV.set(bg);
    }
    const styleFor = kind => (!E.streaming && STREAM_KINDS.includes(kind)) ? 'work' : kind;

    let mt = 0, energy = 1;
    function tickPhase(dt) {
      if (PH.phase === 'handoff') {
        PH.ho += dt / 2.4;
        if (PH.ho >= 1) {
          PH.arrive = clk;
          PH.agent = PH.next; PH.phase = 'run'; PH.ho = 0; PH.holdT = 0;
          if (PH.pendingEnv) { const e = PH.pendingEnv; PH.pendingEnv = null; firePhase('run'); setEnvelope(e); }
          else { E.steps = []; E.si = 0; E.polled = -1; E.forceComplete = false; firePhase('run'); }
        }
        return;
      }
      if (PH.phase === 'hold') {
        PH.holdT += dt;
        if (PH.holdT >= 1.5 && PH.next && PH.next !== PH.agent) {
          PH.phase = 'handoff'; PH.ho = 0;
          const k = PH.agent.n * 2.399 + PH.next.n * 1.7;
          PH.dir[0] = Math.cos(k); PH.dir[1] = Math.sin(k);
          firePhase('handoff');
        }
      }
    }
    function applyEnvFields(env) {
      E.steps = Array.isArray(env.steps) ? env.steps : E.steps;
      E.si = env.step ? env.step.index : (env.phase === 'hold' ? E.steps.length : E.si);
      E.stepStartedAt = env.stepStartedAt || E.stepStartedAt;
      E.polled = typeof env.progress === 'number' ? env.progress : -1;
      E.streaming = !!env.streaming;
      E.errorRetrying = !!env.errorRetrying;
      E.forceComplete = false;
      const q = env.queries;
      if (typeof q === 'number') {
        if (E.lastQ == null) E.lastQ = q;
        else if (q > E.lastQ) { let dq = Math.min(4, q - E.lastQ); while (dq--) E.pings[E.pingIx++ & 3] = 0; E.lastQ = q; }
        else E.lastQ = q;
      }
      view.dirty = true; scene.wake();
    }
    function setEnvelope(env) {
      // no job: idle has no designed look (SPEC 13.8). After review: fade out over ~0.6 s, then draw nothing (it used to pop)
      if (!env) { if (E.hasEnv && PH.agent && !scene.motion.reduce) LV.out = true; else { E.hasEnv = false; PH.agent = null; LV.out = false; } view.dirty = true; scene.wake(); return; }
      LV.out = false;
      const a = AG[String(env.agentKey || '').toLowerCase()];
      if (!a) { console.error('agent-view: unknown agentKey "' + env.agentKey + '"'); return; }
      const b = env.nextAgentKey ? AG[String(env.nextAgentKey).toLowerCase()] : null;
      const first = !E.hasEnv;
      E.hasEnv = true;
      if (first) { LV.fade = opts.fadeIn && !scene.motion.reduce ? 0 : 1; }
      if (PH.phase === 'handoff' && !first) {
        if (a === PH.agent) { applyEnvFields(env); return; }
        PH.pendingEnv = env; return;
      }
      if (env.phase === 'hold') {
        if (PH.agent !== a) { PH.agent = a; PH.arrive = first ? clk : PH.arrive; }
        PH.next = b || a;
        if (PH.phase !== 'hold') { PH.phase = 'hold'; PH.holdT = 0; firePhase('hold'); }
        applyEnvFields(env); return;
      }
      if (env.phase === 'handoff' && b) {
        if (PH.agent !== a) PH.agent = a;
        PH.next = b; PH.phase = 'handoff'; PH.ho = 0;
        const k = PH.agent.n * 2.399 + PH.next.n * 1.7;
        PH.dir[0] = Math.cos(k); PH.dir[1] = Math.sin(k);
        firePhase('handoff'); applyEnvFields(env); return;
      }
      if (PH.agent !== a) {
        PH.agent = a; PH.next = b || a; PH.phase = 'run'; PH.holdT = 0; PH.ho = 0;
        PH.arrive = clk; E.lastQ = null; firePhase('run');
      } else {
        PH.next = b || a;
        if (PH.phase !== 'run') { PH.phase = 'run'; PH.holdT = 0; PH.ho = 0; firePhase('run'); }
      }
      applyEnvFields(env);
    }

    // per-frame numbers, computed in step() and sent in draw()
    const F = { R: 100, cx: 0, cy: 0, p: 0, breath: 1, slosh: 0, tw: 0, dir: PH.dir, pingOn: 0, A: null, B: null, moving: true };
    const DIRV = [1, 0];
    function step(dt, wall, reduce) {
      clk += dt;
      if (!E.hasEnv || !PH.agent) return;
      tickPhase(dt); interact(dt, clk);
      const r = view.rect || el.getBoundingClientRect();
      const W = r.width, H = r.height, flow = reduce ? 0 : 1;
      const A = PH.agent, B = PH.next || A, handoff = PH.phase === 'handoff';
      // reduced motion: no shape pour; the old agent fades out and the new one fades in (crossfade through the stage)
      const p = handoff ? (reduce ? (PH.ho < .5 ? 0 : 1) : ease(clamp(PH.ho, 0, 1))) : 0, bump = reduce ? 0 : Math.sin(Math.PI * p);
      LV.xf = handoff && reduce ? Math.min(1, Math.abs(1 - 2 * PH.ho) * 1.6) : 1;
      const steps = E.steps, nSteps = steps.length;
      const st = nSteps ? steps[Math.min(E.si, nSteps - 1)] : ST_FALLBACK;
      const complete = PH.phase === 'hold' || E.forceComplete, err = E.errorRetrying;
      const eT = (err || st.kind === 'human' && PH.phase === 'run') ? .3 : complete ? .25 : 1;
      energy += (eT - energy) * Math.min(1, dt * 3); if (!reduce) mt += dt * energy;
      const rF = opts.rFrac || [.26, .19];
      let R = Math.min(H * rF[0], W * rF[1]) * (1 + .035 * I.hov);
      const cx = W / 2, cy = H * (opts.cyFrac || .40);
      // level-3 option: the ring at the O's proportion. The ring keeps v1's place (R + 20); the sphere becomes .60 of it
      const prop = LV.level >= 3 && LV.proportion;
      const gap = opts.ringGap ?? 20, ringBase = R + gap;
      if (prop) R = ringBase * .60;
      I.cx = cx; I.cy = cy; I.R = R;
      POSE_SPAN(A, reduce ? 0 : mt, PA, CA);
      if (p > 0) { POSE_SPAN(B, reduce ? 0 : mt, PB, CB); writeMix(A, A.na, B, B.na, p, flow); } else writeStatic(PA, CA);
      const atype = A.t.wob, btype = B.t.wob;
      for (let i = 0; i < 4; i++) wobV[i] = (atype[i] + (btype[i] - atype[i]) * p) * (reduce ? 0 : 1) + flow * .05 * bump * WOBK[i];
      const breath = 1 + (reduce ? 0 : (A.t.breath + (B.t.breath - A.t.breath) * p) * Math.sin(mt * 2.4 * A.sp));
      const settle = reduce ? 0 : Math.exp(-(clk - PH.arrive) * 1.8);
      const off = Math.hypot(I.ox, I.oy), dragOn = off > 1 && p === 0;
      if (dragOn) { DIRV[0] = I.ox / off; DIRV[1] = I.oy / off; }
      F.dir = dragOn ? DIRV : PH.dir;
      F.slosh = reduce ? 0 : flow * .11 * bump * Math.sin(clk * 2.6) + .09 * settle * Math.sin((clk - PH.arrive) * 8) + (dragOn ? off / (R * 1.6) : 0);
      F.tw = flow * 1.6 * bump * (1 + .35 * Math.sin(clk * .9));
      const ek = 1 - Math.exp(-dt * 6);
      const sName = err ? 'error' : complete ? 'complete' : handoff ? 'work' : styleFor(st.kind);
      const T = STYLE[sName] || STYLE.work, tc = COLORS[sName] || COLORS.work;
      const ekS = reduce ? 1 : ek;   // reduced motion: the ring style and colour switch at once, as the mark does
      for (let i = 0; i < 10; i++) RING.v[i] += (T[i] - RING.v[i]) * ekS;
      for (let i = 0; i < 3; i++) RING.c[i] += (tc[i] - RING.c[i]) * ekS;
      const wantFill = (!handoff && !complete && !err && st.kind === 'provider' && E.polled >= 0) ? E.polled : -1;
      RING.fill = wantFill < 0 ? -1 : (RING.fill < 0 ? wantFill : RING.fill + (wantFill - RING.fill) * (1 - Math.exp(-dt * 2.2)));
      RING.swell += (bump - RING.swell) * ek;
      RING.rt += dt * (reduce ? 0 : 1 + 3 * RING.swell);
      // after review: error keeps the real share (the failure shows through colour and the break notch, not a fake 62 %)
      const tgtLen = complete ? 1 : handoff ? (reduce ? (PH.ho < .5 ? 1 : 0) : 1 + (L_MIN - 1) * p) : Math.max(L_MIN, nSteps ? (Math.min(E.si, nSteps) + (RING.fill >= 0 ? clamp(RING.fill / .88, 0, 1) : 0)) / nSteps : 0);
      if (handoff || reduce) RING.len = tgtLen; else RING.len += (tgtLen - RING.len) * (1 - Math.exp(-dt * 3));
      if (!reduce) RING.ang += dt * (RING.v[9] + 180 * RING.swell) / 360;
      const ringPad = R * (Math.abs(wobV[0]) + Math.abs(wobV[1]) + Math.abs(wobV[2]) + Math.abs(wobV[3]) + Math.abs(F.slosh) + Math.max(0, breath - 1));
      RING.ringR = prop ? ringBase + ringPad : R + gap + ringPad;
      let pingOn = 0; for (let i = 0; i < 4; i++) { if (E.pings[i] >= 0) { E.pings[i] += dt * 1.4; if (E.pings[i] > 1.7) E.pings[i] = -1; else pingOn = 1; } pingV[i] = E.pings[i]; }
      if (!E.streaming) pingOn = 0;
      // the horizon (level 2+): state cues borrowed from Deep O, kept small
      const human = st.kind === 'human' && PH.phase === 'run' && !err;
      const hzT = LEVELS[LV.level].hz ? (err ? .6 : 1) : 0;
      const yT = err ? .42 : human ? .20 : complete ? .27 : .31;           // y down, below the centre ring (no line through a 'button'); needs-you lifts it, error lets it fall
      const k2 = 1 - Math.exp(-dt * 2.2);
      LV.hz += (hzT - LV.hz) * (reduce ? 1 : k2); LV.hzY += (yT - LV.hzY) * (reduce ? 1 : k2);
      LV.hzWarm += ((human ? 1 : 0) - LV.hzWarm) * (reduce ? 1 : k2);
      LV.hzWave += ((!reduce && !complete && !err && !human ? 1 : 0) - LV.hzWave) * k2;
      if (!reduce && !complete && !err) LV.drift = -.55 + 1.1 * (.5 - .5 * Math.cos(clk * .21));
      if (LV.out) { LV.fade -= dt / .6; if (LV.fade <= 0) { LV.fade = 0; LV.out = false; E.hasEnv = false; PH.agent = null; view.dirty = true; return; } }
      else LV.fade += (1 - LV.fade) * (reduce ? 1 : 1 - Math.exp(-dt * 3));
      let mv = Math.abs(tgtLen - RING.len) + Math.abs(hzT - LV.hz) + Math.abs(yT - LV.hzY) + (1 - LV.fade) + Math.abs(RING.swell);
      for (let i = 0; i < 10; i++) mv += Math.abs(T[i] - RING.v[i]) * .01;
      for (let i = 0; i < 3; i++) mv += Math.abs(tc[i] - RING.c[i]);
      F.moving = mv > .003 || handoff || PH.phase === 'hold' && PH.holdT < 1.6 || I.ripOn || Math.abs(I.vx) + Math.abs(I.vy) > .05;
      F.R = R; F.cx = cx; F.cy = cy; F.p = p; F.breath = breath; F.pingOn = pingOn; F.A = A; F.B = B;
    }
    function draw(gl, r, dpr, cw, ch, sc) {
      if (!E.hasEnv || !PH.agent || !P) return;
      P.use();
      const ox = r.left, oy = r.top, A = F.A, B = F.B;
      const half = RING.ringR + 70;
      const x0 = Math.max(0, Math.floor((ox + F.cx - half) * dpr)), y0 = Math.max(0, Math.floor(ch - (oy + F.cy + half + F.R * .6) * dpr));
      gl.viewport(0, 0, cw, ch);
      // keep drawing inside the box the sphere, ring and floor shadow can reach (scissor is the stage)
      const bx = x0, by = y0, bw = Math.ceil((2 * half) * dpr), bh = Math.ceil((2 * half + F.R * .6) * dpr);
      const ix = Math.max(bx, sc[0]), iy = Math.max(by, sc[1]), ix2 = Math.min(bx + bw, sc[0] + sc[2]), iy2 = Math.min(by + bh, sc[1] + sc[3]);
      if (ix2 <= ix || iy2 <= iy) return;
      gl.scissor(ix, iy, ix2 - ix, iy2 - iy);
      v2[0] = cw; v2[1] = ch; P.v('uRes', 2, v2); P.f1('uDpr', dpr);
      v2[0] = ox + F.cx + I.ox; v2[1] = oy + F.cy + I.oy; P.v('uC', 2, v2); v2[0] = ox + F.cx; v2[1] = oy + F.cy; P.v('uRC', 2, v2);
      P.f1('uR', F.R); v2[0] = F.dir[0]; v2[1] = F.dir[1]; P.v('uDir', 2, v2); P.v('uWob', 4, wobV);
      P.f1('uTime', mt); P.f1('uBreath', F.breath); P.f1('uP', F.p); P.f1('uTw', F.tw); P.f1('uSlosh', F.slosh);
      P.f1('uRingR', RING.ringR); P.f1('uRT', RING.rt); P.f1('uSwell', RING.swell); P.f1('uPingOn', F.pingOn);
      P.v('uBaseA', 3, A.base); P.v('uInkA', 3, A.ink); P.v('uMatA', 3, A.mat); P.v('uBaseB', 3, B.base); P.v('uInkB', 3, B.ink); P.v('uMatB', 3, B.mat);
      accV[0] = accRGB[0]; accV[1] = accRGB[1]; accV[2] = accRGB[2]; P.v('uAccent', 3, accV); P.v('uRingCol', 3, RING.c); P.v('uBg', 3, bgV);
      P.v('uArc0', 4, arc0); P.v('uArc1', 4, arc1); P.v('uCir0', 4, cir0); P.v('uCir1', 4, cir1);
      for (let i = 0; i < 4; i++) { const rr = I.rips[i], q = i * 4; if (rr) { rip[q] = ox + rr.x; rip[q + 1] = oy + rr.y; rip[q + 2] = clk - rr.t0; rip[q + 3] = rr.amp; } else { rip[q] = 0; rip[q + 1] = 0; rip[q + 2] = -1; rip[q + 3] = 0; } }
      P.v('uRip', 4, rip); P.f1('uRipOn', I.ripOn ? 1 : 0); v2[0] = I.light[0]; v2[1] = I.light[1]; P.v('uLight', 2, v2);
      rs[0] = RING.v[0]; rs[1] = RING.v[1]; rs[2] = RING.v[2] * (opts.ringScale || 1); rs[3] = RING.v[3]; P.v('uRS', 4, rs); rf[0] = RING.v[4]; rf[1] = RING.v[5]; rf[2] = RING.v[6]; rf[3] = RING.v[7]; P.v('uRFx', 4, rf);
      rg[0] = RING.len; rg[1] = RING.ang - Math.floor(RING.ang); rg[2] = RING.v[8]; P.v('uRG', 4, rg); P.v('uPing', 4, pingV);
      const lv = LEVELS[LV.level];
      P.f1('uSatin', lv.satin); P.f1('uHz', LV.hz); P.f1('uHzY', LV.hzY); P.f1('uHzWave', LV.hzWave); P.f1('uHzDrift', LV.drift); P.f1('uHzWarm', LV.hzWarm);
      P.v('uTrack', 3, trackV); P.f1('uTrackW', (lv.track ? 1.0 : .75) * (opts.ringScale || 1)); P.f1('uFade', LV.fade * (LV.xf ?? 1)); P.v('uHzCol', 3, hzCol); P.f1('uDarkBg', darkBg ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    const view = {
      el, group: opts.group, kind: 'agent',
      step, draw,
      visible: () => E.hasEnv && !!PH.agent,
      // with a live envelope the sphere always moves (its temperament); under reduced motion it draws only while something eases
      // done / a settled hold: the temperament motion is tiny there, so 20 fps; reduced motion: 15 fps while something eases
      fps: reduce => (!E.hasEnv || !PH.agent) ? 0 : reduce ? (F.moving || LV.out ? 15 : 0) : LV.out ? 30
        : (PH.phase === 'hold' && PH.holdT > 1.6 && (!PH.next || PH.next === PH.agent)) ? 20 : (view.fpsCap || opts.fps || 60),
      setEnvelope, onPhase(cb) { phaseCbs.push(cb); },
      setComplete() { E.forceComplete = true; view.dirty = true; scene.wake(); },
      setAccent(ring, ink) { accentRing = ring; accentInk = ink || ring; buildColors(); view.dirty = true; scene.wake(); },
      setHuman(hex) { humanCol = hex; buildColors(); view.dirty = true; scene.wake(); },
      // the board's manual controls: a handoff that is still in its hold can be called off (the pour has not started)
      cancelHold() { if (PH.phase === 'hold') { PH.next = PH.agent; } },
      ringAngle: () => RING.ang - Math.floor(RING.ang),
      setBg(hex, dark) { opts.bg = hex; darkBg = !!dark; buildColors(); view.dirty = true; scene.wake(); },
      setLevel(l, proportion) { LV.level = l; if (proportion != null) LV.proportion = !!proportion; setTrack(); view.dirty = true; scene.wake(); },
      get phase() { return PH.phase; }, get agent() { return PH.agent; }, get next() { return PH.next; }, get ho() { return PH.ho; },
      ringR: () => RING.ringR,
      state: () => ({ phase: PH.phase, agent: PH.agent && PH.agent.name, len: RING.len, level: LV.level }),
      reset() { LV.out = false; LV.fade = 1; E.hasEnv = false; PH.agent = null; PH.next = null; PH.phase = 'run'; PH.ho = 0; PH.holdT = 0; PH.pendingEnv = null; RING.len = 0; RING.swell = 0; RING.v.set(STYLE.work); RING.c.set(COLORS.work); E.pings.fill(-1); E.lastQ = null; LV.hz = 0; LV.hzWarm = 0; },
    };
    buildColors(); RING.c.set(COLORS.work);
    return scene.add(view);
  }
  root.NapkinAgents = { create, AG, ORDER, STYLE, K_FIXED, LEVELS, MATS, MAT_OF, TYPE_OF };
})(typeof window !== "undefined" ? window : globalThis);
