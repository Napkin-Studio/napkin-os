// post.js: the spheres are NapkinSpheres; NapkinAgents is the crew figures again (see pre.js).
window.NapkinSpheres = window.NapkinAgents;
window.NapkinAgents = window.__napkinFigures;
try { delete window.__napkinFigures; } catch (e) { window.__napkinFigures = undefined; }
