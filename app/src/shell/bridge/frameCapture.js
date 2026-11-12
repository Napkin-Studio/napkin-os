// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// The dogfood build's listener inside an app frame, once the person has
// agreed (src/dogfood/recorder.ts). It only listens (capture phase, passive)
// and tells the shell what was clicked or submitted. `nameOf` is the shell's
// own rule (recorder.ts nameOf), so the shell and the frames name things
// alike; app/tests/dogfood.test.tsx holds the two to the same answers.
// Wrapped in <script data-dogfood-capture> by the composer.
//
// napkin-host reads this file (crates/napkin-host/src/frame.rs, include_str!)
// and puts it in the frame page as it is, after these leading `//` lines. The
// frame golden (crates/napkin-host/tests/frame_golden.rs) holds its bytes.
(function(){
var nameOf=function nameOf(el) {
  const CONTROLS = '[data-dogfood],button,a,[role="button"],[role="menuitem"],[role="tab"],input,select,textarea,summary,label';
  const WHEN = /\b(?:today|yesterday|tomorrow)\b(?:,?\s*(?:at\s*)?\d{1,2}:\d{2})?|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b|\b\d+\s+(?:minute|hour|day|week|month)s?\s+ago\b|\bjust now\b/gi;
  function parts(node, out) {
    let run = "";
    for (let i = 0; i < node.childNodes.length; i++) {
      const c = node.childNodes[i];
      if (c.nodeType === 3) run += c.textContent || "";
      else if (c.nodeType === 1) {
        out.push(run);
        run = "";
        parts(c, out);
      }
    }
    out.push(run);
  }
  if (!el || !el.closest) return "page";
  const target = el.closest(CONTROLS);
  if (!target) return "background";
  let label = target.getAttribute("data-dogfood") || target.getAttribute("aria-label") || target.getAttribute("title") || "";
  if (!label) {
    const out = [];
    parts(target, out);
    label = out.map((p) => p.replace(WHEN, "").replace(/\s+/g, " ").replace(/^[\s,·–→↗-]+|[\s,·–→↗-]+$/g, "")).filter(Boolean).join(" \xB7 ");
  }
  return target.tagName.toLowerCase() + ": " + (label.slice(0, 80) || "(no label)");
};
function tell(kind,e){if(!e.isTrusted)return;try{parent.postMessage({type:'clan:interaction',kind:kind,name:nameOf(e.target)},'*')}catch(_){}}
document.addEventListener('click',function(e){tell('click',e)},{capture:true,passive:true});
document.addEventListener('submit',function(e){tell('submit',e)},{capture:true,passive:true});
})();