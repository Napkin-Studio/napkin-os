  /* ═══ Variant B: research workspace — answer → findings → pins → sources, with the reasoning ═══ */
  (function rbInit() {
    if (!$('rb-ans-t')) return;
    const $$ = (q, r = document) => [...r.querySelectorAll(q)];
    const SHEET = $('research-sheet'), SIDE = $('r-side'), PART = $('r-side-part');

    // ── Sources read (9) ──
    const SRC = {
      s1: { name: 'Bord Bia Consumer Insights', what: 'Irish consumer panel, wave 2026-Q2', date: 'Jun 2026', tier: 'Panel', lic: 'Licensed panel', mat: 'mat_0417', loc: 'Table 4.2, p.18', sample: 'n=1,400, ROI', read: '02 Nov 2026', pins: ['f_003', 'f_004'], short: 'Bord Bia' },
      s2: { name: 'CSO Ireland', what: 'Time Use Survey 2025, youth module', date: 'Mar 2026', tier: 'Gov', lic: 'Open data (CC BY 4.0)', mat: 'mat_0418', loc: 'Table TU07', sample: 'n=3,900 households', read: '02 Nov 2026', pins: ['f_005'], short: 'CSO' },
      s3: { name: 'Kantar Worldpanel', what: 'ROI Out-of-Home & Delivery Tracker', date: 'Aug 2026', tier: 'Panel', lic: 'Licensed panel', mat: 'mat_0421', loc: 'Frozen desserts, 52 w/e 10 Aug', sample: 'ROI households, 12 months', read: '03 Nov 2026', pins: ['f_007'], short: 'Kantar' },
      s4: { name: 'Client deck · Summer 2025 recap', what: 'last-summer-recap.key', date: 'Sep 2025', tier: 'Client', lic: 'Client-confidential', mat: 'mat_0402', loc: 'Slide 9', sample: 'No method stated', read: '02 Nov 2026', pins: ['f_008'], short: 'Client deck' },
      s5: { name: 'TikTok Ireland', what: '#McFlurry tag, IE region', date: 'Oct 2026', tier: 'Social', lic: 'Public', mat: 'mat_0430', loc: 'Tag page, 31 Oct snapshot', sample: 'Tag views', read: '04 Nov 2026', pins: ['f_009'], short: 'TikTok tag' },
      s6: { name: 'TikTok comment sample', what: 'Two-spoon sharing clips', date: 'Oct 2026', tier: 'Social', lic: 'Public', mat: 'mat_0431', loc: '@ciarabites 12 Oct · @dub.eats 19 Oct', sample: '2 clips, 4.1k likes', read: '04 Nov 2026', pins: ['f_011'], short: 'TikTok clips' },
      s7: { name: 'Met Éireann', what: 'Summer 2026 climate statement', date: 'Sep 2026', tier: 'Gov', lic: 'Open data (CC BY 4.0)', mat: 'mat_0433', loc: 'Summary table', sample: 'National stations', read: '05 Nov 2026', pins: ['f_014'], short: 'Met Éireann' },
      s8: { name: 'Checkout Ireland', what: '“Delivery boom” trade article', date: 'Jul 2026', tier: 'Trade', lic: 'Trade press', mat: 'mat_0425', loc: 'Paragraph 3', sample: '—', read: '03 Nov 2026', pins: [], short: 'Checkout', excl: 'Repeats the client deck’s 31% and cites it, so it is not a second source.', exd: 'd_043' },
      s9: { name: 'Retail Ireland', what: 'Quarterly summary (paywalled)', date: 'Aug 2026', tier: 'Trade', lic: 'Paywalled summary', mat: 'mat_0426', loc: 'Abstract', sample: '—', read: '03 Nov 2026', pins: [], short: 'Retail Ireland', excl: 'Gives “+20% delivery desserts” with no market: Ireland, UK or both.', exd: 'd_041' }
    };
    // ── Pins: extend the page's facts (two pins the old page lacked: the CSO corroboration and the client's 31%) ──
    Object.assign(RS_FACT, {
      f_005: { fact: 'Out-of-home food occasions with friends, 16–24s', value: '65%', asof: 'Mar 2026', conf: 'high', src: 'CSO Ireland', tier: 'Gov', lens: 'Audience', ret: '02 Nov 2026', lic: 'Open data', st: 'active', used: [0] },
      f_008: { fact: 'Delivery dessert growth (client figure)', value: '+31% YoY', asof: 'Sep 2025', conf: 'low', src: 'Client deck', tier: 'Client', lens: 'Category', ret: '02 Nov 2026', lic: 'Client-confidential', st: 'contested', used: [] }
    });
    const FX = {
      f_003: { key: 'treat_occasion.unplanned_social_share', mk: 'IE', method: 'Panel survey, n=1,400', unit: '% of out-of-home treat occasions', s: 's1', quote: 'Among Irish 16–24s, 68% of out-of-home treat occasions were unplanned and social, up from 61% in 2024.', row: 'Category layer · Ireland → Treat occasions, row r_003 v2', pinned: '03 Nov 2026 by Knowledge agent', origin: ['extracted', 'Extracted by Knowledge agent from Table 4.2, p.18, as written.'], d: ['d_041', 'd_042'], brief: ['Insight', 'Proof point 1'], claims: [0, 1, 3] },
      f_004: { key: 'treat_occasion.with_friends_delta', mk: 'IE', method: 'Panel survey, wave on wave', unit: 'percentage points vs 2024 wave', s: 's1', quote: 'The share of treat occasions spent with friends rose seven points, to 54%.', row: 'Category layer · Ireland → Treat occasions, row r_004 v2', pinned: '03 Nov 2026 by Knowledge agent', origin: ['extracted', 'Extracted by Knowledge agent from Table 4.4, p.21.'], d: ['d_041', 'd_042'], brief: [], claims: [0] },
      f_005: { key: 'youth.ooh_food.with_friends_share', mk: 'IE', method: 'Household time-use diary', unit: '% of out-of-home food occasions', s: 's2', quote: '65% of out-of-home food occasions among 16–24s were spent with friends.', row: 'Category layer · Ireland → Youth time use, row r_005 v1', pinned: '03 Nov 2026 by Knowledge agent', origin: ['extracted', 'Extracted by Knowledge agent from CSO Table TU07.'], d: ['d_041', 'd_042'], brief: [], claims: [0] },
      f_007: { key: 'delivery.frozen_dessert.growth_yoy', mk: 'IE', method: 'Panel, like-for-like 52 weeks', unit: '% year on year, ROI only', s: 's3', quote: 'Frozen dessert delivery orders in the Republic of Ireland rose 23.4% against the prior 12 months.', row: 'Category layer · Ireland → Frozen desserts, row r_007 v2', pinned: '05 Nov 2026 by Review agent (d_044)', origin: ['confirmed', 'Extracted from the tracker, then chosen over f_008 by Review agent in d_044.'], d: ['d_041', 'd_043', 'd_044'], brief: ['Proof point 2'], claims: [2, 3], contest: true },
      f_008: { key: 'delivery.frozen_dessert.growth_yoy', mk: 'IE, likely incl. NI', method: 'None stated', unit: '% year on year, “Ireland”', s: 's4', quote: 'Delivery desserts +31%: our biggest growth channel.', row: 'Client layer · McDonald’s Ireland, row r_c12 v1', pinned: '02 Nov 2026 by Knowledge agent', origin: ['stated', 'Stated by the client on slide 9 of last-summer-recap.key. No one measured it here.'], d: ['d_041', 'd_043', 'd_044'], brief: [], claims: [], contest: true, rej: true, licWarn: 'Client-confidential. The model may read it; it never leaves in an export or goes into the shared corpus.' },
      f_009: { key: 'social.tiktok.tag_views', mk: 'IE', method: 'Platform count, snapshot', unit: 'views, IE region', s: 's5', quote: '#McFlurry · 11.2M views (Ireland).', row: 'Culture layer · Ireland → Social signals, row r_009 v1', pinned: '04 Nov 2026 by Research agent', origin: ['extracted', 'Read off the tag page by Research agent on 31 Oct.'], d: ['d_041', 'd_045'], brief: [], claims: [4], stale: 'The layer moved to v2 since this pin; the current value is 12.0M. Run again to take it.' },
      f_011: { key: 'social.ugc.two_spoon_clips', mk: 'IE', method: 'Manual sample, 2 clips', unit: 'clips (4.1k combined likes)', s: 's6', quote: '“the two spoons thing is so real, nobody orders their own mcflurry”', row: 'Culture layer · Ireland → Social signals, row r_011 v1', pinned: '04 Nov 2026 by Research agent, held as thin', origin: ['proposed', 'Proposed by Research agent from 2 clips. No panel or count says this.'], d: ['d_041', 'd_045'], brief: [], claims: [4] },
      f_014: { key: 'weather.warm_days_delta', mk: 'IE', method: 'Station records', unit: '% days above 20°C vs summer 2024', s: 's7', quote: 'Days above 20°C were 18% higher than in summer 2024.', row: 'Category layer · Ireland → Market context, row r_014 v1', pinned: '05 Nov 2026 by Knowledge agent', origin: ['extracted', 'Extracted by Knowledge agent from the summary table.'], d: ['d_041', 'd_046'], brief: [], claims: [], unused: 'Pinned for context. No finding uses it: warm days lift every treat stop alike, so they do not explain the choice. The framing was rejected in Finding 1 and in the answer.' }
    };
    const PINS = ['f_003', 'f_004', 'f_005', 'f_007', 'f_008', 'f_009', 'f_011', 'f_014'];

    // ── Findings: the full reasoning (os-layer decision shape) ──
    const F = [
      { st: 'verified', lens: 'Audience', short: 'Social moments, not meals', pins: ['f_003', 'f_004', 'f_005'], who: 'Synthesis agent', derived: 'synthesis.claim · claude-sonnet-4.6 · 05 Nov 10:05',
        quote: 'Among Irish 16–24s, 68% of out-of-home treat occasions were unplanned and social, up from 61% in 2024.', s: 's1',
        ev2: ['s2', '65% of out-of-home food occasions among 16–24s were spent with friends.'],
        decided: 'Kept as the primary finding. It grounds the brief’s spontaneity insight.',
        because: [['Two independent sources agree within 3 points: Bord Bia 68%, CSO 65%.', ['f_003', 'f_005']], ['The trend rises across waves, from 61% in 2024 to 68% in 2026.', ['f_003']], ['Company is growing too: occasions with friends are up 7 points.', ['f_004']]],
        rejected: [['“16–24s plan treats around meals”', 'Neither panel supports it; planned meal-time stops are 21% and falling.'], ['Frame it as weather-driven', 'Warm days rose 18% (f_014) but lift every treat stop alike; they do not explain the choice.']],
        cert: ['high', 'National panels with published methods, two sources, current wave.'],
        change: 'A 2026 CSO wave below 60%, or a panel showing most treat stops are planned.',
        attention: '',
        confWhy: 'all three pins are High (a licensed panel and government data, current wave). The lowest pin sets it: High.',
        ver: 'Verified by <b>Review agent</b> · 05 Nov 10:12 · “two independent sources agree within 3 points” · written to the layer as pin <code>f_003@v2</code>',
        d: ['d_041', 'd_042', 'd_046'] },
      { st: 'resolved', lens: 'Category', short: 'Indulgence moving home', pins: ['f_007'], rejPins: ['f_008'], who: 'Synthesis agent', derived: 'synthesis.claim · claude-sonnet-4.6 · 05 Nov 10:37',
        quote: 'Frozen dessert delivery orders in the Republic of Ireland rose 23.4% against the prior 12 months.', s: 's3',
        decided: 'Used Kantar’s 23.4% over the client deck’s 31%.',
        because: [['Kantar measures the Republic of Ireland alone, like for like over 52 weeks, with a published method.', ['f_007', 's3']], ['The client figure has no stated method, and the deck reports “Ireland”, which likely includes Northern Ireland.', ['f_008', 's4']], ['The trade article that repeats 31% cites the client deck, so it is not a second source.', ['s8']]],
        rejected: [['Client deck, 31%', 'No method; likely blends NI with ROI. Kept on the record, not chosen.'], ['Average the two (27%)', 'Mixes two definitions; neither source would stand behind it.']],
        cert: ['high', 'Like-for-like ROI panel definition, current to Aug 2026.'],
        change: 'Kantar restates the tracker, or the client shares the method behind 31% and it turns out to be ROI only.',
        attention: 'The figure covers all ages. No 16–24 split exists, so the answer’s sentence 4 leans on it.',
        confWhy: 'it cites one pin, f_007 (High, panel). The not-chosen f_008 (Low) is kept on the record but not cited, so it does not lower this.',
        ver: 'Resolved by <b>Review agent</b> · 05 Nov 10:36 (d_044) · written to the layer as pin <code>f_007@v2</code>',
        d: ['d_041', 'd_043', 'd_044', 'd_046'], contest: true },
      { st: 'proposed', lens: 'Culture', short: 'Two-spoon sharing', pins: ['f_011', 'f_009'], who: 'Synthesis agent', derived: 'synthesis.claim · claude-sonnet-4.6 · 05 Nov 10:39',
        quote: '“the two spoons thing is so real, nobody orders their own mcflurry”', s: 's6',
        decided: 'Held as Proposed only, not auto-verified.',
        because: [['The behaviour is vivid and on brand: both clips show two spoons in one McFlurry.', ['f_011', 's6']], ['The #McFlurry tag is big in Ireland (11.2M views), so the audience is there; but views do not show sharing.', ['f_009', 's5']], ['Two clips cannot stand as a national norm without your sign-off.', ['f_011']]],
        rejected: [['Verify it as a norm', '2 clips is far below the 50-post bar the Review agent uses for social claims.'], ['Drop it now', 'The signal fits Finding 1 (social moments) and is worth keeping as a creative hook.']],
        cert: ['low', 'Thin: 2 clips. Needs a human call: keep it as a creative hook, or cut it.'],
        change: 'A wider search finds 50+ sharing posts in Ireland, or a panel asks about sharing.',
        attention: 'It rests on 2 clips. The 11.2M views say nothing about sharing.',
        confWhy: 'the lowest pin is f_011 (Low, 2 clips). f_009 is Medium but shows reach, not the behaviour.',
        ver: 'Not verified. Held for you by <b>Review agent</b> · 05 Nov 10:40 (d_045).',
        d: ['d_041', 'd_045', 'd_046'] }
    ];
    const FSTMT = i => { const c = card(i); return c ? c.querySelector('.finding-stmt').textContent.trim() : ''; };
    const card = i => document.querySelector(`#r-findings-list .finding-card[data-fi="${i}"]`);

    // ── The answer, sentence by sentence ──
    const CL = [
      { short: 'They stretch social moments', f: [0], pins: ['f_003', 'f_004', 'f_005'], kind: 'Restates Finding 1', cert: 'high',
        because: [['Finding 1 in plain words: most treat stops are unplanned and social.', ['F1', 'f_003']], ['Corroborated by CSO time-use data.', ['f_005']]], rejected: [['“Young people love treats in summer”', 'True of everyone; says nothing about the choice.']], change: 'Finding 1 is rejected or its pins move below 60%.' },
      { short: '68% unplanned & social', f: [0], pins: ['f_003'], kind: 'Figure, quoted as written', cert: 'high',
        because: [['The figure as written in Bord Bia Table 4.2.', ['f_003', 's1']]], rejected: null, change: 'Bord Bia restates the wave.' },
      { short: 'Delivery grew 23.4%', f: [1], pins: ['f_007'], rej: ['f_008'], kind: 'Figure, contested then resolved', cert: 'high',
        because: [['Kantar’s ROI-only figure, chosen in d_044.', ['f_007', 'd_044']]], rejected: [['31% from the client deck', 'No method; likely blends NI.']], change: 'You change the pick in the contest.' },
      { short: 'Moves home unless…', f: [0, 1], pins: ['f_003', 'f_007'], kind: 'Inference · no source says this', cert: 'med',
        because: [['Treat stops outside are social and unplanned…', ['F1']], ['…while delivery desserts grow fast, so without a social reason the treat happens at home.', ['F2']]], rejected: [['“Delivery is replacing outings”', 'Too strong: no source measures substitution.']], change: 'A 16–24 delivery figure, or data showing outings and delivery rising together.', attention: 'This is the agent’s reading of two findings, not a source’s words.' },
      { short: 'Two-spoon: promising, thin', f: [2], pins: ['f_011', 'f_009'], kind: 'From Finding 3 · proposed', cert: 'low',
        because: [['Named only as a hypothesis because Finding 3 rests on 2 clips.', ['F3', 'f_011']]], rejected: [['Leave it out of the answer', 'You would not see it; a thin lead is still a lead.']], change: 'You cut Finding 3 (the sentence goes) or more posts turn up (it firms up).' }
    ];
    const ANS = { decided: 'Lead with spontaneity and the pull of home; name the two-spoon ritual only as a hypothesis.',
      because: [['Spontaneity is the best-supported finding: two national sources, a rising trend.', ['F1', 'f_003', 'f_005']], ['Delivery growth shows where the treat goes when the outing gives no reason.', ['F2', 'f_007']], ['The ritual is vivid but rests on 2 clips, so it is marked thin rather than left out.', ['F3', 'f_011']]],
      rejected: [['Lead with the two-spoon ritual', 'Too thin to lead on 2 clips (f_011). Kept as the last sentence, marked thin.'], ['Lead with the weather', 'Warm days rose 18% (f_014) but lift every treat stop alike.'], ['Use the client deck’s 31%', 'No method; likely blends Northern Ireland (d_044).']],
      cert: ['med', 'Two of three findings are verified; sentence 4 is inference; Finding 3 is thin. Derived from the findings, never asked of the model.'],
      change: 'Cut Finding 3 and the last sentence goes. A wider TikTok sample (50+ posts) would lift it. A 16–24-only delivery figure could weaken sentence 4.',
      attention: 'Sentence 4 is the agent’s inference, not a source’s words.' };

    // ── Decisions on the record ──
    const D = {
      d_041: { t: '09:58', kind: 'extract', who: 'Knowledge agent', cls: '', line: 'extracted 14 candidate facts from 9 sources; pinned 8, excluded 2', to: ['f_003', 'f_004', 'f_005', 'f_007', 'f_008', 'f_009', 'f_011', 'f_014', 's8', 's9'],
        decided: 'Pin 8 facts, exclude 2, keep 4 as notes.', because: [['Each pinned fact has a source, a date and a market.', ['f_003', 'f_007']], ['Checkout repeats the client figure; Retail Ireland gives no market.', ['s8', 's9']]], rejected: [['Pin all 14', 'Four were opinions with no figure; two could not be attributed.']], cert: ['high', 'Mechanical extraction against the source text.'], change: 'A source is withdrawn or restated.' },
      d_042: { t: '10:12', kind: 'verify', who: 'Review agent', cls: 'ok', line: 'verified f_003 (68% unplanned) across Bord Bia and CSO', to: ['f_003', 'f_005', 'F1'],
        decided: 'Verify Finding 1 and write f_003 to the layer as v2.', because: [['Bord Bia 68% and CSO 65% agree within 3 points.', ['f_003', 'f_005']], ['Both publish their method.', ['s1', 's2']]], rejected: null, cert: ['high', 'Two independent national sources.'], change: 'Either source restates.' },
      d_043: { t: '10:21', kind: 'contest', who: 'Review agent', cls: 'contest', line: 'flagged a disagreement on delivery growth: 23.4% Kantar vs 31% client deck', to: ['f_007', 'f_008', 'contest', 's8'],
        decided: 'Open a contest on delivery growth.', because: [['Two pins on one key differ by 7.6 points.', ['f_007', 'f_008']], ['The trade article repeating 31% is not independent.', ['s8']]], rejected: null, cert: ['high', 'The values plainly disagree.'], change: '—' },
      d_044: { t: '10:36', kind: 'resolve', who: 'Review agent', cls: 'ok', line: 'resolved f_007 for Kantar’s 23.4% (documented ROI method)', to: ['f_007', 'f_008', 'contest', 'F2'],
        decided: 'Choose Kantar 23.4%; keep the client’s 31% on the record, not chosen.', because: [['Like-for-like ROI panel with a documented method.', ['f_007', 's3']], ['The client figure has no method and likely blends NI.', ['f_008', 's4']]], rejected: [['Client deck, 31%', 'No method.'], ['Average, 27%', 'Mixes definitions.']], cert: ['high', 'Preset reason: more trusted source; fits the market.'], change: 'The client shares an ROI-only method.' },
      d_045: { t: '10:40', kind: 'verdict', who: 'Review agent', cls: 'warn', line: 'held Finding 3 (f_011, two-spoon sharing) as Proposed; needs your sign-off', to: ['F3', 'f_011', 'f_009'],
        decided: 'Hold Finding 3 as Proposed.', because: [['2 clips is below the 50-post bar for social claims.', ['f_011']]], rejected: [['Verify it', 'Too thin.'], ['Drop it', 'Worth keeping as a hook.']], cert: ['low', 'Thin evidence; a human call.'], change: 'More posts turn up, or you decide.' },
      d_046: { t: '10:44', kind: 'report', who: 'Synthesis agent', cls: 'ok', line: 'composed the answer from Findings 1–3; left f_014 out', to: ['answer', 'F1', 'F2', 'F3', 'f_014'],
        decided: ANS.decided, because: ANS.because, rejected: ANS.rejected, cert: ANS.cert, change: ANS.change }
    };
    let dSeq = 47;
    const addDecision = (kind, who, line, to, extra = {}) => { const id = 'd_0' + dSeq++; const now = new Date(); D[id] = Object.assign({ t: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'), kind, who, cls: kind === 'reject' || kind === 'contest' ? 'contest' : 'ok', line, to, decided: line.charAt(0).toUpperCase() + line.slice(1) + '.', because: [], rejected: null, cert: ['high', 'A person’s call, on the record.'], change: 'You change it.' }, extra); renderLog(); return id; };

    const C = { what: 'Delivery frozen-dessert growth, ROI, 12 months', key: 'delivery.frozen_dessert.growth_yoy',
      a: { v: '+23.4%', who: 'Kantar Worldpanel', s: 's3', pin: 'f_007', row: 'Category layer · Ireland, r_007 v2', method: 'Like-for-like ROI panel, 52 w/e 10 Aug 2026', quote: FX.f_007.quote },
      b: { v: '+31%', who: 'Client deck · Summer 2025 recap', s: 's4', pin: 'f_008', row: 'Client layer · McDonald’s Ireland, r_c12 v1', method: 'No method stated; “Ireland” likely includes NI', quote: FX.f_008.quote },
      why: 'Like-for-like ROI panel with a documented method; the client figure has none and likely blends NI.', who: 'Review agent', when: '05 Nov 10:36', d: 'd_044' };

    // ── Coverage: lens × market ──
    const MKS = ['IE', 'NI'];
    const COV2 = { Market: { IE: ['v', '05 Nov · knowledge.extract'] }, Category: { IE: ['c', '03 Nov · research.web'] }, Audience: { IE: ['u', '02 Nov · research.web'] }, Culture: { IE: ['u', '04 Nov · research.social'] }, Competitors: { IE: ['x', '04 Nov · research.web'] }, Channels: {}, Brand: {}, 'Client data': { IE: ['v', '02 Nov · knowledge.extract'] } };
    const COVNOTE = { Market: '1 pin, not used', Category: '2 pins, 1 contest', Audience: '3 pins → Finding 1', Culture: '2 pins → Finding 3, thin', Competitors: 'searched, nothing found', Channels: 'not in the ask', Brand: 'not in the ask', 'Client data': '1 pin, not chosen' };
    const GAPS = [
      { k: 'Not found', cov: 'empty', lens: 'Category', mk: 'IE', t: 'No summer-only price data for frozen desserts in ROI.', searched: '“frozen dessert price summer ROI”, “McFlurry price 2026 Ireland”', tried: 'CSO CPI, Kantar, Checkout', note: 'Nearest is annual CSO food inflation, 4.1%.' },
      { k: 'Not found', cov: 'empty', lens: 'Competitors', mk: 'IE', t: 'No summer spend figures for Fanta Frozen or Magnum in ROI.', searched: '“Fanta Frozen Ireland outdoor 2026”, “Magnum ROI share summer”', tried: 'Nielsen Ad Intel (no access), trade press', note: 'Outdoor sightings only; nothing to pin.' },
      { k: 'Not looked up', cov: 'none', lens: 'Market', mk: 'NI', t: 'Northern Ireland not researched.', searched: '—', tried: '—', note: 'Out of scope: the ask says Republic of Ireland.' },
      { k: 'Not looked up', cov: 'none', lens: 'Channels · Brand', mk: 'IE', t: 'Channels and Brand lenses not run.', searched: '—', tried: '—', note: 'Not in the ask’s lenses. Run them if the brief needs media or brand health.' }
    ];

    // ── small renderers ──
    const lvl = c => c === 'med' ? 'Medium' : c === 'high' ? 'High' : 'Low';
    const fx = id => Object.assign({}, RS_FACT[id] || {}, FX[id] || {});
    const pinChip = (id, rej) => { const x = fx(id); return x.value ? `<button type="button" class="rb-chip${rej ? ' rej' : ''}" data-rb-sel="fact:${id}" title="${x.src} · ${x.key} · ${x.mk} = ${x.value} · as of ${x.asof} · ${lvl(x.conf)}${x.stale ? ' · STALE' : ''}"><span class="pin"></span>${id}<b>${x.value}</b></button>` : `<span class="rb-chip">${id}</span>`; };
    const fChip = i => `<button type="button" class="rb-fchip" data-rb-sel="finding:${i}"><span class="rb-n${fState(i) === 'proposed' ? ' p' : ''}">${i + 1}</span>Finding ${i + 1}</button>`;
    const sChip = id => `<button type="button" class="rb-schip t-${SRC[id].tier.toLowerCase()}" data-rb-sel="source:${id}">${SRC[id].short}</button>`;
    const dChip = id => `<button type="button" class="rb-dchip" data-rb-sel="decision:${id}">${id}</button>`;
    const cite = t => /^F\d$/.test(t) ? fChip(+t[1] - 1) : /^f_/.test(t) ? pinChip(t) : /^s\d$/.test(t) ? sChip(t) : /^d_/.test(t) ? dChip(t) : t === 'contest' ? '<button type="button" class="rb-cchip" data-rb-sel="contest:0">contest</button>' : t === 'answer' ? '<button type="button" class="rb-cchip" data-rb-sel="answer:0">answer</button>' : t;
    const certHtml = c => `${conf(c[0])} <b>${lvl(c[0])}</b> · ${c[1]}`;
    const reason = (r, by) => `<div class="rb-reason">
      <div class="rb-rrow dec"><span class="rl">Decided</span><div>${r.decided}</div></div>
      ${r.because && r.because.length ? `<div class="rb-rrow"><span class="rl">Because</span><ul class="rb-bec">${r.because.map(([t, c]) => `<li>${t}<span class="rb-cites">${c.map(cite).join('')}</span></li>`).join('')}</ul></div>` : ''}
      <div class="rb-rrow"><span class="rl">Rejected</span>${r.rejected && r.rejected.length ? `<ul class="rb-rej">${r.rejected.map(([o, w]) => `<li><s>${o}</s> · ${w}</li>`).join('')}</ul>` : '<div class="rbi-none">Only option: nothing else was on the table.</div>'}</div>
      ${r.cert ? `<div class="rb-rrow"><span class="rl">Certainty</span><div>${certHtml(r.cert)}</div></div>` : ''}
      ${r.change ? `<div class="rb-rrow"><span class="rl">Would change if</span><div>${r.change}</div></div>` : ''}
      ${r.attention ? `<div class="rb-attn"><b>Look at this</b><span>${r.attention}</span></div>` : ''}
      ${by ? `<div class="rb-by">${by}</div>` : ''}</div>`;
    const decRow = id => { const d = D[id]; return `<details class="rbi-dec ${d.cls}"><summary><span class="rb-t">${d.t}</span><span class="rb-kind k-${d.kind}">${d.kind}</span><span><b>${d.who}</b> ${d.line}</span><span class="rb-did">${id}</span></summary>${reason(d)}<div class="rb-tgts">→ ${d.to.map(cite).join('')}<button type="button" class="side-link" data-rb-sel="decision:${id}" style="margin-left:auto;font-size:11.5px">Open</button></div></details>`; };
    const lensPill = l => `<span class="lens-pill"><i></i>${l}</span>`;
    const stPill = st => ({ verified: '<span class="st-pill ok">Verified</span>', resolved: '<span class="st-pill ok">Verified · resolved conflict</span>', proposed: '<span class="st-pill warn">Proposed · thin · needs you</span>', 'verified-you': '<span class="st-pill ok">Verified by you</span>', rejected: '<span class="st-pill bad">Rejected by you</span>', cut: '<span class="st-pill mute">Cut by you</span>' })[st] || '';
    const sec = (h, body, em) => `<section class="rbi-sec"><h5>${h}${em ? `<em>${em}</em>` : ''}</h5>${body}</section>`;

    let cut3 = false;
    function fState(i) {
      if (F[i].rejBy) return 'rejected';
      if (i === 2) { if (cut3) return 'cut'; const c = card(2); return c && c.classList.contains('proposed') ? 'proposed' : 'verified-you'; }
      return F[i].you ? 'verified-you' : F[i].st;
    }
    const wrongPins = new Set();
    const claimFlag = k => CL[k].f.some(i => ['rejected', 'cut'].includes(fState(i))) || CL[k].pins.some(p => wrongPins.has(p));
    function blockers() {
      const out = [];
      if (fState(2) === 'proposed') out.push(['Finding 3 is proposed, not verified (d_045).', 'finding:2']);
      F.forEach((f, i) => { if (f.rejBy) out.push([`Finding ${i + 1} was rejected; ${CL.filter((c, k) => c.f.includes(i)).length} answer sentence(s) still cite it. Refresh the report.`, 'finding:' + i]); });
      wrongPins.forEach(p => out.push([`${p} was marked wrong; findings that rest on it are flagged.`, 'fact:' + p]));
      return out;
    }

    // ── 1. The report: stats, facts, contest, gaps, coverage, excluded, how it ran, log ──
    rsStats = function () {
      const n = fState(2) === 'proposed' ? 1 : 0;
      $('r-stats').innerHTML = `<span>9 sources</span><span>8 pins</span><span>3 findings</span><span>1 contest</span><span>4 gaps</span><span>2 excluded</span>${n ? '<button type="button" class="r-stat-need" id="r-stat-need">1 needs your call</button>' : '<span class="r-stat-ok">Nothing needs you</span>'}`;
      const b = $('r-stat-need'); if (b) b.addEventListener('click', e => { e.stopPropagation(); rsSelect('finding', 2); });
    };
    function renderFacts() {
      $('r-facts-body').innerHTML = PINS.map(id => { const x = fx(id);
        const status = wrongPins.has(id) ? 'marked wrong' : x.rej ? 'contested · not chosen' : x.contest ? 'contested · chosen' : x.st === 'thin' ? 'thin' : x.unused ? 'not used' : x.stale ? 'active · stale' : 'active';
        return `<tr data-fact="${id}" class="${x.st === 'thin' ? 'thin' : ''} ${x.contest ? 'contested' : ''} ${x.unused ? 'unused' : ''} ${x.stale ? 'stale' : ''} ${wrongPins.has(id) ? 'rb-wrong' : ''}"><td class="r-pin"><span class="pin"></span>${id}</td><td><b>${x.fact}</b><small><span class="tier t-${x.tier.toLowerCase()}"></span>${x.src} · as of ${x.asof}</small></td><td class="r-val">${x.rej ? `<s>${x.value}</s>` : hl(x.value)}</td><td>${conf(x.conf)}</td><td>${status}</td></tr>`; }).join('');
    }
    function renderContest() {
      $('rb-contest').innerHTML = `<div class="rb-contest" data-rb-sel="contest:0">
        <div class="rb-c-top"><b>${C.what}</b><span class="st-pill ok">Resolved · Kantar chosen</span></div>
        <div class="r-vs">
          <div class="rb-c-side won"><span class="tag">Chosen</span><span class="v"><mark class="rs-hl">23.4%</mark></span><span>${sChip('s3')} ${pinChip('f_007')}</span><span>${C.a.method}</span></div>
          <div class="rb-c-side lost"><span class="tag">Not chosen · kept</span><span class="v">31%</span><span>${sChip('s4')} ${pinChip('f_008', 1)}</span><span>${C.b.method}</span></div>
          <div class="r-scale"><i class="tick" style="left:0">0</i><i class="tick" style="left:100%">35%</i><i class="mk won" style="left:66.9%"></i><i class="mk lost" style="left:88.6%"></i></div>
        </div>
        <div class="rb-c-why"><span><b>Why</b> · ${C.why} · ${C.who} · ${C.when} · ${dChip('d_044')}</span><button type="button" class="side-link" data-rb-act="resolve">Change the pick…</button><button type="button" class="side-link" data-rb-sel="why:contest">Why is this here?</button></div></div>`;
    }
    function renderGaps() {
      $('rb-gaps').innerHTML = GAPS.map((g, i) => `<div class="rb-gap"><span class="cov ${g.cov}"></span><div><div class="rb-gap-k"><b>${g.k}</b>${lensPill(g.lens)}<span class="mk-pill">${g.mk}</span></div>${g.t}<div class="rb-gap-d">Searched: ${g.searched}<br>Sources tried: ${g.tried}<br>${g.note}</div></div><button type="button" class="side-link" data-rb-act="gap:${i}">Research this</button></div>`).join('');
    }
    function renderCov() {
      const cell = (l, m) => { const c = (COV2[l] || {})[m]; return c ? `<i class="c-${c[0]}" title="${l} · ${m} · ran ${c[1]}"></i>` : `<i class="n" title="${l} · ${m} · no run recorded"></i>`; };
      $('r-cov').innerHTML = `<table class="rb-cov"><thead><tr><th>Lens</th>${MKS.map(m => `<th>${m}</th>`).join('')}<th>Merged</th><th style="text-align:left">What it gave</th></tr></thead><tbody>${RS_LENS.map(l => `<tr><td>${l}</td>${MKS.map(m => `<td>${cell(l, m)}</td>`).join('')}<td>${cell(l, 'IE')}</td><td class="note">${COVNOTE[l]}</td></tr>`).join('')}</tbody></table>
        <p class="rb-cov-f">6 of 16 lens × market runs · research.web, research.social, knowledge.extract · 02–05 Nov 2026</p>
        <p class="r-cov-key"><i class="c-v"></i> verified pin <i class="c-u"></i> used in a finding <i class="c-c"></i> contested <i class="c-x"></i> searched, nothing found <i class="n" style="border:1px dashed var(--faint)"></i> no run recorded</p>`;
      $('rb-minicov').innerHTML = `<span></span>${MKS.map(m => `<span class="h">${m}</span>`).join('')}<span class="h">ALL</span>` + RS_LENS.map(l => `<span>${l}</span>${MKS.map(m => `<button type="button" data-rb-goto="r-coverage">${cell(l, m)}</button>`).join('')}<button type="button" data-rb-goto="r-coverage">${cell(l, 'IE')}</button>`).join('');
    }
    function renderExcluded() {
      $('rb-excl').innerHTML = ['s8', 's9'].map(id => `<div class="rb-ex"><span class="rb-ex-k">excluded · not pinned</span><span><b>${SRC[id].name}</b> · ${SRC[id].what}. ${SRC[id].excl}</span><small>Review agent · ${dChip(SRC[id].exd)}</small></div>`).join('')
        + `<div class="rb-ex"><span class="rb-ex-k">note · not pinned</span><span><b>4 candidate facts</b> kept as notes: opinions with no figure (“Gen Z loves soft serve”, UK sample).</span><small>Knowledge agent · ${dChip('d_041')}</small></div>`
        + `<div class="rb-ex"><span class="rb-ex-k">pinned · not used</span><span><b>f_014 · Met Éireann</b> · warm days +18%. ${FX.f_014.unused.split('. ').slice(1, 2).join('')}.</span><small>Synthesis agent · ${dChip('d_046')}</small></div>`;
    }
    function renderRun() {
      $('rb-run').innerHTML = `<ol class="rb-run">
        <li><div><b>Strategy agent</b> scoped the question into 3 sub-questions<small>strategy.scope · claude-sonnet-4.6 · read client-email.txt, client-call-notes.pdf</small></div><span class="t">09:41</span><details><summary>The 3 sub-questions</summary><ul><li>When and why do 16–24s stop for a treat?</li><li>Where is indulgence moving (outing vs home)?</li><li>Is there a McFlurry behaviour worth building on?</li></ul></details></li>
        <li><div><b>Research agent</b> ran 41 queries across 4 lenses and read 9 sources<small>research.web, research.social · Audience 14 · Category 12 · Culture 9 · Competitors 6</small></div><span class="t">09:44–09:56</span><details><summary>Some of the queries</summary><ul><li>“Bord Bia treat occasions 16-24 2026”</li><li>“frozen dessert delivery growth Ireland”</li><li>“#mcflurry ireland sharing”</li><li>“Fanta Frozen Ireland outdoor 2026” · nothing found</li></ul></details></li>
        <li><div><b>Knowledge agent</b> extracted 14 candidates, pinned 8, excluded 2<small>knowledge.extract · ${dChip('d_041')}</small></div><span class="t">09:58</span></li>
        <li><div><b>Review agent</b> checked every claim: 1 verified, 1 contest resolved, 1 held for you<small>review.check · ${dChip('d_042')} ${dChip('d_043')} ${dChip('d_044')} ${dChip('d_045')}</small></div><span class="t">10:12–10:40</span></li>
        <li><div><b>Synthesis agent</b> wrote 3 findings and composed the answer<small>synthesis.claim, report.compose · ${dChip('d_046')} · facts sha 9f3a·c21e</small></div><span class="t">10:44</span></li></ol>`;
    }
    let logKind = 'all', logWho = 'all';
    function renderLog() {
      const ids = Object.keys(D);
      const kinds = ['all', ...new Set(ids.map(i => D[i].kind))];
      const list = ids.filter(i => (logKind === 'all' || D[i].kind === logKind) && (logWho === 'all' || (logWho === 'people' ? !/agent/i.test(D[i].who) : /agent/i.test(D[i].who))));
      $('rb-log-h').textContent = ids.length + ' decisions';
      $('rb-log').innerHTML = `<div class="rb-logf">Kind ${kinds.map(k => `<button type="button" data-rb-logk="${k}" class="${k === logKind ? 'on' : ''}">${k}</button>`).join('')}<span class="sp"></span>Actor ${['all', 'agents', 'people'].map(k => `<button type="button" data-rb-logw="${k}" class="${k === logWho ? 'on' : ''}">${k}</button>`).join('')}<span style="margin-left:auto">${list.length} shown</span></div>${list.map(decRow).join('')}`;
    }
    function renderOutline() {
      const items = [['r-ask', '00', 'The ask'], ['r-answer', '01', 'Answer'], ['r-findings', '02', 'Findings', '3'], ...[0, 1, 2].map(i => ['finding:' + i, '', `${i + 1} · ${F[i].short}`, '', i]), ['r-contests', '03', 'Contests', '1'], ['r-gaps', '04', 'Gaps', '4'], ['r-pins', '05', 'Pinned facts', '8'], ['r-coverage', '06', 'Coverage'], ['r-excluded', '07', 'Excluded', '2'], ['r-howran', '08', 'How it ran'], ['r-record', '09', 'On the record', String(Object.keys(D).length)]];
      $('rb-outline').innerHTML = items.map(([id, n, t, c, fi]) => fi !== undefined
        ? `<li class="rb-o-sub"><button type="button" data-rb-goto="${id}"><span class="rb-o-dot ${['proposed'].includes(fState(fi)) ? 'p' : ['rejected', 'cut'].includes(fState(fi)) ? 'x' : ''}"></span>${t}</button></li>`
        : `<li><button type="button" data-rb-goto="${id}"><span class="rb-o-n">${n}</span>${t}${c ? `<span class="rb-o-c">${c}</span>` : ''}</button></li>`).join('');
    }
    function renderMix() {
      const MIX = [['Panel', 2, 'm1'], ['Trade', 2, 'm2'], ['Social', 2, 'm3'], ['Gov', 2, 'm4'], ['Client', 1, 'm5']];
      $('r-srcmix').innerHTML = MIX.map(([n, k, c]) => `<i class="${c}" style="flex:${k}" title="${n} · ${k}"></i>`).join('');
      $('r-srcleg').innerHTML = MIX.map(([n, k, c]) => `<span><i class="${c}"></i>${n} ${k}</span>`).join('');
    }
    function decorateCards() {
      [0, 1, 2].forEach(i => { const c = card(i); if (!c || c.querySelector('.rb-used')) return;
        const uses = CL.map((x, k) => x.f.includes(i) ? k : -1).filter(k => k >= 0);
        c.insertAdjacentHTML('beforeend', `<div class="rb-used">Used in the answer · ${uses.map(k => `<button type="button" class="rb-cchip" data-rb-sel="claim:${k}">sentence ${k + 1}</button>`).join('')} <span>· ${F[i].d.length} decisions</span></div>`); });
    }

    // ── 2. Provenance graph under the answer ──
    const TSRC = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    function litFor(sel) {
      const L = new Set(); if (!sel) return L;
      const addPin = p => { L.add(p); L.add(fx(p).s); };
      if (sel.kind === 'answer') { CL.forEach((c, k) => { L.add('c' + k); c.f.forEach(i => L.add('n' + i)); c.pins.forEach(addPin); (c.rej || []).forEach(addPin); }); }
      else if (sel.kind === 'claim') { const c = CL[sel.id]; L.add('c' + sel.id); c.f.forEach(i => L.add('n' + i)); c.pins.forEach(addPin); (c.rej || []).forEach(addPin); }
      else if (sel.kind === 'finding') { L.add('n' + sel.id); F[sel.id].pins.forEach(addPin); (F[sel.id].rejPins || []).forEach(addPin); CL.forEach((c, k) => { if (c.f.includes(sel.id)) L.add('c' + k); }); }
      else if (sel.kind === 'fact') { addPin(sel.id); F.forEach((f, i) => { if (f.pins.includes(sel.id) || (f.rejPins || []).includes(sel.id)) L.add('n' + i); }); CL.forEach((c, k) => { if (c.pins.includes(sel.id) || (c.rej || []).includes(sel.id)) L.add('c' + k); }); }
      else if (sel.kind === 'source') { L.add(sel.id); SRC[sel.id].pins.forEach(p => { L.add(p); F.forEach((f, i) => { if (f.pins.includes(p)) { L.add('n' + i); CL.forEach((c, k) => { if (c.f.includes(i) && c.pins.includes(p)) L.add('c' + k); }); } }); }); }
      else if (sel.kind === 'contest') { ['f_007', 'f_008', 's3', 's4', 'n1', 'c2'].forEach(x => L.add(x)); }
      return L;
    }
    function edges() {
      const E = [];
      PINS.forEach(p => E.push([fx(p).s, p, '']));
      F.forEach((f, i) => { f.pins.forEach(p => E.push([p, 'n' + i, ''])); (f.rejPins || []).forEach(p => E.push([p, 'n' + i, 'rej'])); });
      CL.forEach((c, k) => c.f.forEach(i => E.push(['n' + i, 'c' + k, ''])));
      return E;
    }
    function renderTrace() {
      const T = $('rb-trace');
      const node = (id, cls, sel, body) => `<button type="button" class="rb-tn ${cls}" data-node="${id}" data-rb-sel="${sel}">${body}</button>`;
      T.innerHTML = `<div class="rb-trace-h"><b>How this was formed</b><span>sources → pins → findings → answer · click a box</span><button type="button" class="side-link" data-rb-act="trace-x" style="font-size:12px">Hide</button></div>
        <div class="rb-tgrid" id="rb-tgrid">
          <div class="rb-tcol"><h6>Sources · 7 of 9</h6>${TSRC.map(s => node(s, s === 's7' ? 'unused' : s === 's4' ? 'rej' : '', 'source:' + s, `<b>${SRC[s].short}</b><small>${SRC[s].tier} · ${SRC[s].date}</small>`)).join('')}</div>
          <div class="rb-tcol"><h6>Pins · 8</h6>${PINS.map(p => { const x = fx(p); return node(p, x.unused ? 'unused' : x.rej ? 'rej' : '', 'fact:' + p, `<b>${p} · ${x.value}</b><small>${lvl(x.conf)}${x.unused ? ' · not used' : x.rej ? ' · not chosen' : ''}</small>`); }).join('')}</div>
          <div class="rb-tcol"><h6>Findings · 3</h6>${F.map((f, i) => node('n' + i, 'f' + (fState(i) === 'proposed' ? ' p' : ''), 'finding:' + i, `<b>${i + 1} · ${f.short}</b><small>${fState(i) === 'proposed' ? 'proposed · low' : fState(i) === 'cut' ? 'cut by you' : fState(i) === 'rejected' ? 'rejected' : 'verified · ' + lvl(f.cert[0]).toLowerCase()}</small>`)).join('')}</div>
          <div class="rb-tcol"><h6>Answer · 5 sentences</h6>${CL.map((c, k) => node('c' + k, 'c', 'claim:' + k, `<b>${k + 1} · ${c.short}</b><small>${c.kind.split(' · ')[0].toLowerCase()} · ${lvl(c.cert).toLowerCase()}</small>`)).join('')}</div>
          <svg class="rb-tsvg" id="rb-tsvg" aria-hidden="true"></svg>
        </div>
        <p class="rb-tleg"><span><i></i>feeds</span><span><i class="r"></i>considered, not chosen</span><span>dashed box · not used or not chosen</span><span>Excluded: Checkout, Retail Ireland (see 07)</span></p>`;
      requestAnimationFrame(drawTrace);
    }
    function drawTrace() {
      const G = $('rb-tgrid'), svg = $('rb-tsvg'); if (!G || $('rb-trace').hidden) return;
      const gr = G.getBoundingClientRect(), L = litFor(rsSel), any = L.size > 0;
      const pos = id => { const n = G.querySelector(`[data-node="${id}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left - gr.left, r: r.right - gr.left, y: r.top - gr.top + r.height / 2 }; };
      svg.setAttribute('viewBox', `0 0 ${gr.width} ${gr.height}`);
      svg.innerHTML = edges().map(([a, b, cls]) => { const A = pos(a), B = pos(b); if (!A || !B) return ''; const dx = (B.l - A.r) / 2; const on = any && L.has(a) && L.has(b);
        return `<path class="${cls} ${any ? (on ? 'on' : 'off') : ''}" d="M${A.r} ${A.y} C${A.r + dx} ${A.y}, ${B.l - dx} ${B.y}, ${B.l} ${B.y}"/>`; }).join('');
      const whole = rsSel && rsSel.kind === 'answer';
      $$('.rb-tn', G).forEach(n => { n.classList.toggle('lit', any && !whole && L.has(n.dataset.node)); n.classList.toggle('dim', any && !L.has(n.dataset.node)); });
    }
    const showTrace = on => { const T = $('rb-trace'); if (on) { if (T.hidden || !T.innerHTML) { T.hidden = false; renderTrace(); } else requestAnimationFrame(drawTrace); } else { T.hidden = true; } $('rb-how').textContent = on ? 'Hide how this was formed' : 'See how this was formed'; };
    window.addEventListener('resize', () => requestAnimationFrame(drawTrace));

    // ── 3. Inspector views ──
    const askSec = label => sec('Ask about this', `<div class="r-askbox" data-ask="sel" data-label="${label}"></div>`);
    function vAnswer() {
      return `<div class="rbi-head"><span class="rbi-kind">01 · Answer</span><span class="st-pill warn">Medium confidence</span></div>
        <p class="rbi-title">How the answer was formed</p>
        <p class="rbi-meta">Composed by <b>Synthesis agent</b> · report.compose · 05 Nov 10:44 · ${dChip('d_046')}</p>
        ${sec('Sentence by sentence', `<ol class="rbi-claims">${CL.map((c, k) => `<li><button type="button" data-rb-sel="claim:${k}" class="${claimFlag(k) ? 'flagged' : ''}"><span class="no">${k + 1}</span><span>${$q(`.rb-claim[data-claim="${k}"]`).textContent.replace(/[\d·]+$/, '')}<small>${c.kind} · ${lvl(c.cert)}${claimFlag(k) ? ' · cites a cut or rejected finding' : ''}</small></span><span class="fx">${c.f.map(i => `<span class="rb-n${fState(i) === 'proposed' ? ' p' : ''}">${i + 1}</span>`).join('')}</span></button></li>`).join('')}</ol>`, 'click one to trace it')}
        ${sec('Why it says this', reason(ANS, 'Synthesis agent · d_046 · certainty is derived from the findings, never asked of the model'))}
        ${sec('Built from', `<div class="rbi-uses"><div class="rbi-use"><span>Findings</span>${[0, 1, 2].map(fChip).join(' ')}</div><div class="rbi-use"><span>Pins</span>${['f_003', 'f_004', 'f_005', 'f_007', 'f_009', 'f_011'].map(p => pinChip(p)).join(' ')}</div><div class="rbi-use"><span>Sources</span>${['s1', 's2', 's3', 's5', 's6'].map(sChip).join(' ')}</div><div class="rbi-use"><span>Considered</span>${pinChip('f_008', 1)} not chosen · ${pinChip('f_014')} not used</div><div class="rbi-use"><span>Excluded</span>${sChip('s8')} ${sChip('s9')}</div></div>`)}
        ${sec('Decisions on the record', ['d_046', 'd_044', 'd_045'].map(decRow).join(''))}
        <div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="trace">Show the graph</button><button type="button" class="rb-btn" data-rb-sel="why:answer">Why is this here?</button><button type="button" class="rb-btn" data-rb-act="refresh">Refresh the answer</button></div>
        ${askSec('the answer')}`;
    }
    function vClaim(k) {
      const c = CL[k], txt = $q(`.rb-claim[data-claim="${k}"]`).textContent.replace(/[\d·]+$/, '').replace(/[,:]$/, '');
      const chain = c.pins.map(p => { const x = fx(p), sx = SRC[x.s]; return `<li class="hl"><span class="k">${p} · ${x.value} · ${lvl(x.conf)}</span>${x.fact}<br><span style="font:11px var(--font-mono);color:var(--muted)">← ${sx.name} · ${sx.date} · ${sx.loc}</span></li>`; }).join('');
      return `<div class="rbi-head"><span class="rbi-kind">Answer · sentence ${k + 1} of 5</span>${c.cert === 'low' ? '<span class="st-pill warn">Low · thin</span>' : c.cert === 'med' ? '<span class="st-pill warn">Medium · inference</span>' : '<span class="st-pill ok">High</span>'}</div>
        <p class="rbi-title">“${txt}”</p>
        <p class="rbi-meta"><b>${c.kind}</b></p>
        ${claimFlag(k) ? '<div class="rbi-flag"><b>Flagged.</b> This sentence cites a finding you cut or rejected, or a pin marked wrong. Refresh the report to rewrite it.</div>' : ''}
        ${sec('Comes from', `<div class="rbi-uses">${c.f.map(i => `<div class="rbi-use"><span>${fChip(i)}</span>${FSTMT(i)} ${stPill(fState(i))}</div>`).join('')}</div>`)}
        ${sec('Pins and sources under it', `<ol class="rbi-chain">${chain}${(c.rej || []).map(p => `<li><span class="k">${p} · ${fx(p).value} · not chosen</span>${fx(p).fact} · lost the contest in ${dChip('d_044')}</li>`).join('')}</ol>`)}
        ${sec('Why it says this', reason({ decided: `Write “${txt}”`, because: c.because, rejected: c.rejected, cert: [c.cert, c.kind], change: c.change, attention: c.attention }))}
        <div class="rbi-acts">${c.f.map(i => `<button type="button" class="rb-btn" data-rb-sel="finding:${i}">Open Finding ${i + 1}</button>`).join('')}<button type="button" class="rb-btn" data-rb-sel="answer:0">The whole answer</button></div>
        ${askSec('sentence ' + (k + 1))}`;
    }
    function vFinding(i) {
      const f = F[i], st = fState(i), x0 = SRC[f.s];
      const pinRows = [...f.pins.map(p => [p, 0]), ...(f.rejPins || []).map(p => [p, 1])].map(([p, rj]) => { const x = fx(p);
        return `<tr data-rb-sel="fact:${p}" class="${rj ? 'rej' : ''}"><td><span class="pin"></span>${p}</td><td>${x.fact}<small>${x.src} · ${x.tier} · as of ${x.asof}</small></td><td class="v">${x.value}</td><td>${conf(x.conf)}<small>${wrongPins.has(p) ? 'marked wrong' : rj ? 'not chosen' : x.st === 'thin' ? 'thin' : x.stale ? 'stale' : x.contest ? 'chosen' : 'active'}</small></td></tr>`; }).join('');
      const shares = [...new Set(f.pins.flatMap(p => (RS_FACT[p].used || []).filter(j => j !== i)))];
      const flagged = f.pins.some(p => wrongPins.has(p));
      return `<div class="rbi-head"><span class="rbi-kind"><span class="rb-n${st === 'proposed' ? ' p' : ''}">${i + 1}</span>Finding ${i + 1} of 3</span>${stPill(st)}</div>
        <p class="rbi-title" style="${['rejected', 'cut'].includes(st) ? 'text-decoration:line-through;color:var(--muted)' : ''}">${FSTMT(i)}</p>
        <p class="rbi-meta">${lensPill(f.lens)}<span class="mk-pill">IE</span>Worked out by <b>${f.who}</b> · ${f.derived}</p>
        ${st === 'proposed' ? `<div class="rbi-needs"><b>Your call · 1 open</b><p>It rests on 2 TikTok clips. Keep it as a working hypothesis, or cut it?</p><div><button type="button" class="rb-btn pri" data-rb-act="keep">Keep as working hypothesis</button><button type="button" class="rb-btn" data-rb-act="cut">Cut finding</button></div></div>` : ''}
        ${flagged ? '<div class="rbi-flag"><b>Flagged.</b> It rests on a pin someone marked wrong.</div>' : ''}
        ${sec('Evidence', `<blockquote class="rbi-q">${f.quote}</blockquote><p class="rbi-srcline">${x0.name} · ${x0.date} · ${x0.sample} · ${x0.loc} · ${x0.lic} · ${x0.mat} · <button type="button" data-rb-act="open-src">Open it ↗</button></p>${f.ev2 ? `<div class="rbi-ev2"><blockquote class="rbi-q">${f.ev2[1]}</blockquote><p class="rbi-srcline">${SRC[f.ev2[0]].name} · ${SRC[f.ev2[0]].date} · ${SRC[f.ev2[0]].sample} · ${SRC[f.ev2[0]].loc} · ${SRC[f.ev2[0]].lic}</p></div>` : ''}`, (f.ev2 ? 2 : 1) + ' source' + (f.ev2 ? 's' : ''))}
        ${sec('Why it says this', reason(f, `${f.who} · checked by Review agent`))}
        ${sec('Rests on', `<table class="rbi-pins">${pinRows}</table>`, f.pins.length + ' pins' + (f.rejPins ? ' · 1 not chosen' : ''))}
        ${sec('Confidence', `<p>${conf(f.cert[0])} <b>${lvl(f.cert[0])}</b>. Derived from the pins, never asked of the model: ${f.confWhy}</p>`)}
        ${sec('Contests touching it', f.contest ? `<div class="rbi-vs"><div class="won"><span class="tag">Chosen</span><span class="v">23.4%</span>${sChip('s3')} ${pinChip('f_007')}</div><div class="lost"><span class="tag">Not chosen · kept</span><span class="v">31%</span>${sChip('s4')} ${pinChip('f_008', 1)}</div></div><p>${C.why} · ${dChip('d_044')} · <button type="button" class="side-link" data-rb-sel="contest:0" style="font-size:12.5px">Open the contest</button></p>` : '<p class="rbi-none">None. No source disagrees with these pins.</p>')}
        ${sec('Verification', `<p>${st === 'verified-you' ? 'Verified by <b>you</b> · just now · written to the layer as a working hypothesis.' : st === 'rejected' ? `Rejected by <b>you</b> · just now · “${esc(f.rejBy)}”` : st === 'cut' ? 'Cut by <b>you</b> · just now. It no longer feeds the answer.' : f.ver}</p>`)}
        ${sec('Decisions on the record', f.d.map(decRow).join(''), f.d.length)}
        ${sec('Used by', `<div class="rbi-uses"><div class="rbi-use"><span>Answer</span>${CL.map((c, k) => c.f.includes(i) ? `<button type="button" class="rb-cchip" data-rb-sel="claim:${k}">sentence ${k + 1}</button>` : '').join(' ')}</div><div class="rbi-use"><span>Brief</span>${i === 0 ? 'McFlurry Summer 2026 · Insight' : i === 1 ? 'McFlurry Summer 2026 · Proof point 2' : 'Not in a brief yet'}</div><div class="rbi-use"><span>Shares pins</span>${shares.length ? shares.map(fChip).join(' ') : 'with no other finding'}</div></div>`)}
        <div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="vr:${i}">Verify or reject…</button><button type="button" class="rb-btn" data-rb-sel="why:F${i + 1}">Why is this here?</button><button type="button" class="rb-btn" data-rb-act="trace">Show in the graph</button></div>
        <div class="rbi-form" id="rb-vr" hidden><label><input type="radio" name="rbvr" value="v" checked> Verify: it holds</label><label><input type="radio" name="rbvr" value="r"> Reject: it is wrong</label><textarea rows="2" placeholder="Your reason (goes on the record)"></textarea><div style="display:flex;gap:6px"><button type="button" class="rb-btn pri" data-rb-act="vr-go:${i}">Write to the record</button><button type="button" class="rb-btn" data-rb-act="vr-x">Cancel</button></div></div>
        ${askSec('Finding ' + (i + 1))}`;
    }
    function vFact(id) {
      const x = fx(id), sx = SRC[x.s], users = F.map((f, i) => f.pins.includes(id) ? i : -1).filter(i => i >= 0);
      const status = wrongPins.has(id) ? '<span class="st-pill bad">Marked wrong</span>' : x.rej ? '<span class="st-pill bad">Contested · not chosen</span>' : x.contest ? '<span class="st-pill ok">Contested · chosen</span>' : x.st === 'thin' ? '<span class="st-pill warn">Thin</span>' : x.unused ? '<span class="st-pill mute">Pinned · not used</span>' : x.stale ? '<span class="st-pill warn">Active · stale</span>' : '<span class="st-pill ok">Active</span>';
      const ORI = { extracted: 'Extracted', proposed: 'Proposed', confirmed: 'Confirmed', stated: 'Stated' };
      return `<div class="rbi-head"><span class="rbi-kind"><span class="pin" style="margin:0"></span>Pin · ${id}</span>${status}</div>
        <p class="rbi-title">${x.fact}</p>
        <div class="rbi-big">${x.rej ? `<s>${x.value}</s>` : hl(x.value)}</div><div class="rbi-unit">${x.unit}</div>
        <p class="rbi-meta" style="margin-top:8px"><code>${x.key}</code><span class="mk-pill">${x.mk}</span>${lensPill(x.lens)}<span>method · ${x.method}</span></p>
        ${x.stale ? `<div class="rbi-warn"><b>Stale.</b> ${x.stale}</div>` : ''}
        ${x.unused ? `<div class="rbi-warn"><b>Not used.</b> ${x.unused}</div>` : ''}
        ${x.licWarn ? `<div class="rbi-flag"><b>Licence.</b> ${x.licWarn}</div>` : ''}
        <div class="rbi-sec" style="border:0;padding-top:4px"><dl class="rbi-grid">
          <div><dt>As of</dt><dd>${x.asof}</dd></div><div><dt>Learned</dt><dd>${x.ret}<small>retrieved_at</small></dd></div>
          <div><dt>Confidence</dt><dd>${conf(x.conf)} ${lvl(x.conf)}<small>from source tier and corroboration</small></dd></div><div><dt>Licence</dt><dd>${x.lic}</dd></div>
          <div class="w"><dt>Source</dt><dd><span class="tier t-${x.tier.toLowerCase()}"></span>${sx.name} · ${x.tier}<small>${sx.what} · ${sx.loc} · ${sx.mat}</small></dd></div></dl></div>
        ${sec('Source line', `<blockquote class="rbi-q">${x.quote}</blockquote><p class="rbi-srcline">${sChip(x.s)} · ${sx.date} · ${sx.loc} · ${sx.lic} · ${sx.mat}${window.openSource && /^f_0(03|04|07|09|11|14)$/.test(id) ? ` · <button type="button" data-rb-act="osrc:${id}">Full source →</button>` : ` · <button type="button" data-rb-act="open-src">Open it ↗</button>`}</p>`)}
        ${sec('Where it came from', `<ol class="rbi-chain"><li><span class="k">Source</span>${sx.name} · ${sx.tier} · read ${sx.read}</li><li><span class="k">Knowledge layer row</span>${x.row}</li><li><span class="k">Frozen pin</span>${id}@v${/v2/.test(x.row) ? 2 : 1}, pinned ${x.pinned}. A pin never follows a newer row; you choose when to take one.</li><li class="hl"><span class="k">Origin · ${ORI[x.origin[0]]}</span>${x.origin[1]}</li></ol><p class="rbi-srcline"><code>fact://mcd/ie/${id}@v${/v2/.test(x.row) ? 2 : 1}</code></p>`)}
        ${x.contest ? sec('Contest', `<div class="rbi-vs"><div class="${id === 'f_007' ? 'won' : 'lost'}"><span class="tag">${id === 'f_007' ? 'This pin · chosen' : 'This pin · not chosen'}</span><span class="v">${x.value}</span></div><div class="${id === 'f_007' ? 'lost' : 'won'}"><span class="tag">${id === 'f_007' ? 'Not chosen · kept' : 'Chosen'}</span><span class="v">${fx(id === 'f_007' ? 'f_008' : 'f_007').value}</span>${pinChip(id === 'f_007' ? 'f_008' : 'f_007', id === 'f_007')}</div></div><p>${C.why} · ${dChip('d_044')} · <button type="button" class="side-link" data-rb-sel="contest:0" style="font-size:12.5px">Open the contest</button></p>`) : ''}
        ${sec('Used by', `<div class="rbi-uses"><div class="rbi-use"><span>Findings</span>${users.length ? users.map(fChip).join(' ') : x.rej ? 'none · it lost the contest' : 'none'}</div><div class="rbi-use"><span>Answer</span>${x.claims.length ? x.claims.map(k => `<button type="button" class="rb-cchip" data-rb-sel="claim:${k}">sentence ${k + 1}</button>`).join(' ') : 'not cited'}</div><div class="rbi-use"><span>Brief</span>${x.brief.length ? x.brief.map(b => 'McFlurry Summer 2026 · ' + b).join(', ') : 'not cited'}</div></div>`)}
        ${sec('Decisions on the record', x.d.map(decRow).join(''), x.d.length)}
        <div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="confirm:${id}">Confirm</button><button type="button" class="rb-btn bad" data-rb-act="wrong:${id}">Mark wrong…</button><button type="button" class="rb-btn" data-rb-act="lic:${id}">Confidential…</button><button type="button" class="rb-btn" data-rb-sel="why:${id}">Why is this here?</button></div>
        <div class="rbi-form" id="rb-wrong" hidden><p style="font-size:12.5px;margin:0">What’s wrong with ${id}? Findings that rest on it get flagged until someone looks.</p><div class="rbi-presets"><button type="button">out of date</button><button type="button">wrong market</button><button type="button">misread the source</button></div><textarea rows="2" placeholder="Or say it in your words"></textarea><div style="display:flex;gap:6px"><button type="button" class="rb-btn pri" data-rb-act="wrong-go:${id}">Mark wrong</button><button type="button" class="rb-btn" data-rb-act="form-x">Cancel</button></div></div>
        ${askSec(id)}`;
    }
    function vSource(sid) {
      const s = SRC[sid], ds = Object.keys(D).filter(d => D[d].to.includes(sid) || s.pins.some(p => D[d].to.includes(p)));
      return `<div class="rbi-head"><span class="rbi-kind"><span class="tier t-${s.tier.toLowerCase()}"></span>Source · ${s.tier}</span>${s.excl ? '<span class="st-pill mute">Excluded · not pinned</span>' : s.pins.every(p => FX[p].rej) ? '<span class="st-pill bad">Read · lost a contest</span>' : s.pins.every(p => FX[p].unused) ? '<span class="st-pill mute">Pinned · not used</span>' : '<span class="st-pill ok">Read · pinned</span>'}</div>
        <p class="rbi-title">${s.name}</p><p class="rbi-meta">${s.what}</p>
        ${s.excl ? `<div class="rbi-warn"><b>Excluded.</b> ${s.excl} ${dChip(s.exd)}</div>` : ''}
        ${s.tier === 'Client' ? `<div class="rbi-flag"><b>Licence.</b> ${FX.f_008.licWarn}</div>` : ''}
        <div class="rbi-sec" style="border:0;padding-top:4px"><dl class="rbi-grid"><div><dt>Published</dt><dd>${s.date}</dd></div><div><dt>Read</dt><dd>${s.read}</dd></div><div><dt>Sample</dt><dd>${s.sample}</dd></div><div><dt>Licence</dt><dd>${s.lic}</dd></div><div class="w"><dt>Locator · material</dt><dd>${s.loc} · ${s.mat}</dd></div></dl></div>
        ${sec('Pins it gave', s.pins.length ? `<table class="rbi-pins">${s.pins.map(p => { const x = fx(p); return `<tr data-rb-sel="fact:${p}" class="${x.rej ? 'rej' : ''}"><td><span class="pin"></span>${p}</td><td>${x.fact}<small>“${x.quote.replace(/^“|”$/g, '')}”</small></td><td class="v">${x.value}</td></tr>`; }).join('')}</table>` : '<p class="rbi-none">None.</p>')}
        ${sec('Reaches', `<div class="rbi-uses"><div class="rbi-use"><span>Findings</span>${[...new Set(s.pins.flatMap(p => F.map((f, i) => f.pins.includes(p) ? i : -1).filter(i => i >= 0)))].map(fChip).join(' ') || 'none'}</div><div class="rbi-use"><span>Answer</span>${[...new Set(s.pins.flatMap(p => FX[p].claims))].map(k => `<button type="button" class="rb-cchip" data-rb-sel="claim:${k}">sentence ${k + 1}</button>`).join(' ') || 'not cited'}</div></div>`)}
        ${sec('Decisions on the record', ds.map(decRow).join('') || '<p class="rbi-none">None.</p>', ds.length)}
        <div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="open-src">Open it ↗</button><button type="button" class="rb-btn" data-rb-act="trace">Show in the graph</button></div>`;
    }
    function vContest() {
      const side = (x, won) => `<div class="${won ? 'won' : 'lost'}"><span class="tag">${won ? 'Chosen' : 'Not chosen · kept'}</span><span class="v">${x.v}</span><span>From ${sChip(x.s)} · ${pinChip(x.pin, !won)}</span><span>${x.method}</span><q>${x.quote.replace(/^“|”$/g, '')}</q><span style="font:10.5px var(--font-mono);color:var(--muted)">${x.row}</span><button type="button" class="side-link" data-rb-act="open-src" style="font-size:11.5px">Open the source ↗</button></div>`;
      return `<div class="rbi-head"><span class="rbi-kind">Contest · two sources disagree</span><span class="st-pill ok">Resolved</span></div>
        <p class="rbi-title">${C.what}</p><p class="rbi-meta"><code>${C.key}</code><span class="mk-pill">IE</span>${lensPill('Category')}</p>
        ${sec('The values', `<div class="rbi-vs">${side(C.a, 1)}${side(C.b, 0)}</div>`)}
        ${sec('Why', reason(D.d_044, `${C.who} · ${C.when} · d_044`))}
        ${sec('Affects', `<div class="rbi-uses"><div class="rbi-use"><span>Findings</span>${fChip(1)}</div><div class="rbi-use"><span>Answer</span><button type="button" class="rb-cchip" data-rb-sel="claim:2">sentence 3</button> <button type="button" class="rb-cchip" data-rb-sel="claim:3">sentence 4</button></div></div>`)}
        ${sec('Decisions on the record', ['d_043', 'd_044'].map(decRow).join(''))}
        <div class="rbi-acts"><button type="button" class="rb-btn" data-rb-act="resolve">Change the pick…</button><button type="button" class="rb-btn" data-rb-sel="why:contest">Why is this here?</button></div>
        <div class="rbi-form" id="rb-res" hidden><p style="font-size:12.5px;margin:0">Pick the value the report should use.</p><label><input type="radio" name="rbres" value="a" checked> Kantar · 23.4%</label><label><input type="radio" name="rbres" value="b"> Client deck · 31%</label><div class="rbi-presets"><button type="button">newer</button><button type="button" class="on">more trusted source</button><button type="button">fits the market</button></div><textarea rows="2" placeholder="Or your own reason"></textarea><div style="display:flex;gap:6px"><button type="button" class="rb-btn pri" data-rb-act="res-go">Resolve</button><button type="button" class="rb-btn" data-rb-act="form-x">Cancel</button></div></div>`;
    }
    function vDecision(id) {
      const d = D[id];
      return `<div class="rbi-head"><span class="rbi-kind">Decision · ${id}</span><span class="rb-kind k-${d.kind}">${d.kind}</span></div>
        <p class="rbi-title"><b>${d.who}</b> ${d.line}</p><p class="rbi-meta">05 Nov ${d.t}</p>
        ${sec('Reasoning', reason(d))}
        ${sec('Targets', `<div style="display:flex;flex-wrap:wrap;gap:5px">${d.to.map(cite).join('')}</div>`)}`;
    }
    function vWhy(t) {
      const ids = Object.keys(D).filter(d => D[d].to.includes(t));
      const name = t === 'answer' ? 'the answer' : t === 'contest' ? 'the delivery-growth contest' : /^F/.test(t) ? 'Finding ' + t.slice(1) : t;
      return `<div class="rbi-head"><span class="rbi-kind">Why is this here?</span><span class="st-pill mute">${ids.length} decisions</span></div>
        <p class="rbi-title">Every decision on ${name}</p>
        <p class="rbi-cur">Current value set by ${ids.length ? ids[ids.length - 1] : '—'} · ${ids.length ? D[ids[ids.length - 1]].who : ''}</p>
        <div class="rbi-sec"><ol class="rbi-tl">${ids.map(d => `<li class="${D[d].cls}"><div class="rbi-tl-h"><span class="rb-t">${D[d].t}</span> <span class="rb-kind k-${D[d].kind}">${D[d].kind}</span> <b>${D[d].who}</b> ${D[d].line} · ${dChip(d)}</div>${reason(D[d])}</li>`).join('')}</ol></div>`;
    }
    function vLock() {
      const bl = blockers();
      return `<div class="rbi-head"><span class="rbi-kind">Lock and accept</span><span class="st-pill ${bl.length ? 'warn' : 'ok'}">${bl.length ? bl.length + ' blocking' : 'Ready'}</span></div>
        <p class="rbi-title">${bl.length ? 'Not ready to lock yet' : 'Ready to lock'}</p>
        <p class="rbi-meta">Locking writes one approve decision. A brief made after that uses this version.</p>
        ${sec('Blocking', bl.length ? `<ul class="rbi-block">${bl.map(([t, sel]) => `<li><i></i><span>${t}</span><button type="button" class="side-link" data-rb-sel="${sel}" style="font-size:12px">Open</button></li>`).join('')}</ul>` : '<ul class="rbi-block"><li class="ok"><i></i><span>Nothing blocks it.</span><span></span></li></ul>')}
        ${sec('Checked', `<ul class="rbi-block"><li class="ok"><i></i><span>Open contests: none. 1 resolved (d_044).</span><span></span></li><li class="ok"><i></i><span>Unmerged branches: none.</span><span></span></li><li class="${fx('f_009').stale ? '' : 'ok'}"><i></i><span>Stale pins accepted as frozen: f_009 (layer is at 12.0M). Locking keeps 11.2M.</span><button type="button" class="side-link" data-rb-sel="fact:f_009" style="font-size:12px">Open</button></li></ul>`)}
        <div class="rbi-acts"><button type="button" class="rb-btn pri" data-rb-act="lock-go" ${bl.length ? 'disabled' : ''}>Accept and lock</button>${bl.length ? '<span style="font-size:12px;color:var(--muted);align-self:center">Make the open calls first.</span>' : ''}</div>`;
    }
    const $q = q => document.querySelector(q);
    const TITLE = { answer: () => 'Answer', claim: k => 'Sentence ' + (+k + 1), finding: i => 'Finding ' + (+i + 1), fact: id => id, source: s => SRC[s].short, contest: () => 'Contest', decision: d => d, why: t => 'Why · ' + (t === 'answer' ? 'answer' : t), lock: () => 'Lock' };

    // ── 4. Selection (replaces the page's rsSelect; every caller keeps working) ──
    let hist = [];
    function paintDoc() {
      $$('#research-sheet .sel, #research-sheet .rel').forEach(x => x.classList.remove('sel', 'rel'));
      $('r-answer').classList.toggle('rb-on', !!rsSel && (rsSel.kind === 'answer' || rsSel.kind === 'claim'));
      if (!rsSel) return;
      const k = rsSel.kind, id = rsSel.id;
      if (k === 'claim') { const c = $q(`.rb-claim[data-claim="${id}"]`); if (c) c.classList.add('sel'); CL[id].f.forEach(i => card(i) && card(i).classList.add('rel')); }
      if (k === 'finding') { const c = card(id); if (c) c.classList.add('sel'); CL.forEach((cl, j) => { if (cl.f.includes(+id)) $q(`.rb-claim[data-claim="${j}"]`).classList.add('rel'); }); F[id].pins.forEach(p => { const r = $q(`#r-facts-body tr[data-fact="${p}"]`); if (r) r.classList.add('rel'); }); }
      if (k === 'fact') { const r = $q(`#r-facts-body tr[data-fact="${id}"]`); if (r) r.classList.add('sel'); F.forEach((f, i) => { if (f.pins.includes(id) && card(i)) card(i).classList.add('rel'); }); (FX[id] ? FX[id].claims : []).forEach(j => $q(`.rb-claim[data-claim="${j}"]`).classList.add('rel')); }
      if (k === 'contest') { const c = $q('.rb-contest'); if (c) c.classList.add('sel'); }
    }
    function renderBar() {
      const bar = $('rb-ibar');
      if (!rsSel) { bar.hidden = true; bar.innerHTML = ''; return; }
      const trail = [...hist, rsSel].slice(-3), off = hist.length + 1 - trail.length;
      bar.hidden = false;
      bar.innerHTML = `<button type="button" class="rb-ibtn" data-rb-act="back" title="Back" ${hist.length ? '' : 'disabled'}>←</button><nav class="rb-crumbs"><button type="button" data-rb-act="close">Report</button>${off > 0 ? '<span>›</span><span>…</span>' : ''}${trail.map((t, j) => `<span>›</span>${j === trail.length - 1 ? `<b>${TITLE[t.kind](t.id)}</b>` : `<button type="button" data-rb-act="crumb:${off + j}">${TITLE[t.kind](t.id)}</button>`}`).join('')}</nav><button type="button" class="rb-ibtn" data-rb-act="close" title="Close (Esc)">×</button>`;
    }
    function renderPart() {
      if (!rsSel) return;
      const { kind, id } = rsSel;
      PART.innerHTML = kind === 'answer' ? vAnswer() : kind === 'claim' ? vClaim(+id) : kind === 'finding' ? vFinding(+id) : kind === 'fact' ? vFact(id) : kind === 'source' ? vSource(id) : kind === 'contest' ? vContest() : kind === 'decision' ? vDecision(id) : kind === 'why' ? vWhy(id) : vLock();
      $$('.r-askbox', PART).forEach(box => { askBoxIdle(box); box.addEventListener('click', e => { if (e.target.closest('.r-ask-open')) { e.stopPropagation(); box.innerHTML = ''; askBoxOpen(box); } }); });
    }
    rsSelect = function (kind, id, opt = {}) {
      if (kind === 'finding') { const c = card(+id); if (!c || c.hidden) { if (!(c && cut3)) return; } id = +id; }
      if (kind === 'fact' && !RS_FACT[id]) return;
      if (kind && rsSel && !opt.back && !(rsSel.kind === kind && String(rsSel.id) === String(id))) hist.push(rsSel);
      if (!kind) hist = [];
      if (hist.length > 12) hist = hist.slice(-12);
      rsSel = kind ? { kind, id } : null;
      SIDE.classList.toggle('has-sel', !!rsSel);
      if (!kind) { PART.hidden = true; PART.innerHTML = ''; renderBar(); paintDoc(); requestAnimationFrame(drawTrace); return; }
      renderPart(); PART.hidden = false; renderBar(); paintDoc(); SIDE.scrollTop = 0;
      if (kind === 'answer' || kind === 'claim') showTrace(true); else requestAnimationFrame(drawTrace);
    };
    const reRender = () => { renderFacts(); renderOutline(); rsStats(); if (!$('rb-trace').hidden) renderTrace(); $$('.rb-claim').forEach((c, k) => c.classList.toggle('flag', claimFlag(k))); if (rsSel) { renderPart(); renderBar(); paintDoc(); } updLock(); };
    function updLock() { const sh = $('research-sheet'); if (sh.classList.contains('locked')) return; const n = blockers().length; $('r-lock').textContent = n ? `Lock and accept · ${n}` : 'Lock and accept'; }

    // ── 5. Wiring ──
    const parseSel = v => { const i = v.indexOf(':'); return [v.slice(0, i), v.slice(i + 1)]; };
    const goSel = (k, id) => { if (k === 'answer') rsSelect('answer', 0); else rsSelect(k, ['finding', 'claim'].includes(k) ? +id : id); };
    SHEET.addEventListener('click', e => {
      const s = e.target.closest('[data-rb-sel]');
      if (s) { e.stopPropagation(); const [k, id] = parseSel(s.dataset.rbSel); goSel(k, id); return; }
      const a = e.target.closest('[data-rb-act]'); if (a) { e.stopPropagation(); act(a.dataset.rbAct, a); return; }
      const lk = e.target.closest('[data-rb-logk]'); if (lk) { e.stopPropagation(); logKind = lk.dataset.rbLogk; renderLog(); return; }
      const lw = e.target.closest('[data-rb-logw]'); if (lw) { e.stopPropagation(); logWho = lw.dataset.rbLogw; renderLog(); return; }
      if (e.target.closest('#rb-how')) { e.stopPropagation(); if ($('rb-trace').hidden) rsSelect('answer', 0); else showTrace(false); return; }
      const cl = e.target.closest('.rb-claim'); if (cl) { e.stopPropagation(); const k = +cl.dataset.claim; rsSelect(rsSel && rsSel.kind === 'claim' && rsSel.id === k ? 'answer' : 'claim', k); return; }
      if (e.target.closest('#rb-trace')) { e.stopPropagation(); return; }
      if (e.target.closest('#r-answer') && !e.target.closest('button, details, a')) { e.stopPropagation(); rsSelect('answer', 0); return; }
      if (e.target.closest('.prov-pill')) { const c = e.target.closest('.finding-card'); if (c) { e.stopPropagation(); rsSelect('finding', +c.dataset.fi); setTimeout(() => { const w = [...PART.querySelectorAll('.rbi-sec > h5')].find(h => h.textContent.startsWith('Why')); if (w) SIDE.scrollTop = w.parentElement.offsetTop - 60; }, 30); } }
    }, true);
    $('r-answer').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'r-answer') { e.preventDefault(); rsSelect('answer', 0); } });
    SIDE.addEventListener('click', e => {
      const s = e.target.closest('[data-rb-sel]');
      if (s) { e.stopPropagation(); const [k, id] = parseSel(s.dataset.rbSel); goSel(k, id); return; }
      const a = e.target.closest('[data-rb-act]'); if (a) { e.stopPropagation(); act(a.dataset.rbAct, a); return; }
      const pr = e.target.closest('.rbi-presets button'); if (pr) { e.stopPropagation(); pr.classList.toggle('on'); }
    }, true);
    $('rb-rail').addEventListener('click', e => {
      e.stopPropagation();
      const g = e.target.closest('[data-rb-goto]'); if (!g) return;
      const t = g.dataset.rbGoto;
      if (t.startsWith('finding:')) { const i = +t.slice(8); const c = card(i); if (c && !c.hidden) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); rsSelect('finding', i); } return; }
      const el = $(t); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (t === 'r-answer') rsSelect('answer', 0);
    });
    // outline follows the scroll
    const OUT_IDS = ['r-ask', 'r-answer', 'r-findings', 'r-contests', 'r-gaps', 'r-pins', 'r-coverage', 'r-excluded', 'r-howran', 'r-record'];
    window.addEventListener('scroll', () => {
      if ($('research-screen-output').hidden) return;
      let cur = OUT_IDS[0]; OUT_IDS.forEach(id => { const el = $(id); if (el && el.getBoundingClientRect().top < 160) cur = id; });
      $$('#rb-outline button').forEach(b => b.classList.toggle('on', b.dataset.rbGoto === cur));
    }, { passive: true });

    function act(a, el) {
      const [k, arg] = a.includes(':') ? parseSel(a) : [a, ''];
      if (k === 'back') { const p = hist.pop(); if (p) rsSelect(p.kind, p.id, { back: true }); return; }
      if (k === 'close') { rsSelect(null); return; }
      if (k === 'crumb') { const j = +arg; const t = hist[j]; hist = hist.slice(0, j); rsSelect(t.kind, t.id, { back: true }); return; }
      if (k === 'trace') { showTrace(true); $('r-answer').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (k === 'trace-x') { showTrace(false); return; }
      if (k === 'keep') { $('r-approve-finding').click(); return; }
      if (k === 'cut') { $('r-drop-finding').click(); return; }
      if (k === 'open-src') { showToast('Opens the source in a new tab (not in this mock).'); return; }
      if (k === 'osrc') { window.openSource && window.openSource(arg); return; }
      if (k === 'refresh') { $('r-refresh').click(); return; }
      if (k === 'vr') { const f = $('rb-vr'); f.hidden = !f.hidden; if (!f.hidden) f.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
      if (k === 'vr-x' || k === 'form-x') { const f = el.closest('.rbi-form'); if (f) f.hidden = true; return; }
      if (k === 'vr-go') {
        const i = +arg, f = $('rb-vr'), v = f.querySelector('input:checked').value, why = f.querySelector('textarea').value.trim() || (v === 'v' ? 'Holds up.' : 'Does not hold up.');
        if (v === 'v') { if (i === 2) $('r-approve-finding').click(); else { F[i].you = true; addDecision('verify', 'Siobhán Ryan', `verified Finding ${i + 1}`, ['F' + (i + 1)], { because: [[why, ['F' + (i + 1)]]] }); reRender(); } showToast(`Finding ${i + 1} verified. On the record.`); }
        else { F[i].rejBy = why; const c = card(i); if (c) c.classList.add('rb-rejected'); addDecision('reject', 'Siobhán Ryan', `rejected Finding ${i + 1}`, ['F' + (i + 1)], { because: [[why, ['F' + (i + 1)]]] }); if (i === 2) { $('r-drop-finding').click(); } reRender(); showToast(`Finding ${i + 1} rejected. Answer sentences that cite it are flagged.`); }
        return;
      }
      if (k === 'confirm') { addDecision('verify', 'Siobhán Ryan', `confirmed ${arg}`, [arg]); reRender(); showToast(`${arg} confirmed. On the record.`); return; }
      if (k === 'wrong') { const f = $('rb-wrong'); f.hidden = !f.hidden; return; }
      if (k === 'wrong-go') { const f = $('rb-wrong'); const why = [...f.querySelectorAll('.rbi-presets .on')].map(b => b.textContent).concat(f.querySelector('textarea').value.trim()).filter(Boolean).join('; ') || 'marked wrong'; wrongPins.add(arg); addDecision('reject', 'Siobhán Ryan', `marked ${arg} wrong: ${why}`, [arg]); reRender(); showToast(`${arg} marked wrong. Findings on it are flagged.`); return; }
      if (k === 'lic') { showToast(`${arg}: licence set to model only, no export.`); return; }
      if (k === 'resolve') { if (!rsSel || rsSel.kind !== 'contest') { rsSelect('contest', 0); setTimeout(() => { const f = $('rb-res'); if (f) f.hidden = false; }, 0); return; } const f = $('rb-res'); f.hidden = !f.hidden; return; }
      if (k === 'res-go') { const f = $('rb-res'); const v = f.querySelector('input:checked').value; const why = [...f.querySelectorAll('.rbi-presets .on')].map(b => b.textContent).concat(f.querySelector('textarea').value.trim()).filter(Boolean).join('; '); if (v === 'a') { addDecision('resolve', 'Siobhán Ryan', 'kept Kantar’s 23.4% for delivery growth', ['contest', 'f_007'], { because: [[why || 'Agrees with the Review agent.', ['f_007']]] }); showToast('Kept Kantar. On the record.'); } else { addDecision('resolve', 'Siobhán Ryan', 'asked to switch delivery growth to the client’s 31%', ['contest', 'f_008'], { because: [[why || 'Client figure preferred.', ['f_008']]] }); showToast('Switch queued: Refresh the report to rewrite Finding 2 and sentence 3.'); } f.hidden = true; reRender(); return; }
      if (k === 'gap') { const g = GAPS[+arg]; showToast(`Research agent queued: ${g.lens} · ${g.mk}.`); el.textContent = 'Queued…'; el.disabled = true; return; }
      if (k === 'lock-go') { lockGo = true; $('r-lock').click(); addDecision('approve', 'Siobhán Ryan', 'accepted and locked the report', ['answer', 'F1', 'F2', 'F3']); rsSelect(null); renderOutline(); return; }
    }

    // Lock asks first: list what blocks it
    let lockGo = false;
    $('r-lock').addEventListener('click', e => {
      if (lockGo) { lockGo = false; return; }
      if ($('research-sheet').classList.contains('locked')) { setTimeout(updLock, 0); return; }
      e.stopImmediatePropagation(); e.stopPropagation();
      setTimeout(() => rsSelect('lock', 'report'), 0);
    }, true);
    // the top bar's Ask goes to the overview's ask box
    document.addEventListener('click', e => { if (e.target.closest('[data-tba="r-ask"]') && rsSel) rsSelect(null); }, true);
    // the old card toggle hides on a second click; keep the inspector instead
    $('r-approve-finding').addEventListener('click', () => setTimeout(() => { addDecision('verdict', 'Siobhán Ryan', 'kept Finding 3 as a working hypothesis', ['F3', 'f_011']); reRender(); }, 5));
    $('r-drop-finding').addEventListener('click', () => { cut3 = true; setTimeout(() => { if (!F[2].rejBy) addDecision('verdict', 'Siobhán Ryan', 'cut Finding 3 from the report', ['F3', 'f_011']); reRender(); }, 5); });
    const NB = $('r-needs-banner'); if (NB) { const t = NB.querySelector('.r-nb-t'); if (t) t.textContent = 'Finding 3 rests on 2 TikTok clips (f_011). Keep it as a working hypothesis?'; }

    // first paint
    renderFacts(); renderContest(); renderGaps(); renderCov(); renderExcluded(); renderRun(); renderLog(); renderOutline(); renderMix(); decorateCards(); rsStats(); updLock();
    window.rbSelect = rsSelect;
  })();
