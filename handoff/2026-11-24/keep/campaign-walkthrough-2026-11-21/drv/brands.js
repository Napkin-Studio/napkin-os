G.addBrands = async (...names) => { for (const n of names) if (!G.BRANDS.includes(n)) G.BRANDS.push(n); await G.ctx.addInitScript(`window.__brands = ${JSON.stringify(G.BRANDS)};`); await G.redactNow(); return G.BRANDS.length; };
if (!G._nc1) { G._nc1 = G.newClip; G.newClip = async (name, url) => { const r = await G._nc1(name, null); await G.ctx.addInitScript(`window.__brands = ${JSON.stringify(G.BRANDS)};`); if (url) await G.page.goto(url, { waitUntil: 'domcontentloaded' }); return r; }; }
return await G.addBrands();
