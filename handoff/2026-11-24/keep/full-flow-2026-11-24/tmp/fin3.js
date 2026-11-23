const tiles={reels:[539,293],r45:[582,293],kv96:[705,362],six:[797,372],dig6:[836,372],dig48:[577,442],ooh48:[577,372]};
const out={};
for (const [k,p] of Object.entries(tiles)){
  await G.page.mouse.click(1000,650); await G.page.waitForTimeout(400);
  await G.go(p,{after:900});
  let done=await G.page.getByRole('button',{name:'Final ✓'}).count();
  if(!done){
    const fb=G.page.getByRole('button',{name:'Final',exact:true});
    if(await fb.count()){
      await fb.first().click(); await G.page.waitForTimeout(700);
      await G.page.getByRole('button',{name:'Mark Final',exact:true}).first().click(); await G.page.waitForTimeout(1500);
    }
    done=await G.page.getByRole('button',{name:'Final ✓'}).count();
  }
  out[k]=done;
}
await G.page.mouse.click(1000,650);
await G.S('finals-check');
return out;
