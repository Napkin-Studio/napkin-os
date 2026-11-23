G.clickAt = async (loc) => { const b = await loc.boundingBox(); if (!b) throw new Error("no box"); await page.mouse.click(b.x + b.width/2, b.y + b.height/2); };
G.btns = async () => (await page.evaluate(() => [...document.querySelectorAll("button,[role=button],a,[role=menuitem]")].filter(b => b.offsetParent).map(b => (b.innerText || b.getAttribute("aria-label") || b.title || "").replace(/\n/g, " ").slice(0, 60)).filter(Boolean)));
G.body = async (a=0,b=3000) => (await page.locator("body").innerText()).slice(a,b);
return 1;
