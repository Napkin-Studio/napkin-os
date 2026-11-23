await page.mouse.click(1300, 330);
const pts = [[483,143],[636,143],[789,143],[942,143],[483,295],[636,248],[789,248],[942,248],[715,427],[869,427],[1022,427],[674,525],[845,515],[1006,560]];
await page.mouse.click(...pts[0]);
await page.keyboard.down("Shift");
for (const p of pts.slice(1)) { await page.mouse.click(...p); await page.waitForTimeout(150); }
await page.keyboard.up("Shift");
await page.waitForTimeout(600);
await S("selected-14");
const bar = (await page.locator("body").innerText()).match(/Generate[\s\S]{0,200}/)?.[0];
await page.getByRole("button", { name: "Generate", exact: true }).first().click();
await page.waitForTimeout(1500);
await S("tray-14");
const t = await page.locator("body").innerText();
return { bar, tray: t.slice(t.indexOf("What the Director"), t.indexOf("What the Director") + 2500) };
