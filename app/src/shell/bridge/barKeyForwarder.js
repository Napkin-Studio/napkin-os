// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// Cmd or Ctrl K inside the app is the shell's bar (features/one-bar-search.clan), in a text field too: the key is
// forwarded and takes no other, and the shell opens the bar and moves focus there. napkin-host puts this at the top
// of the frame page (crates/napkin-host/src/frame.rs, include_str!), before anything of the app's, for every render
// model and every host: a key pressed while the page is still loading (the edit bridge sits at the foot of the
// body, after the app's own scripts) reaches the shell all the same. The frame golden holds its bytes.

(function() {
  if (window.__clan_bar_key || window.parent === window) return;
  window.__clan_bar_key = true;
  window.addEventListener('keydown', function(e) {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (String(e.key).toLowerCase() !== 'k') return;
    e.preventDefault();
    window.parent.postMessage({ type: 'clan:bar-key' }, '*');
  });
})();
