(function () {
  'use strict';
  var L = TerritoriesLogic, R = typeof NapkinRoles !== 'undefined' ? NapkinRoles : null, D = window.__CLAN__.data, esc = L.esc;
  var Q = new URLSearchParams(location.search);
  var shot = Q.has('shot');
  if (shot) document.body.classList.add('shot');
  var theme = Q.get('theme');
  if (theme) document.documentElement.setAttribute('data-color-scheme', theme);

  var CREW = L.crewOf(D), ALL = L.developed(D).slice().sort(L.byRank), BRAND = L.brandOf(D);
  var INS = (D.focus && D.focus.insights || []).slice().sort(function (a, b) { return a.rank - b.rank; });
  var SEEN = L.seen(D);
  var S = { id: Q.get('s') || 'arrived', ticked: {}, green: {}, steerOpen: 'cr_core', pickedSend: null, lqText: '' };
  INS.forEach(function (i) { S.ticked[i.id] = !!i.ticked; });

  function sph(role, size, state) { return R ? R.tag(role, { size: size, state: state || 'idle', decorative: true }) : ''; }
  function nm(r) { return R ? R.name(r).replace(/ agent$/i, '') : r; }
  function job(r) { return R ? R.job(r) : ''; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  function ticked() { return INS.filter(function (i) { return S.ticked[i.id]; }).length; }
  function nGreen() { return Object.keys(S.green).filter(function (k) { return S.green[k]; }).length; }
  function go(id) { return 'data-go="' + id + '"'; }

  // ---------- chrome ----------
  var STEPS = ['Pick', 'Explore', 'Greenlight'];
  function topbar(chip) {
    return '<header class="tb"><div class="brand"><span class="orb">' + sph('orchestrator', 64) + '</span><span class="pill">Napkin Studio</span></div>' +
      '<div class="doc">◎ Lunasa routes <small>saved just now</small></div><button class="tbtn">Continue in ▾</button><button class="tbtn">Share</button><span class="sp"></span>' +
      (chip ? '<span class="work' + (chip.bad ? ' bad' : '') + '"><i></i>' + esc(chip.t) + '</span>' : '') +
      '<span class="circle">☼</span><span class="av">YO</span><span class="dec">Decisions <i>6</i></span></header>';
  }
  function head(at, done) {
    var li = STEPS.map(function (s, i) {
      var cls = i < at ? 'done' : i === at ? 'now' : '';
      var go2 = i === 0 ? 'pick' : i === 1 ? 'routes' : 'greenlight';
      var dis = i > Math.max(at, done == null ? at : done);
      return '<li><button class="' + cls + '"' + (dis ? ' disabled' : ' ' + go(go2)) + (i === at ? ' aria-current="step"' : '') + '><i>' + (i < at ? '✓' : i + 1) + '</i>' + s + '</button></li>';
    }).join('');
    return '<section class="ph"><div><div class="kick">Lunasa routes</div><h1>Territories<i></i></h1></div><ol class="ring3">' + li + '</ol></section>';
  }

  // ---------- stage (agents big while they work) ----------
  function pills(list) {
    return '<div class="ptop"><div class="apills">' + list.map(function (p) { return '<span class="apill ' + (p.s || '') + '"><i></i>' + esc(p.t) + '</span>'; }).join('') + '</div>' +
      '<span class="eta">' + esc(list.eta || '') + '</span></div>';
  }
  function slip(lab, text, mark, wait, cc) {
    return '<div class="wcard' + (cc ? ' cw' : '') + '"' + (cc ? ' style="--cc:' + cc + '"' : '') + '><div class="wlab">' + esc(lab) + '</div><div class="wsnip' + (wait ? ' wait' : '') + '">' + esc(text) + '</div>' +
      (mark ? '<span class="chk' + (mark === 'now' ? ' now' : '') + '">' + (mark === 'now' ? '…' : mark === 'bad' ? '!' : '✓') + '</span>' : '') + '</div>';
  }
  function wsec(h, cards) { return '<div class="wsec"><div class="wsec-h">' + esc(h) + '</div>' + cards.join('') + '</div>'; }
  function stage(o) {
    return '<div class="pwrap">' + o.pills + '<div class="sstage' + (o.bad ? ' fail' : '') + '"><div class="rail">' + o.left + '</div><div class="score"><div class="bigorb' + (o.bad ? ' bad' : '') + '" style="--ring:' + (o.ring || 'var(--ag-base)') + '">' +
      (R ? R.tag(o.role, { size: (window.innerWidth <= 1100 ? 150 : 230), state: o.bad ? 'idle' : 'working', label: nm(o.role) + ' agent' }) : '') + '</div>' +
      '<div class="scap" aria-live="polite"><span class="abadge">' + esc(nm(o.role)) + ' agent</span><span class="l1">' + esc(o.l1) + '</span><span class="l2' + (o.bad ? ' err' : '') + '">' + esc(o.l2) + '</span></div>' + (o.under || '') + '</div>' +
      '<div class="rail">' + o.right + '</div></div>' + (o.lane || '') + '<div class="runbar">' + o.run + '</div></div>';
  }

  // ---------- booth (agents small, then notes, then tools) ----------
  function booth(o) {
    o = o || {};
    var crew = ['knowledge', 'strategy', 'research', 'review'].map(function (r) { return sph(r, 24); }).join('');
    var notes = (o.notes || []).map(function (n) {
      return '<div class="bnote' + (n.ask ? ' ask' : '') + '"><div class="bn-h">' + sph(n.role, 18) + esc(nm(n.role)) + ' · ' + esc(n.tag) + (n.ask ? '<span class="needs">Needs you</span>' : '') + '</div><div>' + n.html + '</div>' + (n.acts ? '<div class="acts">' + n.acts + '</div>' : '') + '</div>';
    }).join('');
    var lq = lookup(o.lq);
    return '<aside class="booth2" id="stab" aria-label="Booth"><div class="bh">Booth<span class="sp"></span><span class="agstack">' + crew + '</span><button>Hide ›</button></div><div class="bb">' +
      '<div class="agrow">' + sph(o.role || 'strategy', 36) + '<div><div class="who">' + esc(nm(o.role || 'strategy')) + ' agent · ' + esc(job(o.role || 'strategy')) + '</div><div class="line">' + esc(o.line || '') + '</div></div></div>' +
      (o.extra || '') + (notes ? '<div class="bsec"><h4>Notes</h4>' + notes + '</div>' : '') + lq + '</div></aside>';
  }
  function lookup(mode) {
    var open = !!mode, typed = mode === 'typed' || mode === 'busy', busy = mode === 'busy';
    var txt = typed ? 'Which Irish pubs now pour a 0.0 cider on draught?' : '';
    var btn = busy ? '<button class="b pri sm busy"><span class="spin"></span>Looking it up…</button>' : '<button class="b' + (typed ? ' pri' : '') + ' sm"' + (typed ? '' : ' disabled') + '>Look it up</button>';
    var why = busy ? 'Searching the open web. The note appears here when it is back.' : typed ? 'Enter to look it up. Only quotes that check against their page can be pinned.' : 'Type a question first.';
    var inner = '<div class="lqbox"><textarea placeholder="Ask the Research agent to look something up…" rows="2">' + esc(txt) + '</textarea><div class="foot"><span class="why' + (typed || busy ? '' : ' lock') + '">' + esc(why) + '</span>' + btn + '</div></div>';
    return '<details class="fold"' + (open ? ' open' : '') + '><summary>' + sph('research', 18) + 'Look something up</summary><div style="padding:0 12px 12px">' + inner + '</div></details>';
  }
  function shell(o) {
    var b = o.booth === false ? '' : o.booth;
    return topbar(o.chip) + '<div class="page">' + head(o.at, o.reached) + '<div class="split' + (b ? '' : ' nobooth') + '"><div>' + o.main + '</div>' + (b || '') + '</div></div>' +
      (b ? '<button class="edge">Booth ‹</button>' : '') + (o.over || '');
  }
  function shellWork(o) { return topbar(o.chip) + '<div class="page">' + head(o.at, o.at) + '<div style="padding-bottom:24px">' + o.main + '</div></div>'; }

  // ---------- step header ----------
  function stephd(k, h, p, act) { return '<header class="stephd"><div><div class="k">' + esc(k) + '</div><h2>' + esc(h) + '</h2>' + (p ? '<p>' + esc(p) + '</p>' : '') + '</div><div class="act">' + act + '</div></header>'; }
  function pri(label, g, why, o) {
    o = o || {};
    var dis = o.disabled;
    return '<button class="b pri lg' + (o.busy ? ' busy' : '') + '" ' + (dis ? 'disabled' : g ? go(g) : '') + '>' + (o.busy ? '<span class="spin"></span>' : '') + esc(label) + '</button>' +
      (why ? '<span class="why ' + (dis ? 'lock' : o.ok ? 'ok' : o.bad ? 'bad' : '') + '">' + esc(why) + '</span>' : '');
  }
  function stats(list) { return '<div class="stats2">' + list.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>'; }

  // ---------- states ----------
  var V = {};

  function researchCard() {
    var r = SEEN.research || {};
    return '<div class="srcc"><div class="band">Research</div><div class="bd"><div class="t">' + esc(r.title || 'Research') + '</div><div class="r"><span>' + r.pins + ' facts</span><span>' + r.findings + ' findings</span><span>' + (r.verified || 0) + ' verified</span></div><div class="r" style="font-weight:400;font-family:var(--font-serif);font-size:13.5px;letter-spacing:0">Built from research · draft</div></div></div>';
  }
  function flags() {
    var r = SEEN.research || {};
    return '<div class="flags"><div class="flag n"><b>Left out</b><span>' + (r.rejected || 0) + ' finding was rejected in Research. The crew never uses it.</span></div>' +
      '<div class="flag w"><b>Derived</b><span>' + (r.proposed || 0) + ' findings were worked out by an agent and nobody has verified them yet. Anything built on them says so.</span></div></div>';
  }
  V.arrived = function () {
    var main = '<div class="sheetx">' + stephd('Step 1 of 3 · What arrived', 'What arrived', 'Made from research. The crew reads it in full and quotes it by name; nothing is copied.',
      pri('Find the insights', 'finding', 'About 40 seconds. Nothing is sent until you approve a pick.')) + stats(L.statsOf(SEEN)) + '<div class="sbody">' + researchCard() + flags() + '</div></div>';
    return shell({ at: 0, main: main, booth: booth({ role: 'knowledge', line: 'I read the research (18 pins, 5 findings). Nothing copied: everything is quoted by id.',
      notes: [{ role: 'review', tag: 'flagged', html: '<span class="ref derived">fi_01JA0F2B</span> <span class="ref derived">fi_01JA0F3C</span> <span class="ref derived">fi_01JA0F4D</span> are derived. I will only ask if one of them reaches a greenlight.' }] }) });
  };
  V['arrived-empty'] = function () {
    var main = '<div class="sheetx">' + stephd('Step 1 of 3 · What arrived', 'Nothing came in with this one', 'No brief and no research were carried in, so there is nothing for the crew to read.',
      pri('Find the insights', null, 'Needs a brief or research. Start from Brief Maker or Research, then Continue in → Territories.', { disabled: true })) +
      '<div class="sbody"><div class="empty"><h3>Start from your brief or research</h3><span>Territories reads what you already made. It does not start from a blank page.</span><div class="toolrow"><button class="b">Open Brief Maker</button><button class="b">Open Research</button></div></div></div></div>';
    return shell({ at: 0, main: main, booth: booth({ role: 'knowledge', line: 'I have nothing to read yet.' }) });
  };
  V.finding = function () {
    var p = [{ t: '1. Knowledge (read)', s: 'done' }, { t: '2. Strategy (find the insights)', s: 'now' }, { t: '3. Review (check)' }]; p.eta = 'Usually about 40 seconds';
    return shellWork({ at: 0, chip: { t: 'Working · Pick' }, main: stage({ pills: pills(p), role: 'strategy', l1: 'Finding the insights', l2: 'Reading the 18 pins and 5 findings for tensions and truths.',
      left: wsec('On the desk', [slip('Research · .clan', 'Lúnasa 0.0 launch: 18 pins, 5 findings', 'ok'), slip('Left out', '1 rejected finding, never used', 'ok'), slip('Flagged', '3 derived findings, marked as derived', 'ok')]),
      right: wsec('Insights', [slip('Insight', 'Waiting for the Strategy agent', 'now', true), slip('Insight', 'They appear together when the run lands', '', true), slip('Insight', 'Nothing is invented while you wait', '', true)]),
      run: '<button class="link" ' + go('arrived') + '>← Back to what arrived</button><span class="sp"></span><button class="b sm">Stop</button>' }) });
  };
  V['finding-failed'] = function () {
    var p = [{ t: '1. Knowledge (read)', s: 'done' }, { t: '2. Strategy (find the insights)', s: 'bad' }, { t: '3. Review (check)' }];
    return shellWork({ at: 0, chip: { t: 'Stopped · Pick', bad: 1 }, main: stage({ pills: pills(p), role: 'strategy', bad: true, l1: 'The crew could not finish', l2: 'The engine stopped: the model took too long to answer. Nothing was lost.',
      left: wsec('On the desk', [slip('Research · .clan', 'Lúnasa 0.0 launch: 18 pins, 5 findings', 'ok')]), right: wsec('Insights', [slip('Insight', 'None written', 'bad', true)]),
      run: '<span class="bad">Failed at step 2 of 3.</span><span class="sp"></span><button class="link" ' + go('arrived') + '>← Back to what arrived</button><button class="b pri" ' + go('finding') + '>Try again</button>' }) });
  };

  function insRow(i) {
    var on = S.ticked[i.id], dots = i.strength === 'strong' ? 3 : i.strength === 'medium' ? 2 : 1;
    var dd = '<span class="dots2" title="' + esc(i.strength) + '">' + [0, 1, 2].map(function (k) { return '<i class="' + (i.derived && k === 0 ? 'half' : k < dots ? 'on' : '') + '"></i>'; }).join('') + '</span>';
    return '<div class="irow' + (on ? ' on' : '') + '" data-tick="' + i.id + '"><span class="box">✓</span><div><div class="kind">' + esc(i.kind === 'truth' ? 'Human truth' : i.kind === 'whatif' ? 'What if' : i.kind) + (i.derived ? ' · derived' : '') + '</div><div class="tx">' + esc(i.text) + '</div>' +
      '<div class="meta2">' + (i.theme ? '<span class="theme">' + esc(i.theme) + '</span>' : '') + (i.evidence || []).slice(0, 3).map(function (c) { return L.refChip(c, D); }).join('') + '</div></div><div class="rt">' + dd + '</div></div>';
  }
  function pickMain(none) {
    var n = ticked();
    var act = n ? pri('Explore ' + plural(n, 'insight') + ' →', 'exploring', 'Usually 2 to 3 minutes. The crew sets off on its own.') : pri('Explore →', null, 'Tick at least one insight.', { disabled: true });
    return '<div class="sheetx">' + stephd('Step 1 of 3 · Pick', 'Which insights should the crew explore?', 'Strongest first, with what each rests on. Tick or untick; add your own.', act) +
      stats(['Research · 18 pins, 5 findings', plural(INS.length, 'insight'), n + ' ticked']) + '<div class="sbody">' + INS.map(insRow).join('') +
      '<div class="addrow"><input placeholder="Add your own insight, tension or what-if…"><button class="b" disabled>Add</button></div><span class="why lock">Type something to add it. It joins the list ticked, labelled as yours.</span>' +
      '<details class="fold"><summary>Everything the crew may quote · 22 in play</summary><div style="padding:0 14px 12px;font:14px var(--font-serif);color:var(--muted)">18 facts and 4 findings from Research. Switch any off to keep it out of the run.</div></details></div></div>';
  }
  V.pick = function () {
    return shell({ at: 0, reached: 0, main: pickMain(), booth: booth({ role: 'strategy', line: 'Tick the insights the crew should explore. The strongest five are ticked for you.',
      notes: [{ role: 'knowledge', tag: 'read', html: 'Read the research (18 pins, 5 findings). Nothing copied.' }] }) });
  };
  V['pick-none'] = function () {
    INS.forEach(function (i) { S.ticked[i.id] = false; });
    var h = shell({ at: 0, reached: 0, main: pickMain(), booth: booth({ role: 'strategy', line: 'Nothing is ticked yet. Tick at least one insight and the Explore button wakes up.' }) });
    INS.forEach(function (i) { S.ticked[i.id] = !!i.ticked; }); return h;
  };

  function exploreStage(bad) {
    var p = [{ t: '1. Explore (5 agents)', s: bad ? 'bad' : 'now' }, { t: '2. Develop' }, { t: '3. Judge' }]; p.eta = bad ? '2 of 5 were back before it stopped' : '2 of 5 agents back · usually 2 to 3 minutes';
    var st = ['back', 'back', 'run', 'run', 'wait'], rn = [3, 3, 0, 0, 0], pc = [100, 100, 55, 30, 0];
    var lane = '<div class="lane">' + CREW.map(function (m, i) {
      var k = bad ? (i < 2 ? 'back' : 'stopped') : st[i];
      var word = k === 'back' ? 'Back · ' + plural(rn[i], 'route') : k === 'run' ? 'Exploring…' : k === 'stopped' ? 'Stopped' : 'Setting off';
      return '<div class="lc ' + k + '" style="--cc:' + m.colour + '"><div class="lh">' + sph(m.role, 26, k === 'run' ? 'working' : 'idle') + '<div><b>' + esc(m.short) + '</b><span>' + esc(nm(m.role)) + '</span></div></div><div class="lbar"><i style="width:' + (k === 'back' ? 100 : k === 'run' ? 34 : 0) + '%"></i></div><div class="lw">' + word + '</div></div>';
    }).join('') + '</div>';
    var heads = CREW.map(function (m) { return slip(nm(m.role) + ' · ' + m.short, m.heading, '', false, m.colour); });
    return stage({ pills: pills(p), role: bad ? 'strategy' : 'copy', bad: bad, l1: bad ? 'The crew stopped before it was back' : 'Copy agent is going the other way',
      l2: bad ? 'The engine stopped: the model took too long to answer. Your pick is saved, nothing was lost.' : 'Each agent takes its own heading. Routes appear on the next screen when all five are back.',
      lane: lane,
      left: wsec('Picked for them · ' + ticked(), INS.filter(function (i) { return S.ticked[i.id]; }).slice(0, 4).map(function (i) { return slip(i.theme || i.kind, i.text, 'ok'); })),
      right: wsec('Their headings', heads.slice(0, 4)),
      run: bad ? '<span class="bad">Failed while exploring.</span><span class="sp"></span><button class="link" ' + go('pick') + '>← Back to your pick</button><button class="b pri" ' + go('exploring') + '>Send the crew out again</button>' :
        '<button class="link" ' + go('pick') + '>← Back to your pick</button><span class="sp">Nothing needed from you.</span><button class="b sm">Stop the crew</button>' });
  }
  V.exploring = function () { return shellWork({ at: 1, chip: { t: 'Working · Explore' }, main: exploreStage(false) }); };
  V['explore-failed'] = function () { return shellWork({ at: 1, chip: { t: 'Stopped · Explore', bad: 1 }, main: exploreStage(true) }); };

  V.routes = function () {
    var cr = CREW.map(function (m) {
      var n = m.routes.length, sel = S.steerOpen === m.id;
      return '<div class="rowc" style="--cc:' + m.colour + '">' + sph(m.role, 22) + '<div>' + esc(m.name) + '<small>' + esc(m.short) + ' · ' + (n ? plural(n, 'route') : 'found nothing') + '</small></div><button class="link" data-steer="' + m.id + '">' + (sel ? 'Steering' : 'Steer') + '</button></div>';
    }).join('');
    var open = CREW.filter(function (m) { return m.id === S.steerOpen; })[0];
    var steer = open ? '<div class="steer"><div class="kind">Steer ' + esc(open.name) + ' (optional)</div><div class="btns"><button class="b sm">Go further</button><button class="b sm">Pull back</button><button class="b sm">Cross with…</button><button class="b sm">Stop</button></div><span class="why">Steering re-runs this agent only. Skip it to keep every route as it is.</span></div>' : '';
    var main = '<div class="sheetx">' + stephd('Step 2 of 3 · Explore', 'The crew is back with 10 routes', '5 agents explored on their own. 6 sources picked up, 4 routes set aside as weak.',
      pri('Review and greenlight →', 'greenlight', 'Every route is already developed and ranked. Steering is optional.')) +
      stats(['5 agents · all back', '10 routes found', '6 sources picked up', '4 set aside']) +
      '<div class="sbody"><div class="exgrid"><div class="compass">' + L.compassSvg(D, {}) + '</div><div style="display:grid;gap:8px">' + cr + steer + '</div></div></div></div>';
    return shell({ at: 1, reached: 2, main: main, booth: booth({ role: 'strategy', line: 'The crew is back. Steer any agent if you want to; you do not have to.', notes: [{ role: 'review', tag: 'close', html: '3 pairs of routes still sit close together, Still a Cider Night and Clear Head, Full Glass among them.' }] }) });
  };

  function ticks(t) {
    var out = [], mk = L.touch ? null : null;
    (t.checks || []).forEach(function (c) { if (c.kind === 'evidence' || c.kind === 'rival') out.push('<span class="tick ' + (c.status === 'ok' ? 'ok' : c.status === 'unchecked' ? 'n' : 'w') + '">' + c.kind + ' · ' + (c.status === 'unchecked' ? 'not checked' : c.status === 'ok' ? 'ok' : 'watch') + '</span>'); });
    return out.slice(0, 3).join('');
  }
  function rrow(t) {
    var on = S.green[t.id], m = CREW.filter(function (c) { return c.id === t.crew; })[0] || {};
    return '<div class="rrow' + (on ? ' on' : '') + '"><div class="pic" ' + go('world') + ' data-open="' + t.id + '" style="cursor:pointer">' + L.touch(t, 'poster', BRAND) + '</div><div ' + go('world') + ' style="cursor:pointer"><h4>' + esc(t.name) + '</h4><p>' + esc(t.thought) + '</p>' +
      '<div class="meta3"><span class="cd" style="--cc:' + (m.colour || '#888') + '"></span>' + esc(m.short || '') + '<span>·</span>' + esc(t.band === 'far_out' ? 'far out' : t.band) + ticks(t) + '</div></div>' +
      '<div class="rt"><span class="jr">Judge #' + t.rank + '</span><button class="gl2' + (on ? ' on' : '') + '" data-green="' + t.id + '" aria-pressed="' + (!!on) + '">' + (on ? '✓ Greenlit' : 'Greenlight') + '</button></div></div>';
  }
  function glMain(asking) {
    var n = nGreen();
    var act = asking ? pri('Send ' + n + ' →', null, 'Answer the question in the Booth first.', { disabled: true }) :
      n ? pri('Send ' + plural(n, 'route') + ' →', 'send', 'Choose Production or Deck Maker next.') : pri('Send →', null, 'Greenlight at least one route.', { disabled: true });
    var tools = '<div class="toolrow"><button class="b sm">▶ Present</button><button class="b sm">Compare</button><button class="b sm">Re-rank</button><span class="sp"></span><button class="b sm" ' + go('export') + '>Export…</button></div>';
    return '<div class="sheetx">' + stephd('Step 3 of 3 · Greenlight', 'Developed, then chosen', 'Ranked by the blind judge. Open a route to see it as a world, or greenlight it from its row.', act) +
      stats([plural(ALL.length, 'route'), n + ' greenlit', ALL.length + ' ranked by the blind judge']) + '<div class="sbody">' + tools + ALL.map(rrow).join('') + '</div></div>';
  }
  V.greenlight = function () {
    S.green = {}; S.green[ALL[0].id] = true;
    return shell({ at: 2, reached: 2, main: glMain(false), booth: booth({ role: 'review', line: 'I tested every route. Greenlight as many as you like; I will ask only if one needs proof.',
      extra: '<div class="bsec"><h4>Greenlit · 1</h4><div class="bnote"><div style="display:flex;justify-content:space-between"><b style="font-weight:600">' + esc(ALL[0].name) + '</b><button class="link">remove</button></div></div></div>',
      notes: [{ role: 'review', tag: 'checked', html: 'Every route was tested against the brief and the rival lines. 10 are ranked by the blind judge.' }] }) });
  };
  V['greenlight-none'] = function () {
    S.green = {};
    return shell({ at: 2, reached: 2, main: glMain(false), booth: booth({ role: 'review', line: 'I tested every route. Greenlight as many as you like; I will ask only if one needs proof.' }) });
  };
  V['greenlight-ask'] = function () {
    var t = ALL[0]; S.green = {}; S.green[t.id] = true;
    return shell({ at: 2, reached: 2, main: glMain(true), booth: booth({ role: 'review', line: 'One greenlit route rests on a finding nobody has verified.',
      notes: [{ role: 'review', tag: 'before sending', ask: true, html: '<b style="font-weight:600">' + esc(t.name) + '</b> rests on <span class="ref derived">fi_01JA0F2B</span>, which an agent worked out and nobody verified. Send it anyway?', acts: '<button class="b pri sm">Send it anyway</button><button class="b sm">Verify it first</button>' }] }) });
  };

  V.world = function () {
    var t = ALL[0], w = t.world || {}, pal = w.palette || {}; S.green = {}; S.green[t.id] = true;
    var head2 = '<div class="whd"><div><div class="k">Route 01 · found by ' + esc((CREW[0] || {}).name) + ' · Judge #' + t.rank + '</div><h2>' + esc(t.name) + '</h2><p>' + esc(t.thought) + '</p></div><div class="act">' +
      '<button class="b pri lg" ' + go('send') + '>Send 1 greenlit →</button><span class="why">✓ This route is greenlit.</span><button class="link" style="color:inherit">Take it off the list</button></div></div>';
    var jn = (D.journey || []).filter(function (j) { return j.key === 'tv' || j.key === 'poster'; }).map(function (j, i) {
      var pic = (t.pictures || []).filter(function (p) { return p.touchpoint === j.key; })[0];
      var q = j.key === 'tv' ? (w.headlines || {}).sl : (w.headlines || {}).wl;
      return '<div class="jmom"><div class="d">' + esc(j.day) + '<span>' + esc(j.where) + '</span></div><div class="q">“' + esc(q || '') + '”</div><div class="th">' + L.touch(t, j.key, BRAND) + '</div></div>';
    }).join('');
    var pics = '<div class="pstripw"><span class="mu">Pictures · 8 places · sketches, marked Mock-up</span><span style="flex:1"></span><button class="b sm">Make pictures</button></div>';
    var main = '<div class="world" style="--wbg:' + pal.bg + ';--wink:' + pal.ink + ';--wacc:' + pal.acc + ';--wsoft:' + pal.soft + '">' + head2 + '<div class="wbody"><div class="toolrow"><div class="wseg"><button class="on">A weekend with it</button><button>All on one wall</button></div><span class="sp"></span><button class="b sm">▶ Play animatic</button><button class="b sm">▶ Read it aloud</button><button class="b sm" ' + go('export') + '>Export…</button></div>' + pics + '<div class="jny">' + jn + '<div class="jmom" style="grid-template-columns:1fr auto;align-items:center"><span style="opacity:.8;font:15px var(--font-serif)">4 more moments: Instagram, radio, in-store, email.</span><button class="b sm">Show the whole weekend</button></div></div></div></div>';
    var dials = [['Wry', 'Sincere', 75], ['Quiet', 'Loud', 30], ['Everyday', 'Cinematic', 30], ['Brand subtle', 'Brand bold', 45]].map(function (d) {
      return '<div class="dial"><span>' + d[0] + '</span><div class="tr"><i style="width:' + d[2] + '%"></i><b style="left:' + d[2] + '%"></b></div><span>' + d[1] + '</span></div>'; }).join('');
    return shell({ at: 2, reached: 2, main: main, booth: booth({ role: 'strategy', line: 'This route as a campaign across one weekend. Move a dial and the words move with it.',
      extra: '<button class="link" ' + go('greenlight') + '>← All routes</button><div class="bsec"><h4>Shape the feel</h4><div style="display:grid;gap:12px;padding:6px 2px">' + dials + '</div><span class="why">The words and the layout change as you move a dial. Nothing is sent.</span></div>' +
        '<details class="fold"><summary>Lines · why · test</summary><div style="padding:0 14px 12px;font:14.5px/1.4 var(--font-serif);color:var(--muted)">' + esc((w.lines || []).slice(0, 3).join(' · ')) + '</div></details>' }) });
  };

  function sendDlg(mode) {
    var sel = mode !== 'choose', busy = mode === 'busy', done = mode === 'done';
    var body = done ? '<div class="why ok">Sent. Production opened with a Territories node on its canvas.</div>' :
      '<button class="opt' + (sel ? ' on' : '') + '"><span class="rd"></span><div><b>Production</b><span>A Territories node on the canvas. Scripts, boards and films start from each route’s world.</span></div></button>' +
      '<button class="opt"><span class="rd"></span><div><b>Deck Maker</b><span>Pitch it: the deck opens with the greenlit route as the recommendation.</span></div></button>';
    var foot = done ? '<button class="b" ' + go('greenlight') + '>Stay here</button><button class="b pri lg">Open Production →</button>' :
      '<span class="why' + (sel ? '' : ' lock') + '">' + (busy ? 'Sending… Production opens when the project is ready.' : sel ? 'The other 9 routes travel as routes not chosen.' : 'Choose where it goes.') + '</span><button class="b" ' + go('greenlight') + '>Cancel</button>' +
      (busy ? '<button class="b pri lg busy"><span class="spin"></span>Sending…</button>' : sel ? '<button class="b pri lg" ' + go('send-busy') + '>Send to Production</button>' : '<button class="b pri lg" disabled>Send</button>');
    return '<div class="veil"><div class="dlg"><h3>' + (done ? 'Sent' : 'Send 1 route onward') + '</h3>' + (done ? '' : '<p>' + esc(ALL[0].name) + ' goes with its world, lines, checks and sources.</p>') + body + '<div class="foot">' + foot + '</div></div></div>';
  }
  function underGreen() { S.green = {}; S.green[ALL[0].id] = true; return shell({ at: 2, reached: 2, main: glMain(false), booth: booth({ role: 'review', line: 'I tested every route.' }) }); }
  V.send = function () { return underGreen() + sendDlg('sel'); };
  V['send-choose'] = function () { return underGreen() + sendDlg('choose'); };
  V['send-busy'] = function () { return underGreen() + sendDlg('busy'); };
  V.sent = function () { return underGreen() + sendDlg('done'); };
  V.export = function () {
    var t = ALL[0];
    var dlg = '<div class="veil"><div class="dlg"><h3>Export</h3><p>PDFs are printed from the page. Pictures drawn from a palette read Mock-up; a picture with no rights chosen reads Rights to supply.</p>' +
      '<div class="exrow"><div><b>Territory board</b><span>PDF. Every greenlit route, in the judge’s order.</span></div><button class="b pri">Download</button></div>' +
      '<div class="exrow"><div><b>Board for the client</b><span>PDF. Same board without sources or derived marks.</span></div><button class="b">Download</button></div>' +
      '<div class="exrow"><div><b>' + esc(t.name) + '</b><span>One-pager · Judge #' + t.rank + '</span></div><span style="display:flex;gap:6px"><button class="b sm">One-pager</button><button class="b sm">Client copy</button></span></div>' +
      '<div class="exrow"><div><b>Routes as JSON</b><span>The greenlit routes as data.</span></div><button class="b">Download</button></div>' +
      '<div class="foot"><span class="why ok">Last saved: Territory board.pdf, to your downloads.</span><button class="b" ' + go('greenlight') + '>Close</button></div></div></div>';
    return underGreen() + dlg;
  };
  V['lookup-empty'] = function () {
    return shell({ at: 1, reached: 2, main: V.routes.main(), booth: booth({ role: 'research', line: 'Ask me to look something up. I search the open web and pin only quotes that check against their page.', lq: 'empty' }) });
  };
  V['lookup-typed'] = function () {
    return shell({ at: 1, reached: 2, main: V.routes.main(), booth: booth({ role: 'research', line: 'Ask me to look something up. I search the open web and pin only quotes that check against their page.', lq: 'typed' }) });
  };
  // routes' main for reuse
  V.routes.main = function () {
    var h = V.routes(); var m = /<div class="split[^>]*"><div>([\s\S]*?)<\/div><aside/.exec(h); return m ? m[1] : '';
  };

  // ---------- mount ----------
  var ORDER = ['arrived', 'arrived-empty', 'finding', 'finding-failed', 'pick', 'pick-none', 'exploring', 'explore-failed', 'routes', 'greenlight', 'greenlight-none', 'greenlight-ask', 'world', 'send-choose', 'send', 'send-busy', 'sent', 'export', 'lookup-empty', 'lookup-typed'];
  function mockbar() {
    return '<nav class="mockbar"><b>Mock</b>' + ORDER.map(function (k) { return '<a data-go="' + k + '" class="' + (k === S.id ? 'on' : '') + '">' + k + '</a>'; }).join('') + '</nav>';
  }
  function render() {
    var f = V[S.id] || V.arrived;
    document.getElementById('app').innerHTML = f() + mockbar();
    document.title = 'Territories redesign · ' + S.id;
    if (R && R.auto) R.auto();
    try { history.replaceState(null, '', '?' + (shot ? 'shot=1&' : '') + (theme ? 'theme=' + theme + '&' : '') + 's=' + S.id); } catch (e) {}
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var t = e.target, el;
    if ((el = t.closest('[data-go]')) && !el.disabled) { S.id = el.getAttribute('data-go'); render(); return; }
    if ((el = t.closest('[data-tick]'))) { var id = el.getAttribute('data-tick'); S.ticked[id] = !S.ticked[id]; render(); return; }
    if ((el = t.closest('[data-green]'))) { var g = el.getAttribute('data-green'); S.green[g] = !S.green[g]; render(); return; }
    if ((el = t.closest('[data-steer]'))) { S.steerOpen = el.getAttribute('data-steer'); render(); return; }
  });
  document.addEventListener('DOMContentLoaded', render);
  if (document.readyState !== 'loading') render();
  window.__mock = { states: ORDER, set: function (s) { S.id = s; render(); } };
})();
