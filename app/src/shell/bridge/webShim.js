// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// The web host's fetch shim (napkin-web): an app computes its API base from
// `clan://localhost`, a scheme no browser has. The composer rewrites the
// page's literal clan:// bases to the frame's own token URL and puts this
// first in <head>, with "__CLAN_ORIGIN__" replaced by that URL, so a base
// built later is rewritten too, and asset paths in window.__CLAN__ resolve.
//
// A token lives in the server's memory, so a deploy (or its 12 h TTL) leaves
// an open page holding a dead one. When a call on it is refused with
// `code: "sandbox_token"`, the shim asks the shell for this document's token
// URL now (`clan:token?`; the shell opens the document again and answers
// `clan:token {origin}`), sends the same call once more on it, and uses it
// for every later call. Once: a second refusal is the app's to see.
// (features/stale-token-and-menus.clan)
//
// napkin-host reads this file (crates/napkin-host/src/frame.rs, include_str!)
// and puts it in the frame page as it is, after these leading `//` lines. The
// frame golden (crates/napkin-host/tests/frame_golden.rs) holds its bytes.
(function(){
  var BASE="__CLAN_ORIGIN__";
  var now=BASE;
  var asking=null;
  var f=window.fetch;

  function rebase(u){
    u=u.replace(/^clan:\/\/localhost/,now).replace(/^http:\/\/clan\.localhost/,now);
    if(now!==BASE&&u.indexOf(BASE)===0) u=now+u.slice(BASE.length);
    return u;
  }

  // One question at a time, however many calls were refused together.
  function renew(){
    if(asking) return asking;
    asking=new Promise(function(done){
      var timer=setTimeout(function(){ finish(null); },10000);
      function on(e){
        var m=e.data;
        if(e.source!==window.parent||!m||m.type!=='clan:token') return;
        finish(typeof m.origin==='string'&&m.origin?m.origin:null);
      }
      function finish(origin){
        clearTimeout(timer);
        window.removeEventListener('message',on);
        asking=null;
        if(origin) now=origin;
        done(origin);
      }
      window.addEventListener('message',on);
      try{ window.parent.postMessage({type:'clan:token?',held:now},'*'); }catch(_){ finish(null); }
    });
    return asking;
  }

  function stale(r){
    if(r.status!==403) return Promise.resolve(false);
    return r.clone().json().then(function(j){ return !!j&&j.code==='sandbox_token'; },function(){ return false; });
  }

  window.fetch=function(input,init){
    if(typeof input!=='string') return f.call(this,input,init);
    var self=this, held=now, url=rebase(input);
    return f.call(self,url,init).then(function(r){
      if(url.indexOf(held)!==0) return r;
      return stale(r).then(function(dead){
        if(!dead) return r;
        // Another call may have the new one already; else ask for it.
        return (now!==held?Promise.resolve(now):renew()).then(function(origin){
          return origin&&origin!==held?f.call(self,rebase(input),init):r;
        });
      });
    });
  };
  var c=window.__CLAN__;
  if(c&&c.assets){for(var k in c.assets){if(c.assets[k].charAt(0)==='/')c.assets[k]=BASE+c.assets[k];}}
})();
