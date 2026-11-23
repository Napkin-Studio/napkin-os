const A = [
 "Launch in March is the date that matters. Christmas is a teaser and awareness build, not the goal.",
 "Working budget is 250k GBP excl. VAT, media included. Production must be lean.",
 "Target: 8% share of the UK convenience RTD coffee fridge within 12 months of launch, tracked by retailer sales data.",
 "No added sugar is not verified yet; do not claim it. Do not use the words barista quality in any copy.",
 "Lead audience is 25-40 urban commuters and gym-goers; students, school-run mums and night-shift nurses are secondary.",
 "Treat the cafes we supply as partners: never knock cafes. We win from energy drinks first; cafes are secondary.",
 "Use Flat out good as the line. Keep Really coffee as a secondary sign-off only."
];
const out=[];
for (let i=0;i<A.length;i++){
  const b = G.F().getByRole('button',{name:'Answer…'});
  const n = await b.count();
  if (!n) { out.push('no answer button at '+i); break; }
  await G.go(b.first());
  const inp = G.F().locator('input[placeholder="Type your answer"]');
  await inp.first().fill(A[i]);
  await G.page.keyboard.press('Enter');
  await G.page.waitForTimeout(1200);
  const left = await G.F().getByRole('button',{name:'Answer…'}).count();
  out.push([i,left]);
}
await G.S('answered');
return [out, (await G.fbody(5500,9500))];
