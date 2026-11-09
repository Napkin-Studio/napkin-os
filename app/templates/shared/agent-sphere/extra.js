// extra.js: the mock's Knowledge, Copy and Review geometries for the agent spheres (napkin-app-v1.html,
// "EXTEND NAPKIN 3D AGENTS"), verbatim. Loaded after agent-view.js.
(function () {
  'use strict';
  if (globalThis.NapkinAgents) {
    const EXTRA_RAW = [
      { "n": 9, "name": "Copy", "arcs": [[0.0001, 0.0, 0.7941, -2.0945, 1.9375, 0.0941, 1.0], [-0.0001, -0.0, 0.3235, -1.5706, 1.0647, 0.0441, 0.4]], "circs": [[0.0, 0.0, 0.2353, 0.0588, 0, 1.0]], "role": "Crafts words" },
      { "n": 23, "name": "Review", "arcs": [[-0.0001, 0.0, 0.7941, 2.6877, 1.7108, 0.0941, 1.0], [-0.0, -0.0001, 0.4706, 0.5938, 2.8794, 0.0735, 1.0], [0.0002, -0.0018, 0.2647, -3.1139, 3.1907, 0.0735, 1.0]], "circs": [[0.3824, 0.2941, 0.0882, 0.0353, 0, 1.0]], "role": "Checks every claim" },
      { "n": 26, "name": "Knowledge", "arcs": [[0.0001, -0.0001, 0.7941, 0.1223, 1.2566, 0.0941, 1.0], [-0.0059, -0.0002, 0.4118, 1.5916, 3.1701, 0.0971, 1.0], [-0.0001, 0.0002, 0.5588, -2.9843, 0.8377, 0.0471, 0.4]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0]], "role": "Reads sources" }
    ];
    const { AG, ORDER, MATS, MAT_OF, TYPE_OF } = globalThis.NapkinAgents;
    const TYPES = {
      scan: { wob: [0, .006, 0, .004], breath: .004 },
      unfold: { wob: [.012, .014, .006, 0], breath: .022 },
      sweep: { wob: [0, .008, .012, .006], breath: .006 },
      hold: { wob: [.003, .002, 0, 0], breath: .004 },
      align: { wob: [.005, 0, .005, 0], breath: .008 },
      pulse: { wob: [.006, 0, .004, 0], breath: .028 }
    };
    const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
    for (const a of EXTRA_RAW) {
      a.key = a.name.toLowerCase();
      if (AG[a.key]) continue;
      const m = MATS[MAT_OF[a.name]];
      a.matName = MAT_OF[a.name];
      a.base = rgb(m.base); a.ink = rgb(m.ink); a.mat = [m.gloss, m.metal, m.glass];
      a.type = TYPE_OF[a.name]; a.t = TYPES[a.type]; a.sp = .8 + ((a.n * 37) % 11) / 20;
      a.arcs.sort((x, y) => y[2] - x[2]); a.circs.sort((x, y) => y[2] - x[2]);
      a.na = a.arcs.length; a.nc = a.circs.length;
      a.arcF = new Float32Array(28); a.arcs.forEach((r, i) => a.arcF.set(r, i * 7));
      a.cirF = new Float32Array(12); a.circs.forEach((r, i) => a.cirF.set(r, i * 6));
      AG[a.key] = a; ORDER.push(a.key);
    }
  }

})();
