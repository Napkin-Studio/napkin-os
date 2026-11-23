await page.keyboard.press("Escape");
await page.getByRole("button",{name:"Hide"}).first().click().catch(()=>{});
await page.mouse.click(1250,700);
const files = [["p04_ruby_front.png","front"],["p05_ruby_side.png","side"]];
const out = [];
for (const [f, v] of files) {
  await page.keyboard.press("Escape");
  const fcP = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("button", { name: /Add a picture/ }).click();
  const fc = await fcP;
  await fc.setFiles([OUT + "/uploads/" + f]);
  await page.waitForTimeout(3500);
  await page.getByText("Name…", { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator("input[placeholder=maya]").fill("ruby");
  await page.locator('input[placeholder^="front"]').fill(v);
  await page.waitForTimeout(400);
  const ch = page.getByRole("radio", { name: "character" });
  if (await ch.count()) await ch.click();
  await S("name-ruby-" + v);
  await page.getByRole("button", { name: /^Save|^Add to/ }).first().click();
  await page.waitForTimeout(2500);
}
await page.keyboard.press("Escape");
await S("ruby-named");
return (await page.locator("body").innerText()).slice(0,400);
