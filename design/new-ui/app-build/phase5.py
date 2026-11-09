# Phase 5 (2026-11-08): the selected part's actions also live in the side tab; logos on the brief
# (Napkin = the Deep O mark; agency / client = a logo from the Brand Clan kit, added here as an image).

# ═══ 1. Side tab: a "Selected part" block and a Logo slot ═══
rep('''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>''',
    '''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>
          <div class="side-part" id="side-part" hidden></div>''')
rep('''          <div>
            <h4>Cover</h4>''', '''          <div id="b-logo-row" hidden>
            <h4>Logo</h4>
            <div class="logo-row"><span class="logo-prev" id="b-logo-prev"></span>
              <span class="logo-acts"><button type="button" class="side-link" id="b-logo-add">Add logo…</button><button type="button" class="side-link" id="b-logo-clear" hidden>Remove</button><small id="b-logo-src">From the Brand Clan kit</small></span></div>
            <input type="file" accept="image/*" id="b-logo-file" hidden>
          </div>
          <div>
            <h4>Cover</h4>''')

# clicks in the side tab keep the selection
rep("  document.addEventListener('click', e => { if (selIdx !== null && !e.composedPath().includes($('brief-page'))) {",
    "  document.addEventListener('click', e => { if (selIdx !== null && !e.composedPath().some(n => n === $('brief-page') || n === $('look-inspector'))) {")

# ═══ 2. Logos ═══
rep("  let briefIdent = 'napkin';", r'''  let briefIdent = 'napkin';
  const LOGOS = {};
  try { Object.assign(LOGOS, JSON.parse(localStorage.getItem('napkin-app-logos') || '{}')); } catch (e) {}
  const logoKey = () => briefIdent === 'agency' ? 'agency:' + curBrand : 'client:' + curClient;''')
rep('''    const ident = briefIdent === 'agency' && !ag.isDefault ? { name: ag.name, mono: ag.short, bg: ag.base, fg: ag.acc, kind: 'Agency' }
      : briefIdent === 'client' ? { name: cl.full || cl.name, mono: cl.mono, bg: cl.col, fg: cl.ink, kind: 'Client' } : null;''',
    '''    const ident = briefIdent === 'agency' && !ag.isDefault ? { name: ag.name, mono: ag.short, bg: ag.base, fg: ag.acc, kind: 'Agency', img: LOGOS['agency:' + curBrand] }
      : briefIdent === 'client' ? { name: cl.full || cl.name, mono: cl.mono, bg: cl.col, fg: cl.ink, kind: 'Client', img: LOGOS['client:' + curClient] } : null;''')
rep('''    const identHtml = ident ? `<div class="b-ident" style="--ib:${ident.bg};--if:${ident.fg}"><span class="b-logo">${esc(ident.mono)}</span><span class="b-iname">${esc(ident.name)}</span><span class="b-ikind">${ident.kind} brief</span></div>` : '';''',
    '''    const napkinMark = window.DeepO ? DeepO.staticSVG(40, '#515BFF', '#FFFDF8') : '';
    const identHtml = ident
      ? `<div class="b-ident" style="--ib:${ident.bg};--if:${ident.fg}">${ident.img ? `<img class="b-logo-img" src="${ident.img}" alt="${esc(ident.name)} logo">` : `<span class="b-logo">${esc(ident.mono)}</span>`}<span class="b-iname">${esc(ident.name)}</span><span class="b-ikind">${ident.kind} brief</span></div>`
      : `<div class="b-ident b-napkin"><span class="b-dO">${napkinMark}</span><span class="b-iname">Napkin Studio</span><span class="b-ikind">Brief</span></div>`;''')
rep("  $('b-ident-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {", r'''  function syncLogoRow() {
    const show = briefIdent !== 'napkin'; $('b-logo-row').hidden = !show; if (!show) return;
    const src = LOGOS[logoKey()];
    $('b-logo-prev').innerHTML = src ? `<img src="${src}" alt="">` : '<span>No logo</span>';
    $('b-logo-add').textContent = src ? 'Replace…' : 'Add logo…';
    $('b-logo-clear').hidden = !src;
    $('b-logo-src').textContent = briefIdent === 'agency' ? 'From your agency profile' : 'From the Brand Clan kit';
  }
  $('b-logo-add').addEventListener('click', () => $('b-logo-file').click());
  $('b-logo-file').addEventListener('change', () => {
    const f = $('b-logo-file').files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { LOGOS[logoKey()] = rd.result; try { localStorage.setItem('napkin-app-logos', JSON.stringify(LOGOS)); } catch (e) {} syncLogoRow(); renderBriefPage(); };
    rd.readAsDataURL(f); $('b-logo-file').value = '';
  });
  $('b-logo-clear').addEventListener('click', () => { delete LOGOS[logoKey()]; try { localStorage.setItem('napkin-app-logos', JSON.stringify(LOGOS)); } catch (e) {} syncLogoRow(); renderBriefPage(); });
  $('b-ident-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {''')
rep("    briefIdent = b.dataset.ident;\n", "    briefIdent = b.dataset.ident;\n    syncLogoRow();\n")

# ═══ 3. Selected part's actions in the side tab ═══
rep("    pg.innerHTML = coverHtml + `<div class=\"b-grid\">${blocksHtml}</div>` + footHtml;",
    "    pg.innerHTML = coverHtml + `<div class=\"b-grid\">${blocksHtml}</div>` + footHtml;\n    renderSidePart(data);")
rep("  function renderBriefPage() {", r'''  function renderSidePart(data) {
    const host = $('side-part'); if (!host) return;
    const p = selIdx !== null ? data.parts[selIdx] : null;
    if (!p) { host.hidden = true; host.innerHTML = ''; return; }
    const sel = (prop, opts, cur, fmt) => `<select data-sp-prop="${prop}">${opts.map(o => `<option value="${o}" ${String(cur) === String(o) ? 'selected' : ''}>${fmt ? fmt(o) : o}</option>`).join('')}</select>`;
    host.hidden = false;
    host.innerHTML = `<h4>Selected part</h4><b class="sp-name">${p.n}</b>
      <div class="sp-acts"><button type="button" class="sp-btn sp-edit" data-sp-act="edit">${editIdx === selIdx ? 'Done' : 'Edit'}</button><button type="button" class="sp-btn" data-sp-act="redraft">Redraft…</button></div>
      ${p.as !== 'cell' ? `<label class="sp-f">Show as ${sel('as', ['prose', 'bullets', 'callout', 'statement', 'cell'], p.as)}</label>
      <label class="sp-f">Width ${sel('span', [3, 4, 6, 8, 9, 12], p.span || 12, o => o + '/12')}</label>
      <label class="sp-f">Tone ${sel('tone', ['plain', 'tint', 'inverse'], p.tone || 'plain')}</label>` : ''}
      <div class="sp-acts"><button type="button" class="sp-btn" data-sp-act="up">↑ Move up</button><button type="button" class="sp-btn" data-sp-act="down">↓ Move down</button></div>
      ${p.needs ? '<p class="sp-needs">This part needs your call. Answer it on the brief.</p>' : ''}`;
  }

  function renderBriefPage() {''')
rep('''  // Answer what needs you''', r'''  // Side tab actions for the selected part
  $('look-inspector').addEventListener('change', e => {
    const s = e.target.closest('[data-sp-prop]'); if (!s || selIdx === null) return;
    const p = BRIEF_DATA[curBriefKey].parts[selIdx];
    p[s.dataset.spProp] = s.dataset.spProp === 'span' ? +s.value : s.value;
    renderBriefPage();
  });
  $('look-inspector').addEventListener('click', e => {
    const b = e.target.closest('[data-sp-act]'); if (!b || selIdx === null) return;
    e.stopPropagation();
    const data = BRIEF_DATA[curBriefKey], i = selIdx, act = b.dataset.spAct;
    if (act === 'edit') {
      if (editIdx === i) { const el = $('brief-page').querySelector('[data-body="' + i + '"]'); if (el) saveBody(el); editIdx = null; renderBriefPage(); }
      else startEdit(i);
    } else if (act === 'redraft') {
      const gi = $('brief-page').querySelector('.gi[data-idx="' + i + '"]');
      askRedraft(gi, i, false); gi && gi.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const j = i + (act === 'up' ? -1 : 1); if (j < 0 || j >= data.parts.length) return;
      [data.parts[i], data.parts[j]] = [data.parts[j], data.parts[i]]; selIdx = j; renderBriefPage();
    }
  });

  // Answer what needs you''')

# ═══ 4. CSS ═══
rep(".chrome-bar { white-space: nowrap;", r""".side-part { border: 1px solid var(--line-strong); border-radius: 8px; padding: 12px; display: grid; gap: 9px; background: #fff; }
.side-part h4 { margin: 0; }
.sp-name { font: 700 14px var(--font-ui); letter-spacing: -.01em; }
.sp-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.sp-btn { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); font: 600 12px var(--font-ui); cursor: pointer; }
.sp-btn:hover { border-color: var(--ink); }
.sp-edit { color: var(--bm-red); border-color: color-mix(in srgb, var(--bm-red) 40%, transparent); }
.sp-f { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 8px; font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.sp-f select { height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); font: 13px var(--font-ui); text-transform: none; letter-spacing: 0; color: var(--ink); padding: 0 6px; }
.sp-needs { font-size: 12px; color: var(--warn); }
.logo-row { display: flex; align-items: center; gap: 12px; }
.logo-prev { width: 52px; height: 52px; border-radius: 10px; border: 1px dashed var(--line-strong); display: grid; place-items: center; overflow: hidden; background: #fff; flex: none; }
.logo-prev img { max-width: 100%; max-height: 100%; object-fit: contain; }
.logo-prev span { font: 600 9.5px var(--font-mono); color: var(--faint); text-transform: uppercase; }
.logo-acts { display: grid; gap: 3px; }
.logo-acts small { font-size: 11.5px; color: var(--muted); }
.b-logo-img { height: 40px; max-width: 160px; object-fit: contain; }
.b-napkin { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 14%, transparent) !important; }
.b-dO { display: inline-flex; width: 36px; height: 36px; }
.b-dO svg { width: 100%; height: 100%; }
.chrome-bar { white-space: nowrap;""")
