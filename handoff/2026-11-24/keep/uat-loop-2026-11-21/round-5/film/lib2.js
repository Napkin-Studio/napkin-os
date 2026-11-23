G.clickAt = async (loc) => { const b = await loc.boundingBox(); if (!b) throw new Error("no box"); await page.mouse.click(b.x + b.width/2, b.y + b.height/2); };
G.btns = async () => (await page.getByRole("button").allInnerTexts()).filter(b=>b.trim()).map(s=>s.replace(/\n/g," ").slice(0,60));
G.body = async (a=0,b=3000) => (await page.locator("body").innerText()).slice(a,b);
return 1;
