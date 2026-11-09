# Phase 7 (2026-11-08): theme and logo per brief. Napkin by default (Napkin mark); Agency / Client / Custom;
# the logo can be changed for each brief.

# ═══ side bar ═══
rep("            <h4>Look</h4>", "            <h4>Theme · this brief</h4>")
rep('''              <button type="button" data-ident="client" aria-pressed="false">Client</button>
            </div>''', '''              <button type="button" data-ident="client" aria-pressed="false">Client</button>
              <button type="button" data-ident="custom" aria-pressed="false">Custom</button>
            </div>
            <div class="theme-custom" id="b-theme-custom" hidden>
              <label class="sp-f">Name <input type="text" id="bt-name" placeholder="Name on the brief"></label>
              <label class="sp-f">Accent <input type="color" id="bt-accent" value="#2A2620"></label>
              <label class="sp-f">Paper <input type="color" id="bt-paper" value="#FFFDF8"></label>
              <div class="sp-f">Headings <span class="seg-row" id="bt-head"><button type="button" data-head="serif" aria-pressed="true">Serif</button><button type="button" data-head="sans" aria-pressed="false">Sans</button></span></div>
            </div>''')
rep('<div id="b-logo-row" hidden>', '<div id="b-logo-row">')

# ═══ state: one theme per brief ═══
rep("  const logoKey = () => briefIdent === 'agency' ? 'agency:' + curBrand : 'client:' + curClient;", r'''  const logoKey = () => 'brief:' + curBriefKey;
  const BT = {};
  try { Object.assign(BT, JSON.parse(localStorage.getItem('napkin-app-brief-themes') || '{}')); } catch (e) {}
  const bt = () => (BT[curBriefKey] = BT[curBriefKey] || { ident: 'napkin', accent: '#2A2620', paper: '#FFFDF8', head: 'serif', name: '' });
  const saveBT = () => { try { localStorage.setItem('napkin-app-brief-themes', JSON.stringify(BT)); } catch (e) {} };''')

# ═══ render with the brief's theme ═══
rep("    const ident = briefIdent === 'agency' && !ag.isDefault ?", "    const T = bt(); briefIdent = T.ident;\n    const ident = briefIdent === 'agency' && !ag.isDefault ?")
rep("kind: 'Agency', img: LOGOS['agency:' + curBrand] }", "kind: 'Agency', img: LOGOS[logoKey()] }")
rep("kind: 'Client', img: LOGOS['client:' + curClient] } : null;", "kind: 'Client', img: LOGOS[logoKey()] } : null;")
rep("    pg.style.setProperty('--b-accent', ident ? ident.bg : briefAccent);",
    "    const custom = T.ident === 'custom';\n"
    "    pg.style.setProperty('--b-accent', custom ? T.accent : ident ? ident.bg : briefAccent);\n"
    "    pg.style.setProperty('--b-bg', custom ? T.paper : briefBg);\n"
    "    pg.classList.toggle('head-sans', custom && T.head === 'sans');")
rep('''      : `<div class="b-ident b-napkin"><span class="b-dO">${napkinMark}</span><span class="b-iname">Napkin Studio</span><span class="b-ikind">Brief</span></div>`;''',
    '''      : `<div class="b-ident b-napkin" ${custom ? `style="border-bottom:3px solid ${T.accent} !important"` : ''}>${LOGOS[logoKey()] ? `<img class="b-logo-img" src="${LOGOS[logoKey()]}" alt="Logo">` : `<span class="b-dO">${napkinMark}</span>`}<span class="b-iname">${esc((custom && T.name) || 'Napkin Studio')}</span><span class="b-ikind">Brief</span></div>`;''')
# the previous accent/bg lines at the top of renderBriefPage must not override the theme
rep("    pg.style.setProperty('--b-accent', briefAccent);\n    pg.style.setProperty('--b-bg', briefBg);", "    pg.style.setProperty('--b-text', briefText);")
rep("    renderSidePart(data);", "    renderSidePart(data);\n    syncThemeUI();")

# ═══ side bar wiring ═══
rep("  function syncLogoRow() {\n    const show = briefIdent !== 'napkin'; $('b-logo-row').hidden = !show; if (!show) return;",
    r'''  function syncThemeUI() {
    const T = bt();
    $('b-ident-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ident === T.ident)));
    $('b-theme-custom').hidden = T.ident !== 'custom';
    if (document.activeElement !== $('bt-name')) $('bt-name').value = T.name || '';
    $('bt-accent').value = T.accent; $('bt-paper').value = T.paper;
    $('bt-head').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.head === T.head)));
    syncLogoRow();
  }
  function syncLogoRow() {''')
rep("    $('b-logo-add').textContent = src ? 'Replace…' : 'Add logo…';", "    $('b-logo-add').textContent = 'Change logo…';")
rep("    $('b-logo-prev').innerHTML = src ? `<img src=\"${src}\" alt=\"\">` : '<span>No logo</span>';",
    "    $('b-logo-prev').innerHTML = src ? `<img src=\"${src}\" alt=\"\">` : (bt().ident === 'napkin' || bt().ident === 'custom') && window.DeepO ? DeepO.staticSVG(40, '#515BFF', '#FFFFFF') : '<span>Initials</span>';")
rep("    $('b-logo-src').textContent = briefIdent === 'agency' ? 'From your agency profile' : 'From the Brand Clan kit';",
    "    $('b-logo-clear').textContent = 'Use ' + (bt().ident === 'agency' ? 'agency initials' : bt().ident === 'client' ? 'client initials' : 'Napkin logo');\n"
    "    $('b-logo-src').textContent = 'For this brief only';")
rep("    briefIdent = b.dataset.ident;\n    syncLogoRow();\n", "    bt().ident = b.dataset.ident; briefIdent = b.dataset.ident; saveBT();\n")
rep("  $('b-logo-add').addEventListener('click', () => $('b-logo-file').click());", r'''  $('b-logo-add').addEventListener('click', () => $('b-logo-file').click());
  $('bt-name').addEventListener('input', () => { bt().name = $('bt-name').value; saveBT(); renderBriefPage(); });
  $('bt-accent').addEventListener('input', () => { bt().accent = $('bt-accent').value; saveBT(); renderBriefPage(); });
  $('bt-paper').addEventListener('input', () => { bt().paper = $('bt-paper').value; saveBT(); renderBriefPage(); });
  $('bt-head').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { bt().head = b.dataset.head; saveBT(); renderBriefPage(); }));''')

# ═══ CSS ═══
rep(".side-part { border: 1px solid var(--line-strong);", r""".theme-custom { display: grid; gap: 8px; margin-top: 10px; }
.theme-custom input[type=text] { height: 28px; border: 1px solid var(--line); border-radius: 6px; padding: 0 8px; font: 13px var(--font-ui); text-transform: none; letter-spacing: 0; color: var(--ink); background: #fff; }
.theme-custom input[type=color] { width: 44px; height: 28px; border: 1px solid var(--line); border-radius: 6px; padding: 2px; background: #fff; cursor: pointer; }
.theme-custom .seg-row { display: inline-flex; }
.brief-page.head-sans .b-cover h2, .brief-page.head-sans .stmt, .brief-page.head-sans .lay-callout .txt { font-family: var(--font-ui) !important; letter-spacing: -.02em; }
.logo-prev svg { width: 40px; height: 40px; }
.side-part { border: 1px solid var(--line-strong);""")
