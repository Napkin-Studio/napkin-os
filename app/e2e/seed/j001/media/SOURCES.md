# J001 media fixtures: where each file comes from

Every file here is made by `make_media.py` in this folder: Python 3, standard library only, no input file, no network, no
model. Napkin owns all of them. None is copied or traced from `client_briefs/`, from a client's material or from any
stock or generated picture. They prove plumbing only (sizes, ids, hashes, corners); they look nothing like real work, and
the five manual gate checks in `docs/design/phase3-acceptance.md` use real output.

Regenerate with `python3 app/e2e/seed/j001/media/make_media.py`; prove with `node app/e2e/seed/j001/media/verify.mjs`.
`verify.mjs` refuses a file in this folder that is not listed below or not in `manifest.json`, a hash that moved, and a
file whose hash matches anything in `client_briefs/`.

| File | What it is | How it is drawn |
| --- | --- | --- |
| bottle.png | The product photo: one bottle on a plain ground, 600 x 900, label left blank | Filled rounded rectangles, a quad and an ellipse, with a linear glass shade |
| scamp.png | The scamp: a rough ink frame, a bottle outline, three headline scribbles, a crossed logo box, 800 x 500 | Straight ink lines on paper |
| site-48-sheet.png | Site placeholder, a 48 sheet seen at an angle, 1200 x 800, corners known | Flat colour blocks; the display face is a quad whose four corners are in `manifest.json` |
| site-bus-shelter.png | Site placeholder, a bus shelter panel seen nearly square on, 1200 x 800, corners known | Flat colour blocks; the lit panel is a quad whose four corners are in `manifest.json` |
| site-6-sheet.png | Site placeholder, a 6 sheet beside a pavement, 1200 x 800, corners known | Flat colour blocks; the face is a quad whose four corners are in `manifest.json` |
| site-station-panel.png | Site placeholder, a wide station panel, 1200 x 800, corners known | Flat colour blocks; the face is a quad whose four corners are in `manifest.json` |
| site-digital-screen.png | Site placeholder, a digital screen, 1200 x 800, corners known | Flat colour blocks; the face is a quad whose four corners are in `manifest.json` |
| radio-30s.json | The 30 second radio script: six beats with ids r1 to r6, estimated seconds summing to 30 | Written in the script |
| tv-10s.json | The 10 second TV script: three beats with ids t1 to t3, seconds summing to 10 | Written in the script |
| layout.json | The approved layout of the still: picture, headline, logo and legal layers in boxes on a 1080 x 1350 canvas | Written in the script |
| manifest.json | Name, kind, size, sha256 and corners of each file above | Written last by the script |
