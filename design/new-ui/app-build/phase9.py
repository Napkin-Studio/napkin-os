# Phase 9 (2026-11-08): Basic = the clean sheet with an accent colour you choose.
# Coloured = an expressive template built from the logo owner's palette (base + accent).

# ═══ side bar: an Accent row for Basic ═══
rep('''              <button type="button" data-tpl="coloured" aria-pressed="false">Coloured</button>
            </div>
          </div>''', '''              <button type="button" data-tpl="coloured" aria-pressed="false">Coloured</button>
            </div>
            <div class="acc-row" id="b-acc-row">
              <span class="acc-l">Accent</span>
              <span class="acc-sw" id="b-acc-sw"></span>
              <label class="acc-pick" title="Pick any colour"><input type="color" id="b-acc-pick" value="#2A2620"></label>
            </div>
          </div>''')

# ═══ render ═══
rep("    const own = OWN[T.logo] || OWN.napkin, up = LOGOS[logoKey()], coloured = T.tpl === 'coloured';\n    pg.style.setProperty('--b-accent', coloured ? own.color : briefAccent);",
    r'''    OWN.napkin.acc = '#C8CBFF'; OWN.agency.acc = ag.isDefault ? '#C8CBFF' : ag.acc; OWN.client.acc = cl.ink;
    const own = OWN[T.logo] || OWN.napkin, up = LOGOS[logoKey()], coloured = T.tpl === 'coloured';
    const lum = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
    pg.style.setProperty('--c-base', own.color); pg.style.setProperty('--c-acc', own.acc);
    pg.style.setProperty('--c-on', lum(own.color) > .45 ? '#141413' : '#FFFFFF');
    pg.classList.toggle('tpl-coloured', coloured);
    pg.style.setProperty('--b-accent', coloured ? own.color : (T.accent || briefAccent));
    window.__briefOwn = own;''')
rep("    pg.classList.toggle('ident', coloured);", "    pg.classList.toggle('ident', false);")
rep("    const identHtml = `<div class=\"b-ident ${coloured ? '' : 'b-basic'}\" style=\"--ib:${coloured ? own.color : 'var(--b-text)'}\">",
    "    const identHtml = `<div class=\"b-ident ${coloured ? 'b-col' : 'b-basic'}\" style=\"--ib:${coloured ? own.acc : 'var(--b-accent)'}\">")

# ═══ wiring ═══
rep("  function syncLogoRow() {", r'''  function syncAccent() {
    const T = bt(), own = window.__briefOwn || { color: '#515BFF' };
    $('b-acc-row').hidden = T.tpl !== 'basic';
    const opts = [['#2A2620', 'Ink'], [own.color, 'Logo colour'], ['#C9462A', 'Red pencil'], ['#2F6B3A', 'Green'], ['#1F5FAF', 'Blue']];
    const cur = (T.accent || '#2A2620').toLowerCase();
    $('b-acc-sw').innerHTML = opts.map(([c, n]) => `<button type="button" data-acc="${c}" title="${n}" aria-pressed="${c.toLowerCase() === cur}" style="--sw:${c}"></button>`).join('');
    $('b-acc-pick').value = T.accent || '#2A2620';
  }
  function syncLogoRow() {''')
rep("    syncLogoRow();\n  }\n  function syncAccent() {", "    syncLogoRow(); syncAccent();\n  }\n  function syncAccent() {")
rep("  $('b-tpl-seg').querySelectorAll('button').forEach(b =>", r'''  $('b-acc-sw').addEventListener('click', e => { const b = e.target.closest('[data-acc]'); if (!b) return; bt().accent = b.dataset.acc; saveBT(); renderBriefPage(); });
  $('b-acc-pick').addEventListener('input', () => { bt().accent = $('b-acc-pick').value; saveBT(); renderBriefPage(); });
  $('b-tpl-seg').querySelectorAll('button').forEach(b =>''')

# ═══ CSS: the Coloured template ═══
rep(".logo-up { display: flex;", r""".acc-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.acc-row[hidden] { display: none; }
.acc-l { font: 600 11px var(--font-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); width: 56px; }
.acc-sw { display: flex; gap: 6px; }
.acc-sw button { width: 22px; height: 22px; border-radius: 50%; background: var(--sw); border: 2px solid #fff; box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; }
.acc-sw button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--ink); }
.acc-pick { width: 22px; height: 22px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 1px var(--line); background: conic-gradient(#f44, #fd4, #4d6, #4bf, #84f, #f4b, #f44); cursor: pointer; position: relative; }
.acc-pick input { opacity: 0; position: absolute; inset: 0; cursor: pointer; }
.b-ident.b-basic { border-bottom: 2px solid var(--b-accent) !important; }

/* Coloured: built from the logo owner's palette */
.brief-page.tpl-coloured { --b-bg: color-mix(in srgb, var(--c-base) 4%, #FFFDF8); background-image: none; }
.brief-page.tpl-coloured .b-cover { background: var(--c-base); color: var(--c-on); border-bottom: 0; padding: 30px 44px 34px; position: relative; overflow: hidden; border-radius: var(--r-md) var(--r-md) 0 0; }
.brief-page.tpl-coloured .b-cover::after { content: ""; position: absolute; right: -60px; bottom: -90px; width: 260px; height: 260px; border-radius: 50%; background: var(--c-acc); opacity: .9; }
.brief-page.tpl-coloured .b-cover > * { position: relative; z-index: 1; }
.brief-page.tpl-coloured .b-cover h2 { color: var(--c-on); font-size: calc(44px * var(--b-scale)); }
.brief-page.tpl-coloured .b-cover .eyebrow-row { opacity: .85; }
.brief-page.tpl-coloured .b-ident.b-col { border-bottom: 1px solid color-mix(in srgb, var(--c-on) 25%, transparent) !important; padding-bottom: 16px; margin-bottom: 22px; }
.brief-page.tpl-coloured .b-ident .b-logo { box-shadow: 0 0 0 2px var(--c-acc); }
.brief-page.tpl-coloured .b-ident .b-ikind { color: var(--c-on); opacity: .75; }
.brief-page.tpl-coloured .b-dO { background: #fff; border-radius: 50%; padding: 2px; }
.brief-page.tpl-coloured .b-grid { padding-top: 22px; }
.brief-page.tpl-coloured .gi { border-top-color: color-mix(in srgb, var(--c-base) 18%, transparent); }
.brief-page.tpl-coloured .gi h3 { display: inline-block; background: var(--c-base); color: var(--c-on); padding: 3px 8px; border-radius: 3px; }
.brief-page.tpl-coloured .gi.lay-cell { background: color-mix(in srgb, var(--c-acc) 22%, transparent); border-top: 0; border-radius: 6px; }
.brief-page.tpl-coloured .gi.lay-cell h3 { background: none; color: color-mix(in srgb, var(--c-base) 80%, #000); padding: 0; }
.brief-page.tpl-coloured .lay-statement .stmt { font-size: calc(34px * var(--b-scale)); color: var(--c-base); text-decoration: none; background: linear-gradient(transparent 62%, color-mix(in srgb, var(--c-acc) 70%, transparent) 62%); display: inline; }
.brief-page.tpl-coloured .gi.lay-callout { background: var(--c-base); color: var(--c-on); border-radius: 8px; padding: 20px 22px; border-top: 0; }
.brief-page.tpl-coloured .gi.lay-callout h3 { background: var(--c-acc); color: color-mix(in srgb, var(--c-base) 85%, #000); }
.brief-page.tpl-coloured .lay-callout .txt { border-left-color: var(--c-acc); color: var(--c-on); }
.brief-page.tpl-coloured .gi li::marker { color: var(--c-base); }
.brief-page.tpl-coloured .b-foot { background: var(--c-base); color: var(--c-on); border-radius: 0 0 var(--r-md) var(--r-md); }
.logo-up { display: flex;""")
rep(".brief-page.tpl-coloured .b-cover::after { content: \"\"; position: absolute; right: -60px; bottom: -90px; width: 260px; height: 260px;",
    ".brief-page.tpl-coloured .b-cover::after { content: \"\"; position: absolute; right: -70px; bottom: -170px; width: 250px; height: 250px;")
s, _n = re.subn(r'\s*<div>\s*<h4>Cover</h4>\s*<div class="seg-row" id="b-cover-seg">.*?</div>\s*</div>', '\n          <div hidden><div class="seg-row" id="b-cover-seg"><button type="button" data-cover="plain" aria-pressed="true">Plain</button><button type="button" data-cover="band" aria-pressed="false">Band</button></div></div>', s, count=1, flags=re.S)
assert _n == 1, 'cover seg'
