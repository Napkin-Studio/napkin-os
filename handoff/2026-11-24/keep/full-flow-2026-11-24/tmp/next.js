const t0=await G.F().locator('body').innerText();
const g=(t0.match(/GATE (\d) OF 3/)||[])[1];
if(g==='1'||g==='3'){ await G.S('d3-gate'+g); await G.go(G.F().getByRole('button',{name:/^Approve and continue/}).first(),{after:3000}); }
else if(g==='2'){ await G.S('d3-gate2'); const t=G.F().getByRole('button',{name:/Lift You/}); if(await t.count()) await G.go(t.first(),{after:800}); await G.go(G.F().getByRole('button',{name:/Pick this territory/}).first(),{after:3000}); }
let t='';
for(let i=0;i<30;i++){ await G.page.waitForTimeout(3000); t=await G.F().locator('body').innerText();
  const g2=(t.match(/GATE (\d) OF 3/)||[])[1];
  if((g2&&g2!==g)||/Something failed/.test(t)||/Review the deck now|deck is ready/i.test(t)) break;}
return [g,(t.match(/GATE \d OF 3[\s\S]{0,60}/)||[''])[0], (t.match(/Step \d of 7/)||[''])[0], (t.match(/Something failed[\s\S]{0,300}/)||[''])[0]];
