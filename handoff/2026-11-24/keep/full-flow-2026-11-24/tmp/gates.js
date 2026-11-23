let t='';
for(let i=0;i<36;i++){ t=await G.F().locator('body').innerText();
  if(/GATE \d OF 3/.test(t)||/Something failed|No deck yet/.test(t)) break;
  await G.page.waitForTimeout(3000);}
return [(t.match(/GATE \d OF 3[\s\S]{0,80}/)||[''])[0], (t.match(/Step \d of 7/)||[''])[0], (t.match(/Something failed[\s\S]{0,200}/)||[''])[0]];
