// A stand-in media base for the build pairs: in/sha256:<hex> by PUT, answered by HEAD and GET, CORS open. In memory only.
import http from 'node:http'
const held = new Map()
http.createServer((req, res) => {
  const h = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD, PUT, OPTIONS', 'access-control-allow-headers': '*' }
  const key = req.url.split('?')[0]
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end() }
  if (req.method === 'PUT') { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { held.set(key, Buffer.concat(c)); res.writeHead(204, h); res.end() }); return }
  const body = held.get(key)
  if (!body) { res.writeHead(404, h); return res.end() }
  res.writeHead(200, { ...h, 'content-type': 'image/png', 'content-length': body.length })
  res.end(req.method === 'HEAD' ? undefined : body)
}).listen(5501, '127.0.0.1')
