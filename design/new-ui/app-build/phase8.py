# Phase 8 (2026-11-08): two templates only, Basic or Coloured; the logo is a separate choice
# (Napkin / Agency / Client, or an uploaded image). Per brief.

# ═══ side bar ═══
s, n = re.subn(r'<div>\s*<h4>Theme · this brief</h4>.*?<input type="file" accept="image/\*" id="b-logo-file" hidden>\s*</div>', '''<div>
            <h4>Template</h4>
            <div class="seg-row" id="b-tpl-seg">
              <button type="button" data-tpl="basic" aria-pressed="true">Basic</button>
              <button type="button" data-tpl="coloured" aria-pressed="false">Coloured</button>
            </div>
          </div>
          <div>
            <h4>Logo</h4>
            <div class="seg-row" id="b-logo-seg">
              <button type="button" data-logo="napkin" aria-pressed="true">Napkin</button>
              <button type="button" data-logo="agency" aria-pressed="false">Agency</button>
              <button type="button" data-logo="client" aria-pressed="false">Client</button>
            </div>
            <div class="logo-up"><button type="button" class="side-link" id="b-logo-add">Upload a logo…</button><button type="button" class="side-link" id="b-logo-clear" hidden>Remove upload</button></div>
            <input type="file" accept="image/*" id="b-logo-file" hidden>
          </div>''', s, count=1, flags=re.S)
assert n == 1, 'side bar block'

# ═══ state ═══
rep("  try { Object.assign(BT, JSON.parse(localStorage.getItem('napkin-app-brief-themes') || '{}')); } catch (e) {}",
    "  try { Object.assign(BT, JSON.parse(localStorage.getItem('napkin-app-brief-themes-v2') || '{}')); } catch (e) {}")
rep("  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { ident: 'napkin', accent: '#2A2620', paper: '#FFFDF8', head: 'serif', name: '' });",
    "  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { tpl: 'basic', logo: 'napkin' });")
rep("  const saveBT = () => { try { localStorage.setItem('napkin-app-brief-themes', JSON.stringify(BT)); } catch (e) {} };",
    "  const saveBT = () => { try { localStorage.setItem('napkin-app-brief-themes-v2', JSON.stringify(BT)); } catch (e) {} };")

# ═══ render: header from the logo choice; colour only in Coloured ═══
_a = s.index("    const T = bt(); briefIdent = T.ident;")
_b = s.index('<span class="b-ikind">Brief</span></div>`;', _a) + len('<span class="b-ikind">Brief</span></div>`;')
s = s[:_a] + r'''    const T = bt();
    const OWN = {
      napkin: { name: 'Napkin Studio', color: '#515BFF', mark: window.DeepO ? `<span class="b-dO">${DeepO.staticSVG(40, '#515BFF', '#FFFDF8')}</span>` : '' },
      agency: { name: ag.isDefault ? 'Napkin Studio' : ag.name, color: ag.base, mark: `<span class="b-logo" style="--ib:${ag.base};--if:${ag.acc}">${esc(ag.short)}</span>` },
      client: { name: cl.full || cl.name, color: cl.col, mark: `<span class="b-logo" style="--ib:${cl.col};--if:${cl.ink}">${esc(cl.mono)}</span>` }
    };
    const own = OWN[T.logo] || OWN.napkin, up = LOGOS[logoKey()], coloured = T.tpl === 'coloured';
    pg.style.setProperty('--b-accent', coloured ? own.color : briefAccent);
    pg.style.setProperty('--b-bg', briefBg);
    pg.classList.toggle('ident', coloured);
    const identHtml = `<div class="b-ident ${coloured ? '' : 'b-basic'}" style="--ib:${coloured ? own.color : 'var(--b-text)'}">${up ? `<img class="b-logo-img" src="${up}" alt="${esc(own.name)} logo">` : own.mark}<span class="b-iname">${esc(own.name)}</span><span class="b-ikind">Brief</span></div>`;''' + s[_b:]

# ═══ wiring: drop the old theme controls, add template + logo ═══
_a = s.index("  $('b-ident-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {")
_b = s.index("  }));\n", _a) + len("  }));\n")
s = s[:_a] + s[_b:]
for line in ["  $('bt-name').addEventListener('input', () => { bt().name = $('bt-name').value; saveBT(); renderBriefPage(); });\n",
             "  $('bt-accent').addEventListener('input', () => { bt().accent = $('bt-accent').value; saveBT(); renderBriefPage(); });\n",
             "  $('bt-paper').addEventListener('input', () => { bt().paper = $('bt-paper').value; saveBT(); renderBriefPage(); });\n",
             "  $('bt-head').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().head = b.dataset.head; saveBT(); renderBriefPage(); }));"]:
    rep(line, "")
_a = s.index("  function syncThemeUI() {")
_b = s.index("  $('b-logo-add').addEventListener('click', () => $('b-logo-file').click());", _a)
s = s[:_a] + r'''  function syncThemeUI() {
    const T = bt();
    $('b-tpl-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tpl === T.tpl)));
    $('b-logo-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.logo === T.logo)));
    syncLogoRow();
  }
  function syncLogoRow() {
    const has = !!LOGOS[logoKey()];
    $('b-logo-clear').hidden = !has;
    $('b-logo-add').textContent = has ? 'Replace upload…' : 'Upload a logo…';
  }
  $('b-tpl-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().tpl = b.dataset.tpl; saveBT(); renderBriefPage(); }));
  $('b-logo-seg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().logo = b.dataset.logo; saveBT(); renderBriefPage(); }));
''' + s[_b:]

# ═══ CSS ═══
rep(".theme-custom { display: grid;", r""".logo-up { display: flex; gap: 14px; margin-top: 8px; }
.b-ident.b-basic { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 14%, transparent); }
.b-ident.b-basic .b-logo { filter: grayscale(1); }
.theme-custom { display: grid;""")
rep(".b-ident.b-basic .b-logo { filter: grayscale(1); }\n", "")
