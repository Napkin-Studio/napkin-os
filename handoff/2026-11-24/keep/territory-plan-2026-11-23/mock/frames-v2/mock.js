(function () {
  var D = window.__CLAN__.data, SH = ['c0a1f001', 'c0a1f002', 'c0a1f003', 'c0a1f004'], FIRST = 't_started';
  var base = JSON.parse(JSON.stringify(D.territories)), made = {}, held = {}, out = {}, busy = false;
  var hash = location.hash;
  if (hash === '#2' || hash === '#3') made[FIRST] = true;
  if (hash === '#3') held['pic_started_tv3'] = true;
  apply();
  var css = document.createElement('style');
  css.textContent = '.mk-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px;margin-top:10px}' +
    '.mk-head .psec-t{margin-top:0}.mk-make{min-height:30px;padding:0 12px;font-size:12px}' +
    '.pslot.mk-held .pface img{opacity:.42;filter:saturate(.55)}.pface .pchip.mk-need{cursor:pointer}';
  document.head.appendChild(css);

  function tvOf(t) { return t.pictures.filter(function (p) { return p.touchpoint === 'tv'; }); }
  function apply() {
    D.territories.forEach(function (t, i) {
      var b = base[i];
      tvOf(t).forEach(function (p, k) {
        var orig = tvOf(b)[k];
        Object.keys(p).forEach(function (key) { delete p[key]; });
        if (made[t.id] && !out[orig.id]) {
          var h = SH[k] + new Array(57).join('0');
          Object.assign(p, { id: orig.id, touchpoint: 'tv', kind: 'frame', image: 'sha256:' + h, sha256: h, rights: 'generated' });
        } else Object.assign(p, orig);
      });
    });
  }
  function force() { var m = made[FIRST]; made[FIRST] = false; refresh(); made[FIRST] = m; refresh(); }
  function refresh() { apply(); window.dispatchEvent(new Event('clan:dataupdated')); }
  function routeOf(pan) {
    var s = pan.querySelector('[data-pslot]'); if (!s) return null;
    var id = s.getAttribute('data-pslot'), r = null;
    D.territories.forEach(function (t) { if (t.pictures.some(function (p) { return p.id === id; })) r = t; });
    return r;
  }
  function decorate() {
    var pan = document.querySelector('.ppanel'); if (!pan) return;
    var t = routeOf(pan); if (!t) return;
    if (!pan.querySelector('.mk-head')) {
      var hd = pan.querySelector('.psec-t'), row = document.createElement('div'); row.className = 'mk-head';
      pan.insertBefore(row, hd); row.appendChild(hd);
      if (!made[t.id]) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn-rect mk-make'; b.textContent = 'Make pictures'; b.setAttribute('data-mk-make', t.id); row.appendChild(b);
      }
    }
    pan.querySelectorAll('[data-pslot]').forEach(function (s) {
      var id = s.getAttribute('data-pslot'); if (!held[id] || s.classList.contains('mk-held')) return;
      s.classList.add('mk-held');
      var chip = s.querySelector('.pface .pchip'); if (chip) chip.remove();
      var fb = s.querySelector('.pfbtn'); if (fb) fb.remove();
      var n = document.createElement('button'); n.type = 'button'; n.className = 'pchip sup mk-need'; n.textContent = 'Needs you'; n.setAttribute('data-mk-need', id);
      s.querySelector('.pface').appendChild(n);
    });
  }
  var mo = new MutationObserver(function () { if (busy) return; busy = true; mo.disconnect(); try { decorate(); } finally { mo.observe(document.body, { childList: true, subtree: true }); busy = false; } });
  mo.observe(document.body, { childList: true, subtree: true });

  function overlay(title, line, buttons) {
    close();
    var o = document.createElement('div'); o.className = 'overlay'; o.id = 'mkOverlay';
    o.innerHTML = '<div class="dialog sans" role="dialog" aria-modal="true" aria-label="' + title + '"><h3></h3><p class="meta" style="margin:0"></p><div class="row"><span class="spacer" style="flex:1"></span>' +
      buttons.map(function (b) { return '<button type="button" class="btn-rect' + (b.p ? ' primary' : '') + '" data-mk="' + b.k + '">' + b.t + '</button>'; }).join('') + '</div></div>';
    o.querySelector('h3').textContent = title; o.querySelector('p').textContent = line;
    document.body.appendChild(o);
  }
  function close() { var o = document.getElementById('mkOverlay'); if (o) o.remove(); }
  var cur = null;
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-mk-make],[data-mk-need],[data-mk]'); if (!t) return;
    if (t.hasAttribute('data-mk-make')) {
      cur = t.getAttribute('data-mk-make');
      var nm = D.territories.filter(function (x) { return x.id === cur; })[0].name;
      overlay('Make 4 pictures for ' + nm + '?', 'Illustrative, made by an outside picture tool.', [{ k: 'cancel', t: 'Cancel' }, { k: 'make', t: 'Make', p: 1 }]);
    } else if (t.hasAttribute('data-mk-need')) {
      cur = t.getAttribute('data-mk-need');
      overlay('Needs you', 'It has the word FERNCLIFF in it.', [{ k: 'leave', t: 'Leave it out' }, { k: 'approve', t: 'Approve', p: 1 }]);
    } else {
      var k = t.getAttribute('data-mk'); close();
      if (k === 'make') { var r0 = cur; made[r0] = true; history.replaceState(null, '', '#2'); refresh(); if (r0 === FIRST) setTimeout(function () { held['pic_started_tv3'] = true; history.replaceState(null, '', '#3'); force(); }, 2200); }
      if (k === 'approve') { delete held[cur]; history.replaceState(null, '', '#2'); force(); }
      if (k === 'leave') { delete held[cur]; out[cur] = true; force(); }
    }
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); }, true);
  window.addEventListener('hashchange', function () { location.reload(); });

  function go() {
    var app = document.getElementById('app'), el = null;
    app.querySelectorAll('*').forEach(function (n) { if (!el && !n.children.length && n.textContent.trim() === 'Flat Out Good') el = n; });
    if (!el) { setTimeout(go, 150); return; }
    el.click();
    setTimeout(function () { var p = document.querySelector('.ppanel'); if (p) window.scrollTo(0, p.getBoundingClientRect().top + window.pageYOffset - 425); }, 250);
  }
  setTimeout(go, 700);
})();
