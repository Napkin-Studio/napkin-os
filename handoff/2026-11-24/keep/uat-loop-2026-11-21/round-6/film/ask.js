const p = page;
const t0 = Date.now();
const ta = p.getByPlaceholder("Tell the Script agent what to write or change…");
await ta.fill(G.ask);
await ta.press("Enter");
let t1 = null;
for (let i = 0; i < 180; i++) { await p.waitForTimeout(500); if (await p.getByRole("button", { name: /^Discard/ }).count()) { t1 = Date.now(); break; } }
await p.waitForTimeout(800);
const kb = p.getByRole("button", { name: /^Keep/ }).first();
if (await kb.count()) await kb.scrollIntoViewIfNeeded();
await S(G.shot);
const cards = await p.evaluate(() => { const out=[]; document.querySelectorAll("button").forEach(b=>{ if(/^Keep/.test(b.innerText)){ let c=b; for(let i=0;i<6;i++) c=c.parentElement; out.push(c.innerText.slice(0,2500)); } }); return out; });
return { ms: t1 && t1 - t0, cards, top: (await p.locator("body").innerText()).match(/target[\s\S]{0,200}?Make film/)?.[0] };
