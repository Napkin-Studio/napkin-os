G.jobsPosted = () => fs.readFileSync(OUT + "/requests.jsonl", "utf8").split("\n").filter(l => l.includes("/api/jobs\""));
G.run = async (name, clickFn, opts = {}) => {
  const before = G.jobsPosted().length;
  const t0 = Date.now();
  await clickFn();
  let posted = null;
  for (let i = 0; i < 40 && !posted; i++) { await page.waitForTimeout(500); const ls = G.jobsPosted(); if (ls.length > before) posted = ls.slice(before).map(l => { const o = JSON.parse(l); const b = JSON.parse(o.body); return { t: o.t, jobId: b.jobId, op: b.op, modelChoice: b.input && b.input.modelChoice, audio: b.input && b.input.audio }; }); }
  const tPost = Date.now();
  await page.waitForTimeout(1500);
  await S(name + "-posted");
  G.pending = { name, t0, posted, tPost };
  return { posted, postMs: tPost - t0, dialog: G.lastDialog || null, body: (await page.locator("body").innerText()).slice(0, 300) };
};
G.waitLand = async (maxS = 540) => {
  const { name, t0 } = G.pending;
  let landed = null;
  for (let i = 0; i < maxS; i++) {
    await page.waitForTimeout(1000);
    const t = await page.locator("body").innerText();
    if (/Nothing making/.test(t) && i > 3) { landed = Date.now(); break; }
  }
  await page.waitForTimeout(1500);
  await S(name + "-landed");
  return { landMs: landed && landed - t0, t: (await page.locator("body").innerText()).slice(0, 1500) };
};
return 1;
