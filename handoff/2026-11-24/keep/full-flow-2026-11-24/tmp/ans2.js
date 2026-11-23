const A=["Yes. We hold the aluminium recyclability certificate and the Rainforest Alliance certificate for the beans; copies to follow.",
"Target stays 8% of the convenience RTD coffee fridge in 12 months. Retailer sales data is available through our two wholesalers.",
"25-40 is agreed for the lead audience; the data person's survey backs it. 18-45 and 25-55 are dropped.",
"Yes, the Rainforest Alliance certification is current.",
"Yes, a small pre-launch tracker wave is funded inside the 250k."];
const out=[];
for (let i=0;i<A.length;i++){
  await G.page.waitForTimeout(1500);
  const b=G.F().getByRole('button',{name:'Answer…'});
  if(!(await b.count())) {out.push('none at '+i); break;}
  await G.go(b.first());
  await G.F().locator('input[placeholder="Type your answer"]').first().fill(A[i]);
  await G.page.keyboard.press('Enter');
  out.push(i);
}
await G.page.waitForTimeout(2000); await G.S('answered2');
return [out, (await G.F().locator('body').innerText()).split('BOOTH')[1].slice(0,500)];
