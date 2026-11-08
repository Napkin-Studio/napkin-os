# Phase 11 (2026-11-08), from the brief-customisation research:
# 1 fixes (print = the sheet only, no "Built on Napkin", the right client follows the brief, logos saved once to a library)
# 2 logos that read on any ground (light/dark versions, white silhouette fallback, inverted tile, drag to reorder, one lockup)
# 3 client colours on offer ("Use <client>'s brand?", kit swatches first, shared colours, contrast nudge)
# + "Trying out": Audience (Internal / Client-facing) and a document line, to judge before keeping.

# ═══ 1. Fixes ═══
rep("      foot: \"McDonald's Ireland · Creative Brief · Built on Napkin\",", "      foot: \"McDonald's Ireland · Creative brief\",")
rep("      foot: 'Ballymaloe Foods · Creative Brief · Built on Napkin',", "      foot: 'Ballymaloe Foods · Creative brief',")
rep("      curBriefKey = btn.dataset.bpreset;\n", "      curBriefKey = btn.dataset.bpreset;\n      curClient = curBriefKey === 'ballymaloe' ? 'bal' : 'mcd';\n")
rep("  let curClient = 'mcd';", "  var curClient = 'mcd';")

# ═══ side bar: brand line, trying-out block ═══
rep('''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>''',
    '''          <button type="button" class="side-link" id="b-redraft-btn">Draft it again</button>
          <div class="brand-line" id="b-brand-line"></div>''')
rep('''          <details class="side-more">''', '''          <div class="try-out">
            <div class="try-h">Trying out <small>not decided yet</small></div>
            <div class="sp-f">Audience <span class="seg-row" id="b-aud-seg"><button type="button" data-aud="internal" aria-pressed="true">Internal</button><button type="button" data-aud="client" aria-pressed="false">Client-facing</button></span></div>
            <div class="sp-f">Doc line <span class="seg-row" id="b-doc-seg"><button type="button" data-doc="off" aria-pressed="true">Off</button><button type="button" data-doc="on" aria-pressed="false">On</button></span></div>
          </div>
          <details class="side-more">''')
# logo box editor (light / dark versions)
rep('''            <input type="file" accept="image/*" id="b-logo-file" hidden>
          </div>''', '''            <input type="file" accept="image/*" id="b-logo-file" hidden>
            <div class="logo-edit" id="b-logo-edit" hidden></div>
            <input type="file" accept="image/*" id="b-logo-vfile" hidden>
          </div>''')

# ═══ state ═══
rep("  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', accent: null, base: null, cacc: null, logos: [] });",
    r'''  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', base: null, cacc: null, logos: [], brand: null, dismissed: false, aud: 'internal', doc: 'off' });
  // Logo library: uploaded once, reused by every brief. Agency logos are the agency's own; client logos are proposals to the Brand Clan kit.
  const LIB = { agency: {}, client: {} };
  try { const l = JSON.parse(localStorage.getItem('napkin-app-logo-lib') || '{}'); Object.assign(LIB.agency, l.agency || {}); Object.assign(LIB.client, l.client || {}); } catch (e) {}
  const saveLIB = () => { try { localStorage.setItem('napkin-app-logo-lib', JSON.stringify(LIB)); } catch (e) {} };
  const kitOf = id => { const x = (typeof CLIENT_X !== 'undefined' && CLIENT_X[id]) || null, d = DIAL[id] || DIAL.mcd;
    return { v: x ? x.clan.v : 1, sw: x ? x.clan.sw : [d.col, d.ink, '#141413', '#FFFFFF'], name: d.full || d.name }; };
  const lumOf = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const contrast = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const darker = h => { const n = parseInt(h.slice(1), 16), f = v => Math.round(v * .62).toString(16).padStart(2, '0'); return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); };''')
rep("localStorage.getItem('napkin-app-brief-themes-v3')", "localStorage.getItem('napkin-app-brief-themes-v4')")
rep("localStorage.setItem('napkin-app-brief-themes-v3', JSON.stringify(BT))", "localStorage.setItem('napkin-app-brief-themes-v4', JSON.stringify(BT))")

# ═══ render: palette + logos ═══
_a = s.index("    const T = bt();\n    const P = { agency:")
_b = s.index("      : '';", _a) + len("      : '';")
s = s[:_a] + r'''    const T = bt();
    const P = { agency: ag.isDefault ? null : { id: curBrand, name: ag.name, mono: ag.short, base: ag.base, acc: ag.acc },
                client: { id: curClient, name: cl.full || cl.name, mono: cl.mono, base: cl.col, acc: cl.ink } };
    const logos = (T.logos || []).filter(l => l.kind === 'img' || P[l.kind]);
    const kit = kitOf(curClient);
    const coloured = T.tpl === 'coloured';
    const base = T.base || (coloured ? kit.sw[0] : '#2A2620'), cacc = T.cacc || (coloured ? kit.sw[1] : '#C8CBFF');
    const onDark = coloured && lumOf(base) < .45;
    pg.style.setProperty('--c-base', base); pg.style.setProperty('--c-acc', cacc);
    pg.style.setProperty('--c-on', onDark ? '#FFFFFF' : coloured ? '#141413' : '#141413');
    pg.classList.toggle('tpl-coloured', coloured);
    pg.style.setProperty('--b-accent', base);
    pg.style.setProperty('--b-bg', briefBg);
    pg.classList.toggle('ident', false);
    pg.classList.toggle('aud-client', T.aud === 'client');
    window.__briefPal = { P, kit, base, cacc, coloured };
    const near = (a, b) => { const p = x => [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; const A = p(a), B = p(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) < 60; };
    const logoHtml = l => {
      if (l.kind === 'img') return `<img class="b-logo-img ${onDark ? 'knock' : ''}" src="${l.src}" alt="Logo">`;
      const o = P[l.kind], lib = LIB[l.kind][o.id] || {};
      if (onDark && lib.dark) return `<img class="b-logo-img" src="${lib.dark}" alt="${esc(o.name)}">`;
      if (lib.light) return `<img class="b-logo-img ${onDark ? 'knock' : ''}" src="${lib.light}" alt="${esc(o.name)}">`;
      const inv = coloured && near(o.base, base);
      return `<span class="b-logo" style="--ib:${inv ? '#FFFDF8' : o.base};--if:${inv ? o.base : o.acc}">${esc(o.mono)}</span>`;
    };
    const names = logos.filter(l => l.kind !== 'img').map(l => P[l.kind].name);
    const identHtml = logos.length
      ? `<div class="b-ident ${coloured ? 'b-col' : 'b-basic'}"><span class="b-logos">${logos.map(logoHtml).join('<i class="b-x"></i>')}</span><span class="b-iname">${esc(names.join(' · '))}</span><span class="b-ikind">${T.aud === 'internal' ? 'Internal' : 'Brief'}</span></div>`
      : '';
    const prepHtml = T.aud === 'client' && P.agency ? `<p class="b-prep">Prepared for ${esc(P.client.name)} · Prepared by ${esc(P.agency.name)}</p>` : '';''' + s[_b:]
rep('''          <h2>${data.title}</h2>''', '''          <h2>${data.title}</h2>${prepHtml}''')
rep('''      <span>${data.foot}</span>''', '''      <span>${data.foot}</span>${bt().doc === 'on' ? `<span class="b-docline">v1.3 · ${BRIEF_DATA[curBriefKey].parts.some(x => x.needs) ? 'Draft' : 'Ready'} · Owner Siobhán Ryan · Approver — · 28 Oct 2026 · ${bt().aud === 'client' ? 'Client copy' : 'Confidential'}</span>` : ''}''')

# ═══ side bar wiring ═══
_a = s.index("  function syncThemeUI() {")
_b = s.index("  $('b-tpl-seg').querySelectorAll('button').forEach(b =>", _a)
s = s[:_a] + r'''  function syncThemeUI() {
    const T = bt();
    $('b-tpl-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tpl === T.tpl)));
    $('b-aud-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.aud === T.aud)));
    $('b-doc-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.doc === T.doc)));
    syncBrandLine(); syncColours(); syncLogoBoxes();
  }
  function syncBrandLine() {
    const T = bt(), kit = kitOf(curClient), h = $('b-brand-line');
    if (T.brand) h.innerHTML = `<span class="bl-dot" style="background:${kit.sw[0]}"></span><span><b>${esc(kit.name)}'s brand</b><small>Brand Clan v${kit.v}</small></span><span class="bl-acts"><button type="button" class="side-link" data-brand="reset">Reset to kit</button><button type="button" class="side-link" data-brand="detach">Detach</button></span>`;
    else if (!T.dismissed) h.innerHTML = `<span class="bl-dot" style="background:${kit.sw[0]}"></span><span>Use <b>${esc(kit.name)}'s</b> brand?<small>Logos and colours from the Brand Clan kit</small></span><span class="bl-acts"><button type="button" class="bl-apply" data-brand="apply">Apply</button><button type="button" class="bl-x" data-brand="dismiss" title="Not now">×</button></span>`;
    else h.innerHTML = '';
    h.hidden = !h.innerHTML;
  }
  function colourRow(label, key, opts, cur) {
    cur = (cur || '').toLowerCase();
    const uniq = [...new Map(opts.filter(Boolean).map(c => [c.toLowerCase(), c])).values()];
    return `<div class="acc-row"><span class="acc-l">${label}</span><span class="acc-sw">${uniq.map((c, i) => `<button type="button" data-crow="${key}" data-c="${c}" aria-pressed="${c.toLowerCase() === cur}" style="--sw:${c}" title="${c}"></button>${i === 1 && uniq.length > 3 ? '<i class="sw-gap"></i>' : ''}`).join('')}</span>`
      + `<label class="acc-pick" title="Pick any colour"><input type="color" data-cpick="${key}" value="${cur || '#000000'}"></label></div>`;
  }
  function syncColours() {
    const T = bt(), pal = window.__briefPal, kit = pal.kit, P = pal.P;
    const kitSw = kit.sw.filter(c => c.toLowerCase() !== '#ffffff');
    let html = T.tpl === 'basic'
      ? colourRow('Accent', 'base', [...kitSw.slice(0, 2), P.agency && P.agency.base, '#2A2620', '#C9462A', '#1F5FAF'], pal.base)
      : colourRow('Base', 'base', [...kitSw, P.agency && P.agency.base, '#141413', '#1F5FAF'], pal.base)
        + colourRow('Accent', 'cacc', [...kit.sw.slice(1), P.agency && P.agency.acc, '#F6E36B', '#C8CBFF'], pal.cacc);
    const cr = T.tpl === 'basic' ? contrast(pal.base, '#FFFDF8') : Math.min(contrast(pal.cacc, pal.base), 99);
    if (cr < 3) html += `<p class="cr-nudge">Low contrast (${cr.toFixed(1)}:1), hard to read. <button type="button" class="side-link" data-fix="${T.tpl === 'basic' ? 'base' : 'cacc'}">Use a darker shade</button></p>`;
    $('b-colour-rows').innerHTML = html;
  }
  let editLogo = null;
  function syncLogoBoxes() {
    const T = bt(), P = window.__briefPal.P, L = T.logos || [];
    const inner = l => {
      if (l.kind === 'img') return `<img src="${l.src}" alt="">`;
      const o = P[l.kind]; if (!o) return ''; const lib = LIB[l.kind][o.id] || {};
      return lib.light ? `<img src="${lib.light}" alt="">` : `<span class="lb-tile" style="background:${o.base};color:${o.acc}">${esc(o.mono)}</span>`;
    };
    const label = l => l.kind === 'img' ? 'Image' : P[l.kind] ? P[l.kind].name : '';
    $('b-logo-boxes').innerHTML = L.map((l, i) => `<span class="lbox ${editLogo === i ? 'on' : ''}" draggable="true" data-li="${i}" title="Click to set versions · drag to reorder">${inner(l)}<small>${esc(label(l))}</small><button type="button" class="lb-rm" data-rm="${i}" title="Remove">×</button></span>`).join('')
      + (L.length < 3 ? `<button type="button" class="lbox lb-add" id="b-logo-addbox" title="Add a logo"><b>+</b><small>Add logo</small></button>` : '');
    const m = $('b-logo-menu');
    m.querySelector('[data-add="agency"]').textContent = P.agency ? 'Agency · ' + P.agency.name : 'Agency';
    m.querySelector('[data-add="agency"]').hidden = !P.agency || L.some(l => l.kind === 'agency');
    m.querySelector('[data-add="client"]').textContent = 'Client · ' + P.client.name;
    m.querySelector('[data-add="client"]').hidden = L.some(l => l.kind === 'client');
    const ed = $('b-logo-edit'), l = L[editLogo];
    if (!l || l.kind === 'img') { ed.hidden = true; ed.innerHTML = ''; return; }
    const o = P[l.kind], lib = LIB[l.kind][o.id] || {};
    const slot = (v, lab, bg) => `<div class="le-slot"><span class="le-prev" style="background:${bg}">${lib[v] ? `<img src="${lib[v]}" alt="">` : '<small>None</small>'}</span><span><b>${lab}</b><button type="button" class="side-link" data-vup="${v}">${lib[v] ? 'Replace' : 'Upload'}</button>${lib[v] ? `<button type="button" class="side-link" data-vrm="${v}">Remove</button>` : ''}</span></div>`;
    ed.hidden = false;
    ed.innerHTML = `<div class="le-h">${esc(o.name)} logo</div>${slot('light', 'On light', '#FFFDF8')}${slot('dark', 'On dark', '#141413')}<p class="le-note">${l.kind === 'agency' ? 'Saved to your agency library. Every brief uses it.' : 'Sent to the Brand Clan kit as a proposal. Used here now.'} Without a dark version, a white silhouette is used on dark covers.</p>`;
  }
''' + s[_b:]
rep("  $('look-inspector').addEventListener('click', e => {\n    const sw = e.target.closest('[data-crow]');", r'''  $('look-inspector').addEventListener('click', e => {
    const br = e.target.closest('[data-brand]');
    if (br) {
      e.stopPropagation(); const T = bt(), kit = kitOf(curClient), a = br.dataset.brand;
      if (a === 'apply' || a === 'reset') {
        T.brand = curClient + '@v' + kit.v; T.base = kit.sw[0]; T.cacc = kit.sw[1];
        if (!T.logos.some(l => l.kind === 'client')) T.logos.unshift({ kind: 'client' });
        if (!T.logos.some(l => l.kind === 'agency') && !AGENCIES[curBrand].isDefault) T.logos.push({ kind: 'agency' });
        showToast(a === 'apply' ? kit.name + "'s brand applied: logos and colours from Brand Clan v" + kit.v + '.' : 'Reset to the Brand Clan kit.');
      } else if (a === 'detach') { T.brand = null; T.dismissed = true; showToast('Detached. Your colours and logos stay; kit updates won’t apply.'); }
      else if (a === 'dismiss') { T.dismissed = true; }
      saveBT(); renderBriefPage(); return;
    }
    const fx = e.target.closest('[data-fix]');
    if (fx) { const T = bt(), pal = window.__briefPal; T[fx.dataset.fix] = darker(fx.dataset.fix === 'base' ? pal.base : pal.cacc); saveBT(); renderBriefPage(); return; }
    const vu = e.target.closest('[data-vup]');
    if (vu) { e.stopPropagation(); $('b-logo-vfile').dataset.v = vu.dataset.vup; $('b-logo-vfile').click(); return; }
    const vr = e.target.closest('[data-vrm]');
    if (vr) { e.stopPropagation(); const l = bt().logos[editLogo], o = window.__briefPal.P[l.kind]; delete (LIB[l.kind][o.id] || {})[vr.dataset.vrm]; saveLIB(); renderBriefPage(); return; }
    const lb = e.target.closest('.lbox[data-li]');
    if (lb && !e.target.closest('[data-rm]')) { e.stopPropagation(); editLogo = editLogo === +lb.dataset.li ? null : +lb.dataset.li; syncLogoBoxes(); return; }
    const sw = e.target.closest('[data-crow]');''')
rep("    if (rm) { e.stopPropagation(); bt().logos.splice(+rm.dataset.rm, 1); saveBT(); renderBriefPage(); return; }",
    "    if (rm) { e.stopPropagation(); bt().logos.splice(+rm.dataset.rm, 1); editLogo = null; saveBT(); renderBriefPage(); return; }")
rep("  $('b-logo-file').addEventListener('change', () => {", r'''  $('b-logo-vfile').addEventListener('change', () => {
    const f = $('b-logo-vfile').files[0]; if (!f) return;
    const l = bt().logos[editLogo], o = window.__briefPal.P[l.kind], v = $('b-logo-vfile').dataset.v;
    const rd = new FileReader();
    rd.onload = () => {
      LIB[l.kind][o.id] = LIB[l.kind][o.id] || {}; LIB[l.kind][o.id][v] = rd.result; saveLIB(); renderBriefPage();
      showToast(l.kind === 'agency' ? o.name + ' logo saved to your agency library.' : o.name + ' logo proposed to the Brand Clan kit.');
    };
    rd.readAsDataURL(f); $('b-logo-vfile').value = '';
  });
  // drag logo boxes to reorder
  let lDrag = null;
  $('b-logo-boxes').addEventListener('dragstart', e => { const b = e.target.closest('[data-li]'); if (!b) return; lDrag = +b.dataset.li; e.dataTransfer.setData('text/plain', String(lDrag)); });
  $('b-logo-boxes').addEventListener('dragover', e => { if (lDrag !== null && e.target.closest('[data-li]')) e.preventDefault(); });
  $('b-logo-boxes').addEventListener('drop', e => {
    const b = e.target.closest('[data-li]'); if (lDrag === null || !b) return; e.preventDefault();
    const L = bt().logos, to = +b.dataset.li, [m] = L.splice(lDrag, 1); L.splice(to, 0, m); lDrag = null; editLogo = null; saveBT(); renderBriefPage();
  });
  $('b-aud-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().aud = b.dataset.aud; saveBT(); renderBriefPage(); }));
  $('b-doc-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().doc = b.dataset.doc; saveBT(); renderBriefPage(); }));
  $('b-logo-file').addEventListener('change', () => {''')

# ═══ CSS ═══
rep(".colour-rows { display: grid; }", r""".colour-rows { display: grid; }
.sw-gap { width: 1px; height: 16px; background: var(--line); align-self: center; margin: 0 2px; }
.cr-nudge { margin-top: 8px; font-size: 12px; color: var(--warn); line-height: 1.4; }
.brand-line { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: #fff; font-size: 13px; }
.brand-line small { display: block; font-size: 11.5px; color: var(--muted); }
.bl-dot { width: 12px; height: 12px; border-radius: 50%; }
.bl-acts { display: flex; align-items: center; gap: 8px; }
.bl-apply { height: 28px; padding: 0 12px; border-radius: 999px; border: 0; background: var(--ink); color: var(--paper); font: 600 12px var(--font-ui); cursor: pointer; }
.bl-x { width: 22px; height: 22px; border: 0; background: none; color: var(--muted); font-size: 16px; cursor: pointer; }
.lbox { cursor: pointer; }
.lbox.on { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.logo-edit { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 10px; display: grid; gap: 8px; background: #fff; }
.le-h { font: 700 12.5px var(--font-ui); }
.le-slot { display: flex; align-items: center; gap: 10px; }
.le-slot b { display: block; font: 600 12px var(--font-ui); }
.le-slot .side-link { font-size: 12px; margin-right: 10px; }
.le-prev { width: 64px; height: 40px; border-radius: 6px; border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden; }
.le-prev img { max-width: 56px; max-height: 30px; object-fit: contain; }
.le-prev small { font-size: 10px; color: #8A8A84; }
.le-note { font-size: 11.5px; color: var(--muted); line-height: 1.4; }
.try-out { border: 1px dashed #9A9A94; border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; }
.try-h { font: 700 10.5px var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #6A6A64; }
.try-h small { font: 500 10.5px var(--font-ui); letter-spacing: 0; text-transform: none; color: #8A8A84; margin-left: 6px; }
.try-out .sp-f { grid-template-columns: 70px 1fr; }
/* one lockup: equal height, hairline between, names never overflow */
.b-logos { gap: 14px; }
.b-logo-img { height: 32px; width: auto; max-width: 140px; object-fit: contain; }
.b-logo-img.knock { filter: brightness(0) invert(1); }
.b-logo { width: 36px; height: 36px; font-size: 13px; }
.b-iname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.b-ident { min-width: 0; }
.brief-page.phone .b-ident { flex-wrap: wrap; }
.brief-page.phone .b-iname { white-space: normal; flex-basis: 100%; order: 3; }
.brief-page.phone.tpl-coloured .b-cover { padding: 22px 22px 26px; }
.brief-page.phone.tpl-coloured .b-cover h2 { font-size: 30px; }
.brief-page.phone.tpl-coloured .b-cover::after { width: 150px; height: 150px; right: -50px; bottom: -100px; }
.b-prep { font: 600 11px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; opacity: .75; margin-top: 8px; }
.b-docline { font: 10.5px var(--font-mono); letter-spacing: .04em; opacity: .8; }
.brief-page.aud-client .gi.needs::after { display: none; }
/* print: only the sheet, on A4 */
@page { size: A4; margin: 12mm; }
@media print {
  body { background: #fff !important; padding: 0 !important; }
  body * { visibility: hidden !important; }
  #brief-page, #brief-page * { visibility: visible !important; }
  #brief-page { position: absolute; left: 0; top: 0; width: 100%; max-width: none; box-shadow: none; border: 0; }
  .gi-grip, .gi-resize, .bm-tab, .bm-sheet::before, .bm-sheet::after { display: none !important; }
  .gi.sel, .gi:hover { background: none !important; box-shadow: none !important; }
}""")

# ═══ polish ═══
rep('''<span><b>${esc(kit.name)}'s brand</b><small>Brand Clan v${kit.v}</small></span>''', '''<span><b>${esc(kit.name)}</b><small>Brand applied · Brand Clan v${kit.v}</small></span>''')
rep('''<span>Use <b>${esc(kit.name)}'s</b> brand?<small>Logos and colours from the Brand Clan kit</small></span>''', '''<span>Apply the <b>${esc(kit.name)}</b> brand?<small>Logos and colours from its Brand Clan kit</small></span>''')
rep(".brand-line { display: grid; grid-template-columns: 12px 1fr auto;", ".brand-line { display: grid; grid-template-columns: 12px 1fr;")
rep(".bl-acts { display: flex; align-items: center; gap: 8px; }", ".bl-acts { grid-column: 2; display: flex; align-items: center; gap: 12px; }\n.bl-x { margin-left: auto; }")
rep('''<button type="button" class="side-link" data-fix="${T.tpl === 'basic' ? 'base' : 'cacc'}">Use a darker shade</button>''',
    '''<button type="button" class="side-link" data-fix="${T.tpl === 'basic' ? 'base' : 'cacc'}">${T.tpl === 'coloured' && lumOf(pal.base) < .45 ? 'Use a lighter shade' : 'Use a darker shade'}</button>''')
rep("    if (fx) { const T = bt(), pal = window.__briefPal; T[fx.dataset.fix] = darker(fx.dataset.fix === 'base' ? pal.base : pal.cacc); saveBT(); renderBriefPage(); return; }",
    "    if (fx) { const T = bt(), pal = window.__briefPal, k = fx.dataset.fix, cur = k === 'base' ? pal.base : pal.cacc;\n"
    "      const light = T.tpl === 'coloured' && lumOf(pal.base) < .45;\n"
    "      const lighter = h => { const n = parseInt(h.slice(1), 16), f = v => Math.round(v + (255 - v) * .55).toString(16).padStart(2, '0'); return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); };\n"
    "      let c = cur; for (let i = 0; i < 6 && (k === 'base' ? contrast(c, '#FFFDF8') : contrast(c, pal.base)) < 3; i++) c = light ? lighter(c) : darker(c);\n"
    "      T[k] = c; saveBT(); renderBriefPage(); return; }")
