// scene.js: ONE WebGL context for the whole page. Every view (an agent sphere, a Deep O mark) is a DOM
// element; the scene draws each one into its own scissor box on a single fixed canvas laid over the page.
//
// Frame rules (sphere-ring SPEC 10, Deep O NOTES):
//  - a view is drawn only when it is on screen and due (its own fps cap, or marked dirty);
//  - views in one group (a stage: agent + corner mark) are cleared and redrawn together, in order;
//  - nothing due -> no draw call and no requestAnimationFrame (the loop stops; wake() restarts it);
//  - scrolling or resizing redraws the visible views once at their new place;
//  - resolution governor: every 45 back-to-back frames, smoothed frame time > 26 ms drops the scale by .15 (floor .6),
//    < 14 ms raises it by .1. ?fixed disables it (benchmarks). Device pixel ratio capped at 2.
//    When the loop goes idle below scale 1, the scale returns to 1 and everything is drawn once, sharp.
// After review:
//  - each view is clipped to its nearest scrolling / overflow-hidden ancestor (no orbs drawn past a scroller's edge);
//  - a FROZEN view (a still tile) is drawn once, copied into a 2D canvas inside its own element ("baked"), and then
//    skipped by the GL loop, so scrolling past 50 still tiles costs nothing; it is re-drawn when marked dirty;
//  - a clock-only view (a story host: kind 'host') never clears or draws anything;
//  - the canvas is sized in px from innerWidth / innerHeight (a 100vh canvas drifts on mobile URL-bar collapse).
// Stray spheres (owner, 2026-11-09: an agent shows in one place only):
//  - a view is drawn only while its element is connected and really shown: checkVisibility() catches display:none,
//    visibility:hidden and a closed <details> (its content is content-visibility:hidden, so offsetParent is set and
//    the rect is real: the sphere used to draw over whatever follows the summary); a zero rect is not drawn either;
//  - a view whose element left the page is dropped from the scene (its pixels cleared) on the next frame;
//  - rects are read every frame, and a scroll anywhere (captured, so a scrolling side panel counts) or a change to
//    the page's classes, hidden, open or children redraws them; the clip ancestors are found again each frame;
//  - the canvas's own offset is subtracted, so a sphere stays on its element even if the canvas is not at 0,0.
(function (root) {
  'use strict';
  const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';
  const canvas = document.createElement('canvas');
  canvas.id = 'napkin-gl';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '3' });
  document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  const FIXED = /[?&]fixed/.test(location.search), NOBAKE = /[?&]nobake/.test(location.search);
  const ENG = { scale: 1, dpr: 1, W: 0, H: 0, ox: 0, oy: 0, avgMs: 16, frames: 0, draws: 0, skipped: 0, uploads: 0, fps: 0, drawsPerSec: 0, contexts: gl ? 1 : 0 };
  const views = [];
  const programs = {};
  let raf = 0, timer = 0, lastT = 0, lastFrame = 0, govN = 0, moved = true, paused = false, fpsN = 0, fpsT = 0, drawN = 0;
  const motion = { reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener && mq.addEventListener('change', e => { motion.reduce = e.matches; wake(true); });

  if (gl) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.clearColor(0, 0, 0, 0); gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied: a group's later views lay over earlier ones
    gl.enable(gl.SCISSOR_TEST);
  }
  let current = null;
  // a program with a uniform cache: a value that did not change is not sent again
  function program(name, frag) {
    if (programs[name]) return programs[name];
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(o)); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(pr));
    const locs = {}, last = {};
    const L = n => locs[n] !== undefined ? locs[n] : (locs[n] = gl.getUniformLocation(pr, n));
    const same = (a, b) => { if (!b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
    const P = {
      use() { if (current !== pr) { gl.useProgram(pr); current = pr; } },
      f1(n, v) { if (last[n] === v) return; last[n] = v; gl.uniform1f(L(n), v); ENG.uploads++; },
      v(n, size, arr) { const l = last[n]; if (same(arr, l)) return; last[n] = l && l.length === arr.length ? (l.set(arr), l) : Float32Array.from(arr);
        (size === 2 ? gl.uniform2fv : size === 3 ? gl.uniform3fv : gl.uniform4fv).call(gl, L(n), arr); ENG.uploads++; },
    };
    programs[name] = P; return P;
  }

  function resize() {
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2) * ENG.scale;
    if (W === ENG.W && H === ENG.H && dpr === ENG.dpr) return false;
    ENG.W = W; ENG.H = H; ENG.dpr = dpr; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.scissor(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }
  // is the element on the page and really shown (not display:none, visibility:hidden or in a closed <details>)?
  function shown(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    return el.offsetParent !== null;
  }
  // rect of a view in CSS px, viewport space; null when off screen or hidden
  function rectOf(v) {
    if (!v.el || !v.el.isConnected) return null;
    const r = v.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || !shown(v.el)) return null;
    return r;
  }
  // nearest ancestor that clips (overflow other than visible), found once per frame (a class change can add one)
  let fid = 0;
  function clipEl(el) {
    if (el._nkClipF === fid) return el._nkClip;
    let a = el.parentElement, found = null;
    while (a && a !== document.body && a !== document.documentElement) { const cs = getComputedStyle(a); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { found = a; break; } a = a.parentElement; }
    el._nkClipF = fid;
    return (el._nkClip = found);
  }
  // the part of r that is really visible: inside the viewport and every clipping ancestor
  function visRect(el, r) {
    let L = Math.max(0, r.left), T = Math.max(0, r.top), Rr = Math.min(innerWidth, r.right), B = Math.min(innerHeight, r.bottom);
    for (let a = clipEl(el); a; a = clipEl(a)) { const c = a.getBoundingClientRect(); L = Math.max(L, c.left); T = Math.max(T, c.top); Rr = Math.min(Rr, c.right); B = Math.min(B, c.bottom); }
    return Rr - L < 1 || B - T < 1 ? null : { left: L, top: T, right: Rr, bottom: B };
  }
  // baking a still view into its own 2D canvas
  function bake(m, b) {
    let c = m._bake;
    if (!c) { c = m._bake = document.createElement('canvas'); c.setAttribute('aria-hidden', 'true');
      Object.assign(c.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      if (getComputedStyle(m.el).position === 'static') m.el.style.position = 'relative';
      m.el.insertBefore(c, m.el.firstChild); }
    c.width = b[2]; c.height = b[3];
    const x = c.getContext('2d'); x.clearRect(0, 0, b[2], b[3]);
    x.drawImage(canvas, b[0], canvas.height - b[1] - b[3], b[2], b[3], 0, 0, b[2], b[3]);
    c.style.display = ''; m.baked = true;
    gl.scissor(b[0], b[1], b[2], b[3]); gl.clear(gl.COLOR_BUFFER_BIT);   // the bitmap shows it now; never both (shadows would double)
  }
  function unbake(m) { if (m._bake) m._bake.style.display = 'none'; m.baked = false; }
  function box(r) {   // device-pixel scissor box (GL origin bottom left), clamped to the canvas; r is viewport space
    const d = ENG.dpr, ox = ENG.ox, oy = ENG.oy;
    const x0 = Math.max(0, Math.floor((r.left - ox) * d)), y1 = Math.min(canvas.height, Math.ceil((r.bottom - oy) * d));
    const x1 = Math.min(canvas.width, Math.ceil((r.right - ox) * d)), y0 = Math.max(0, Math.floor((r.top - oy) * d));
    return [x0, canvas.height - y1, Math.max(0, x1 - x0), Math.max(0, y1 - y0)];
  }

  // a group is a stage holding several views (agent + corner mark); a lone view is its own group
  const groups = [];
  function add(view) {
    views.push(view); view.dirty = true;
    const g = view.group || (view.group = { el: view.el });
    if (!g.members) { g.members = []; g.lastDraw = -1e9; groups.push(g); }
    g.members.push(view);
    wake(true); return view;
  }
  function remove(view) {   // idempotent: the scene may have dropped a detached view before its owner destroys it
    const i = views.indexOf(view); if (i < 0) return;
    views.splice(i, 1);
    const g = view.group, j = g && g.members ? g.members.indexOf(view) : -1;
    if (j >= 0) { g.members.splice(j, 1); if (!g.members.length) { const k = groups.indexOf(g); if (k >= 0) groups.splice(k, 1); g.members = null; } }
    wake(true);
  }
  // a wake during a frame (a view's step changed something) is folded into that frame's own schedule: one rAF chain only
  let inFrame = false, wokeInFrame = false;
  function wake(all) { if (all) moved = true; if (inFrame) { wokeInFrame = true; return; } if (!raf && !paused) { if (timer) { clearTimeout(timer); timer = 0; } raf = requestAnimationFrame(frame); } }

  let clock = 0;
  function frame(now) {
    raf = 0;
    if (!gl || paused) return;
    inFrame = true; wokeInFrame = false;
    const dtRaw = lastT ? Math.max(0, Math.min(.25, (now - lastT) / 1000)) : 0, dt = Math.min(.05, dtRaw); lastT = now;   // SPEC 10: views clamp dt to [0, .05]; a host's script clock gets real time
    clock += dt;
    const rm = motion.reduce;
    fid++;
    for (let i = views.length - 1; i >= 0; i--) {                     // 0. a view whose element left the page is dropped
      const v = views[i];
      if (v.el && v.el.isConnected) { v.wasConnected = true; continue; }
      if (v.wasConnected) { remove(v); v.detached = true; }           // remove() wakes everything: its pixels are cleared below
    }
    for (const v of views) if (v.step && !v.frozen) v.step(v.tickHz ? dtRaw : dt, clock, rm);          // 1. simulation (cheap, no allocation)
    const resized = resize();
    const cr = canvas.getBoundingClientRect();                        // the canvas's own place (a transformed ancestor moves it)
    if (cr.left !== ENG.ox || cr.top !== ENG.oy) { ENG.ox = cr.left; ENG.oy = cr.top; moved = true; }
    const all = moved || resized; moved = false;
    let nextMs = 1e9, nDue = 0;
    for (const g of groups) {                                         // 2. which stages are due
      if (g.clockOnly === undefined) g.clockOnly = g.members.every(m => m.kind === 'host');
      if (g.clockOnly) { for (const m of g.members) if (m.tickHz) { const hz = m.tickHz(); if (hz > 0) nextMs = Math.min(nextMs, 1000 / hz); } g.due = false; continue; }
      const still = g.members.every(m => m.frozen);
      for (const m of g.members) if (m.baked && (m.dirty || !m.frozen)) unbake(m);
      if (still && g.members.every(m => m.baked)) { g.due = false; g.wasVisible = false; g.lastRect = null; continue; }   // a baked still: nothing for GL to do
      g.rect = rectOf(g);
      g.vis = g.rect ? visRect(g.el, g.rect) : null; if (!g.vis) g.rect = null;
      let cap = 0, dirty = false;
      for (const m of g.members) if (m.tickHz) { const hz = m.tickHz(); if (hz > 0) nextMs = Math.min(nextMs, 1000 / hz); }   // a host needs time to pass, not pixels
      if (g.rect) for (const m of g.members) { if (!m.frozen && !m.tickHz) cap = Math.max(cap, m.fps(rm)); dirty = dirty || m.dirty; }
      g.cap = cap;
      g.due = all || dirty || (!!g.rect !== !!g.wasVisible);
      if (!g.due && cap > 0) { const gap = 1000 / cap; if (now - g.lastDraw >= gap - 6) g.due = true; else nextMs = Math.min(nextMs, gap - (now - g.lastDraw)); }
      if (g.due) nDue++;
    }
    if (all) { gl.scissor(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); }
    if (!nDue) { ENG.skipped++; lastFrame = 0; inFrame = false; schedule(wokeInFrame ? 0 : nextMs); return; }
    for (const g of groups) {                                         // 3. clear each due stage, then draw its members in order
      if (!g.due) continue;
      const clr = g.vis && g.lastRect && !all ? union(g.vis, g.lastRect) : (g.vis || (all ? null : g.lastRect));
      if (clr) { const b = box(clr); gl.scissor(b[0], b[1], b[2], b[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
      g.lastRect = g.vis ? { left: g.vis.left, top: g.vis.top, right: g.vis.right, bottom: g.vis.bottom } : null;
      g.wasVisible = !!g.rect; g.lastDraw = now;
      if (!g.rect) continue;
      const b = box(g.vis);
      let drew = false;
      for (const m of g.members) {
        m.rect = m.el === g.el ? g.rect : rectOf(m);
        m.dirty = false;
        if (!m.rect || !m.visible()) continue;
        gl.scissor(b[0], b[1], b[2], b[3]);
        m.draw(gl, m.rect, ENG.dpr, canvas.width, canvas.height, b);
        ENG.draws++; drawN++; drew = true;
      }
      // a still drawn whole (not cut by the viewport or a scroller) is baked; the next frames skip it
      const whole = Math.abs(g.vis.left - g.rect.left) < .5 && Math.abs(g.vis.top - g.rect.top) < .5 && Math.abs(g.vis.right - g.rect.right) < .5 && Math.abs(g.vis.bottom - g.rect.bottom) < .5;
      if (drew && whole && g.members.length === 1 && g.members[0].frozen && !NOBAKE) { bake(g.members[0], b); g.lastRect = null; }
      if (g.cap > 0) nextMs = Math.min(nextMs, 1000 / g.cap);
    }
    ENG.frames++;
    // governor (Deep O rule): judged only on back-to-back frames at a >= 30 fps cap, against that cap, never across idle gaps
    let maxCap = 0; for (const g of groups) if (g.due && g.cap > maxCap) maxCap = g.cap;
    if (maxCap >= 30 && lastFrame && now - lastFrame < 250 && !FIXED) {
      ENG.avgMs += (now - lastFrame - ENG.avgMs) * .05;
      const capMs = 1000 / maxCap;
      if (++govN > 45) { govN = 0; if (ENG.avgMs > capMs * 1.55 && ENG.scale > .6) { ENG.scale = Math.max(.6, ENG.scale - .15); moved = true; } else if (ENG.avgMs < capMs * 1.12 && ENG.scale < 1) { ENG.scale = Math.min(1, ENG.scale + .1); moved = true; } }
    }
    lastFrame = maxCap >= 30 ? now : 0;
    fpsN++; if (now - fpsT > 1000) { ENG.fps = fpsN * 1000 / (now - fpsT); ENG.drawsPerSec = drawN * 1000 / (now - fpsT); fpsN = 0; drawN = 0; fpsT = now; }
    inFrame = false;
    schedule(wokeInFrame || moved ? 0 : nextMs);
  }
  function union(a, b) { return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }; }
  function schedule(ms) {
    if (raf || paused) return;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (ms >= 1e9) {                                       // nothing animates: the loop stops here
      lastT = 0;
      if (ENG.scale < 1 && !FIXED) { ENG.scale = 1; moved = true; raf = requestAnimationFrame(frame); }   // idle: back to full sharpness, drawn once
      return; }
    if (ms <= 20) { raf = requestAnimationFrame(frame); return; }
    timer = setTimeout(() => { timer = 0; wake(); }, ms - 8);   // a timed wait keeps the clock (the script must not lose time)
  }
  // scroll does not bubble: listen in the capture phase so a scrolling panel or list moves its spheres too
  document.addEventListener('scroll', () => wake(true), { passive: true, capture: true });
  // a panel opened or closed, a tab switched, a <details> toggled, a placeholder replaced: draw again at the new places
  if (typeof MutationObserver === 'function') new MutationObserver(() => wake(true)).observe(document.documentElement,
    { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'open'] });
  document.addEventListener('toggle', () => wake(true), { capture: true });
  document.addEventListener('transitionend', () => wake(true), { capture: true, passive: true });
  addEventListener('resize', () => { for (const v of views) if (v.baked) { unbake(v); v.dirty = true; } wake(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastT = 0; wake(true); } });

  root.NapkinScene = {
    gl, canvas, ENG, motion, program, add, remove, wake, views, shown,
    pause(p) { paused = !!p; if (!paused) { lastT = 0; wake(true); } },
    get paused() { return paused; },
    get clock() { return clock; },
    // capture: draw every visible view now, synchronously (headless stills)
    drawNow() { moved = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } const was = paused; paused = false; frame(performance.now()); paused = was; gl.finish(); },
    get inFrame() { return inFrame; },
  };
})(window);
