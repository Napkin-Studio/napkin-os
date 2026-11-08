# Phase 10 (2026-11-08): no Napkin in the brief's branding. Basic = accent colour; Coloured = base + accent
# colours. Logos are boxes: add the agency's, the client's or an uploaded image (co-branding allowed).

# ═══ side bar markup ═══
_a = s.index('            <div class="acc-row" id="b-acc-row">')
_b = s.index('<input type="file" accept="image/*" id="b-logo-file" hidden>\n          </div>', _a) + len('<input type="file" accept="image/*" id="b-logo-file" hidden>\n          </div>')
s = s[:_a] + '''            <div class="colour-rows" id="b-colour-rows"></div>
          </div>
          <div>
            <h4>Logos</h4>
            <div class="logo-boxes" id="b-logo-boxes"></div>
            <div class="logo-menu" id="b-logo-menu" hidden>
              <button type="button" data-add="agency"></button>
              <button type="button" data-add="client"></button>
              <button type="button" data-add="img">Upload an image…</button>
            </div>
            <input type="file" accept="image/*" id="b-logo-file" hidden>
          </div>''' + s[_b:]

# ═══ state ═══
rep("localStorage.getItem('napkin-app-brief-themes-v2')", "localStorage.getItem('napkin-app-brief-themes-v3')")
rep("localStorage.setItem('napkin-app-brief-themes-v2', JSON.stringify(BT))", "localStorage.setItem('napkin-app-brief-themes-v3', JSON.stringify(BT))")
rep("  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', logo: 'napkin' });",
    "  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', accent: null, base: null, cacc: null, logos: [] });")

# ═══ render ═══
_a = s.index("    const T = bt();\n    const OWN = {")
_b = s.index('<span class="b-ikind">Brief</span></div>`;', _a) + len('<span class="b-ikind">Brief</span></div>`;')
s = s[:_a] + r'''    const T = bt();
    const P = { agency: ag.isDefault ? null : { name: ag.name, mono: ag.short, base: ag.base, acc: ag.acc },
                client: { name: cl.full || cl.name, mono: cl.mono, base: cl.col, acc: cl.ink } };
    const logos = (T.logos || []).filter(l => l.kind === 'img' || P[l.kind]);
    const first = logos.map(l => P[l.kind]).find(Boolean) || P.client;
    const coloured = T.tpl === 'coloured', base = T.base || first.base, cacc = T.cacc || first.acc;
    const lum = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
    pg.style.setProperty('--c-base', base); pg.style.setProperty('--c-acc', cacc);
    pg.style.setProperty('--c-on', lum(base) > .45 ? '#141413' : '#FFFFFF');
    pg.classList.toggle('tpl-coloured', coloured);
    pg.style.setProperty('--b-accent', coloured ? base : (T.accent || briefAccent));
    pg.style.setProperty('--b-bg', briefBg);
    pg.classList.toggle('ident', false);
    window.__briefPal = { P, first };
    const logoHtml = l => l.kind === 'img' ? `<img class="b-logo-img" src="${l.src}" alt="Logo">` : `<span class="b-logo" style="--ib:${P[l.kind].base};--if:${P[l.kind].acc}">${esc(P[l.kind].mono)}</span>`;
    const names = logos.filter(l => l.kind !== 'img').map(l => P[l.kind].name);
    const identHtml = logos.length
      ? `<div class="b-ident ${coloured ? 'b-col' : 'b-basic'}"><span class="b-logos">${logos.map(logoHtml).join('<i class="b-x"></i>')}</span><span class="b-iname">${esc(names.join(' × '))}</span><span class="b-ikind">Brief</span></div>`
      : '';''' + s[_b:]

# ═══ side bar wiring ═══
_a = s.index("  function syncThemeUI() {")
_b = s.index("  // Side tab actions for the selected part", _a)
s = s[:_a] + r'''  function syncThemeUI() {
    const T = bt();
    $('b-tpl-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tpl === T.tpl)));
    syncColours(); syncLogoBoxes();
  }
  function colourRow(label, key, opts, cur) {
    cur = (cur || '').toLowerCase();
    const uniq = [...new Map(opts.filter(Boolean).map(c => [c.toLowerCase(), c])).values()];
    return `<div class="acc-row"><span class="acc-l">${label}</span><span class="acc-sw">${uniq.map(c => `<button type="button" data-crow="${key}" data-c="${c}" aria-pressed="${c.toLowerCase() === cur}" style="--sw:${c}" title="${c}"></button>`).join('')}</span>`
      + `<label class="acc-pick" title="Pick any colour"><input type="color" data-cpick="${key}" value="${cur || '#000000'}"></label></div>`;
  }
  function syncColours() {
    const T = bt(), pal = window.__briefPal || { P: {}, first: { base: '#1E22AA', acc: '#FFB800' } }, P = pal.P;
    $('b-colour-rows').innerHTML = T.tpl === 'basic'
      ? colourRow('Accent', 'accent', ['#2A2620', P.client && P.client.base, P.agency && P.agency.base, '#C9462A', '#2F6B3A', '#1F5FAF'], T.accent || '#2A2620')
      : colourRow('Base', 'base', [P.client && P.client.base, P.agency && P.agency.base, '#141413', '#1F5FAF', '#2F6B3A', '#7A1E1E'], T.base || pal.first.base)
        + colourRow('Accent', 'cacc', [P.client && P.client.acc, P.agency && P.agency.acc, '#FFB800', '#F6E36B', '#C8CBFF', '#FFFFFF'], T.cacc || pal.first.acc);
  }
  function syncLogoBoxes() {
    const T = bt(), P = (window.__briefPal || { P: {} }).P, L = T.logos || [];
    const inner = l => l.kind === 'img' ? `<img src="${l.src}" alt="">` : P[l.kind] ? `<span class="lb-tile" style="background:${P[l.kind].base};color:${P[l.kind].acc}">${esc(P[l.kind].mono)}</span>` : '';
    const label = l => l.kind === 'img' ? 'Image' : P[l.kind] ? P[l.kind].name : '';
    $('b-logo-boxes').innerHTML = L.map((l, i) => `<span class="lbox" title="${esc(label(l))}">${inner(l)}<small>${esc(label(l))}</small><button type="button" class="lb-rm" data-rm="${i}" title="Remove">×</button></span>`).join('')
      + (L.length < 3 ? `<button type="button" class="lbox lb-add" id="b-logo-addbox" title="Add a logo"><b>+</b><small>Add logo</small></button>` : '');
    const m = $('b-logo-menu');
    m.querySelector('[data-add="agency"]').textContent = P.agency ? 'Agency · ' + P.agency.name : 'Agency';
    m.querySelector('[data-add="agency"]').hidden = !P.agency || L.some(l => l.kind === 'agency');
    m.querySelector('[data-add="client"]').textContent = P.client ? 'Client · ' + P.client.name : 'Client';
    m.querySelector('[data-add="client"]').hidden = L.some(l => l.kind === 'client');
  }
  $('b-tpl-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().tpl = b.dataset.tpl; saveBT(); renderBriefPage(); }));
  $('look-inspector').addEventListener('click', e => {
    const sw = e.target.closest('[data-crow]');
    if (sw) { bt()[sw.dataset.crow] = sw.dataset.c; saveBT(); renderBriefPage(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); bt().logos.splice(+rm.dataset.rm, 1); saveBT(); renderBriefPage(); return; }
    if (e.target.closest('#b-logo-addbox')) { e.stopPropagation(); $('b-logo-menu').hidden = !$('b-logo-menu').hidden; return; }
    const add = e.target.closest('[data-add]');
    if (add) {
      e.stopPropagation(); $('b-logo-menu').hidden = true;
      if (add.dataset.add === 'img') { $('b-logo-file').click(); return; }
      bt().logos.push({ kind: add.dataset.add }); saveBT(); renderBriefPage();
    }
  });
  $('look-inspector').addEventListener('input', e => {
    const p = e.target.closest('[data-cpick]'); if (!p) return;
    bt()[p.dataset.cpick] = p.value; saveBT(); renderBriefPage();
  });
  document.addEventListener('click', e => { if (!e.target.closest('#b-logo-menu, #b-logo-addbox')) $('b-logo-menu').hidden = true; });
  $('b-logo-file').addEventListener('change', () => {
    const f = $('b-logo-file').files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { bt().logos.push({ kind: 'img', src: rd.result }); saveBT(); renderBriefPage(); };
    rd.readAsDataURL(f); $('b-logo-file').value = '';
  });

''' + s[_b:]

# ═══ CSS ═══
rep(".acc-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }", r""".acc-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.colour-rows { display: grid; }
.logo-boxes { display: flex; gap: 8px; flex-wrap: wrap; }
.lbox { position: relative; width: 74px; height: 74px; border: 1px solid var(--line); border-radius: 10px; background: #fff; display: grid; place-items: center; align-content: center; gap: 4px; padding: 6px; }
.lbox img { max-width: 58px; max-height: 34px; object-fit: contain; }
.lbox small { font: 600 9.5px var(--font-ui); color: var(--muted); max-width: 64px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lb-tile { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; font: 800 13px var(--font-ui); letter-spacing: -.03em; }
.lb-rm { position: absolute; top: -7px; right: -7px; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--line); background: #fff; font: 600 12px/1 var(--font-ui); cursor: pointer; opacity: 0; transition: opacity .12s; }
.lbox:hover .lb-rm { opacity: 1; }
.lb-add { border: 1.5px dashed var(--line-strong); background: transparent; cursor: pointer; }
.lb-add b { font: 300 26px/1 var(--font-ui); color: var(--ink-soft); }
.lb-add:hover { background: #fff; }
.logo-menu { margin-top: 8px; display: grid; background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 10px 24px -14px rgba(20,20,19,.35); overflow: hidden; }
.logo-menu button { text-align: left; padding: 9px 12px; border: 0; background: none; font: 500 13px var(--font-ui); cursor: pointer; }
.logo-menu button:hover { background: #FBF7EF; }
.logo-menu button[hidden] { display: none; }
.b-logos { display: inline-flex; align-items: center; gap: 10px; }
.b-x { width: 1px; height: 26px; background: color-mix(in srgb, currentColor 30%, transparent); }""")

# ═══ Steps: no shortcut to a brief that doesn't exist yet ═══
s = s.replace("    if (activeStep === 'prompt') $('hero-cta-circle').hidden = true;",
    "    if (activeStep === 'prompt' || activeStep === 'loading') $('hero-cta-circle').hidden = true;\n"
    "    document.querySelectorAll('.flow-steps button').forEach(b => {\n"
    "      const k = b.dataset.qstep, here = k === activeStep;\n"
    "      b.disabled = !here && (order.indexOf(k) > order.indexOf(activeStep) || k === 'loading' || activeStep === 'loading');\n"
    "    });")
rep(".flow-steps button.done i {", ".flow-steps button:disabled { cursor: default; }\n.flow-steps button:disabled:not([aria-pressed=\"true\"]) { opacity: .45; }\n.flow-steps button.done i {")
