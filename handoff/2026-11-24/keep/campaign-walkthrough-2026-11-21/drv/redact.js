G.BRANDS = ["Russell Hobbs","Russell-Hobbs","Mumsnet","Dualit","Smeg","SMEG","McD","McDonald's","Flahavans","Flahavan's","Breville","Morphy Richards","Bosch","Kenwood","Tefal","De'Longhi","DeLonghi","Philips","Argos","Amazon","John Lewis","Currys","IKEA","Ikea","Which?","Buckingham","Swan","Salter","Cuisinart","KitchenAid","Hamilton Beach","Spotify","Reddit","TikTok","Instagram","YouGov","Mintel","SpareRoom","Spareroom","Zoopla","Rightmove","Tesco","Sainsbury's","Asda","Lakeland","Dunelm","Bodum","Fellow","Stagg","Ninja","Sage","Dyson","Nespresso","Yorkshire Tea","PG Tips","Tetley","Twinings","Typhoo","Lidl","Aldi","Facebook","YouTube","Google","Apple","Samsung","Netflix","Deliveroo","Uber"];
G.REDACT = `(() => {
  const L = window.__brands = window.__brands || ${JSON.stringify(G.BRANDS)};
  let rx = null;
  const mkRx = () => { const esc = s => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); rx = new RegExp('(?<![A-Za-z])(' + window.__brands.map(esc).join('|') + ')(?![A-Za-z])', 'g'); };
  window.__setBrands = (a) => { window.__brands = a; mkRx(); scrub(document.body); };
  const skip = el => el && el.closest && el.closest('script,style,textarea,[contenteditable=""],[contenteditable=true],input');
  const scrub = (root) => { if (!root) return; if (!rx) mkRx(); const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; const hits = []; while ((n = w.nextNode())) { if (rx.test(n.nodeValue)) hits.push(n); rx.lastIndex = 0; } for (const t of hits) { if (skip(t.parentElement)) continue; t.nodeValue = t.nodeValue.replace(rx, m => '\\u2588'.repeat(Math.max(3, Math.min(m.length, 10)))); } };
  const go = () => { if (!document.body) return setTimeout(go, 30); scrub(document.body); new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') scrub(m.target.parentNode || document.body); else m.addedNodes.forEach(a => scrub(a.nodeType === 3 ? a.parentNode : a)); } }).observe(document.body, { subtree: true, childList: true, characterData: true }); };
  go();
})();`;
if (!G._nc0) G._nc0 = G.newClip;
G.newClip = async (name, url) => {
  await G.endClip();
  const fsm = fs; const dir = `${OUT}/raw/${name}`; fsm.mkdirSync(dir, { recursive: true });
  G.ctx = await G.browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, recordVideo: { dir, size: { width: 1440, height: 900 } }, storageState: G.state });
  await G.ctx.addInitScript(G.REDACT);
  await G.ctx.addInitScript(G.CURSOR_SRC);
  G.ctx.on('page', G.wire);
  G.page = await G.ctx.newPage();
  G.clip = name; G.clipT0 = Date.now();
  G.mark('clip-start');
  if (url) await G.page.goto(url, { waitUntil: 'domcontentloaded' });
  return name;
};
G.redactNow = async () => { for (const f of G.page.frames()) { try { await f.evaluate(a => window.__setBrands && window.__setBrands(a), G.BRANDS); } catch {} } };
return 1;
