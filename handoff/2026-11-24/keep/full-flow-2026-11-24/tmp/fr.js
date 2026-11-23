const out=[];
for (const idx of [2,3,4]){
  await G.go(G.page.getByText('← Storyboard').first(),{after:2000});
  const b=G.page.getByText('Open in image editor');
  await G.go(b.nth(idx),{after:3000});
  await G.page.getByRole('button',{name:'Final',exact:true}).first().click(); await G.page.waitForTimeout(700);
  await G.page.getByRole('button',{name:'Mark Final',exact:true}).first().click(); await G.page.waitForTimeout(1500);
  out.push([idx, await G.page.getByRole('button',{name:'Final ✓'}).count(), (await G.page.locator('body').innerText()).match(/Frame \d/)?.[0]]);
}
await G.S('frames-final');
return out;
