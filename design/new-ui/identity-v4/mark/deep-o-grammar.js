// deep-o-grammar.js (round 4, mark polish): the ONE copy of Deep O's state grammar, geometry and reductions.
// Round 4 changes: a coloured horizon line (no white streak), an AWAKE wave (WAVE), a calmer needs-you
// (steady arc, breathing halo, champagne line), awake at 15 fps for the wave. The <= 24 px cut is unchanged.
// Used by the shader page (concepts/deep-o.html), the board's live 18 px vector and favicon (index.html),
// and the static-frame set. Change a number here and every rendering of the mark follows.
//
// Contract (mirrors napkin-sphere-engine.js setEnvelope): the HOST owns state. The model never changes
// state by itself (no auto done -> awake, no auto handoff -> working). It only eases toward what it was told.
//   model.set({ state, agent, progress, kind })    progress = steps done / steps, from real step events only
//   model.handoff(toAgent)                         hold 1.5 s + glide 2.4 s = 3.9 s, the agent engine's timing
//   model.step(dt, reducedMotion) -> params        eased numbers for the shader and the vectors
//   model.fpsCap()                                 frames per second this moment needs (0 = draw nothing)
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  // geometry: window radius, pane (floor) depth in local z, resting pose (window faces up and right)
  const GEO = { RH: .6, ZF: .30, FACE: [.15, .15] };
  GEO.ZM = Math.sqrt(1 - GEO.RH * GEO.RH);
  // small-size hint (<= 24 px): a slightly smaller, deeper window and a little more turn, so the inner-wall
  // crescent is >= 3 px at 16 px and the band at the thin side stays >= 1.5 px. Same object, hinted.
  const SMALL = { RH: .50, ZF: -.40, EX: 1.25 };
  const TIMING = { hold: 1.5, glide: 2.4, swell: 1.2 };      // handoff = 3.9 s, as the agent sphere (1.5 s hold + 2.4 s pour)
  // after review: no 10 % floor. Zero progress draws a zero-length arc, which the shader shows as a round start dot.
  const L_MIN = 0;

  // state targets. key = room light, glow = light from beyond, night, sat, lift = horizon height in the pane,
  // warm, arcOn, fx/fy = pose offset, hw = arc half-width (lip units)
  const STATES = {
    // wave = how much the horizon line undulates (awake only: the sign that it is awake)
    sleep:   { key: .34, glow: .16, night: 1,   sat: 1,   lift: -.10, warm: 0, arcOn: 0, fx: -.03,  fy: -.05,  hw: .050, wave: 0 },
    awake:   { key: 1,   glow: .62, night: 0,   sat: 1,   lift: 0,    warm: 0, arcOn: 0, fx: 0,     fy: 0,     hw: .050, wave: 1 },
    working: { key: 1,   glow: 1.1, night: 0,   sat: 1,   lift: .03,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
    handoff: { key: 1,   glow: 1.0, night: 0,   sat: 1,   lift: .03,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
    done:    { key: 1,   glow: 1.05, night: 0,  sat: 1,   lift: .05,  warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .062, wave: 0 },
    needs:   { key: 1,   glow: .85, night: 0,   sat: 1,   lift: .26,  warm: 1, arcOn: 1, fx: -.045, fy: -.035, hw: .054, wave: 0 },
    error:   { key: .78, glow: .10, night: .35, sat: .08, lift: -.05, warm: 0, arcOn: 1, fx: 0,     fy: 0,     hw: .050, wave: 0 },
  };
  const LABEL = { sleep: 'Sleeping', awake: 'Awake', working: 'Working', handoff: 'Handoff', done: 'Done', needs: 'Needs you', error: 'Error' };
  // step kind -> [width scale, turn speed rad/s]. One continuous arc always (no dashes: dashes read as a loading spinner)
  const KIND = { write: [1, .55], think: [.85, .30], search: [1, .75], read: [.8, .40], provider: [1.2, .36], check: [1, .80], queue: [.8, .12], work: [1, .45] };
  // breath: [amplitude, period s, fps]. Subtle by rule: horizon luminance +-4 % (awake), ember +-6 % (sleep)
  // round 4: awake runs at 15 fps so the wave glides (8 fps stepped visibly). needs: the halo breathes, the arc no longer blinks.
  // after review: needs' window breath is .05 (its .30 is the HALO's amplitude, NEEDS_HALO), so leaving needs never inherits .30
  const BREATH = { awake: [.04, 6, 15], sleep: [.06, 9, 4], needs: [.05, 3.6, 10] };
  const NEEDS_HALO = .30;
  // the awake wave on the horizon line: two slow travelling sines, amplitude in far-plane units (the pane spans about 1.5).
  // k = spatial frequency (rad per unit), w = temporal (rad/s). Periods 7.0 s and 11.4 s; a crest drifts ~0.14 units/s.
  // after review: amp .028 -> .05 and k1 6.6 -> 4.0 (a slow swell, not a wiggle); band = the light that rides each crest
  const WAVE = { amp: .05, k1: 4.0, w1: .90, k2: 2.5, w2: .55, mix: .62, band: .55 };
  const waveAt = (x, t) => WAVE.mix * Math.sin(x * WAVE.k1 - t * WAVE.w1) + (1 - WAVE.mix) * Math.sin(x * WAVE.k2 + t * WAVE.w2 + 1.3);
  const PLAN_KINDS = { Brief: ['read', 'think', 'write', 'check'], Research: ['think', 'search', 'read', 'write', 'check'], Strategy: ['read', 'think', 'write', 'check'],
    Copy: ['read', 'write', 'check', 'write'], Image: ['read', 'think', 'provider', 'check'], Deck: ['read', 'think', 'write', 'check'] };

  // length rule (SPEC: length = completion, never fake): the arc only ever shows real progress
  function targetLen(state, progress) {
    if (state === 'working' || state === 'needs' || state === 'error') return Math.max(L_MIN, progress);   // error: the real share too
    if (state === 'handoff') return L_MIN;
    if (state === 'done') return 1;
    return L_MIN;   // arcOn is 0 in sleep and awake
  }
  const ease = x => .5 - .5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1));

  function createModel(init = {}) {
    const S = { state: init.state || 'awake', agent: init.agent || 'Brief', progress: init.progress || 0, kind: 'work',
      t: 0, hoT: -1, doneT: -1, arcTail: 0, hoBase: 0, sweep: -3, drift: -.6, settleT: 0, bAmt: 0, bAe: 0, ph: 0, hoLift0: 0, swell0: 0 };
    const c = { ...STATES[S.state], len: targetLen(S.state, S.progress), kw: 1, ks: .45, swell: 0, breath: 1, sheen: 0, pulse: 1, halo: 1, waveAmt: 0 };
    const kindOf = () => { const p = PLAN_KINDS[S.agent] || PLAN_KINDS.Brief; return p[Math.min(p.length - 1, Math.floor(S.progress * p.length + 1e-6))]; };
    const model = {
      S, c,
      set(o = {}) {
        if (o.agent) S.agent = o.agent;
        if (o.progress != null) S.progress = Math.max(0, Math.min(1, o.progress));
        if (o.state && o.state !== S.state) {
          S.state = o.state;
          if (o.state === 'done') { S.doneT = 0; S.swell0 = c.swell; }
          if (o.state === 'handoff') { S.hoT = 0; S.hoBase = S.arcTail; S.hoLift0 = c.lift; }
        }
        S.kind = o.kind || kindOf(); S.settleT = 0;
      },
      // handoff: the finished agent's arc is shown FULL for the 1.5 s hold, then it drains to 0 over the 2.4 s pour,
      // exactly as the agent ring (1 + (0 - 1) * ease(pour)). progress becomes the new agent's 0 only after that.
      handoff(to) { S.handTo = to; S.progress = 0; this.set({ state: 'handoff' }); S.hoT = 0; S.hoBase = S.arcTail; S.hoLift0 = c.lift; },
      // jump straight to the targets (resume after a pause, reduced motion, captures)
      snap(rm) { Object.assign(c, STATES[S.state]); S.bAmt = BREATH[S.state] && !rm ? 1 : 0; S.bAe = BREATH[S.state] ? BREATH[S.state][0] : 0; c.halo = 1; c.waveAmt = c.wave * S.bAmt; c.len = targetLen(S.state, S.progress); c.swell = S.state === 'done' ? .15 : 0; S.sweep = -3; if (S.state === 'handoff') { S.hoT = TIMING.hold + TIMING.glide; S.hoLift0 = c.lift; } S.settleT = 9; },
      step(dt, rm) {
        S.t += dt; S.settleT += dt;
        const T = STATES[S.state], kE = rm ? 1 - Math.exp(-dt * 9) : 1 - Math.exp(-dt * (S.state === 'sleep' ? 1.1 : 3.2));
        for (const k in T) c[k] += (T[k] - c[k]) * kE;
        const kd = KIND[S.kind] || KIND.work; c.kw += (kd[0] - c.kw) * (1 - Math.exp(-6 * dt)); c.ks += (kd[1] - c.ks) * (1 - Math.exp(-6 * dt));
        const tl = targetLen(S.state, S.progress);
        // the arc never gets shorter during a job: only handoff (new agent) and a new job reset it
        if (S.state !== 'handoff') c.len += (tl - c.len) * (rm ? 1 : 1 - Math.exp(-dt * 3));
        if (S.state === 'handoff') {
          S.hoT += dt;
          const sink = ease(S.hoT / TIMING.hold), g = ease((S.hoT - TIMING.hold) / TIMING.glide);
          // hold: the arc shows the finished agent complete (1); pour: it drains with the agent's ring (1 -> 0)
          if (S.hoT < TIMING.hold) c.len += (1 - c.len) * (rm ? 1 : 1 - Math.exp(-dt * 6)); else c.len = rm ? (g < .5 ? 1 : 0) : 1 - g;
          // the horizon starts where it was (no snap), sinks during the hold, then rises with the glide
          c.lift = S.hoLift0 + (.03 - S.hoLift0) * ease(S.hoT / .5) - .30 * sink * (1 - g);
          if (!rm) { S.arcTail = S.hoBase + g; S.sweep = -2.4 + 4.8 * g; }
        } else {
          if (!rm && S.state === 'working') S.arcTail += dt * c.ks / TAU * c.arcOn;
          S.sweep += (-3 - S.sweep) * (1 - Math.exp(-2 * dt));
        }
        if (!rm && S.state === 'working') S.drift = -.9 + 1.8 * (.5 - .5 * Math.cos(S.t * .21));
        // done: one swell of light over 1.2 s, then it holds (closed ring) until the host moves on
        // (starts from the swell it had, so needs -> done does not jump)
        if (S.state === 'done') { S.doneT += dt; const u = Math.min(1, S.doneT / TIMING.swell); c.swell = rm ? .15 : S.swell0 + (.15 - S.swell0) * ease(u) + .85 * Math.sin(Math.PI * u); }
        else c.swell += (0 - c.swell) * kE;
        // breath: eased in and out so leaving a state never pops
        // after review: the amplitude is eased on its own (S.bAe) and the phase is accumulated (S.ph), so a new state's
        // breath never reads the previous state's amplitude or jumps phase when the period changes
        const B = BREATH[S.state], want = B && !rm ? 1 : 0;
        S.bAmt += (want - S.bAmt) * (1 - Math.exp(-dt * 1.5));
        S.bAe += ((B ? B[0] : 0) - S.bAe) * (1 - Math.exp(-dt * 1.5));
        if (B) S.bPer = B[1];
        S.ph += dt * TAU / (S.bPer || 6);
        const ph = Math.sin(S.ph);
        c.breath = 1 + S.bAe * ph * S.bAmt;
        // needs: the arc holds steady (a blinking arc read as an alarm); its halo and the warm line breathe instead
        c.pulse = 1 - (1 - c.pulse) * (1 - kE);
        const hw = S.state === 'needs' ? 1 + NEEDS_HALO * (.5 + .5 * ph) * S.bAmt : 1;
        c.halo += (hw - c.halo) * kE;
        c.sheen = .05 * Math.sin(S.t * TAU / 11) * S.bAmt * (S.state === 'awake' ? 1 : .5);
        // the wave fades in with the breath, so it is 0 under reduced motion and eases out on leaving awake
        c.waveAmt = c.wave * S.bAmt;
        return c;
      },
      // how many frames per second this moment needs. Settling to a new state is capped at 30.
      fpsCap(rm) {
        const s = S.state;
        if (s === 'handoff' && S.hoT < TIMING.hold + TIMING.glide + .4) return rm ? 15 : (S.hoT > TIMING.hold ? 60 : 30);
        if (s === 'working') return rm ? (this.settling() ? 15 : 0) : 30;
        if (s === 'done' && S.doneT < TIMING.swell + .3 && !rm) return 30;
        if (this.settling()) return rm ? 15 : (s === 'sleep' ? 15 : 30);   // the slow fall asleep needs no more than 15
        if (rm) return 0;
        const B = BREATH[s]; return B ? B[2] : 0;
      },
      settling() {
        const T = STATES[S.state]; let d = Math.abs(targetLen(S.state, S.progress) - c.len) + (S.sweep > -2.9 ? 1 : 0);
        for (const k in T) d += Math.abs(T[k] - c[k]);
        if (S.state === 'handoff') return false;
        if (d < .03 && S.sweep <= -2.9) {          // close enough: land exactly on the targets so the loop can stop
          for (const k in T) c[k] = T[k]; c.len = targetLen(S.state, S.progress); return false; }
        return true;
      },
    };
    return model;
  }

  // ---------- colour helpers ----------
  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const hex = a => '#' + a.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((x, i) => x + (B[i] - x) * t)); };
  const relLum = h => { const c = rgb(h).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  // agency theming rule: when the accent is too close to the surface (white on light, black on dark,
  // pale mint or yellow on light) the mark gets a contrast rim in ink or paper. Below 1.6:1 the rim is on.
  const RIM_MIN = 1.6;
  const rimFor = (accent, bg) => contrast(accent, bg) < RIM_MIN ? (relLum(bg) > .4 ? '#16181D' : '#E9EAEC') : null;
  // round 4: the horizon line's colour: a luminous, still-saturated tone of the accent (blue #515BFF -> #979DFF), never white.
  // warm (needs-you) moves it to champagne. Near-white or near-black accents fall back to a cool grey-blue.
  // after review: the line is lifted .66 toward white, then capped (HSV saturation <= .32, value <= .96): about #BCBFF5
  // for #515BFF. It is never brighter than .90 in any channel (agency-tint.js houseLineTone is the same rule).
  // NEEDS: the needs-you warm tones. Champagne by default; the board can switch it (see index.html "Needs-you colour").
  const NEEDS = { line: '#EBCB9E', arc: '#EED8B8', ring: '#C99550' };
  const capSV = (c, smax, vmax) => { let V = Math.max(...c), m = Math.min(...c), S = V > 0 ? (V - m) / V : 0;
    if (S > smax) c = c.map(x => V - (V - x) * smax / S); V = Math.max(...c); if (V > vmax) c = c.map(x => x * vmax / V); return c; };
  const lineColor = (accent, warm = 0) => { const a = rgb(accent), sat = Math.max(...a) - Math.min(...a);
    let l = sat < .12 ? '#A9B3C8' : hex(capSV(a.map(x => x + (1 - x) * .66), .32, .96)); return warm ? mix(l, NEEDS.line, warm) : l; };

  // ---------- projection of the lip and pane (the shader's camera, same pose), silhouette radius = 1 ----------
  function reduced(face = GEO.FACE, g = GEO) {
    const RH = g.RH, ZM = Math.sqrt(1 - RH * RH), ZF = g.ZF;
    const n = Math.hypot(face[0], face[1], 1), f = [face[0] / n, face[1] / n, 1 / n];
    const X = [f[2], 0, -f[0]], xl = Math.hypot(...X); X[0] /= xl; X[2] /= xl;
    const Y = [f[1] * X[2] - f[2] * X[1], f[2] * X[0] - f[0] * X[2], f[0] * X[1] - f[1] * X[0]];
    const D = 5.2, sil = 2.6 / Math.sqrt(D * D - 1);
    const ring = z => { const pts = []; for (let i = 0; i < 72; i++) { const a = i / 72 * TAU, l = [RH * Math.cos(a), RH * Math.sin(a), z];
      const w = [0, 1, 2].map(j => X[j] * l[0] + Y[j] * l[1] + f[j] * l[2]); const s = 2.6 / (D - w[2]) / sil; pts.push([w[0] * s, -w[1] * s]); } return pts; };
    const m = ring(ZM), fl = ring(ZF), ys = fl.map(p => p[1]);
    // the lip again, ordered clockwise on screen from 12 o'clock: the arc path (same direction as the agent ring)
    const cw = []; for (let i = 0; i < 72; i++) { const a = Math.PI / 2 - i / 72 * TAU, l = [RH * Math.cos(a), RH * Math.sin(a), ZM];
      const w = [0, 1, 2].map(j => X[j] * l[0] + Y[j] * l[1] + f[j] * l[2]); const s = 2.6 / (D - w[2]) / sil; cw.push([w[0] * s, -w[1] * s]); }
    return { m, fl, cw, top: Math.min(...ys), bot: Math.max(...ys) };
  }
  const K = 48;
  const pathOf = pts => 'M' + pts.map(p => (p[0] * K).toFixed(2) + ' ' + (p[1] * K).toFixed(2)).join('L') + 'Z';
  let N = 0;

  // ---------- the static set ----------
  // >= 48 px: gradients and a horizon line (prefer the rendered still at >= 128 px)
  // 25..47 px: flat tones, true pose, a thin horizon line
  // <= 24 px: flat tones, hinted geometry (SMALL), NO horizon line (it read as a minus sign or a Pokeball)
  function staticSVG(size, accent, bg, opt = {}) {
    const small = size <= 24, mid = size < 48 && !small;
    const R = small ? reduced([GEO.FACE[0] * SMALL.EX, GEO.FACE[1] * SMALL.EX], SMALL) : reduced(GEO.FACE);
    const id = 'dO' + (++N), rim = opt.noRim ? null : rimFor(accent, bg || '#FFFFFF');
    const wall = mix(accent, '#0B0C10', .58), top = R.top * K, bot = R.bot * K, hz = (top + bot) / 2 + (bot - top) * .1, o = x => ((x - top) / (bot - top)).toFixed(3);
    const paneFlat = mix(accent, '#ffffff', .66);
    const shell = small || mid ? accent : `url(#${id}s)`, pane = small || mid ? paneFlat : `url(#${id}p)`;
    const rimW = small ? 100 / size * 1.0 : 100 / size * 1.25;
    // round 4: the line is a luminous tone of the accent, never white; mid sizes split the pane (sky over a deeper sea)
    const lineC = lineColor(accent), seaFlat = mix(accent, '#0B0C10', .30);
    const hzLine = mid ? `<g clip-path="url(#${id}f)"><rect x="-50" y="${hz.toFixed(2)}" width="100" height="100" fill="${seaFlat}"/><rect x="-50" y="${(hz - 1.5).toFixed(2)}" width="100" height="3" fill="${lineC}"/></g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="${size}" height="${size}"${opt.label ? ` role="img" aria-label="${opt.label}"` : ''}>
<defs><clipPath id="${id}c"><path d="${pathOf(R.m)}"/></clipPath><clipPath id="${id}f"><path d="${pathOf(R.fl)}"/></clipPath>
<radialGradient id="${id}s" cx=".3" cy=".26" r=".95"><stop offset="0" stop-color="${mix(accent, '#ffffff', .16)}"/><stop offset=".55" stop-color="${accent}"/><stop offset="1" stop-color="${mix(accent, '#000000', .22)}"/></radialGradient>
<linearGradient id="${id}p" gradientUnits="userSpaceOnUse" x1="0" y1="${top.toFixed(1)}" x2="0" y2="${bot.toFixed(1)}">
<stop offset="0" stop-color="${mix(accent, '#ffffff', .3)}"/><stop offset="${o(hz - 2.2)}" stop-color="${mix(accent, '#ffffff', .6)}"/><stop offset="${o(hz)}" stop-color="${lineColor(accent)}"/><stop offset="${o(hz + 2.2)}" stop-color="${mix(accent, '#0B0C10', .2)}"/><stop offset="1" stop-color="${mix(accent, '#0B0C10', .5)}"/></linearGradient></defs>
<circle r="48" fill="${shell}"/>${rim ? `<circle r="${(48 - rimW / 2).toFixed(2)}" fill="none" stroke="${rim}" stroke-width="${rimW.toFixed(2)}"/>` : ''}<path d="${pathOf(R.m)}" fill="${wall}"/>
<g clip-path="url(#${id}c)"><path d="${pathOf(R.fl)}" fill="${pane}"/>${hzLine}</g></svg>`;
  }

  // ---------- the live vector (OS bar, favicon, zoom): drawn from the model's own eased numbers ----------
  function liveSVG(size, accent, bg, c, S) {
    const small = size <= 24, id = 'dL' + (++N);
    const R = small ? reduced([GEO.FACE[0] * SMALL.EX + c.fx, GEO.FACE[1] * SMALL.EX + c.fy], SMALL) : reduced([GEO.FACE[0] + c.fx, GEO.FACE[1] + c.fy]);
    const rim = rimFor(accent, bg);
    let shell = mix(accent, '#0B0C10', .5 * c.night); shell = mix(shell, '#6A6D74', .88 * (1 - c.sat));
    const wall = mix(shell, '#0B0C10', .58);
    const day = Math.min(1, c.glow);
    let pane = mix(accent, '#FFFFFF', .5 + .22 * day + .1 * c.swell);
    pane = mix(pane, mix(accent, '#000000', .82), c.night);
    pane = mix(pane, '#6E7178', .9 * (1 - c.sat));
    const top = R.top * K, bot = R.bot * K, span = bot - top, mid = (top + bot) / 2;
    const hzY = mid + span * .1 - c.lift * span * 1.2;
    // lower pane (below the horizon) is darker: the horizon height is the needs-you cue, so it must survive greyscale
    const sea = mix(pane, '#0B0C10', .42 + .3 * c.night);
    const showLine = !small, showSea = !small;   // <= 24 px: no horizon bar and no split pane (minus sign / Pokeball)
    const lineCol = c.night > .5 ? '#FF9A6A' : lineColor(accent, c.warm);
    // the awake wave, drawn as a path at >= 25 px (the same function as the shader, scaled to the vector's pane)
    const wv = c.waveAmt || 0, t = S ? S.t : 0;
    const linePath = (y0, th) => { if (wv < .01) return `<rect x="-50" y="${(y0 - th / 2).toFixed(2)}" width="100" height="${th}" fill="${lineCol}"/>`;
      const pts = []; for (let i = 0; i <= 40; i++) { const x = -50 + i * 2.5, y = y0 - wv * WAVE.amp * waveAt(x / (span / 1.5), t) * span / 1.5; pts.push(x.toFixed(1) + ' ' + y.toFixed(2)); }
      return `<path d="M${pts.join('L')}" fill="none" stroke="${lineCol}" stroke-width="${th}"/>`; };
    const len = Math.max(.001, Math.min(1, c.len)), arcW = (small ? 9.5 : 4.2) * (c.hw / .062);
    const arcCol = c.sat < .5 ? '#9A9CA1' : c.warm > .5 ? NEEDS.arc : hex(capSV(rgb(mix(accent, '#FFFFFF', .62)), 1, .92));
    const tail = (S ? S.arcTail : 0) % 1;
    const arc = c.arcOn > .03 ? `<path d="${pathOf(R.cw)}" pathLength="1" fill="none" stroke="${arcCol}" stroke-width="${arcW.toFixed(2)}" stroke-linecap="round" stroke-dasharray="${len >= .995 ? '1 0' : len.toFixed(3) + ' ' + (1 - len).toFixed(3)}" stroke-dashoffset="${(-tail).toFixed(3)}" opacity="${(Math.min(1, c.arcOn) * c.pulse).toFixed(2)}"/>` : '';
    const lbl = S ? `${LABEL[S.state]}` : 'Napkin Studio';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100" role="img" aria-label="Napkin Studio mark: ${lbl}"><defs><clipPath id="${id}"><path d="${pathOf(R.m)}"/></clipPath><clipPath id="${id}f"><path d="${pathOf(R.fl)}"/></clipPath></defs>
<circle r="48" fill="${shell}"/>${rim ? `<circle r="${(48 - 50 / size).toFixed(2)}" fill="none" stroke="${rim}" stroke-width="${(100 / size).toFixed(2)}"/>` : ''}<path d="${pathOf(R.m)}" fill="${wall}"/>
<g clip-path="url(#${id})"><g clip-path="url(#${id}f)"><rect x="-50" y="-50" width="100" height="100" fill="${pane}"/>${showSea ? `<rect x="-50" y="${hzY.toFixed(2)}" width="100" height="100" fill="${sea}"/>` : ''}${showLine ? linePath(hzY, 2.4) : ''}</g></g>${arc}</svg>`;
  }

  root.DeepO = { NEEDS, NEEDS_HALO, capSV, GEO, SMALL, TIMING, STATES, LABEL, KIND, BREATH, WAVE, waveAt, PLAN_KINDS, L_MIN, targetLen, createModel, reduced, staticSVG, liveSVG, rimFor, lineColor, contrast, mix, rgb, RIM_MIN };
})(typeof window !== 'undefined' ? window : globalThis);
