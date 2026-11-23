// G.box: index of Make button among visible "Make" buttons in boxes OR a locator fn
const p = G.page;
const before = fs.readFileSync(OUT + "/requests.jsonl", "utf8").split("\n").filter(l => l.includes("/api/jobs\"")).length;
const t0 = Date.now();
await G.clickMake(p);
let posted = null;
for (let i = 0; i < 60 && !posted; i++) { await p.waitForTimeout(500); const ls = fs.readFileSync(OUT + "/requests.jsonl", "utf8").split("\n").filter(l => l.includes("/api/jobs\"")); if (ls.length > before) posted = ls.slice(before).map(l => { const o = JSON.parse(l); const b = JSON.parse(o.body); return { t: o.t, jobId: b.jobId, op: b.op }; }); }
const tPost = Date.now();
await S(G.name + "-posted", { page: p });
let landed = null;
for (let i = 0; i < (G.maxS || 600) && posted; i++) {
  await p.waitForTimeout(1000);
  const t = await p.locator("body").innerText();
  if (G.doneRe && G.doneRe.test(t)) { landed = Date.now(); break; }
  if (/Nothing making/.test(t) && i > 5) { landed = Date.now(); break; }
}
await p.waitForTimeout(1500);
await S(G.name + "-landed", { page: p });
return { posted, postMs: tPost - t0, landMs: landed && landed - t0, dialog: G.lastDialog || null };
