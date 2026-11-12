// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// The device host's rpc shim (the WebAssembly build, frame loaded from
// srcdoc): there is no server, so every clan:// call is a postMessage to the
// shell, which answers it from the host in the page (AppRuntime clan:rpc).
// An <img src="clan://…/assets/x.png"> never reaches fetch, so asset URLs in
// the DOM are swapped for blobs as they appear.
//
// napkin-host reads this file (crates/napkin-host/src/frame.rs, include_str!)
// and puts it in the frame page as it is, after these leading `//` lines. The
// frame golden (crates/napkin-host/tests/frame_golden.rs) holds its bytes.
(function(){
  var f=window.fetch, seq=0, pending={};
  window.addEventListener('message',function(e){
    if(e.source!==window.parent) return;
    var m=e.data;
    if(m&&m.type==='clan:rpc-reply'&&pending[m.id]){pending[m.id](m);delete pending[m.id];}
  });
  function rpc(path,query,body){
    return new Promise(function(resolve){
      var id=++seq; pending[id]=resolve;
      window.parent.postMessage({type:'clan:rpc',id:id,path:path,query:query,body:body},'*');
    }).then(function(m){
      // 204 and 304 may not carry a body; nothing here returns them, but a
      // Response constructed with one would throw.
      var body=(m.status===204||m.status===304)?null:m.body;
      return new Response(body,{status:m.status,headers:m.headers||{}});
    });
  }
  // There is no server: every clan:// call is a function call in the parent.
  function split(u){
    var m=/^(?:clan:\/\/localhost|http:\/\/clan\.localhost)(\/[^?]*)(?:\?(.*))?$/.exec(u);
    return m?{path:m[1],query:m[2]||''}:null;
  }
  window.fetch=function(input,init){
    if(typeof input==='string'){
      var t=split(input);
      if(t) return rpc(t.path,t.query,(init&&init.body)||'');
    }
    return f.call(this,input,init);
  };

  // An <img src="clan://…/assets/x.png"> never reaches fetch, so asset URLs in
  // the DOM are swapped for blobs as they appear. Mood boards depend on it.
  var blobs={};
  function resolveAsset(el){
    var src=el.getAttribute('src')||'';
    var t=split(src);
    if(!t||t.path.indexOf('/assets/')!==0) return;
    if(blobs[src]){el.src=blobs[src];return;}
    rpc(t.path,t.query,'').then(function(r){return r.ok?r.blob():null;}).then(function(b){
      if(b){blobs[src]=URL.createObjectURL(b);el.src=blobs[src];}
    });
  }
  function sweep(root){
    if(root.querySelectorAll) root.querySelectorAll('img[src]').forEach(resolveAsset);
    if(root.tagName==='IMG') resolveAsset(root);
  }
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){ if(n.nodeType===1) sweep(n); });
      if(m.type==='attributes'&&m.target.tagName==='IMG') resolveAsset(m.target);
    });
  }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  document.addEventListener('DOMContentLoaded',function(){sweep(document);});
})();