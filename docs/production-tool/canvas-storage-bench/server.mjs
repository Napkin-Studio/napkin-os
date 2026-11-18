import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const WWW = path.join(path.dirname(new URL(import.meta.url).pathname), 'www');
const DOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  const h = { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (u.searchParams.get('coi') === '1') { h['Cross-Origin-Opener-Policy'] = 'same-origin'; h['Cross-Origin-Embedder-Policy'] = 'require-corp'; }
  if (u.pathname === '/ping') { res.writeHead(200, { ...h, 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u.pathname === '/dot.png') { res.writeHead(200, { ...h, 'Content-Type': 'image/png' }); return res.end(DOT); }
  if (u.pathname === '/w.js') { res.writeHead(200, { ...h, 'Content-Type': 'text/javascript' }); return res.end('postMessage("ok")'); }
  const f = path.join(WWW, u.pathname === '/' ? 'top.html' : u.pathname);
  if (!f.startsWith(WWW) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = f.endsWith('.js') ? 'text/javascript' : 'text/html';
  res.writeHead(200, { ...h, 'Content-Type': type }); res.end(fs.readFileSync(f));
}
function upgrade(req, sock) {
  const key = req.headers['sec-websocket-key'];
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.on('data', () => {}); sock.on('error', () => {});
}
for (const port of [8811, 8812]) { const s = http.createServer(handler); s.on('upgrade', upgrade); s.listen(port); }
console.log('listening');
