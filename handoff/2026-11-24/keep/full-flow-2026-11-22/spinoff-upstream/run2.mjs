import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/home/batunii/Documents/Code/napkin-wt-prod-spinoff/app/package.json');
const { chromium } = require('@playwright/test');
const B='http://127.0.0.1:18090', K='/home/batunii/Documents/napkin-local-keep/full-flow-2026-11-22/spinoff-upstream';
const st=JSON.parse(fs.readFileSync(K+'/state.json'));
const br = await chromium.launch({headless:true});
const ctx = await br.newContext({viewport:{width:1440,height:900},storageState:K+'/auth.json'});
const page = await ctx.newPage();
page.on('pageerror',e=>console.log('pageerror',String(e).slice(0,200)));
await page.goto(B+st.sp.path);
await page.waitForTimeout(9000);
await page.screenshot({path:K+'/shots/01-production-brief-node.png'});
console.log(await page.title());
await page.waitForTimeout(8000); // autosave
const r = await ctx.request.get(`${B}/production/api/clan/${st.sp.project}`);
console.log('clan',r.status());
await br.close();
