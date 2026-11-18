"""The blind grading page: one self-contained HTML file, opened from a folder (no server, network or login).

It shows one slide picture at a time with only the questions that apply (Yes / No / Can't tell; keys Y, N, C, Enter for
next), saves answers in the browser, and downloads grades.json. It carries no critic answer, fixture name, phase or
seeded mark: only tokens (S001...), blind deck labels (D01...) and slide numbers. A test searches the page for those.
"""
from __future__ import annotations

import json
from pathlib import Path

WARM_NOTES = {
    "pass": "A clean slide: one clear first thing, room around everything, looks made by a designer. Yes to every question.",
    "overfilled": "Too much on it, crowded. This is a No to 'room around its words' and probably a No to 'passes as made by a designer'.",
    "aside": "All the content bunched in the top-left corner with the rest bare. This is a No to 'free of a large empty area'.",
    "equal_blocks": "Three blocks of the same weight compete. This is a No to 'one clear first thing to look at'.",
}

TEMPLATE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slide grading, session __SESSION__</title>
<style>
:root{--bg:#f6f5f1;--fg:#1c1b19;--mut:#6b6860;--card:#fff;--line:#d9d6cc;--acc:#1f5f4a;--yes:#1f7a4d;--no:#b3392f;--cant:#8a7a2a}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--mut:#9a978d;--card:#211f1c;--line:#3a3833;--acc:#6bc3a2;--yes:#58c08a;--no:#ef7b6f;--cant:#d6c46a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,sans-serif}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between}
main{max-width:1180px;margin:0 auto;padding:16px;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,1fr);gap:20px}
@media (max-width:860px){main{grid-template-columns:1fr}}
img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;background:#fff;display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;margin-bottom:12px}
.q{padding:10px 0;border-bottom:1px solid var(--line)}.q:last-child{border:0}.q.cur{outline:2px solid var(--acc);outline-offset:4px;border-radius:6px}
.q b{display:block}.q small{color:var(--mut);display:block;margin:2px 0 8px}
button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;min-height:40px}
button.on[data-a=yes]{background:var(--yes);color:#fff;border-color:var(--yes)}button.on[data-a=no]{background:var(--no);color:#fff;border-color:var(--no)}button.on[data-a=cant]{background:var(--cant);color:#fff;border-color:var(--cant)}
.bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc)}
textarea{width:100%;font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
.mut{color:var(--mut);font-size:14px}.nav{display:flex;gap:8px;flex-wrap:wrap}
</style></head><body>
<header><strong>Slide grading, session __SESSION__</strong><span class="mut" id="prog"></span><span class="nav"><input id="who" placeholder="Your name (optional)" aria-label="Your name"><button id="dl">Download answers</button></span></header>
<main><div><img id="pic" alt="The slide to grade"></div><div>
<div class="card" id="intro"></div><div class="card" id="qs"></div>
<div class="card"><label class="mut" for="cm">Comment on this slide (optional)</label><textarea id="cm" rows="2"></textarea></div>
<div class="nav"><button id="prev">Back</button><button id="next">Next (Enter)</button></div>
<p class="mut">Keys: Y yes, N no, C can't tell, Enter next slide, Backspace back. Your answers are kept in this browser; Download answers when you finish.</p>
<div class="bar"><i id="barfill"></i></div></div></main>
<script>
const SESSION=__SESSION_JSON__, ITEMS=__ITEMS__, SLIDES=__SLIDES__, WARM=__WARM__;
const KEY="slide-grading-"+SESSION;
let state={answers:{},comments:{},who:"",pos:-1}; // pos -1 is the warm-up
try{const s=localStorage.getItem(KEY); if(s) state=Object.assign(state,JSON.parse(s));}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
const $=id=>document.getElementById(id); let qi=0;
function el(t,c,x){const e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e;}
function render(){
  const warm=state.pos<0, qs=$("qs"); qs.textContent=""; const intro=$("intro"); intro.textContent="";
  $("who").value=state.who||"";
  if(warm){
    const k=Math.min(Math.max(window.__w||0,0),Math.max(WARM.length-1,0));
    if(WARM.length){const w=WARM[k]; $("pic").src=w.img; intro.append(el("b",null,"Warm-up "+(k+1)+" of "+WARM.length+" (not scored)"),el("p",null,w.note));}
    else intro.append(el("b",null,"Warm-up"),el("p",null,"Answer each question about the slide. Nothing here is scored."));
    $("prog").textContent="Warm-up"; $("barfill").style.width="0%"; $("cm").parentElement.style.display="none";
    qs.append(el("p","mut","Look at the example, then press Next."));
    return;
  }
  $("cm").parentElement.style.display="";
  const s=SLIDES[state.pos]; $("pic").src=s.img;
  intro.append(el("b",null,s.deck+" · slide "+s.n),el("p","mut","Judge only how the slide looks."));
  s.questions.forEach((q,i)=>{
    const it=ITEMS[q], d=el("div","q"+(i===qi?" cur":"")); d.append(el("b",null,it.question),el("small",null,it.looks_at||""));
    const a=(state.answers[s.token]||{})[q];
    [["yes","Yes (Y)"],["no","No (N)"],["cant","Can't tell (C)"]].forEach(([v,l])=>{const b=el("button",a===v?"on":"",l); b.dataset.a=v; b.onclick=()=>{answer(q,v)}; d.append(b," ");});
    qs.append(d);
  });
  $("cm").value=(state.comments||{})[s.token]||"";
  const done=Object.keys(state.answers).length; $("prog").textContent="Slide "+(state.pos+1)+" of "+SLIDES.length+" · "+done+" slides answered";
  $("barfill").style.width=(100*(state.pos+1)/SLIDES.length)+"%";
}
function answer(q,v){const s=SLIDES[state.pos]; (state.answers[s.token]=state.answers[s.token]||{})[q]=v; qi=Math.min(qi+1,s.questions.length-1); save(); render();}
function go(d){
  if(state.pos<0){ window.__w=(window.__w||0)+d; if(window.__w>=WARM.length){state.pos=0;window.__w=0;} else if(window.__w<0){window.__w=0;} }
  else {const n=state.pos+d; if(n<0){state.pos=-1;window.__w=Math.max(WARM.length-1,0);} else if(n<SLIDES.length) state.pos=n;}
  qi=0; save(); render(); window.scrollTo(0,0);
}
$("next").onclick=()=>go(1); $("prev").onclick=()=>go(-1);
$("cm").oninput=e=>{if(state.pos>=0){state.comments[SLIDES[state.pos].token]=e.target.value;save();}};
$("who").oninput=e=>{state.who=e.target.value;save();};
document.addEventListener("keydown",e=>{
  if(e.target.tagName==="TEXTAREA"||e.target.tagName==="INPUT") return;
  const k=e.key.toLowerCase();
  if(k==="enter"){go(1);e.preventDefault();} else if(k==="backspace"){go(-1);e.preventDefault();}
  else if(state.pos>=0&&["y","n","c"].includes(k)){const s=SLIDES[state.pos]; answer(s.questions[qi],{y:"yes",n:"no",c:"cant"}[k]);}
});
$("dl").onclick=()=>{const out={session:SESSION,grader:state.who||"",answers:state.answers,comments:state.comments,saved_at:new Date().toISOString()};
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:"application/json"})); a.download="grades.json"; a.click();};
if(!WARM.length&&state.pos<0) state.pos=0;
render();
</script></body></html>
"""


def write(path: Path, session: str, slides: list, data: dict, items: dict, warm: list) -> None:
    """Write the page. ``items`` is the rubric items; the page shows only each question's words and what it looks at."""
    shown = {q: {"question": it["question"], "looks_at": (data["questions"].get(q) or {}).get("looks_at", "")} for q, it in items.items()}
    wl = [{"img": w["img"], "note": WARM_NOTES.get(w["kind"], "")} for w in warm]
    html = (TEMPLATE.replace("__SESSION_JSON__", json.dumps(session)).replace("__SESSION__", session)
            .replace("__ITEMS__", json.dumps(shown)).replace("__SLIDES__", json.dumps(slides)).replace("__WARM__", json.dumps(wl)))
    Path(path).write_text(html)
