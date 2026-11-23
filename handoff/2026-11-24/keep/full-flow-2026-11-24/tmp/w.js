G.fwait = async (re, maxS=600, invert=false) => { for (let i=0;i<maxS;i++){ const t = await G.F().locator('body').innerText().catch(()=>''); if (re.test(t) !== invert) return i; await G.page.waitForTimeout(1000);} return -1; };
return 'ok';
