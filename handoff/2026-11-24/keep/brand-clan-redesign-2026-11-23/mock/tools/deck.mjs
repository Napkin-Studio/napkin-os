import { browser, openPage, read, OUT, BC_CSS, CLANS } from './lib.mjs'
import fs from 'node:fs'
const html = read('deck-maker/index.html')
const d = JSON.parse(fs.readFileSync('deck-done.json','utf8'))
d.inputs.prompt = { client:'Tidewell', project:'Summer Zero pitch', agency:'', text:'Client: Tidewell (sparkling water). Pitch a summer campaign for Tidewell Zero, 30s film and social, for adults 25 to 40.' }
const init = `window.__CLAN__={data:${JSON.stringify(d)},manifest:{document_id:'d1'},assets:{}};window.clan={me:()=>Promise.resolve({name:'Shrey'}),patchData:()=>Promise.resolve({}),apiProxy:()=>Promise.resolve({ok:true,data:{}})}`
const b = await browser()
const sw=(c)=>c.map(x=>`<i class="bc-sw" style="background:${x}"></i>`).join('')
const SW={Original:['#0b5d8a','#e9f3f8','#102a3a'],Zero:['#9aa7b1','#7fd6bd','#1c2630'],'Summer 26':['#ff7a62','#8fd0f0','#2a2340']}
for (const [w,h] of [[1280,900],[1024,900]]) for (const st of ['e1','e2']) {
  const p = await openPage(b,w,h,html,init)
  await p.getByText('Start',{exact:true}).first().click(); await p.waitForTimeout(500)
  await p.evaluate(({css,st,clans,SW})=>{
    const s=document.createElement('style');s.textContent=css;document.head.appendChild(s)
    const stack=document.querySelector('.stack'); const first=stack.firstElementChild
    const sec=document.createElement('section'); sec.className='card sec'; sec.style.position='relative'
    const sw=(c)=>c.map(x=>'<i class="bc-sw" style="background:'+x+'"></i>').join('')
    sec.innerHTML='<div class="sec-h"><span class="mono eyebrow">Look</span><b>How it looks</b><div class="spacer"></div></div>'
     +'<div class="doc"><span class="ico">.clan</span><div style="flex:1"><div style="font-size:14px;font-weight:600">Tidewell · Zero</div><div class="mono eyebrow" style="text-transform:none;letter-spacing:0">Brand Clan · built with v1 · '+sw(SW.Zero)+'</div></div>'
     +'<button class="btn sm" id="bcUpd" type="button">Update look ▾</button></div>'
     +'<div class="upnote" role="status" style="margin-top:10px"><b>Zero has a newer version, v2.</b> This deck keeps its look until you press Update look. The words stay the same.</div>'
     +'<p class="note" style="margin-top:8px">Tidewell’s look wins over your agency’s. A look never changes what a slide says.</p>'
    stack.insertBefore(sec,first)
    if(st==='e2'){
      const pop=document.createElement('div'); pop.className='bc-card bc-pop'; pop.style.cssText='right:14px;top:130px;min-width:290px'
      pop.innerHTML='<div style="padding:2px 6px 6px"><small>Re-theme this deck with</small></div>'+clans.map((c,i)=>'<div class="it"><span class="ck">'+(i===1?'●':'')+'</span><div><b>'+c.name+'</b>'+(c.def?' <small>· default</small>':'')+' <small>v'+c.v+'</small><br>'+sw(SW[c.name])+'</div></div>').join('')+'<div class="bc-row" style="padding:0 6px 4px"><button class="bc-btn pri">Update look</button><button class="bc-btn">Cancel</button></div><div style="border-top:1px solid #e6e1d8;margin-top:6px;padding:8px 6px 2px"><small>Same words, new colours, type and logo.</small></div>'
      sec.appendChild(pop)
    }
    window.scrollTo(0,0)
  },{css:BC_CSS,st,clans:CLANS,SW})
  await p.waitForTimeout(500)
  await p.screenshot({path:`${OUT}${st}-${w}.png`})
  await p.context().close()
}
await b.close()
