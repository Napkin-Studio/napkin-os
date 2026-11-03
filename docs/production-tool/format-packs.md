# Production Tool: scamp-sheet format packs

Status: **draft for owner review** (2026-10-13). Owner decision of 2026-10-13: "Use industry standards", with the owner reviewing.
Data file: `production-tool/contracts/format-packs.json` (same content as these tables).

## How to read this

- **Size** is the format's real size: px for screen formats, mm for print and OOH.
- **Delivery px** for screen formats is the file to deliver. For print and OOH it is the raster size of the artwork **at the scale the media owner asks for, at 300 dpi** (for example, a 48-sheet is supplied at 1/10 scale, which gives 7200 x 3600 px). For ISO paper it is the trim at 300 dpi; add about 35 px per side for 3 mm bleed.
- **Safe area** is either insets from each edge (`T/R/B/L`) or a centred live/display box at full size.
- **Bleed** is in mm. For scaled OOH artwork it applies **to the scaled artwork**, not the full poster.
- Rows marked **(unverified)** have `"verified": false` in the JSON. The value is either derived, read only from a search snippet, or not confirmed on a primary page. The list at the end gives the reason for each.
- UK OOH media owners publish specs **per site and per network**. These packs hold the common national spec. The tool should still say "confirm with the media owner" on OOH output.

## Social

Meta's current guides recommend 1440 px wide for all placements and give one safe zone (top 14%, bottom 35%, sides 6%) for both Stories and Reels. Older third-party guides cite 20% bottom for Stories, but Meta's own page now says 35%. TikTok and YouTube Shorts publish safe-zone *templates or graphics* rather than numbers, so those rows carry no safe area.

| Name | Size | Ratio | Delivery px | Safe area | Bleed | Notes | Source |
|---|---|---|---|---|---|---|---|
| Meta feed image 4:5 (Facebook / Instagram)<br>`meta-feed-image-4x5` | 1440 x 1800 px | 4:5 | 1440 x 1800 | not published | - | Meta accepts 1.91:1 to 4:5 (1% tolerance), min width 500 px. No safe zone published for feed. | [1](https://www.facebook.com/business/ads-guide/update/image/instagram-feed) |
| Meta feed image 1:1 **(unverified)**<br>`meta-feed-image-1x1` | 1440 x 1440 px | 1:1 | 1440 x 1440 | not published | - | 1:1 sits inside Meta's accepted range; the 1440 px size is derived from Meta's 1440-wide recommendation, not stated on the page. | [1](https://www.facebook.com/business/ads-guide/update/image/instagram-feed) |
| Meta feed video 4:5<br>`meta-feed-video-4x5` | 1440 x 1800 px | 4:5 | 1440 x 1800 | not published | - | Meta publishes no feed safe zone; footer (headline/CTA) may not show on mobile Facebook Feed for awareness objectives. | [1](https://www.facebook.com/business/ads-guide/update/video/facebook-feed) |
| Meta Stories 9:16 (Facebook / Instagram)<br>`meta-stories-9x16` | 1440 x 2560 px | 9:16 | 1440 x 2560 | T 14 / R 6 / B 35 / L 6 % | - | Keep text/logos out of top 14%, bottom 35%, 6% each side. Same spec applies to still images in Stories. | [1](https://www.facebook.com/business/ads-guide/update/video/instagram-story) |
| Meta Reels 9:16 (Facebook / Instagram)<br>`meta-reels-9x16` | 1440 x 2560 px | 9:16 | 1440 x 2560 | T 14 / R 6 / B 35 / L 6 % | - | Top 14%, bottom 35% (profile icon and CTA), 6% each side. | [1](https://www.facebook.com/business/ads-guide/update/video/instagram-reels) |
| TikTok In-Feed 9:16 **(unverified)**<br>`tiktok-infeed-9x16` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | TikTok publishes minimums only (540x960); 1080x1920 is the conventional delivery. Also accepts 16:9 (min 960x540) and 1:1 (min 640x640). Safe zone: TikTok publishes downloadable templates only (varies with caption length and anchors); no numeric margins on the page. | [1](https://ads.tiktok.com/help/article/video-ads-specifications) |
| YouTube 16:9 (long-form and in-stream)<br>`youtube-16x9` | 1920 x 1080 px | 16:9 | 1920 x 1080 | not published | - | YouTube encode ladder includes 3840x2160 and 2560x1440; ads min 1280x720. | [1](https://support.google.com/youtube/answer/6375112)<br>[2](https://support.google.com/google-ads/answer/13547298) |
| YouTube Shorts / vertical ad 9:16<br>`youtube-shorts-9x16` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | Google recommends 9:16 for Shorts; only first 60 s plays in the Shorts feed. Google shows a safe-zone graphic but publishes no numeric margins. | [1](https://support.google.com/google-ads/answer/13547298)<br>[2](https://support.google.com/google-ads/answer/16041697) |
| YouTube square 1:1<br>`youtube-1x1` | 1080 x 1080 px | 1:1 | 1080 x 1080 | not published | - | Google Ads also accepts 4:5 and 2:3 vertical. | [1](https://support.google.com/google-ads/answer/13547298) |
| LinkedIn single image 1.91:1<br>`linkedin-image-1.91x1` | 1200 x 628 px | 1.91:1 | 1200 x 628 | not published | - |  | [1](https://www.linkedin.com/help/lms/answer/a426534) |
| LinkedIn single image 1:1<br>`linkedin-image-1x1` | 1200 x 1200 px | 1:1 | 1200 x 1200 | not published | - |  | [1](https://www.linkedin.com/help/lms/answer/a426534) |
| LinkedIn single image 4:5 (mobile only)<br>`linkedin-image-4x5` | 720 x 900 px | 4:5 | 720 x 900 | not published | - | Vertical assets serve on mobile only. | [1](https://www.linkedin.com/help/lms/answer/a426534) |
| LinkedIn video 16:9<br>`linkedin-video-16x9` | 1920 x 1080 px | 16:9 | 1920 x 1080 | not published | - | 1200x675 also recommended; max 1920x1080. | [1](https://www.linkedin.com/help/lms/answer/a424737) |
| LinkedIn video 4:5<br>`linkedin-video-4x5` | 720 x 900 px | 4:5 | 1080 x 1350 | not published | - | Recommended 720x900, max 1080x1350; delivery_px uses the max. | [1](https://www.linkedin.com/help/lms/answer/a424737) |
| LinkedIn video 9:16<br>`linkedin-video-9x16` | 720 x 1280 px | 9:16 | 1080 x 1920 | not published | - | Recommended 720x1280, max 1080x1920; delivery_px uses the max. | [1](https://www.linkedin.com/help/lms/answer/a424737) |
| X video 16:9 **(unverified)**<br>`x-video-16x9` | 1920 x 1080 px | 16:9 | 1920 x 1080 | not published | - | Read via search snippet; help.x.com returned 403 to direct fetch. | [1](https://help.x.com/en/business-and-advertising/creative-ad-specifications) |
| X video 1:1 **(unverified)**<br>`x-video-1x1` | 1200 x 1200 px | 1:1 | 1200 x 1200 | not published | - | Read via search snippet; not fetched directly. | [1](https://help.x.com/en/business-and-advertising/creative-ad-specifications) |
| X vertical video 9:16 **(unverified)**<br>`x-video-9x16` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | From X's older creative-specs page (max 1080x1920). Not fetched directly. | [1](https://help.x.com/en/business-and-advertising/creative-ad-specifications) |
| X single image 1.91:1 **(unverified)**<br>`x-image-1.91x1` | 1200 x 628 px | 1.91:1 | 1200 x 628 | not published | - | Common industry size; not confirmed on an X page in this research. | [1](https://help.x.com/en/business-and-advertising/creative-ad-specifications) |
| X single image 1:1 **(unverified)**<br>`x-image-1x1` | 1200 x 1200 px | 1:1 | 1200 x 1200 | not published | - | Not confirmed on an X page in this research. | [1](https://help.x.com/en/business-and-advertising/creative-ad-specifications) |
| Pinterest standard pin 2:3<br>`pinterest-standard-2x3` | 1000 x 1500 px | 2:3 | 1000 x 1500 | not published | - | Taller or wider than 2:3 may be cropped in feed. | [1](https://help.pinterest.com/en/business/article/pinterest-product-specs) |
| Pinterest full-screen (Idea ad) 9:16<br>`pinterest-fullscreen-9x16` | 1080 x 1920 px | 9:16 | 1080 x 1920 | T 270 / R 195 / B 440 / L 65 px | - | Pinterest publishes px insets: top 270, left 65, right 195, bottom 440. Video pins accept 1:2 to 1.91:1; 1:1, 2:3, 4:5, 9:16 recommended. | [1](https://help.pinterest.com/en/business/article/pinterest-product-specs) |

## Out of home (UK and Ireland)

Clear Channel UK is now **Bauer Media Outdoor**, and clearchannel.co.uk redirects there; Adshel is Bauer's roadside 6-sheet brand. Outsmart publishes no format dimension table that I could find; its Large Format Digital Roadside Code gives the 48-sheet as 3 m x 6 m. The physical sizes here come from the Global and Bauer spec sheets. Digital 48-sheet pixel sizes differ by owner and by site, so the pack has one row per owner. The bus formats come from Global's sheets. A TfL bus template (not a pack row) gives 200 mm bleed and 40-50 dpi at full size for bus wraps, which shows how much bus specs vary.

| Name | Size | Ratio | Delivery px | Safe area | Bleed | Notes | Source |
|---|---|---|---|---|---|---|---|
| 48-sheet billboard (UK/IE roadside, paper)<br>`uk-48-sheet` | 6096 x 3048 mm | 2:1 | 7200 x 3600 | 5946 x 2948 mm (centred) | 3 mm | Global: display area 5,946 x 2,948 mm, 3 mm bleed on 1/10-scale artwork (609.6 x 304.8 mm), CMYK PDF, FOGRA39L. Bauer: safe copy 594.6 x 296.8 mm at 1/10, 1 mm bleed. Artwork supplied at 1/10 scale, 300 dpi minimum (450 dpi best for Bauer); delivery_px is the scaled artwork at 300 dpi. | [1](https://global.com/wp-content/uploads/2020/10/48-Sheets-1.pdf)<br>[2](https://www.bauermediaoutdoor.co.uk/resources/specifications/station-billboard-specification) |
| 96-sheet billboard<br>`uk-96-sheet` | 12192 x 3048 mm | 4:1 | 14400 x 3600 | 11942 x 2948 mm (centred) | 3 mm | Global: display area 11,942 x 2,948 mm; 1/10-scale artwork 1,219.2 x 304.8 mm; 3 mm bleed. Artwork supplied at 1/10 scale, 300 dpi minimum (450 dpi best for Bauer); delivery_px is the scaled artwork at 300 dpi. | [1](https://global.com/wp-content/uploads/2020/10/96-Sheet-global-Spec.pdf) |
| 6-sheet (roadside / bus shelter / street furniture)<br>`uk-6-sheet` | 1200 x 1800 mm | 2:3 | 3543 x 5315 | 1160 x 1750 mm (centred) | 3 mm | Global 006/506: display area 1,160 x 1,750 mm; quarter-scale artwork 300 x 450 mm; 3 mm bleed. Artwork supplied at 1/4 scale, 300 dpi minimum (450 dpi best for Bauer); delivery_px is the scaled artwork at 300 dpi. | [1](https://global.com/wp-content/uploads/2020/10/6-Sheet-006-506-Spec.pdf) |
| Adshel 6-sheet (Bauer Media Outdoor, ex-Clear Channel)<br>`uk-adshel-6-sheet` | 1200 x 1800 mm | 2:3 | 3543 x 5315 | 1140 x 1710 mm (centred) | 2 mm | Bauer: quarter-scale artwork 300 x 450 mm, safe copy 285 x 428 mm at 1/4 (1,140 x 1,710 full), 2 mm bleed, 300 dpi min / 450 best. Station 6-sheet trim differs (1,185 x 1,750 mm). | [1](https://www.bauermediaoutdoor.co.uk/resources/specifications/adshel-6-sheet) |
| 4-sheet **(unverified)**<br>`uk-4-sheet` | 1016 x 1524 mm | 2:3 | 3000 x 4500 | 945 x 1453 mm (centred) | 2 mm | Global: overall 1,524 x 1,016 mm, display 1,453 x 945 mm (Global lists the long side first; recorded here as portrait 40 x 60 in). Quarter-scale artwork 381 x 254 mm, 2 mm bleed. | [1](https://global.com/wp-content/uploads/2020/10/4-Sheets.pdf) |
| Digital 6-sheet (D6) / Adshel Live<br>`uk-d6` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | JCDecaux UK: roadside D6 1080x1920 portrait, 12 s, static JPEG only; mall/rail/supermarket 6 s, static or motion 25 fps MP4. Adshel Live (Bauer): 1080x1920, 10 s, subtle animation only. No safe zone published. | [1](https://www.jcdecaux.co.uk/digital-technical-specifications)<br>[2](https://www.clearchannel.co.uk/help/templates/adshel) |
| Digital 48-sheet (D48), JCDecaux UK roadside Drive<br>`uk-d48-jcdecaux` | 612 x 306 px | 2:1 | 612 x 306 | not published | - | Static JPEG, 12 s slot. Physical face nominally 6 x 3 m (Outsmart large-format code). JCDecaux rail D48 (Transvision) is 1440x720, 20 s, static or motion. | [1](https://www.jcdecaux.co.uk/digital-technical-specifications) |
| Digital 48-sheet (D48), Global UK Spec A<br>`uk-d48-global` | 576 x 288 px | 2:1 | 576 x 288 | not published | - | Global UK runs several D48 specs per site: A 576x288, B 600x280, C 720x384, D 864x432. Spec A: 25 fps, 10 s slot, JPEG, max 15 MB. Confirm the spec per site. | [1](https://global.com/wp-content/uploads/2020/10/D48_SpecA.pdf)<br>[2](https://global.com/outdoor/artwork-specs/) |
| Digital 48-sheet, JCDecaux Ireland Digi48<br>`ie-d48-jcdecaux` | 760 x 380 px | 2:1 | 760 x 380 | not published | - | Two artworks required: 760x380 and 912x456. Static only, JPEG, RGB, max 10 MB. | [1](https://www.jcdecaux.ie/jcdecaux/download-file?url=public%3A%2F%2Fblocks%2Fdownloadable_file%2F2024-11%2FDigi48+Specs.pdf) |
| Digital 48-sheet, Global Ireland roadside<br>`ie-d48-global` | 912 x 432 px | 19:9 | 912 x 432 | not published | - | 912x432, JPEG, static, no sound, 2 GB max (2026 sheet). | [1](https://global.com/ie/wp-content/uploads/2026/04/Global-Digital-48-Sheet-Specsheet.pdf) |
| 48-sheet HD (JCDecaux Ireland) **(unverified)**<br>`ie-48-sheet-hd` | 6030 x 3060 mm | ~2:1 | 7122 x 3614 | T 100 / R 100 / B 100 / L 100 mm | - | Visual area 5,950 x 2,950 mm; 100 mm safe copy margin each side (whether measured from full or visual edge is not clear); artwork at 1/10 (603 x 306 mm). Read from search snippet of the PDF, not the full file. | [1](https://www.jcdecaux.ie/jcdecaux/download-file?url=public://blocks/downloadable_file/2024-03/48+Sheet+HD+Specs.pdf) |
| Retail 6-sheet (JCDecaux Ireland) **(unverified)**<br>`ie-retail-6-sheet` | 1200 x 1800 mm | 2:3 | 7087 x 10630 | 1100 x 1700 mm (centred) | - | Visible 1,168 x 1,776 mm; safe copy 1,100 x 1,700 mm; artwork at half scale (600 x 900 mm). Read from search snippet (2017 PDF). | [1](https://www.jcdecaux.ie/jcdecaux/download-file?url=public%3A%2F%2Fblocks%2Fdownloadable_file%2F2017-08%2Fretail6sheetspecs.pdf) |
| Bus T-side (Global, forward stem)<br>`uk-bus-tside` | 7274 x 1801 mm | ~4:1 | 8591 x 2127 | not published | 3 mm | T-shaped: overall width 7,274 mm; horizontal band 653 mm high; stem 1,166 mm wide x 1,801 mm high. Display area at 1/10: 722.2 x 174.9 mm (band 60.1 mm, stem 111.4 mm). Avoid safety stud. 1/10-scale artwork, 3 mm bleed, 300 dpi. Off-centre stem variant exists. | [1](https://global.com/wp-content/uploads/2025/12/T-Sides-Forward-Stem.pdf) |
| Bus streetliner, 13 ft (Global)<br>`uk-bus-streetliner-13ft` | 3962 x 508 mm | ~7.8:1 | 9359 x 1200 | 3911 x 456 mm (centred) | 3 mm | 1/5-scale artwork 792.4 x 101.6 mm (display 782.2 x 91.2). A 477 mm-deep variant and a 10 ft streetliner also exist. | [1](https://global.com/wp-content/uploads/2025/12/Streetliners-13-foot.pdf) |
| Bus superside (Global)<br>`uk-bus-superside` | 6116 x 658 mm | ~9.3:1 | 7224 x 777 | 6056 x 601 mm (centred) | 3 mm | Four sections, each 1,529 mm wide (display 1,514 mm). 1/10-scale artwork 611.6 x 65.8 mm. Market-specific variants (Reading, Bristol/Blackpool chevron). | [1](https://global.com/wp-content/uploads/2025/12/Supersides.pdf) |
| Bus rear, standard 48 x 18 in (Global)<br>`uk-bus-rear-standard` | 1217 x 455 mm | ~2.7:1 | 3594 x 1344 | 1165 x 403 mm (centred) | 3 mm | Quarter-scale artwork 304.25 x 113.75 mm. Variants: super rear 60 x 20 in, non-standard 48 x 20 and 60 x 12 in. | [1](https://global.com/wp-content/uploads/2025/12/Standard-Rears-48-x-18.pdf) |

## Print

ISO 216 trim sizes are the standard values. The ISO page is paywalled, so they are not checked against the ISO text itself. **There is no industry-standard magazine page.** Sizes vary by title, so two published examples are shown: an A4-trim title (Passive House Plus, Irish) and a 230 x 300 mm glossy (Passenger Terminal World). 3 mm bleed is the usual convention, and PTW asks for exactly that. Passive House Plus asks for 5 mm. Half-page ads sit in the type area and have no bleed.

| Name | Size | Ratio | Delivery px | Safe area | Bleed | Notes | Source |
|---|---|---|---|---|---|---|---|
| A0 (ISO 216) **(unverified)**<br>`iso-a0` | 841 x 1189 mm | 1:√2 | 9933 x 14043 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A1 (ISO 216) **(unverified)**<br>`iso-a1` | 594 x 841 mm | 1:√2 | 7016 x 9933 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A2 (ISO 216) **(unverified)**<br>`iso-a2` | 420 x 594 mm | 1:√2 | 4961 x 7016 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A3 (ISO 216) **(unverified)**<br>`iso-a3` | 297 x 420 mm | 1:√2 | 3508 x 4961 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A4 (ISO 216) **(unverified)**<br>`iso-a4` | 210 x 297 mm | 1:√2 | 2480 x 3508 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A5 (ISO 216) **(unverified)**<br>`iso-a5` | 148 x 210 mm | 1:√2 | 1748 x 2480 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| A6 (ISO 216) **(unverified)**<br>`iso-a6` | 105 x 148 mm | 1:√2 | 1240 x 1748 | not published | 3 mm | Trim size; delivery_px = trim at 300 dpi (add ~35 px per side for 3 mm bleed). 3 mm bleed is the trade convention, not part of ISO 216. | [1](https://www.iso.org/standard/36631.html) |
| Magazine full page (A4 trim)<br>`mag-a4-full-page` | 210 x 297 mm | 1:√2 | 2480 x 3508 | 190 x 277 mm (centred) | 5 mm | Example title (Passive House Plus): trim 210 x 297, type area 190 x 277, bleed size 220 x 307 (5 mm bleed). Page sizes vary by title; confirm with publisher. | [1](https://passivehouseplus.co.uk/info/mechanical-data) |
| Magazine double-page spread (A4 trim) **(unverified)**<br>`mag-a4-dps` | 420 x 297 mm | ~1.41:1 | 4961 x 3508 | not published | 5 mm | Passive House Plus lists DPS trim 425 x 297 (bleed 435 x 307) - their DPS is wider than 2 x A4; keep gutter clear. Varies by title. | [1](https://passivehouseplus.co.uk/info/mechanical-data) |
| Magazine half page horizontal (A4 title)<br>`mag-a4-half-h` | 190 x 135 mm | ~1.41:1 | 2244 x 1594 | not published | - | Type-area ad, no bleed. Varies by title. | [1](https://passivehouseplus.co.uk/info/mechanical-data) |
| Magazine half page vertical (A4 title)<br>`mag-a4-half-v` | 93 x 277 mm | ~1:3 | 1098 x 3272 | not published | - | Strip, type-area ad, no bleed. Varies by title. | [1](https://passivehouseplus.co.uk/info/mechanical-data) |
| Magazine full page (230 x 300 glossy)<br>`mag-230-full-page` | 230 x 300 mm | ~0.77:1 | 2717 x 3543 | not published | 3 mm | Example: Passenger Terminal World Annual Review; 3 mm bleed all sides, 300 dpi CMYK PDF. | [1](https://www.ukimediaevents.com/guidelines/ptw.htm) |
| Magazine DPS (460 x 300)<br>`mag-230-dps` | 460 x 300 mm | ~1.53:1 | 5433 x 3543 | not published | 3 mm | Example: PTW Annual Review. | [1](https://www.ukimediaevents.com/guidelines/ptw.htm) |
| Magazine half page horizontal (230 x 300 title)<br>`mag-230-half-h` | 200 x 132 mm | ~1.52:1 | 2362 x 1559 | not published | - | Example: PTW Annual Review. | [1](https://www.ukimediaevents.com/guidelines/ptw.htm) |
| Magazine half page vertical (230 x 300 title)<br>`mag-230-half-v` | 100 x 270 mm | ~1:2.7 | 1181 x 3189 | not published | - | Example: PTW Annual Review. | [1](https://www.ukimediaevents.com/guidelines/ptw.htm) |

## Digital display (IAB)

Source: IAB Tech Lab *New Ad Portfolio: Fixed Size Ad Specifications* (2017, current). The recommended list there is 970x250, 300x50/320x50, 728x90, 970x90, 300x1050, 160x600, 300x250, 120x60, interstitials (640x1136, 750x1334, 1080x1920) and feature-phone banners. 300x600 appears only in the k-weight grid, as a previous IAB size. 320x100 is not in the document. File weights are gzipped initial load; IAB sizes the weight against 2x (retina) pixels.

| Name | Size | Ratio | Delivery px | Safe area | Bleed | Notes | Source |
|---|---|---|---|---|---|---|---|
| Medium rectangle (MPU)<br>`iab-300x250` | 300 x 250 px | 6:5 | 300 x 250 | not published | - | IAB max initial load 150 kB (gzipped). Sizes are specified at 1x; IAB computes weight on 2x (retina) pixels. | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Leaderboard<br>`iab-728x90` | 728 x 90 px | ~8:1 | 728 x 90 | not published | - | IAB max initial load 150 kB (gzipped). | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Wide skyscraper<br>`iab-160x600` | 160 x 600 px | ~1:3.75 | 160 x 600 | not published | - | IAB max initial load 150 kB (gzipped). | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Half page<br>`iab-300x600` | 300 x 600 px | 1:2 | 300 x 600 | not published | - | Listed in IAB's 2017 sizing grid as a previous IAB fixed size (initial load 250 kB); not in the 2017 recommended list. | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Billboard<br>`iab-970x250` | 970 x 250 px | ~3.9:1 | 970 x 250 | not published | - | IAB max initial load 250 kB (gzipped). | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Super leaderboard / pushdown<br>`iab-970x90` | 970 x 90 px | ~10.8:1 | 970 x 90 | not published | - | IAB max initial load 200 kB (gzipped). | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Portrait<br>`iab-300x1050` | 300 x 1050 px | 2:7 | 300 x 1050 | not published | - | IAB max initial load 250 kB (gzipped). | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Smartphone banner<br>`iab-320x50` | 320 x 50 px | 32:5 | 320 x 50 | not published | - | IAB max initial load 50 kB (gzipped). IAB also lists 300x50. | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Large mobile banner **(unverified)**<br>`iab-320x100` | 320 x 100 px | 16:5 | 320 x 100 | not published | - | Widely sold (e.g. Google Ad Manager) but not in IAB's 2017 fixed-size list; not verified against an IAB primary source. | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |
| Mobile phone interstitial<br>`iab-interstitial-1080x1920` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | IAB max initial load 300 kB (gzipped). IAB also lists 640x1136 and 750x1334. | [1](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf) |

## Film

These rows are the four frame ratios for storyboard panels and their default delivery masters. A storyboard panel uses the ratio, and its pixel size is the app's choice. The broadcast title/action-safe convention (EBU) and UK broadcast delivery (DPP AS-11) were not researched. See open questions.

| Name | Size | Ratio | Delivery px | Safe area | Bleed | Notes | Source |
|---|---|---|---|---|---|---|---|
| Film 16:9 (landscape master)<br>`film-16x9` | 1920 x 1080 px | 16:9 | 1920 x 1080 | not published | - | Storyboard frame ratio 16:9. UHD master 3840x2160 per YouTube encode ladder. | [1](https://support.google.com/youtube/answer/6375112)<br>[2](https://support.google.com/google-ads/answer/13547298) |
| Film 9:16 (vertical)<br>`film-9x16` | 1080 x 1920 px | 9:16 | 1080 x 1920 | not published | - | Meta Reels/Stories recommend 1440x2560; use meta-reels safe insets when cutting for Meta. | [1](https://support.google.com/google-ads/answer/13547298) |
| Film 1:1 (square)<br>`film-1x1` | 1080 x 1080 px | 1:1 | 1080 x 1080 | not published | - |  | [1](https://support.google.com/google-ads/answer/13547298) |
| Film 4:5 (portrait feed)<br>`film-4x5` | 1080 x 1350 px | 4:5 | 1080 x 1350 | not published | - | LinkedIn max 1080x1350; Meta now recommends 1440x1800 for 4:5. | [1](https://www.linkedin.com/help/lms/answer/a424737)<br>[2](https://www.facebook.com/business/ads-guide/update/video/facebook-feed) |

## Unverified, and why

- **meta-feed-image-1x1**: the 1440 x 1440 size is derived from Meta's 1440-wide recommendation; 1:1 is within Meta's accepted range.
- **tiktok-infeed-9x16**: TikTok publishes only minimums (540 x 960). 1080 x 1920 is the convention. The safe zone exists only as downloadable templates.
- **x-*** (all X rows): help.x.com refused direct fetch (403) and business.x.com returned 402. The video sizes come from search snippets of X's help page. The 1200 x 628 and 1200 x 1200 image sizes are not confirmed on an X page.
- **iso-a0 ... iso-a6**: ISO 216 values are standard but were not read from the paywalled ISO text. The 3 mm bleed is a trade convention.
- **uk-4-sheet**: Global lists the size as 1,524 x 1,016 mm without saying which is width. It is recorded as portrait (40 x 60 in), which is the usual UK 4-sheet.
- **ie-48-sheet-hd**, **ie-retail-6-sheet**: read from search snippets of JCDecaux Ireland PDFs, not the full files. Download from jcdecaux.ie did not complete in this session.
- **mag-a4-dps**: Passive House Plus gives the DPS trim as 425 mm, not 420 mm. Kept at 2 x A4 pending the owner's choice.
- **iab-320x100**: widely sold, but not in the IAB 2017 fixed-size document.

## Not covered or not found

- No Outsmart format-dimension page was found. outsmart.org.uk/formats returns 404.
- Global's bus specs and D48 specs are UK national. Bus formats for Ireland (Dublin Bus, Go-Ahead Ireland) were not researched.
- No 96-sheet spec specific to Ireland was found. The pack assumes the UK size.
- **Digital 96-sheet** sizes vary by site (Global D96 A-F, JCDecaux 1836 x 486 or 1920 x 480) and are not in the pack. They can be added if wanted.
- The YouTube thumbnail size and the safe zones for Shorts, TikTok and LinkedIn are not published as numbers.

## Open questions for the owner

1. **D48**: should there be one row per media owner, as here, or one generic "D48 2:1" row that leaves the media owner's pixel size to fill in?
2. **Bus formats**: is Global's national set enough, or are Irish bus specs needed?
3. **Film**: add a broadcast pack (DPP AS-11 1920 x 1080, EBU title-safe and action-safe)?
4. **Magazine**: keep both examples, or let the brief's publisher supply the page size?
5. **Extra JSON keys**: each format carries `notes` and `verified` beyond the agreed schema, and `source` is a string or an array of strings. Keep them or strip them?

## Sources

Meta Ads Guide (Reels, Stories, Instagram feed image, Facebook feed video); TikTok Ads Help, *Video ads specifications*; YouTube Help 6375112; Google Ads Help 13547298 and 16041697; LinkedIn Marketing Solutions Help a426534 and a424737; X Help, *Creative ad specifications*; Pinterest Business Help, *Product specs*; IAB Tech Lab *New Ad Portfolio: Fixed Size Ad Specifications* (2017); Bauer Media Outdoor (ex-Clear Channel UK) Adshel 6-sheet and Station Billboard specs; Global Outdoor artwork-spec library and its PDFs (48, 96, 6 and 4-sheet; D48 Spec A; T-side; streetliner; superside; rear; Ireland D48); JCDecaux UK digital technical specifications; JCDecaux Ireland Digi48, HD 48-sheet and Retail 6-sheet PDFs; Outsmart Large Format Digital Roadside Code; ISO 216:2007; UKi Media (Passenger Terminal World) and Passive House Plus mechanical data.
