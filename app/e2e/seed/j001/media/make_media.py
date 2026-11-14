#!/usr/bin/env python3
"""Draws J001's media fixtures (features/j001-phase3-suite.clan) and writes manifest.json.

Pure Python 3, standard library only, no network, no model, no input file: every pixel is made by the code below, so the
same script gives the same bytes on every machine. Napkin owns the output. Nothing here is copied from client_briefs/ or
from any client's material. SOURCES.md says how each file is drawn.

    python3 app/e2e/seed/j001/media/make_media.py          # rewrite the files and manifest.json
    node app/e2e/seed/j001/media/verify.mjs               # prove each hash and the list in SOURCES.md
"""
import hashlib
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


class Canvas:
    """An RGB canvas. Shapes are filled by testing each pixel of their bounding box (small images, so this is fast enough)."""

    def __init__(self, w, h, ground):
        self.w, self.h = w, h
        self.px = [bytearray(bytes(ground) * w) for _ in range(h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x * 3:x * 3 + 3] = bytes(c)

    def fill(self, box, inside, color):
        x0, y0, x1, y1 = box
        for y in range(max(0, int(y0)), min(self.h, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(self.w, int(x1) + 1)):
                if inside(x + 0.5, y + 0.5):
                    c = color(x, y) if callable(color) else color
                    self.px[y][x * 3:x * 3 + 3] = bytes(c)

    def rect(self, x0, y0, x1, y1, c):
        self.fill((x0, y0, x1, y1), lambda x, y: x0 <= x <= x1 and y0 <= y <= y1, c)

    def round_rect(self, x0, y0, x1, y1, r, c):
        def inside(x, y):
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                return False
            cx = min(max(x, x0 + r), x1 - r)
            cy = min(max(y, y0 + r), y1 - r)
            return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
        self.fill((x0, y0, x1, y1), inside, c)

    def ellipse(self, cx, cy, rx, ry, c):
        self.fill((cx - rx, cy - ry, cx + rx, cy + ry), lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c)

    def quad(self, pts, c):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]

        def inside(x, y):
            sign = 0
            for i in range(4):
                (ax, ay), (bx, by) = pts[i], pts[(i + 1) % 4]
                cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
                if cross != 0:
                    s = 1 if cross > 0 else -1
                    if sign and s != sign:
                        return False
                    sign = s
            return True
        self.fill((min(xs), min(ys), max(xs), max(ys)), inside, c)

    def line(self, a, b, c, width=3):
        (x0, y0), (x1, y1) = a, b
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        r = width // 2
        for i in range(n + 1):
            t = i / n
            x, y = round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t)
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    self.set(x + dx, y + dy, c)

    def png(self):
        raw = b''.join(b'\x00' + bytes(row) for row in self.px)

        def chunk(tag, data):
            body = tag + data
            return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

        head = struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0)
        return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', head) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def bottle():
    """A drawn bottle on a plain ground: 600 x 900, label blank (type is never made inside a picture)."""
    ground = (233, 228, 216)
    c = Canvas(600, 900, ground)
    c.ellipse(300, 838, 150, 22, (206, 200, 187))  # the shadow on the ground
    glass_dark, glass_light = (92, 52, 18), (176, 112, 44)

    def glass(x, y):
        t = min(1.0, max(0.0, (x - 190) / 220))
        return mix(glass_dark, glass_light, 0.25 + 0.5 * (1 - abs(2 * t - 1)) * 0.8 + 0.2 * t)

    c.round_rect(190, 400, 410, 830, 26, glass)  # the body
    c.quad([(250, 400), (350, 400), (338, 270), (262, 270)], glass)  # the shoulder into the neck
    c.round_rect(262, 170, 338, 300, 8, glass)  # the neck
    c.round_rect(252, 122, 348, 186, 10, (46, 34, 28))  # the cap
    c.rect(212, 520, 388, 720, (240, 234, 220))  # the label, blank
    c.rect(212, 520, 388, 526, (181, 142, 74))
    c.rect(212, 714, 388, 720, (181, 142, 74))
    c.quad([(214, 430), (236, 430), (236, 800), (214, 800)], (214, 162, 96))  # the highlight down the glass
    return c.png()


def scamp():
    """A rough scamp in ink on paper: a frame, a bottle outline, headline lines and a logo box. 800 x 500."""
    ink, paper = (34, 30, 28), (246, 242, 232)
    c = Canvas(800, 500, paper)
    for a, b in [((20, 20), (780, 20)), ((780, 20), (780, 480)), ((780, 480), (20, 480)), ((20, 480), (20, 20))]:
        c.line(a, b, ink, 3)
    for a, b in [((500, 410), (500, 190)), ((500, 190), (528, 160)), ((528, 160), (528, 90)), ((528, 90), (572, 90)),
                 ((572, 90), (572, 160)), ((572, 160), (600, 190)), ((600, 190), (600, 410)), ((600, 410), (500, 410))]:
        c.line(a, b, ink, 3)
    c.line((510, 270), (590, 262), ink, 2)
    c.line((510, 330), (590, 322), ink, 2)
    for i, w in enumerate((300, 340, 220)):  # the headline, three scribbled lines (no words)
        y = 110 + i * 44
        c.line((60, y), (60 + w, y + (4 if i % 2 else -3)), ink, 5)
    for i in range(3):  # a line of small copy
        c.line((60, 300 + i * 22), (300 - i * 40, 300 + i * 22), ink, 2)
    c.line((620, 400), (760, 400), ink, 2)
    c.line((620, 460), (760, 460), ink, 2)
    c.line((620, 400), (620, 460), ink, 2)
    c.line((760, 400), (760, 460), ink, 2)
    c.line((620, 400), (760, 460), ink, 2)  # the logo box, crossed
    c.line((760, 400), (620, 460), ink, 2)
    return c.png()


# The five placeholders: name, file, display-face corners (top left, top right, bottom right, bottom left) in the 1200 x 800 picture.
SITES = [
    ('48 sheet', 'site-48-sheet.png', [(480, 170), (1010, 215), (1010, 505), (480, 520)], True),
    ('6 sheet', 'site-6-sheet.png', [(520, 300), (700, 292), (700, 560), (520, 556)], False),
    ('bus shelter', 'site-bus-shelter.png', [(560, 260), (860, 250), (860, 520), (560, 530)], False),
    ('station panel', 'site-station-panel.png', [(300, 220), (900, 240), (900, 540), (300, 520)], False),
    ('digital screen', 'site-digital-screen.png', [(430, 180), (770, 190), (770, 470), (430, 465)], False),
]


def site(corners, wall):
    """A site placeholder: a plain street scene with a flat grey display face at four known corners. 1200 x 800."""
    sky = (205, 214, 222)
    c = Canvas(1200, 800, sky)
    c.rect(0, 600, 1199, 799, (126, 124, 118))  # the street
    c.rect(0, 560, 1199, 600, (158, 154, 146))  # the pavement
    if wall:  # buildings either side of a hoarding
        c.rect(70, 150, 420, 560, (150, 112, 92))
        c.rect(1010, 120, 1160, 560, (150, 112, 92))
    xs, ys = [p[0] for p in corners], [p[1] for p in corners]
    c.rect(min(xs) - 20, min(ys) - 20, max(xs) + 20, max(ys) + 20, (60, 64, 68))  # the frame behind the face
    c.quad(corners, (88, 92, 96))  # the display face, plain grey
    return c.png()


def beat(id_, kind, role, text, est_s, **extra):
    return {'id': id_, 'kind': kind, 'role': role, 'text': text, 'est_s': est_s, **extra}


def radio_30s():
    beats = [
        beat('r1', 'sfx', '', 'A bar at closing time. One glass set down.', 3, duration_s=3),
        beat('r2', 'voice', 'FVO', 'It is late. Everyone else has gone home. You have not.', 7, duration_s=7),
        beat('r3', 'voice', 'MVO', 'Client A. Triple distilled, and in no hurry at all.', 6, duration_s=6),
        beat('r4', 'music', '', 'One slow piano line under the voice.', 4, duration_s=4),
        beat('r5', 'voice', 'FVO', 'Pour one. The night can wait.', 5, duration_s=5),
        beat('r6', 'voice', 'LEGAL', 'Drink responsibly. Eighteen plus only.', 5, duration_s=5, legal=True),
    ]
    return {'id': 'j001-radio-30s', 'format': 'radio', 'slot_s': 30, 'client': 'Client A, an Irish whiskey',
            'est_total_s': sum(b['est_s'] for b in beats), 'beats': beats}


def tv_10s():
    beats = [
        beat('t1', 'shot', '', 'A bar, late. The door half shut.', 3, duration_s=3, visual_action='Wide on an empty room, one lamp lit.'),
        beat('t2', 'shot', 'VO', 'Some things are worth the wait.', 4, duration_s=4, visual_action='Close on a pour into a heavy glass.'),
        beat('t3', 'shot', '', 'End card.', 3, duration_s=3, visual_action='The bottle, label forward, then the logo.', on_screen_text='Client A. Drink responsibly.'),
    ]
    return {'id': 'j001-tv-10s', 'format': 'tv', 'slot_s': 10, 'client': 'Client A, an Irish whiskey',
            'est_total_s': sum(b['est_s'] for b in beats), 'beats': beats}


def layout():
    """The approved layout of the J001 still: layers in boxes on a 1080 x 1350 canvas. Type and logo are layers, never picture."""
    return {
        'id': 'j001-layout-still', 'status': 'approved', 'approved_by': 'creative director (placeholder person)',
        'canvas': {'w': 1080, 'h': 1350}, 'safe_area': {'x': 60, 'y': 60, 'w': 960, 'h': 1230},
        'layers': [
            {'id': 'picture', 'type': 'picture', 'asset': 'bottle.png', 'box': {'x': 240, 'y': 330, 'w': 600, 'h': 900}},
            {'id': 'headline', 'type': 'type', 'text': 'The night can wait.', 'font': 'Geist', 'box': {'x': 80, 'y': 100, 'w': 920, 'h': 180}},
            {'id': 'logo', 'type': 'logo', 'source': 'brand kit', 'box': {'x': 80, 'y': 1180, 'w': 220, 'h': 90}},
            {'id': 'legal', 'type': 'type', 'text': 'Drink responsibly', 'font': 'Geist', 'box': {'x': 700, 'y': 1220, 'w': 300, 'h': 50}},
        ],
        'protected': ['headline', 'logo', 'legal'],
    }


def write(name, data):
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(os.path.join(HERE, name), mode) as f:
        f.write(data if isinstance(data, bytes) else json.dumps(data, indent=2) + '\n')


def main():
    files = [
        ('bottle.png', 'product_photo', bottle(), {'width': 600, 'height': 900}),
        ('scamp.png', 'scamp', scamp(), {'width': 800, 'height': 500}),
    ]
    for name, file, corners, wall in SITES:
        files.append((file, 'site', site(corners, wall), {'width': 1200, 'height': 800, 'site': name, 'corners': [list(p) for p in corners]}))
    docs = [
        ('radio-30s.json', 'radio_script', radio_30s(), {'slot_s': 30}),
        ('tv-10s.json', 'tv_script', tv_10s(), {'slot_s': 10}),
        ('layout.json', 'layout', layout(), {}),
    ]
    entries = []
    for name, kind, data, extra in files + docs:
        write(name, data)
        path = os.path.join(HERE, name)
        with open(path, 'rb') as f:
            body = f.read()
        entries.append({'name': name, 'kind': kind, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
                        'owner': 'Napkin', 'drawn_by': 'make_media.py', **extra})
    write('manifest.json', {'note': 'Drawn by make_media.py. Napkin owns every file. None comes from client_briefs/.', 'files': entries})
    print(f'wrote {len(entries)} files and manifest.json')


if __name__ == '__main__':
    main()
