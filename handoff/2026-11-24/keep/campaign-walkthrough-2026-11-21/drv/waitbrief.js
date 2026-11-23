const t0=Date.now(); let last=""; let k=0;
for (let i=0;i<220;i++) { await G.page.waitForTimeout(4000); const t = await G.fbody(0,5000); last=t; if (i%8==0) await G.S("brief-wait"); 
  if (/Send answers|Skip, just draft/.test(t)) { G.mark("brief-question"); break; }
  if (!/\nStop\n|is reading|is writing|is planning|is checking|researching/.test(t)) { k++; if (k>2) break; } else k=0; }
G.mark("brief-wait-end"); await G.S("brief-wait-end"); return [(Date.now()-t0)/1000, last.slice(0,3500), await G.fbtns()];
