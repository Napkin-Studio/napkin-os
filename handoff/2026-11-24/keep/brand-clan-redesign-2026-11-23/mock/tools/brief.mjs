import { browser, openPage, read, OUT, SIZES, BC_CSS, CLANS } from './lib.mjs'
const html = read('brief-maker/index.html')
const init = `window.__CLAN__={data:{reference_assets:[
 {type:'doc',name:'doc-1-0.pdf',path:'human/assets/doc-1-0.pdf',label:'Tidewell-brand-book-2026.pdf',sha256:'a'.repeat(64),media_type:'application/pdf'},
 {type:'doc',name:'doc-1-1.docx',path:'human/assets/doc-1-1.docx',label:'Zero-launch-call-notes.docx',sha256:'b'.repeat(64),media_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}],
 prompt:'Tidewell wants a summer campaign for Zero. Kick-off call notes and the brand book are attached.'},
 manifest:{document_id:'d1',client:{name:'Tidewell'}},assets:{}};
 window.clan={me:()=>Promise.resolve({name:'Shrey'}),patchData:()=>Promise.resolve({}),apiProxy:()=>Promise.resolve({ok:true,data:{}})}`
const CHIP = (n)=>`<button class="bc-chip" id="bcChip" type="button"><span class="bc-dot"></span>Tidewell · ${n} ▾</button>`
const b = await browser()
for (const [w,h] of [[1280,900],[1024,900]]) for (const st of ['a1','a2','c1','c2']) {
  const p = await openPage(b,w,h,html,init)
  await p.evaluate(({css,st,chips,clans})=>{
    const s=document.createElement('style');s.textContent=css;document.head.appendChild(s)
    const ta=document.getElementById('prompt'); ta.value=window.__CLAN__.data.prompt; ta.dispatchEvent(new Event('input',{bubbles:true}))
    window.dispatchEvent(new Event('clan:dataupdated'))
    const eb=document.querySelector('.eyebrow, [class*=eyebrow]')
    // brand chip beside the eyebrow
    const host=document.querySelector('.paperc')
    const wrap=document.createElement('div'); wrap.id='bcWrap'; wrap.style.cssText='position:relative;display:inline-block;margin:0 0 14px'
    wrap.innerHTML=chips; document.querySelector('#intake').insertBefore(wrap,document.getElementById('introH'))
    const ST=document.getElementById('intakeStatus')
    if(st==='a1'){
      const q=document.createElement('div'); q.className='bc-card'; q.style.cssText='margin:14px 0 0;border-color:#5b5bf7'
      q.innerHTML='<b>Tidewell-brand-book-2026.pdf looks like a brand bible.</b><div><small>Tidewell has Brand Clans already. What should we do with it?</small></div><div class="bc-row"><button class="bc-btn pri">Update “Original”</button><button class="bc-btn">Make a new Brand Clan</button><button class="bc-btn">Not a brand bible</button></div>'
      host.insertBefore(q,document.querySelector('.cfoot'))
    }
    if(st==='a2'){
      const q=document.createElement('div'); q.className='bc-card'; q.style.cssText='margin:14px 0 0'
      q.innerHTML='<span class="bc-spin"></span><b>Updating “Original” from the brand book</b> <small>in the background. Carry on; we will tell you when its changes are ready to review.</small>'
      host.insertBefore(q,document.querySelector('.cfoot'))
    }
    if(st==='c2'){
      const pop=document.createElement('div'); pop.className='bc-card bc-pop'; pop.style.cssText='left:0;top:34px'
      pop.innerHTML='<div style="padding:2px 6px 6px"><small>Brand Clan for this brief</small></div>'+clans.map((c,i)=>'<div class="it"><span class="ck">'+(i===1?'✓':'')+'</span><div><b>'+c.name+'</b>'+(c.def?' <small>· default</small>':'')+'<br><small>v'+c.v+' · '+c.note+'</small></div></div>').join('')+'<div style="border-top:1px solid #e6e1d8;margin-top:4px;padding:8px 6px 2px"><small>This brief keeps the version it has. A newer one shows an Update chip.</small></div>'
      wrap.appendChild(pop)
    }
  },{css:BC_CSS,st,chips:CHIP(st==='c1'||st==='c2'?'Zero':'Original'),clans:CLANS})
  await p.waitForTimeout(500)
  await p.screenshot({path:`${OUT}${st}-${w}.png`})
  await p.context().close()
}
await b.close()
