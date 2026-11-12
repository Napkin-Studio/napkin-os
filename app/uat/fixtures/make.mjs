// Makes the attachment fixtures for app/uat/attachments.uat.ts. All synthetic: "Kestrel Oat"
// is a made-up Irish oat drink, never a real client. Each file carries one fact the journeys
// look for, to prove the agents read it.
//
//   cd app && node uat/fixtures/make.mjs
//
// Uses only what app/ already installs: Playwright's Chromium prints the PDFs (a real text
// layer) and renders the PNG; the docx and zip are written by hand (node:zlib).

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const out = (name, data) => { writeFileSync(join(here, name), data); console.log(`${name}: ${data.length} bytes`) }

/** A zip (deflate), enough for OOXML and for the unsupported-type fixture. Fixed time stamps,
 *  so a re-run makes the same bytes. */
function zip(entries) {
  const locals = [], centrals = []
  let off = 0
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8'), body = deflateRawSync(raw), nm = Buffer.from(name, 'utf8'), crc = crc32(raw)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8)
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x5a21, 12) // 2025-01-01
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10)
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x5a21, 14)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, nm, body); centrals.push(ch, nm)
    off += lh.length + nm.length + body.length
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function docx(paragraphs) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const body = paragraphs.map(p => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`],
  ])
}

const PAGE = 'body{font:15px/1.5 Georgia,serif;margin:48px;color:#111} h1{font-size:22px} .pb{break-before:page}'

const CALL = `<style>${PAGE}</style>
<h1>Kestrel Oat: client call notes</h1>
<p>Call with the Kestrel Oat marketing team, Tuesday morning. Kestrel Oat is an Irish oat drink made in County Cork.</p>
<p>Where they are: Kestrel Oat sold 1.2 million litres in Ireland in 2025, mostly the barista carton through cafes and independent grocers.</p>
<p>What they want: a spring campaign to bring lapsed buyers back and win new ones in the big supermarkets.</p>
<div class="pb"></div>
<h1>Timing and money</h1>
<p>They plan to launch on 14 March 2027, with the first flight of media in the fortnight after.</p>
<p>They have a media budget of €420,000 for the first year, social and out-of-home first.</p>
<p>Measure of success: repeat purchase at twelve weeks.</p>`

const SHELF = `<style>html,body{margin:0;width:1200px;height:800px;background:#f3ead8;font-family:Arial,Helvetica,sans-serif}
.box{position:absolute;inset:60px;border:10px solid #1d3b2a;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#1d3b2a}
.a{font-size:110px;font-weight:800;line-height:1.1}.b{font-size:64px;font-weight:700;line-height:1.3}</style>
<div class="box"><div class="a">Kestrel Oat</div><div class="b">now in Dunnes Stores, Cork</div></div>`

/** The 4 MB PDF: the same text layer, padded with pictures of noise (they do not compress). */
const BIG = `<style>${PAGE} canvas{display:block;width:170mm;margin:12px 0}</style>
<h1>Kestrel Oat: full call pack</h1>
<p>Kestrel Oat plans to launch on 14 March 2027 with a media budget of €420,000.</p>
<p>The pictures below are padding for the upload test.</p>
<canvas id="a" width="1000" height="700"></canvas><div class="pb"></div><canvas id="b" width="1000" height="700"></canvas>
<script>
  let s = 42; const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 24
  for (const id of ['a', 'b']) { const c = document.getElementById(id).getContext('2d'), d = c.createImageData(1000, 700)
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = r(); d.data[i + 1] = r(); d.data[i + 2] = r(); d.data[i + 3] = 255 }
    c.putImageData(d, 0, 0) }
</script>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.setContent(CALL); out('kestrel-client-call.pdf', await page.pdf({ format: 'A4' }))
await page.setContent(BIG); out('kestrel-big.pdf', await page.pdf({ format: 'A4' }))
await page.setContent(SHELF); out('kestrel-shelf.png', await page.screenshot({ type: 'png' }))
await browser.close()

out('kestrel-brand-notes.docx', docx([
  'Kestrel Oat: brand notes',
  'Kestrel Oat is an Irish oat drink.',
  'Tone: dry wit, never smug.',
  'Core audience: night-shift nurses, who drink it on the break at 3 a.m.',
]))
out('kestrel-notes.txt', Buffer.from('Kestrel Oat, notes from the planner.\nCompetitor to watch: Glenmore Oat.\n'))
out('kestrel-archive.zip', zip([['kestrel-readme.txt', 'Kestrel Oat archive. Nothing in here is readable by the agents.\n']]))
out('empty.pdf', Buffer.alloc(0))
