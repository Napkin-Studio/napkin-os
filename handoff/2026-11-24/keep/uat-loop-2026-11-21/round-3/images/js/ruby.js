await page.getByText("← Canvas").first().click().catch(()=>{});
await page.waitForTimeout(1500);
await page.mouse.click(1300, 150);
const files = [["p04_ruby_front.png","front"],["p05_ruby_side.png","side"],["p06_ruby_back.png","back-three-quarter"]];
const out = [];
for (const [f, v] of files) {
  await page.keyboard.press("Escape");
  const fcP = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("button", { name: /Add a picture/ }).click();
  const fc = await fcP;
  await fc.setFiles([OUT + "/uploads/" + f]);
  await page.waitForTimeout(3000);
  await page.getByText("Name…", { exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator("input[placeholder=maya]").fill("ruby");
  await page.locator('input[placeholder^="front"]').fill(v);
  await page.waitForTimeout(400);
  const ch = page.getByRole("radio", { name: "character" });
  if (await ch.count()) await ch.click();
  await S("name-ruby-" + v);
  out.push((await page.locator(".pt-panel, [class*=pop]").filter({ hasText: "Name this image" }).last().innerText()).slice(0, 600));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(2500);
  out.push((await page.locator("body").innerText()).slice(0, 300));
}
await S("ruby-named");
return out;
