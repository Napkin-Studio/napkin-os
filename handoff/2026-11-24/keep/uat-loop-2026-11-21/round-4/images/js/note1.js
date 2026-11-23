await page.keyboard.press("Escape"); await page.getByRole("button", { name: "Text (T)" }).click();
await page.mouse.click(200, 150);
await page.waitForTimeout(500);
await page.keyboard.type("A busy Paris street corner in the morning: a café terrace with newspapers on the tables, parked scooters, shop signs and a delivery van. Photo.");
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await S("note1");
const b = page.getByRole("button", { name: "Generate", exact: true });
const n = await b.count();
if (n) { await b.first().click(); await page.waitForTimeout(1200); }
await S("note1-tray");
const t = await page.locator("body").innerText();
return [n, t.slice(0, 2500)];
