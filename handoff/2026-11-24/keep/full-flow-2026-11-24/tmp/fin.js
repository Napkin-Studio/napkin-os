const pts = [[505,325],[683,310],[813,325],[505,423]];
const out=[];
for (const p of pts){
  await G.go(p,{after:1000});
  const fb = G.page.getByRole('button',{name:'Final',exact:true}).first();
  if (!(await fb.count())) { out.push(['nofinal',p]); continue; }
  await G.go(fb,{after:800});
  await G.go(G.page.getByRole('button',{name:'Mark Final'}).first(),{after:1500});
  out.push(['ok',p]);
}
await G.S('ooh-finals');
return out;
