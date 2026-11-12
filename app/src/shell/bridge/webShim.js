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
// napkin-host reads this file (crates/napkin-host/src/frame.rs, include_str!)
// and puts it in the frame page as it is, after these leading `//` lines. The
// frame golden (crates/napkin-host/tests/frame_golden.rs) holds its bytes.
(function(){
  var BASE="__CLAN_ORIGIN__";
  var f=window.fetch;

  window.fetch=function(input,init){
    if(typeof input==='string'){
      input=input.replace(/^clan:\/\/localhost/,BASE).replace(/^http:\/\/clan\.localhost/,BASE);
    }
    return f.call(this,input,init);
  };
  var c=window.__CLAN__;
  if(c&&c.assets){for(var k in c.assets){if(c.assets[k].charAt(0)==='/')c.assets[k]=BASE+c.assets[k];}}
})();