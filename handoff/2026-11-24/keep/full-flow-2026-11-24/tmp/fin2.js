const out=[];
async function mark(p,label){
  await G.go(p,{after:1000});
  const fb=G.page.getByRole('button',{name:'Final',exact:true});
  if(await fb.count()){ await G.go(fb.first(),{after:800}); await G.go(G.page.getByRole('button',{name:'Mark Final'}).first(),{after:1800}); }
  out.push([label, await G.page.getByRole('button',{name:'Final ✓'}).count()]);
}
await mark([705,340],'96-sheet');
await mark([797,350],'6-sheet');
await mark([577,418],'digital 48');
await G.S('ooh-finals2');
await G.go(G.rb(/Open Social/),{after:1500});
await G.S('social-open');
return out;
