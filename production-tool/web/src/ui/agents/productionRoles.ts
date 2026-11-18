// The Production Tool's agents as role spheres in the shell's one agent engine (features/production-new-ui.clan).
// Ported from the approved mock (~/Documents/napkin-design-mocks/production-new-ui-v2/vendor/production-agents.js,
// mock-only there): the geometry rows are VERBATIM from sphere-ring-v1/source/agents.json (the 30-agent sheet);
// each production role borrows the sheet agent named in `src` and keeps that agent's material and motion type.
// Registered once into NapkinRoles (app/templates/shared/agent-sphere/roles.js, loaded by the shell's
// app/src/shell/agents/engine.ts) after it loads. Review and Knowledge are the shell's own roles already.
// Names are role names (copy rules, owner 2026-11-10): Director agent, Script agent, Camera agent, Retouch agent,
// Edit agent, Review agent, Knowledge agent.

import { roles } from '@napkin/app/shell/agents/engine'

/* eslint-disable @typescript-eslint/no-explicit-any */
const RAW: any[] = [{"key": "director", "a": {"n": 10, "name": "Director", "arcs": [[0.0, 0.0, 0.7941, -0.8554, 2.1643, 0.0941, 1.0], [0.0, 0.0, 0.4118, 0.6282, 3.1416, 0.0971, 1.0]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0], [0.0, 0.0, 0.0882, 0.0, 1, 1.0]], "role": "directs the film", "src": "Art Director"}, "job": "directs the film", "kind": "think"}, {"key": "script", "a": {"n": 9, "name": "Script", "arcs": [[0.0001, 0.0, 0.7941, -2.0945, 1.9375, 0.0941, 1.0], [-0.0001, -0.0, 0.3235, -1.5706, 1.0647, 0.0441, 0.4]], "circs": [[0.0, 0.0, 0.2353, 0.0588, 0, 1.0]], "role": "writes the script", "src": "Copy"}, "job": "writes the script", "kind": "write"}, {"key": "camera", "a": {"n": 14, "name": "Camera", "arcs": [[0.0, -0.0002, 0.7941, -2.1818, 1.9378, 0.0941, 1.0], [0.0054, 0.0064, 0.4118, -0.7188, 3.1824, 0.0971, 1.0], [-0.0, -0.0001, 0.3235, -1.6581, 1.065, 0.0441, 0.4]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0]], "role": "makes frames and clips", "src": "Video"}, "job": "makes frames and clips", "kind": "work"}, {"key": "retouch", "a": {"n": 13, "name": "Retouch", "arcs": [[0.0001, -0.0001, 0.7941, 2.8623, 1.7103, 0.0941, 1.0]], "circs": [[0.0, 0.0, 0.2353, 0.0588, 0, 1.0], [0.3824, 0.2941, 0.0882, 0.0353, 0, 1.0]], "role": "changes a picture", "src": "Image"}, "job": "changes a picture", "kind": "work"}, {"key": "edit", "a": {"n": 18, "name": "Edit", "arcs": [[-0.0001, -0.0, 0.7941, 2.7749, 1.7109, 0.0941, 1.0], [-0.0055, 0.0027, 0.4118, -2.0099, 3.1116, 0.0971, 1.0]], "circs": [[0.2647, -0.1765, 0.1176, 0.0471, 0, 1.0], [0.3824, 0.2941, 0.0882, 0.0353, 0, 1.0]], "role": "cuts the film", "src": "Edit"}, "job": "cuts the film", "kind": "work"}]
const TYPES: Record<string, { wob: number[]; breath: number }> = { scan: { wob: [0, .006, 0, .004], breath: .004 }, unfold: { wob: [.012, .014, .006, 0], breath: .022 },
    sweep: { wob: [0, .008, .012, .006], breath: .006 }, hold: { wob: [.003, .002, 0, 0], breath: .004 },
    align: { wob: [.005, 0, .005, 0], breath: .008 }, pulse: { wob: [.006, 0, .004, 0], breath: .028 } }
/* eslint-enable @typescript-eslint/no-explicit-any */

let done = false
/** Adds the production roles to the engine; idempotent, and harmless where the engine is absent (tests without it). */
export function registerProductionRoles(): void {
  if (done) return
  done = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  const A = g.NapkinAgents, R = g.NapkinRoles
  if (!A || !R) return
  const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }
  for (const r of RAW) {
    const a = r.a
    a.key = r.key
    A.MAT_OF[a.name] = A.MAT_OF[a.src] || 'pearl'
    A.TYPE_OF[a.name] = A.TYPE_OF[a.src] || 'sweep'
    const m = A.MATS[A.MAT_OF[a.name]]
    a.matName = A.MAT_OF[a.name]; a.base = rgb(m.base); a.ink = rgb(m.ink); a.mat = [m.gloss, m.metal, m.glass]
    a.type = A.TYPE_OF[a.name]; a.t = TYPES[a.type] || TYPES.sweep; a.sp = 0.8 + ((a.n * 37) % 11) / 20
    a.arcs.sort((x: number[], y: number[]) => y[2] - x[2]); a.circs.sort((x: number[], y: number[]) => y[2] - x[2])
    a.na = a.arcs.length; a.nc = a.circs.length
    a.arcF = new Float32Array(28); a.arcs.forEach((q: number[], i: number) => a.arcF.set(q, i * 7))
    a.cirF = new Float32Array(12); a.circs.forEach((q: number[], i: number) => a.cirF.set(q, i * 6))
    A.AG[r.key] = a
    if (A.ORDER.indexOf(r.key) < 0) A.ORDER.push(r.key)
    R.ROLES[r.key] = { name: a.name, job: r.job }
    R.KIND[r.key] = r.kind
  }
}

registerProductionRoles()
export { roles }
