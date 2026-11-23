// G.upFile, G.upAt [x,y]
await page.keyboard.press("Escape");
await page.mouse.click(...G.upAt);
const fcP = page.waitForEvent("filechooser", { timeout: 5000 });
await page.getByRole("button", { name: /Add a picture/ }).click();
const fc = await fcP;
await fc.setFiles([OUT + "/uploads/" + G.upFile]);
await page.waitForTimeout(3500);
await S("upload-" + G.upFile.replace(/\.png$/, ''));
return (await page.locator("body").innerText()).slice(0, 900);
