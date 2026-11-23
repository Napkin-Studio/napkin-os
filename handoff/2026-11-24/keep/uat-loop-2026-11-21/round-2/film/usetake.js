const p = G.page;
const log = [];
for (const box of G.order) {
  const cards = p.locator("article, section, div").filter({ hasText: new RegExp("^[\\s\\S]{0,200}New take ready for Box " + box + "\\.") });
  const btns = p.locator("button:visible", { hasText: /^Use this take$/ });
  const n = await btns.count();
  let clicked = false;
  for (let k = 0; k < n; k++) {
    const ctx = await btns.nth(k).evaluate(e => { let c = e; for (let i = 0; i < 5; i++) c = c.parentElement; return c.innerText; });
    if (ctx.includes("New take ready for Box " + box + ".")) { await btns.nth(k).click(); clicked = true; break; }
  }
  await p.waitForTimeout(1200);
  const dlg = p.locator("[role=dialog]:visible");
  let dtext = "";
  if (await dlg.count()) { dtext = (await dlg.first().innerText()).slice(0, 500); const u = dlg.locator("button", { hasText: /^Use this take$/ }); if (await u.count()) { await u.first().click(); await p.waitForTimeout(1200); } }
  log.push({ box, clicked, dtext });
}
return log;
