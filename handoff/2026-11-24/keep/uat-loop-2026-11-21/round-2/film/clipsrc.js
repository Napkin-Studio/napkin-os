const p = G.page;
const out = [];
const clips = p.locator("[title^='Shot ']");
const n = await clips.count();
for (let k = 0; k < n; k++) {
  const c = clips.nth(k); const r = await c.boundingBox(); if (!r || r.y < 600) continue;
  await c.click(); await p.waitForTimeout(600);
  const t = await p.locator("body").innerText();
  out.push({ title: (await c.getAttribute("title")).slice(0, 30), src: (t.match(/Source:[^\n]*/)||[])[0], plays: (t.match(/Plays[^\n]*/)||[])[0] });
}
const t = await p.locator("body").innerText();
out.push({ asks: (t.match(/[^\n]*New take ready for[^\n]*/g)||[]), len: (t.match(/16:9 · [^\n]*/)||[])[0], cut: (t.match(/The cut ·[^\n]*/)||[])[0] });
return out;
