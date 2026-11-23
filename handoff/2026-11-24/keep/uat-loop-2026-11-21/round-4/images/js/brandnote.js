await page.keyboard.press("Escape");
await page.locator(".zp-value").click().catch(()=>{}); await page.waitForTimeout(700);
await S("canvas-before-brand");
await page.getByRole("button", { name: "Text (T)" }).click();
await page.mouse.click(G.noteAt[0], G.noteAt[1]);
await page.waitForTimeout(500);
await page.keyboard.type(G.noteText);
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Select (V)" }).click();
await S(G.tag + "-note");
const b = page.getByRole("button", { name: "Generate", exact: true });
if (await b.count()) { await b.first().click(); await page.waitForTimeout(1500); }
await S(G.tag + "-tray");
const t = await page.locator("body").innerText();
const i = t.indexOf("What the");
return t.slice(i, i + 1500);
