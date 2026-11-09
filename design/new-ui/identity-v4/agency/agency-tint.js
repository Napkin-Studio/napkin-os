// agency-tint.js: where an agency's accent lives on the Deep O mark, while the body stays house blue.
// Round 4, track "subtle agency colour" (owner feedback 7). Portable: no dependencies, works in a page or in Node.
//
// The rule this file implements: ALL colour judgement happens here, in JS, once per agency. The shader only MIXES.
// Every slot gets a "banded" colour: the agency's hue kept, its lightness clamped into the band that slot needs and
// its chroma capped, in OKLab. So yellow never turns the horizon into a white streak, red never makes a dark line,
// and black / white agencies (no hue) fall back to a tone, never to a broken colour.
//
// To port into the mark track's shader:
//   1. paste AgencyTint.GLSL into the fragment shader (it declares the uniforms and four helpers);
//   2. call agencyLine(), agencySky(), agencySea(), agencyWall() where the shader used the accent for those parts,
//      and agencyRim(col, edgePx) as the last step before output (silhouette hairline, option c′);
//   3. each time the agency, option or theme changes: AgencyTint.apply(setVec3, setVec4, setFloat, AgencyTint.uniforms(hex, option)).
//   The uniforms (all clearly named, all sRGB 0..1):
//     uHouse        vec3   the house accent (#515BFF). The body is always this.
//     uHouseLine    vec3   house colour banded for the horizon line / inner light (used when the agency weight is 0)
//     uHouseSky     vec3   house colour banded for the sky
//     uHouseWall    vec3   house colour for the inner wall
//     uAgencyLine   vec3   agency colour banded for the horizon line and the inner light
//     uAgencySky    vec3   agency colour banded for the sky (and the sea, darker, in option d)
//     uAgencyWall   vec3   agency colour banded for the inner wall
//     uAgencyRim    vec3   agency colour for the silhouette hairline
//     uAgencyW      vec4   weights 0..1: x line + inner light, y sky, z wall, w rim
//     uAgencySea    float  weight 0..1 for below the horizon (option d only)
//     uAgencyRimPx  float  hairline width in device px (0 = off)
(function (root) {
  'use strict';
  const HOUSE = '#515BFF';

  // ---------- OKLab ----------
  const s2l = v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
  const l2s = v => v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055;
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const hex = a => '#' + a.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
  function toOK(h) {
    const [r, g, b] = rgb(h).map(s2l);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    const L = .2104542553 * l + .7936177850 * m - .0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
    return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
  }
  function fromOK(L, C, h) {
    const A = C * Math.cos(h), B = C * Math.sin(h);
    const l = (L + .3963377774 * A + .2158037573 * B) ** 3, m = (L - .1055613458 * A - .0638541728 * B) ** 3, s = (L - .0894841775 * A - 1.2914855480 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
  }
  const inGamut = c => c.every(v => v >= -1e-4 && v <= 1 + 1e-4);
  // keep hue, clamp lightness to [lo, hi], cap chroma, then reduce chroma until it fits sRGB. Returns sRGB 0..1.
  function band(h, lo, hi, cmax) {
    const o = toOK(h); const L = Math.min(hi, Math.max(lo, o.L)); let C = Math.min(o.C, cmax);
    let c = fromOK(L, C, o.h); for (let i = 0; i < 40 && !inGamut(c); i++) { C *= .93; c = fromOK(L, C, o.h); }
    return c.map(v => l2s(Math.max(0, Math.min(1, v))));
  }
  const isNeutral = h => toOK(h).C < .03;
  const okLab = c => { const [r, g, b] = c.map(s2l);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b), s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s]; };
  // OKLab distance x 100 (a "Delta E" on the OKLab scale) between two sRGB 0..1 colours
  const deltaE = (a, b) => { const A = okLab(a), B = okLab(b); return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

  // ---------- the horizon line tone (round 4, after review) ----------
  // The line carries COLOUR, never brightness of its own: HSV saturation <= LINE.sat, value <= LINE.val, so the shader's
  // light can never clip it to a white streak. Very dark agency colours (OKLab L < LINE.darkL) keep their own darkest
  // readable tone (a graphite or deep line on the pale sky), never white.
  const LINE = { sat: .45, val: .88, darkL: .35, darkBand: [.40, .44, .09], minDE: 10, minHue: 40 };
  function capSV(c, smax, vmax) {
    let V = Math.max(...c), m = Math.min(...c), S = V > 0 ? (V - m) / V : 0;
    if (S > smax) c = c.map(x => V - (V - x) * smax / S);
    V = Math.max(...c); if (V > vmax) c = c.map(x => x * vmax / V);
    return c;
  }
  // the house line: #515BFF lifted 66 % toward white, saturation <= .32, value <= .96 (about #BCBFF5): a light, coloured line
  const houseLineTone = h => capSV(rgb(h).map(x => x + (1 - x) * .66), .32, .96);
  function lineTone(h) {
    const o = toOK(h);
    if (o.L < LINE.darkL) return capSV(band(h, ...LINE.darkBand), .45, .86);
    return capSV(band(h, ...BANDS.line), LINE.sat, LINE.val);
  }

  // ---------- slot bands (OKLab L range, chroma cap) ----------
  // line: a light, coloured horizon (never white), sky: a mid, calm sky, wall: the shaded inside, rim: a hairline.
  const BANDS = {
    line: [.80, .90, .14], sky: [.60, .74, .11], wall: [.20, .82, .17], rim: [.30, .86, .20],
    viewLine: [.80, .90, .08], viewSky: [.62, .74, .065],   // option d: the whole view, but muted (it is the biggest area)
  };

  // ---------- the options ----------
  const OPTIONS = {
    none:  { name: 'House only', short: 'house', w: [0, 0, 0, 0], sea: 0, rim: 0, note: 'No agency colour. The reference.' },
    a:     { name: '(a) Horizon line and inner light', short: 'line', w: [1, 0, 0, 0], sea: 0, rim: 0,
             note: 'The agency colour is the colour of the far light: the horizon line, its glow, and the light it throws on the lip and the inside of the window.' },
    b:     { name: '(b) Inner sky only', short: 'sky', w: [0, 1, 0, 0], sea: 0, rim: 0,
             note: 'The sky above the horizon takes the agency colour. The line and the sea stay house.' },
    c:     { name: '(c) Inner wall only', short: 'wall', w: [0, 0, 1, 0], sea: 0, rim: 0,
             note: 'The inside of the window is the agency colour: the crescent at the upper right. The view stays house.' },
    c2:    { name: '(c′) Hairline rim only', short: 'rim', w: [0, 0, 0, 1], sea: 0, rim: 1,
             note: 'A hairline round the silhouette in the agency colour.' },
    rec:   { name: 'Recommended: the line only; (c) wall at ≤ 24 px', short: 'rec', w: [1, 0, 0, 0], inner: 0, sea: 0, rim: 0, smallWall: true,
             note: 'Only the horizon line takes the agency colour (muted: saturation ≤ .45, brightness ≤ .88). The inner light stays Napkin. At 24 px and below, where the line is dropped, the agency moves to the inner-wall crescent, mixed half-way to Napkin. When the agency line would be too close to Napkin\'s own line (ΔE < 10, or a hue within 40°, e.g. purple or another blue), the crescent carries it at every size.' },
    ac:    { name: '(a) + (c) together', short: 'line+wall', w: [1, 0, 1, 0], sea: 0, rim: 0,
             note: 'The horizon line and the inner wall both take the agency colour, at every size.' },
    d:     { name: '(d) Their view, muted', short: 'view', w: [1, 1, 0, 0], sea: 1, rim: 0, view: true,
             note: 'Our window, their view. The whole pane (sky, line, sea) is the agency colour at low chroma; the body, wall and lip stay house.' },
  };

  function uniforms(agencyHex, option = 'a', o = {}) {
    const opt = OPTIONS[option] || OPTIONS.none, house = o.house || HOUSE;
    const ag = agencyHex || house;
    const LB = opt.view ? BANDS.viewLine : BANDS.line, SB = opt.view ? BANDS.viewSky : BANDS.sky;
    const rimPx = opt.rim ? (o.rimPx ?? 1.25) : 0;
    const houseLine = houseLineTone(house), agLine = opt.view ? capSV(band(ag, ...LB), LINE.sat, LINE.val) : lineTone(ag);
    let w = opt.w.slice(), placed = w[0] ? 'line' : '';
    const dE = deltaE(agLine, houseLine);
    // the recommendation: an agency line that reads as Napkin's own line is no agency colour at all -> the wall crescent carries it
    // "too close" = within LINE.minDE, or a hue within LINE.minHue degrees of Napkin's (purple, a blue): the line would read as ours
    const hA = toOK(hex(agLine)), hH = toOK(hex(houseLine));
    let dH = Math.abs(hA.h - hH.h) * 180 / Math.PI; if (dH > 180) dH = 360 - dH;
    const close = dE < LINE.minDE || (!isNeutral(ag) && hA.C > .02 && dH < LINE.minHue && dE < 25);   // a dark navy line differs by lightness: it stays a line
    if (option === 'rec' && ag.toLowerCase() !== house.toLowerCase() && close) { w = [0, 0, 1, 0]; placed = 'wall'; }
    return {
      uHouse: rgb(house),
      uHouseLine: houseLine, uHouseSky: band(house, ...BANDS.sky), uHouseWall: band(house, .20, .82, .30),
      uAgencyLine: agLine, uAgencySky: band(ag, ...SB), uAgencyWall: band(ag, ...BANDS.wall), uAgencyRim: band(ag, ...BANDS.rim),
      uAgencyW: w, uAgencyInner: placed === 'wall' ? 0 : (opt.inner ?? w[0]), uAgencySea: opt.sea, uAgencyRimPx: rimPx,
      placed, dE, dH,
    };
  }
  // hand the uniforms to any GL wrapper: setVec3(name, [r,g,b]), setVec4(name, [x,y,z,w]), setFloat(name, v)
  function apply(v3, v4, f1, U) {
    for (const k of ['uHouse', 'uHouseLine', 'uHouseSky', 'uHouseWall', 'uAgencyLine', 'uAgencySky', 'uAgencyWall', 'uAgencyRim']) v3(k, U[k]);
    v4('uAgencyW', U.uAgencyW); f1('uAgencyInner', U.uAgencyInner); f1('uAgencySea', U.uAgencySea); f1('uAgencyRimPx', U.uAgencyRimPx);
  }

  // ---------- GLSL: declarations + mixers. Paste once into the fragment shader. ----------
  const GLSL = `
// ---- agency tint (agency-tint.js). The JS bands every colour; the shader only mixes. ----
uniform vec3 uHouse, uHouseLine, uHouseSky, uHouseWall;
uniform vec3 uAgencyLine, uAgencySky, uAgencyWall, uAgencyRim;
uniform vec4 uAgencyW;        // x line + inner light, y sky, z wall, w rim
uniform float uAgencySea, uAgencyRimPx, uAgencyInner;   // inner light weight (0 in the recommendation)
vec3 agencyLine(){ return mix(uHouseLine, uAgencyLine, uAgencyW.x); }
vec3 agencySky(){  return mix(uHouseSky,  uAgencySky,  uAgencyW.y); }
vec3 agencySea(){  return mix(uHouseSky,  uAgencySky,  uAgencySea) * .42; }
vec3 agencyWall(){ return mix(uHouseWall, uAgencyWall, uAgencyW.z); }
// edgePx: distance inside the silhouette in device px. Call last.
vec3 agencyRim(vec3 col, float edgePx){
  if (uAgencyRimPx <= 0.) return col;
  return mix(col, uAgencyRim, uAgencyW.w * (1. - smoothstep(uAgencyRimPx - .6, uAgencyRimPx + .5, edgePx)));
}
`;

  // ---------- the small sizes (<= 47 px): flat vectors, same reduced geometry as deep-o-grammar.js ----------
  // At <= 24 px there is no horizon line (it read as a minus sign), so option (a) can only survive as a faint
  // tint of the pane. That is reported, not hidden.
  let N = 0;
  function smallSVG(size, agencyHex, option, bg, DeepO) {
    const U = uniforms(agencyHex, option), opt = OPTIONS[option] || OPTIONS.none, small = size <= 24;
    const G = DeepO.GEO, SM = DeepO.SMALL;
    const R = small ? DeepO.reduced([G.FACE[0] * SM.EX, G.FACE[1] * SM.EX], SM) : DeepO.reduced(G.FACE);
    const K = 48, path = pts => 'M' + pts.map(p => (p[0] * K).toFixed(2) + ' ' + (p[1] * K).toFixed(2)).join('L') + 'Z';
    const mixA = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    const shell = hex(U.uHouse);
    const agWall = opt.w[2] || (opt.smallWall && small);
    const wall = agWall ? hex(mixA(U.uAgencyWall, [0, 0, 0], .25)) : hex(mixA(U.uHouse, [.043, .047, .063], .58));
    // pane at small sizes: the sky's colour lifted toward the line (the view seen as one flat tone)
    let paneSrc = mixA(U.uHouseSky, U.uHouseLine, .5);
    if (option === 'b') paneSrc = mixA(U.uAgencySky, U.uHouseLine, .35);
    if (option === 'd') paneSrc = mixA(U.uAgencySky, U.uAgencyLine, .5);
    if (option === 'a' || option === 'ac' || (option === 'rec' && !small)) paneSrc = mixA(paneSrc, U.uAgencyLine, small ? .45 : .25);
    const pane = hex(paneSrc);
    const id = 'aT' + (++N), top = R.top * K, bot = R.bot * K, hz = (top + bot) / 2 + (bot - top) * .1;
    const line = !small ? `<g clip-path="url(#${id}f)"><rect x="-50" y="${(hz - 1.6).toFixed(2)}" width="100" height="3.2" fill="${hex(opt.w[0] ? U.uAgencyLine : U.uHouseLine)}"/>` +
      `<rect x="-50" y="${(hz + 1.6).toFixed(2)}" width="100" height="60" fill="${hex(mixA(opt.sea ? U.uAgencySky : U.uHouseSky, [0, 0, 0], .5))}"/></g>` : '';
    const rimW = 100 / size * 1.0;
    const rim = opt.rim ? `<circle r="${(48 - rimW / 2).toFixed(2)}" fill="none" stroke="${hex(U.uAgencyRim)}" stroke-width="${rimW.toFixed(2)}"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="${size}" height="${size}"><defs><clipPath id="${id}c"><path d="${path(R.m)}"/></clipPath><clipPath id="${id}f"><path d="${path(R.fl)}"/></clipPath></defs>` +
      `<circle r="48" fill="${shell}"/>${rim}<path d="${path(R.m)}" fill="${wall}"/><g clip-path="url(#${id}c)"><path d="${path(R.fl)}" fill="${pane}"/>${line}</g></svg>`;
  }

  root.AgencyTint = { HOUSE, OPTIONS, BANDS, LINE, uniforms, apply, GLSL, smallSVG, band, toOK, isNeutral, hex, rgb, lineTone, houseLineTone, capSV, deltaE };
})(typeof window !== 'undefined' ? window : globalThis);
