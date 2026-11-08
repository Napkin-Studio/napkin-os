# Phase 12 (2026-11-08): paper is the only look (no Coloured template); far fewer red lines; logos as boxes
# (brand, agency, both, several or none; click a box to change its logo); parts that need you look like it;
# "Trying out" removed; every part has a reason.

# ═══ 1. paper only ═══
rep("    const coloured = T.tpl === 'coloured';", "    T.tpl = 'basic'; T.aud = 'internal'; T.doc = 'off';\n    const coloured = false;")
rep('''            <h4>Template</h4>
            <div class="seg-row" id="b-tpl-seg">''', '''            <h4>Colour</h4>
            <div class="seg-row" id="b-tpl-seg" hidden>''')
rep('<div class="try-out">', '<div class="try-out" hidden>')
rep("<span class=\"b-ikind\">${T.aud === 'internal' ? 'Internal' : 'Brief'}</span>", "<span class=\"b-ikind\">Brief</span>")

# ═══ 2. logos: click a box to change its logo; no light/dark panel ═══
rep("    if (lb && !e.target.closest('[data-rm]')) { e.stopPropagation(); editLogo = editLogo === +lb.dataset.li ? null : +lb.dataset.li; syncLogoBoxes(); return; }",
    "    if (lb && !e.target.closest('[data-rm]')) {\n"
    "      e.stopPropagation(); const i = +lb.dataset.li, l = bt().logos[i];\n"
    "      if (l.kind === 'img') { $('b-logo-file').dataset.replace = String(i); $('b-logo-file').click(); }\n"
    "      else { editLogo = i; $('b-logo-vfile').dataset.v = 'light'; $('b-logo-vfile').click(); }\n"
    "      return;\n"
    "    }")
rep("    const ed = $('b-logo-edit'), l = L[editLogo];\n    if (!l || l.kind === 'img') { ed.hidden = true; ed.innerHTML = ''; return; }",
    "    const ed = $('b-logo-edit'), l = L[editLogo];\n    ed.hidden = true; ed.innerHTML = ''; return;\n    if (!l || l.kind === 'img') { ed.hidden = true; ed.innerHTML = ''; return; }")
rep('title="Click to set versions · drag to reorder"', 'title="Click to change the logo · drag to reorder"')
rep("    rd.onload = () => { bt().logos.push({ kind: 'img', src: rd.result }); saveBT(); renderBriefPage(); };",
    "    const ri = $('b-logo-file').dataset.replace; delete $('b-logo-file').dataset.replace;\n"
    "    rd.onload = () => { if (ri !== undefined && bt().logos[+ri]) bt().logos[+ri].src = rd.result; else bt().logos.push({ kind: 'img', src: rd.result }); saveBT(); renderBriefPage(); };")
rep("    m.querySelector('[data-add=\"agency\"]').textContent = P.agency ? 'Agency · ' + P.agency.name : 'Agency';",
    "    m.querySelector('[data-add=\"agency\"]').textContent = P.agency ? 'Agency logo · ' + P.agency.name : 'Agency logo';")
rep("    m.querySelector('[data-add=\"client\"]').textContent = 'Client · ' + P.client.name;",
    "    m.querySelector('[data-add=\"client\"]').textContent = 'Brand logo · ' + P.client.name;")
rep('<button type="button" data-add="img">Upload an image…</button>', '<button type="button" data-add="img">Another logo (upload)…</button>')
rep("<small>${esc(label(l))}</small><button type=\"button\" class=\"lb-rm\"", "<small>${esc(label(l))}</small><em class=\"lb-chg\">Change</em><button type=\"button\" class=\"lb-rm\"")

# ═══ 3. every part has a reason ═══
rep("  function renderBriefPage() {", r'''  const WHY_FILL = {
    barrier: { decided: 'Name the barrier as "nobody owns the small shared treat outside".', because: 'Delivery desserts grew +23.4% (f_007) while 68% of treat stops are unplanned (f_003): the gap is the moment, not the product.', rejected: '"Price is the barrier" — the client ruled out promotion and panel data shows no price sensitivity.', certainty: 'High · cites f_003, f_007' },
    obj_comm: { decided: '+12% units June–August, no price promotion.', because: 'Taken directly from the client call (client-call-notes.pdf, p.2).', rejected: 'A share target — no reliable category share data for summer only.', certainty: 'High · client stated' },
    obj_beh: { decided: 'Unplanned warm-day visits, not new triers.', because: 'Spontaneous social occasions are 68% of 16–24 treat stops (f_003).', rejected: 'Driving app orders — conflicts with the in-restaurant target.', certainty: 'Medium · inferred from f_003' },
    obj_att: { decided: 'From "the thing I get" to "the thing that makes it summer".', because: 'Recap deck shows McFlurry is liked but low on salience between May and September.', rejected: 'Taste or quality claims — already strong, not the problem.', certainty: 'Medium · recap deck + f_009' },
    audience: { decided: 'Irish 16–24s who treat food stops as social glue.', because: 'Matches the client target and the Bord Bia panel (n=1,400).', rejected: 'Families — off-brief for this campaign.', certainty: 'High · client + f_003' },
    rtb: { decided: 'Two spoons on request, Flake and Oreo all summer, the restaurant you pass.', because: 'Each is a mandatory or an operational fact the client confirmed.', rejected: '"New recipe" — not true this summer.', certainty: 'Needs ops sign-off on two spoons' },
    resp_think: { decided: 'Frame it as keeping the afternoon going.', because: 'Ladders from the insight (unplanned moments) to the behaviour.', rejected: '"Treat yourself" — individual, not shared.', certainty: 'Medium · creative judgement' },
    resp_feel: { decided: 'The small joy of an unplanned treat.', because: 'Mirrors the language in TikTok UGC (f_011).', rejected: 'Nostalgia — the review agent cut it as off-target for 16–24s.', certainty: 'Medium · f_011 is thin (2 clips)' },
    resp_do: { decided: 'Split a McFlurry outside and post it.', because: 'Two-spoon sharing is visible on Irish TikTok (f_011, f_009 11.2M views).', rejected: '"Download the app" — conflicts with in-restaurant target.', certainty: 'Medium · depends on ops' },
    tone: { decided: 'Sun-bleached, handheld, real Irish places.', because: 'Brand Clan voice: warm, quick, a little cheeky; never a studio pack-shot.', rejected: 'Polished studio food photography.', certainty: 'High · Brand Clan v4' },
    background: { decided: 'Frame the problem as heritage vs. habit.', because: 'Under-35s see the relish as their parents’ jar (client notes).', rejected: 'A taste problem — product scores well.', certainty: 'Medium · client notes' }
  };
  const fillWhy = () => Object.values(BRIEF_DATA).forEach(d => d.parts.forEach(p => {
    if (!p.why && p.as !== 'cell') p.why = WHY_FILL[p.k] || { decided: 'Kept as drafted by the Brief agent.', because: 'Drawn from the client notes and attached research.', rejected: '—', certainty: p.who || 'Napkin · checked' };
  }));

  function renderBriefPage() {
    fillWhy();''')

# ═══ 4. CSS: paper, fewer red lines, needs attention ═══
rep(".colour-rows { display: grid; }", r""".colour-rows { display: grid; }
.colour-rows .acc-l { display: none; }
.try-out[hidden] { display: none !important; }
/* paper: no margin line; rules are ink hairlines; colour only on labels and the proposition underline */
.brief-page, .brief-page.bm-sheet { background-image: none !important; }
.brief-page .b-cover { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 22%, transparent) !important; }
.b-ident.b-basic { border-bottom: 1px solid color-mix(in srgb, var(--b-text) 12%, transparent) !important; }
.lay-statement .stmt { text-decoration-thickness: 1.5px; }
/* logo boxes */
.lb-chg { position: absolute; left: 0; right: 0; bottom: 4px; font: 600 9.5px var(--font-ui); font-style: normal; color: var(--ink); opacity: 0; transition: opacity .12s; }
.lbox:hover .lb-chg { opacity: 1; }
.lbox:hover small { opacity: 0; }
/* parts that need you look like it */
.gi.needs { background-color: color-mix(in srgb, var(--warn) 7%, transparent); box-shadow: inset 3px 0 0 var(--warn); }
.gi.needs::after { content: none !important; }
.gi.needs .gi-head h3::after { content: "Needs your call"; margin-left: 10px; padding: 2px 7px; border-radius: 999px; background: var(--warn); color: #fff; font: 700 9.5px var(--font-mono); letter-spacing: .08em; text-transform: uppercase; vertical-align: 1px; }
.gi.needs:hover { background-color: color-mix(in srgb, var(--warn) 11%, transparent); }
.gi.needs.sel { box-shadow: inset 3px 0 0 var(--warn), inset 0 0 0 1px color-mix(in srgb, var(--warn) 45%, transparent); }""")
