// roles.js: the one agent engine's front door, for the template apps and the shell alike.
//
// Napkin's agents are named by role (Knowledge, Strategy, Research, Synthesis, Brief, Review, Deck), each drawn as its
// sphere (agent-view.js: AG, MAT_OF). This file holds:
//   - THE one lookup from anything a run, a step or a stored decision calls an agent (a stage id, a handler,
//     an old crew key or crew name kept in older documents) to its role: NapkinRoles.of / forStage / ofDecision;
//   - the words people read: name('review') "Review agent", the('review') "the Review agent",
//     caption('knowledge') "KNOWLEDGE AGENT" (the material is not the person's business, owner 2026-11-10);
//   - the sphere at any size: mount(el, {agent, state, progress}) puts a live view on the page's one scene
//     (scene.js), and still(agent, size) is the same sphere as a static frame (material, marks, horizon) for a
//     page without WebGL. tag() writes a placeholder an app can put in any innerHTML; hydrate() (or auto())
//     turns each into a live view.
// States follow the mock's grammar: idle, working, handoff (with next), needs, done.
// Loaded after finish.js, agent-view.js and extra.js; scene.js is needed only by mount().
(function (root) {
  'use strict';
  var ROLES = {
    knowledge: { name: 'Knowledge', job: 'reads what you sent' },
    strategy: { name: 'Strategy', job: 'plans the work' },
    research: { name: 'Research', job: 'finds evidence' },
    // The mock's research report is "Composed by Synthesis agent": it turns pins into findings and writes the
    // report from them. Its sphere is ceramic (extra.js), a material no research stage uses.
    synthesis: { name: 'Synthesis', job: 'finds the points' },
    brief: { name: 'Brief', job: 'writes the brief' },
    review: { name: 'Review', job: 'checks every claim' },
    deck: { name: 'Deck', job: 'builds the deck' },
    idea: { name: 'Idea', job: 'opens directions' },
    copy: { name: 'Copy', job: 'crafts words' },
    approval: { name: 'Approval', job: 'asks for sign-off' },
    orchestrator: { name: 'Orchestrator', job: 'routes the work' }
  };
  var LENSES = ['market_structure', 'brands_positioning', 'consumer_culture', 'category_codes', 'rhythm_moments', 'media_spend',
    'regulation_clearance', 'effectiveness_evidence', 'positioning', 'culture', 'codes', 'rhythm', 'media', 'regulation', 'effectiveness'];
  // Every name an agent has gone by, to its role. Older documents store crew keys (extract, drafter, judge,
  // synthesis, a lens) and crew names (Ellis, Dara ...) as actors: they read as the role here, and only here.
  var ALIAS = {
    extract: 'knowledge', ellis: 'knowledge', read: 'knowledge', capture: 'knowledge', extract_ask: 'knowledge', identify: 'knowledge',
    lookup: 'knowledge', transcribe: 'knowledge', knowledge: 'knowledge',
    sam: 'strategy', context: 'strategy', plan: 'strategy', think: 'strategy', propose_audience: 'strategy', planner: 'strategy',
    // The research's findings and its report: the Synthesis agent's. (Brief Maker's own "synthesis" crew key is
    // its Strategy step; it maps its keys to roles itself.)
    synthesise: 'synthesis', synthesise_findings: 'synthesis', synthesise_finding: 'synthesis',
    report: 'synthesis', compose_report: 'synthesis', 'report.compose': 'synthesis',
    drafter: 'brief', dara: 'brief', draft: 'brief', write: 'brief', draft_brief: 'brief', regenerate_field: 'brief', fill: 'brief',
    judge: 'review', jude: 'review', check: 'review', verdict: 'review', select: 'review', golden_critic: 'review', critic: 'review',
    score: 'review',
    research: 'research', research_lens: 'research', research_run: 'research', research_merge: 'research', search: 'research',
    max: 'research', bo: 'research', cam: 'research', cody: 'research', remy: 'research', mo: 'research', lex: 'research', eden: 'research',
    dex: 'deck', deck: 'deck', director: 'deck'
  };
  for (var i = 0; i < LENSES.length; i++) ALIAS[LENSES[i]] = 'research';
  // What each app's run stages are (the job's own stage ids), per the mock's RUN_PLANS.
  var STAGES = {
    brief: { extract: 'knowledge', context: 'strategy', draft: 'brief', judge: 'review', check: 'review' },
    research: { extract: 'strategy', identify: 'strategy', select: 'strategy', research: 'research', synthesise: 'synthesis', report: 'review' },
    deck: {}
  };
  var APP_ROLE = { brief: 'brief', research: 'research', deck: 'deck' };

  function last(s) { return String(s == null ? '' : s).split('/').pop().replace(/@.*$/, '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_agent$/, ''); }
  /** Anything that names an agent -> its role key, or '' when it names none. */
  function of(x) {
    if (!x) return '';
    var k = last(x);
    if (ROLES[k]) return k;
    return ALIAS[k] || '';
  }
  function appOf(app) {
    var a = String(app || '').toLowerCase();
    return /deck/.test(a) ? 'deck' : /research/.test(a) ? 'research' : /brief/.test(a) ? 'brief' : '';
  }
  /** The agent at work on a run: the app ('brief', 'research', 'deck', or its app id) and the stage it reports. */
  function forStage(app, stage) {
    var a = appOf(app), s = last(stage);
    if (a === 'deck') return 'deck';
    return (a && STAGES[a][s]) || of(stage) || APP_ROLE[a] || 'orchestrator';
  }
  /** The agent behind a decision, or null for a person (the rule every app and the shell use). */
  function ofDecision(d) {
    d = d || {};
    var who = String(d.agent || d.actor || ''), act = String(d.action || '').toLowerCase();
    if (!who || who === 'human' || /^human:/.test(who)) return null;
    if (d.kind === 'verdict' || d.polarity) return 'review';
    if (d.kind === 'finding') return 'synthesis';
    if (act === 'score') return 'review';
    var r = of(who) || of(act);
    if (r) return r;
    if (/judge|critic|review/i.test(who)) return 'review';
    if (/extract|capture/i.test(who + ' ' + act)) return 'knowledge';
    if (/draft/i.test(who)) return 'brief';
    if (/research|lens/i.test(who)) return 'research';
    return null;
  }
  function meta(r) { return ROLES[of(r)] || null; }
  function name(r) { var m = meta(r); return m ? m.name + ' agent' : 'An agent'; }
  function the(r) { var m = meta(r); return m ? 'the ' + m.name + ' agent' : 'an agent'; }
  function The(r) { var s = the(r); return s.charAt(0).toUpperCase() + s.slice(1); }
  function mats() { var A = root.NapkinAgents; return A ? A : null; }
  function matOf(r) { var A = mats(), m = meta(r); return A && m ? A.MAT_OF[m.name] || 'pearl' : 'pearl'; }
  function caption(r) { return name(r).toUpperCase(); }
  function hex(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { var x = hex(a), y = hex(b); return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join(''); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var uid = 0;
  /** The sphere as a static frame: its material, its marks (the agent's own arcs and circles) and the horizon. */
  function still(r, size) {
    r = of(r) || 'orchestrator';
    var fill = !size;   // no size: the frame fills its box (the app's CSS sizes it)
    size = +size || 28;
    var A = mats(), M = A ? A.MATS[matOf(r)] : { base: '#EEECE7', ink: '#16191D' }, ag = A && A.AG[r];
    var base = M.base, ink = M.ink, id = 'nkg' + (++uid);
    var lite = mix(base, '#FFFFFF', 0.28), dark = mix(base, '#000000', 0.34), mk = size > 80 && !fill ? 0.8 : 1;
    var out = ['<svg class="nk-still" viewBox="-1.25 -1.25 2.5 2.5" width="' + (fill ? '100%' : size) + '" height="' + (fill ? '100%' : size) + '" aria-hidden="true" focusable="false">',
      '<defs><radialGradient id="' + id + '" cx="-.35" cy="-.42" r="1.6" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="' + lite + '"/><stop offset=".55" stop-color="' + base + '"/><stop offset="1" stop-color="' + dark + '"/></radialGradient></defs>',
      '<ellipse cx=".1" cy="1.08" rx=".7" ry=".12" fill="#000" opacity=".12"/>',
      '<circle r="1" fill="url(#' + id + ')"/>', '<g transform="scale(' + mk + ')">'];
    if (ag) {
      var sw = function (w) { return Math.max(w, 2.2 / size); };
      for (var a = 0; a < ag.arcs.length; a++) {
        var q = ag.arcs[a], cx = q[0], cy = q[1], rr = q[2], a0 = q[3], s = Math.min(q[4], 6.28), op = q[6] > 1.5 ? 1 : q[6];
        var x0 = cx + rr * Math.cos(a0), y0 = cy + rr * Math.sin(a0), x1 = cx + rr * Math.cos(a0 + s), y1 = cy + rr * Math.sin(a0 + s);
        out.push('<path d="M' + x0.toFixed(4) + ' ' + y0.toFixed(4) + 'A' + rr + ' ' + rr + ' 0 ' + (s > Math.PI ? 1 : 0) + ' 1 ' + x1.toFixed(4) + ' ' + y1.toFixed(4) +
          '" fill="none" stroke="' + ink + '" stroke-opacity="' + (op * 0.95).toFixed(2) + '" stroke-width="' + sw(q[5]).toFixed(4) + '" stroke-linecap="round"/>');
      }
      for (var c = 0; c < ag.circs.length; c++) {
        var o = ag.circs[c], op2 = o[5] > 1.5 ? 1 : o[5];
        out.push(o[4] > 0.5 ? '<circle cx="' + o[0] + '" cy="' + o[1] + '" r="' + o[2] + '" fill="' + ink + '" fill-opacity="' + (op2 * 0.95).toFixed(2) + '"/>'
          : '<circle cx="' + o[0] + '" cy="' + o[1] + '" r="' + o[2] + '" fill="none" stroke="' + ink + '" stroke-opacity="' + (op2 * 0.95).toFixed(2) + '" stroke-width="' + sw(o[3]).toFixed(4) + '"/>');
      }
    }
    out.push('</g>');
    // the horizon: one thin line below centre, in Napkin's line colour; a soft dark rim and a light edge give the
    // static frame a silhouette on any ground
    out.push('<path d="M-.86 .31H.86" stroke="#BCBFF5" stroke-opacity=".35" stroke-width="' + (1.5 / size * 2.5).toFixed(4) + '"/>');
    out.push('<circle r=".985" fill="none" stroke="#000" stroke-opacity=".16" stroke-width=".03"/><circle r=".95" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width=".03"/></svg>');
    return out.join('');
  }

  // ── live views ─────────────────────────────────────────────────────────────────────────────
  var CFG = {};
  /** Page defaults for every view: {accent, inkAccent, bg, dark}. Unset ones are read from the page. */
  function configure(o) { for (var k in o) CFG[k] = o[k]; restyle(); }
  function cssVar(n) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); } catch (e) { return ''; } }
  function lum(h) { var c = hex(h); return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; }
  function isDark() {
    var d = document.documentElement, a = d.getAttribute('data-color-scheme') || d.getAttribute('data-theme');
    return a === 'dark' || (!a && !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches));
  }
  function look() {
    var base = CFG.inkAccent || cssVar('--ag-base') || '#515BFF', acc = cssVar('--ag-acc') || '#C8CBFF';
    if (!/^#[0-9a-f]{6}$/i.test(base)) base = '#515BFF';
    if (!/^#[0-9a-f]{6}$/i.test(acc)) acc = '#C8CBFF';
    // the ring is the agency's base; a near-black base rings in its accent, deepened (the mock's TBWA ring)
    var ring = CFG.accent || (lum(base) < 0.15 ? mix(acc, '#000000', 0.23) : base);
    var dark = CFG.dark != null ? !!CFG.dark : isDark();
    return { accent: ring, inkAccent: base, dark: dark, bg: CFG.bg || (dark ? '#16181D' : '#F6F1E7') };
  }
  var live = [];
  function restyle() { var L = look(); for (var i = 0; i < live.length; i++) { var v = live[i].view; if (v) { v.setAccent(L.accent, L.inkAccent); v.setBg(L.bg, L.dark); } } }
  var KIND = { knowledge: 'read', strategy: 'think', research: 'search', synthesis: 'think', brief: 'write', review: 'check', deck: 'write', orchestrator: 'work' };
  function envelope(o) {
    var r = of(o.agent) || 'orchestrator', st = o.state || 'idle', kind = o.kind || KIND[r] || 'work';
    var pr = o.progress, n = 20, at = 0;
    if (pr && pr.length === 2 && pr[1] > 0) { n = pr[1]; at = Math.min(pr[0], pr[1]); }
    else if (typeof pr === 'number') at = Math.round(Math.max(0, Math.min(1, pr)) * n);
    var steps = []; for (var i = 0; i < n; i++) steps.push({ label: '', kind: st === 'needs' ? 'human' : st === 'idle' ? 'queue' : kind });
    var env = { agentKey: r, nextAgentKey: r, phase: 'run', steps: steps, step: { index: st === 'idle' ? 0 : at }, stepStartedAt: Date.now(), streaming: st === 'working' };
    if (st === 'done') { env.phase = 'hold'; env.step = { index: n }; }
    if (st === 'handoff' && of(o.next) && of(o.next) !== r) { env.phase = 'handoff'; env.nextAgentKey = of(o.next); }
    return env;
  }
  /** A live sphere in `el`, sized to the element: {agent, state, progress, next, kind, size}. Without WebGL the
   *  element gets the static frame. Returns {set(o), destroy(), live}. */
  function mount(el, o) {
    o = o || {};
    var S = root.NapkinScene, A = root.NapkinAgents, h = { el: el, view: null, o: o, frozenT: 0 };
    var size = o.size || Math.min(el.clientWidth || 28, el.clientHeight || 28);
    function fallback() { el.innerHTML = still(o.agent, size); }
    if (S && S.gl && A) {
      try {
        var L = look(), small = size < 72;
        h.view = A.create(S, el, {
          level: 4, accent: L.accent, inkAccent: L.inkAccent, bg: L.bg, dark: L.dark, interactive: !small && o.interactive !== false,
          rFrac: small ? [0.33, 0.33] : (o.rFrac || [0.27, 0.24]), cyFrac: small ? 0.47 : (o.cyFrac || 0.45),
          ringGap: small ? Math.max(2, size * 0.07) : o.ringGap, ringScale: small ? Math.max(0.55, size / 80) : o.ringScale, fps: small ? 30 : undefined
        });
        live.push(h);
      } catch (e) { h.view = null; }
    }
    if (!h.view) fallback();
    h.set = function (n) {
      for (var k in n) o[k] = n[k];
      if (!h.view) { fallback(); return; }
      clearTimeout(h.frozenT); h.view.frozen = false; h.view.dirty = true;
      h.view.setEnvelope(envelope(o));
      // an idle sphere is drawn and then kept still (baked): a list of them costs nothing
      if ((o.state || 'idle') === 'idle' || o.state === 'done') h.frozenT = setTimeout(function () { if (h.view) { h.view.frozen = true; h.view.dirty = true; S.wake(); } }, o.state === 'done' ? 2600 : 900);
    };
    h.destroy = function () {
      clearTimeout(h.frozenT);
      if (h.view) { try { S.remove(h.view); } catch (e) { /* gone */ } if (h.view._bake && h.view._bake.parentNode) h.view._bake.parentNode.removeChild(h.view._bake); }
      var i = live.indexOf(h); if (i >= 0) live.splice(i, 1);
      h.view = null;
    };
    h.live = !!h.view;
    h.set({});
    return h;
  }

  // ── placeholders for innerHTML apps ────────────────────────────────────────────────────────
  /** A sphere placeholder an app writes into its HTML: the static frame now, a live view once hydrated. */
  function tag(r, o) {
    o = o || {};
    var k = of(r) || 'orchestrator', size = o.size || 0, st = o.state === 'needs-you' ? 'needs' : o.state || 'idle';
    var label = o.label || name(k) + (st === 'working' ? ', working' : st === 'needs' ? ', needs you' : '');
    return '<span class="nk-ag' + (o.cls ? ' ' + esc(o.cls) : '') + '" data-nk-agent="' + k + '" data-nk-state="' + esc(st) + '"' + (size ? ' data-nk-size="' + size + '"' : '') +
      (o.progress != null ? ' data-nk-progress="' + esc(o.progress) + '"' : '') + (o.next && of(o.next) ? ' data-nk-next="' + of(o.next) + '"' : '') +
      ' style="display:inline-block;position:relative;flex:none;vertical-align:middle;line-height:0' + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '"' +
      (o.decorative ? ' aria-hidden="true"' : ' role="img" aria-label="' + esc(label) + '"') + '>' + still(k, size) + '</span>';
  }
  function hydrate(scope) {
    var S = root.NapkinScene;
    if (!S || !S.gl || !root.document) return;
    var els = (scope || document).querySelectorAll('.nk-ag[data-nk-agent]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], want = el.getAttribute('data-nk-agent') + '|' + el.getAttribute('data-nk-state') + '|' + (el.getAttribute('data-nk-progress') || '') + '|' + (el.getAttribute('data-nk-next') || '');
      // the scene drops a view whose element left the page; an element put back gets a new one
      if (el._nk && el._nk.view && el._nk.view.detached) { el._nk.destroy(); el._nk = null; }
      if (el._nk && el._nkWant === want) continue;
      var pr = el.getAttribute('data-nk-progress'), o = { agent: el.getAttribute('data-nk-agent'), state: el.getAttribute('data-nk-state'), progress: pr == null ? undefined : +pr, next: el.getAttribute('data-nk-next') || undefined, size: +el.getAttribute('data-nk-size') || Math.min(el.clientWidth, el.clientHeight) || 28 };
      el._nkWant = want;
      if (el._nk) { el._nk.set(o); continue; }
      var svg = el.querySelector('.nk-still');
      el._nk = mount(el, o);
      if (el._nk.live && svg) svg.style.visibility = 'hidden';
    }
  }
  function sweep() { for (var i = live.length - 1; i >= 0; i--) { var h = live[i]; if (h.el._nk === h && !h.el.isConnected) { h.el._nk = null; h.destroy(); } } }
  var obs = null;
  /** Hydrate now and after every change to the page; views of removed placeholders are dropped. */
  function auto() {
    if (obs || !root.MutationObserver || !root.document) { hydrate(); return; }
    var queued = false;
    obs = new MutationObserver(function () { if (queued) return; queued = true; (root.requestAnimationFrame || setTimeout)(function () { queued = false; sweep(); hydrate(); }); });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nk-agent', 'data-nk-state', 'data-nk-progress', 'data-nk-next'] });
    hydrate();
  }

  // ── the side panel's job block, one for every app (owner, 2026-11-11: identical in the brief and the research;
  // then "bigger, embedded in the panel"): the panel's own top section, under its tabs, full width, no card. The
  // working agent's live sphere sits in a soft inset well, its ring showing progress; beside it (under it on a
  // narrow panel) the role in mono caps, what it is doing in body type, and a small mono status. A hairline in
  // the agency colour runs along its foot while it works. Clicking it goes to what the job is about. When the
  // job ends the block folds away (a height transition; none under reduced motion).
  var SIDE = 92, SIDE_NARROW = 64, NARROW = 320;
  function sideCss() {
    if (!root.document || document.getElementById('nk-side-css')) return;
    var st = document.createElement('style'); st.id = 'nk-side-css';
    st.textContent = ''
      + '.side-agent{--sb:var(--side-bleed,0px);display:grid;grid-template-rows:1fr;position:relative;box-sizing:border-box;min-width:0;max-width:none;'
      + 'margin:0 calc(-1 * var(--sb));border-bottom:1px solid var(--nd-line,var(--line,rgba(20,20,19,.14)));background:transparent;'
      + 'color:var(--nd-ink,var(--ink,inherit));transition:grid-template-rows .36s cubic-bezier(.2,.7,.2,1),opacity .3s,border-color .3s}'
      + '.side-agent[hidden]{display:none}'
      + '.side-agent.nk-job-off{grid-template-rows:0fr;opacity:0;border-bottom-color:transparent}'
      + '.side-agent>.nk-job{min-height:0;overflow:hidden}'
      + '.side-agent .nk-job-go{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:16px;width:100%;padding:16px var(--sb);cursor:default;border-radius:0}'
      + '.side-agent .nk-job-go[data-go]{cursor:pointer}.side-agent .nk-job-go[data-go]:hover .nk-job-do{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}'
      + '.side-agent .nk-job-go:focus-visible{outline:2px solid var(--ag-act,currentColor);outline-offset:-4px}'
      + '.side-agent .nk-job-well{flex:none;display:grid;place-items:center;width:' + (SIDE + 14) + 'px;height:' + (SIDE + 14) + 'px;border-radius:50%;'
      + 'background:color-mix(in srgb,currentColor 6%,transparent);box-shadow:inset 0 3px 8px rgba(0,0,0,.16),inset 0 -1px 0 rgba(255,255,255,.35),inset 0 0 0 1px color-mix(in srgb,currentColor 5%,transparent)}'
      + ':root[data-color-scheme="dark"] .side-agent .nk-job-well{box-shadow:inset 0 3px 10px rgba(0,0,0,.55),inset 0 -1px 0 rgba(255,255,255,.06)}'
      + '.side-agent .nk-job-t{display:grid;gap:4px;min-width:0;flex:1}'
      + '.side-agent .nk-job-role{font:600 11px/1.3 var(--font-mono,ui-monospace,monospace);letter-spacing:.08em;text-transform:uppercase;color:var(--nd-muted,var(--muted,inherit))}'
      + '.side-agent .nk-job-do{font:500 15.5px/1.35 var(--font-ui,var(--f,inherit));overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
      + '.side-agent .nk-job-st{font:11.5px/1.3 var(--font-mono,ui-monospace,monospace);color:var(--nd-muted,var(--muted,inherit))}'
      + '.side-agent.nk-job-narrow .nk-job-go{flex-direction:column;align-items:flex-start;gap:10px}'
      + '.side-agent.nk-job-narrow .nk-job-well{width:' + (SIDE_NARROW + 10) + 'px;height:' + (SIDE_NARROW + 10) + 'px}'
      + '.side-agent::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;pointer-events:none;'
      + 'background:linear-gradient(90deg,transparent,var(--ag-act,var(--accent,#C9462A)) 50%,transparent) no-repeat;background-size:38% 100%;'
      + 'animation:nk-job-run 1.8s linear infinite;transition:opacity .4s}'
      + '.side-agent.nk-job-off::after{opacity:0}'
      + '@keyframes nk-job-run{from{background-position:-60% 0}to{background-position:160% 0}}'
      + '@media (prefers-reduced-motion:reduce){.side-agent{transition:none}.side-agent::after{animation:none;background-size:100% 100%;opacity:.5}}';
    document.head.appendChild(st);
  }
  function cap1(s) { s = String(s == null ? '' : s); return s.charAt(0).toUpperCase() + s.slice(1); }
  /** The job block's markup, into a .side-agent: {role, doing, status, title, progress (0-1), size, go (a flag)}. */
  function side(r, o) {
    sideCss();
    o = typeof o === 'string' ? { doing: o } : o || {};
    var size = o.size || SIDE;
    return '<div class="nk-job"><div class="nk-job-go" role="' + (o.go ? 'button' : 'group') + '"' + (o.go ? ' tabindex="0" data-go="1"' : '') +
      (o.title ? ' title="' + esc(o.title) + '"' : '') + '><span class="nk-job-well">' +
      tag(r, { state: 'working', decorative: true, size: size, cls: 'nk-side', progress: o.progress != null ? o.progress : undefined }) +
      '</span><span class="nk-job-t"><span class="nk-job-role">' + esc(caption(r)) + '</span><span class="nk-job-do">' + esc(cap1(o.doing)) + '</span>' +
      '<span class="nk-job-st">' + esc(o.status || 'working') + '</span></span></div></div>';
  }
  function ago(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's'; }
  /** Show `job` in the side block `el`, or fold it away when job is null. job: {role, doing, title, status,
   *  progress, key, onGo}. Without a status the block counts "working · 40s" from when the job first showed. */
  function sideSet(el, job) {
    if (!el) return;
    sideCss();
    var want = job ? [job.role, job.doing, job.status || '', job.progress == null ? '' : job.progress, job.title || ''].join('|') : '';
    el._nkGo = job && job.onGo || null;
    // Without a page around it (a test's stand-in), no transition: shown or gone at once.
    if (!el.classList) { el.hidden = !job; el.innerHTML = job ? side(job.role, { doing: job.doing, title: job.title, status: job.status, progress: job.progress, go: !!job.onGo }) : ''; return; }
    if (!el._nkWired && el.addEventListener) {
      el._nkWired = true;
      var go = function (e) { if (!el._nkGo || !e.target.closest || !e.target.closest('.nk-job-go[data-go]')) return; if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); el._nkGo(); };
      el.addEventListener('click', go); el.addEventListener('keydown', go);
    }
    if (!job) {
      clearInterval(el._nkTick); el._nkTick = 0;
      if (el.hidden || el.classList.contains('nk-job-off')) return;
      el.setAttribute('data-k', '');
      el.classList.add('nk-job-off');
      var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      clearTimeout(el._nkFold); el._nkFold = setTimeout(function () { if (el.classList.contains('nk-job-off')) { el.hidden = true; el.innerHTML = ''; } }, reduce ? 0 : 420);
      return;
    }
    clearTimeout(el._nkFold);
    var k = job.key || job.role + '|' + job.doing;
    if (el._nkKey !== k) { el._nkKey = k; el._nkT0 = Date.now(); }
    var narrow = el.parentNode && el.parentNode.clientWidth > 0 && el.parentNode.clientWidth < NARROW;
    el.classList.toggle('nk-job-narrow', !!narrow);
    var stat = function () { return job.status || 'working · ' + ago(Date.now() - el._nkT0); };
    if (el.getAttribute('data-k') !== want + (narrow ? '|n' : '') || !el.innerHTML) {
      el.setAttribute('data-k', want + (narrow ? '|n' : ''));
      el.innerHTML = side(job.role, { doing: job.doing, title: job.title, status: stat(), progress: job.progress, go: !!job.onGo, size: narrow ? SIDE_NARROW : SIDE });
      auto();
    }
    clearInterval(el._nkTick);
    if (!job.status) el._nkTick = setInterval(function () { var s = el.querySelector('.nk-job-st'); if (!s || !el.isConnected) { clearInterval(el._nkTick); return; } s.textContent = stat(); }, 1000);
    if (el.hidden || el.classList.contains('nk-job-off')) {
      el.classList.add('nk-job-off'); el.hidden = false;
      void el.offsetHeight;
      el.classList.remove('nk-job-off');
    }
  }

  // ── the run stage: the thread from a rail card to the sphere, and the sphere rising to ask ──
  // A stage is any element with data-nk-stage holding the rail cards (.wcard) and the sphere's box (.aglbox).
  function css() {
    if (!root.document || document.getElementById('nk-roles-css')) return;
    var st = document.createElement('style'); st.id = 'nk-roles-css';
    st.textContent = '[data-nk-stage]{position:relative}.nk-thread{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible}';
    document.head.appendChild(st);
  }
  // the box's sphere: centre at the box's cyFrac (.45) and its ring radius, as agent-view.js sizes it
  function rimOf(box, rFrac) {
    var r = box.getBoundingClientRect(), f = rFrac || [0.27, 0.24], R = Math.min(r.height * f[0], r.width * f[1]);
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.45, rim: R + 20 };
  }
  var threadOn = false;
  /** Hovering a rail card draws a dashed thread from its inner edge to the sphere's rim (napkin-app-v1 5983-6002). */
  function thread() {
    if (threadOn || !root.document) return; threadOn = true; css();
    function svgOf(stage) { var s = stage.querySelector(':scope > .nk-thread'); if (!s) { s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'nk-thread'); s.setAttribute('aria-hidden', 'true'); stage.appendChild(s); } return s; }
    document.addEventListener('pointerover', function (e) {
      var card = e.target && e.target.closest && e.target.closest('.wcard'), stage = card && card.closest('[data-nk-stage]');
      if (!stage || (e.relatedTarget && card.contains(e.relatedTarget))) return;
      var box = stage.querySelector('.aglbox'); if (!box) return;
      var sr = stage.getBoundingClientRect(), cr = card.getBoundingClientRect(), c = rimOf(box);
      var cx = c.x - sr.left, cy = c.y - sr.top;
      var x1 = (cr.left + cr.width / 2 < c.x) ? (cr.right - sr.left) : (cr.left - sr.left), y1 = cr.top - sr.top + cr.height / 2;
      var ang = Math.atan2(y1 - cy, x1 - cx), x2 = cx + Math.cos(ang) * c.rim, y2 = cy + Math.sin(ang) * c.rim;
      svgOf(stage).innerHTML = '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="var(--ag-act, var(--ag-base))" stroke-width="1.5" stroke-dasharray="4 3" />';
    });
    document.addEventListener('pointerout', function (e) {
      var card = e.target && e.target.closest && e.target.closest('.wcard'), stage = card && card.closest('[data-nk-stage]');
      if (!stage || (e.relatedTarget && card.contains(e.relatedTarget))) return;
      var s = stage.querySelector(':scope > .nk-thread'); if (s) s.innerHTML = '';
    });
  }
  /** The agent asks: the stage gets nk-asking (its CSS eases the sphere up and shows the card under it) and the
   *  scene follows the box while it moves. on=false: the card goes and the sphere comes back down. */
  function ask(stage, on) {
    if (!stage) return;
    on = !!on;
    if (stage.classList.contains('nk-asking') === on) return;
    stage.classList.toggle('nk-asking', on);
    var S = root.NapkinScene; if (!S || !S.wake) return;
    var t0 = Date.now(), raf = root.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    (function follow() { S.wake(true); if (Date.now() - t0 < 900) raf(follow); })();
  }

  root.NapkinRoles = {
    thread: thread, ask: ask, side: side, sideSet: sideSet, SIDE: SIDE, SIDE_NARROW: SIDE_NARROW,
    ROLES: ROLES, KIND: KIND, of: of, forStage: forStage, ofDecision: ofDecision, name: name, the: the, The: The,
    job: function (r) { var m = meta(r); return m ? m.job : ''; }, mat: matOf, caption: caption,
    still: still, mount: mount, tag: tag, hydrate: hydrate, auto: auto, configure: configure, envelope: envelope
  };
  // the stage spheres the apps make themselves use the engine under this name
  if (root.NapkinAgents) root.NapkinSpheres = root.NapkinAgents;
})(typeof window !== 'undefined' ? window : globalThis);
