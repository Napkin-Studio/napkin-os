let t='';
for(let i=0;i<36;i++){ await G.page.waitForTimeout(3000); t=await G.F().locator('body').innerText();
  if(/Something failed|No deck yet/.test(t)||/Review the deck|Export/.test(t.slice(0,300))&&!/Step \d of 7/.test(t)) break;}
return [(t.match(/Step \d of 7/)||[''])[0], (t.match(/Something failed[\s\S]{0,400}/)||[''])[0], t.slice(0,300)];
