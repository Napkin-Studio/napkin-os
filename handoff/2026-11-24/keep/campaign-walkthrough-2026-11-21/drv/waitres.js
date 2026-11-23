const t0=Date.now(); let last=""; let k=0;
for (let i=0;i<300;i++) { await G.page.waitForTimeout(4000); const t = await G.fbody(0,5000); last=t; if (i%10==0) await G.S("res-wait"); 
  if (/I need you|Send answers|Skip this one/.test(t)) { G.mark("research-question"); break; }
  if (!/\nStop\n/.test(t)) { k++; if (k>2) break; } else k=0; }
G.mark("research-wait-end"); await G.S("res-wait-end"); return [(Date.now()-t0)/1000, last.slice(0,3000), await G.fbtns()];
