const out = [];
const clips = page.locator("[title^='Shot ']");
const n = await clips.count();
for (let k = 0; k < n; k++) {
  const c = clips.nth(k); const r = await c.boundingBox(); if (!r || r.y < 600) continue;
  await c.click(); await page.waitForTimeout(600);
  const t = await page.locator("body").innerText();
  out.push({ title: (await c.getAttribute("title")).slice(0, 40), src: (t.match(/Source:[^\n]*/)||[])[0], plays: (t.match(/Plays[^\n]*/)||[])[0] });
}
const t = await page.locator("body").innerText();
out.push({ cards: (t.match(/[^\n]*New take ready for[^\n]*/g)||[]), len: (t.match(/\d+(\.\d+)? s · [^\n]*short|\d+(\.\d+)? s · [^\n]*over/)||[])[0], cut: (t.match(/The cut ·[^\n]*/)||[])[0] });
return out;
