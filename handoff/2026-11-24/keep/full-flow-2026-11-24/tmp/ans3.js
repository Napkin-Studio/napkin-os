const A=["25-40 is agreed for the lead audience; the data person's survey backs it. 18-45 and 25-55 are dropped.",
"Yes, the Rainforest Alliance certification is current.",
"Yes, a small pre-launch tracker wave is funded inside the 250k."];
const out=[];
for (let i=0;i<A.length;i++){
  await G.page.waitForTimeout(2500);
  const inp=G.F().locator('input[placeholder="Type your answer"]');
  for (let k=0;k<3 && !(await inp.count()); k++){
    const b=G.F().getByRole('button',{name:'Answer…'});
    if(!(await b.count())) break;
    await G.go(b.first(),{after:900});
  }
  if(!(await inp.count())) {out.push('noinput '+i); await G.S('noinput'); break;}
  await inp.first().fill(A[i]);
  await G.page.keyboard.press('Enter');
  out.push(i);
}
await G.page.waitForTimeout(2500); await G.S('answered2');
return [out, (await G.F().locator('body').innerText()).split('BOOTH')[1].slice(0,500)];
