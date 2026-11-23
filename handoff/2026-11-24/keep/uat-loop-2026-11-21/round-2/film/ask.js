const p = G.page;
const t0 = Date.now();
const ta = p.getByPlaceholder("Tell the Script agent what to write or change…");
await ta.fill(G.ask);
await ta.press("Enter");
let t1 = null;
for (let i = 0; i < 180; i++) { await p.waitForTimeout(500); if (await p.getByRole("button", { name: /^Keep/ }).count()) { t1 = Date.now(); break; } }
await p.waitForTimeout(800);
const kb = p.getByRole("button", { name: /^Keep/ }).first();
const box = await kb.boundingBox().catch(()=>null);
await S(G.shot, { page: p });
const card = await p.locator("text=Keep").first().locator("xpath=ancestor::*[contains(@class,'') ][4]").innerText().catch(()=>"");
return { ms: t1 && t1 - t0, keepVisibleInViewport: box && box.y > 0 && box.y < 900, keepY: box && box.y, body: (await p.locator("body").innerText()).slice(600, 4500) };
