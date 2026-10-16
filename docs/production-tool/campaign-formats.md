# Production Tool: one concept, every format

Written 2026-10-15 for Shrey. Record: [`features/campaign-formats.clan`](../../features/campaign-formats.clan)
(`scripts/feature show campaign-formats`). Status: **exploring**. Nothing is built until Shrey
approves the design.

Shrey's words: "Basically how ad agencies work: they will have one concept but they would like to
see how it looks on billboards, TV spots, reels etc. So how can they make one thing and see the
remaining rest of them with one click."

## In short

- Agencies don't redraw the idea for every channel. They adapt one approved **master**:
  re-lay stills for each size, cut the film down to shorter lengths, and keep the brand parts locked.
  A person reviews every format.
- No tool does it all in one click. They automate the rule-based part and keep a person reviewing
  the rest. Auto-crop cuts logos and heads. Generative fill leaves artefacts and goes soft at
  print size.
- We already have the plan (ui-behaviour 3.19), the format packs (67 draft formats) and the
  contract entities (`format_set`, `size`, ops `resize` and `cutdown`). The adaptation code itself
  is not built.
- **Recommended:** a method for each format. Crop when the crop keeps what matters, which is free.
  Extend when the gap is moderate. Regenerate when the shape is extreme. Re-edit the same takes for
  cutdowns. Type, logo, supers and the end card are layers laid out for each format, never painted
  into the pictures. Everything lands on one **Campaign board** for review.
- **Cost** of a first pass for a typical campaign (17 still formats and 7 video deliverables):
  about **$7** for previews, and about **$15** delivered with full-size OOH and print files.
  The cost shows only in History.
- **Paid tests:** about $8.30, capped at $10. They need Shrey's approval and never run on his
  local live stack.

## 1. Research

### How agencies adapt one idea

- **Master, versioning and adaptation.** Production studios adapt a "primary master" to each
  delivery spec. Hogarth (WPP) employs versioning artists to do exactly this
  ([Hogarth job ad](https://www.hogarth.com/job/versioning-afx-artist)). Creative-automation
  teams turn the master into modular templates in which the logo and colours are locked and the
  headline and image are variable
  ([Superside](https://superside.com/blog/automate-ad-creative-versioning)).
- **Cutdowns.**
  - UK TV spots are usually multiples of 10 s, and brands switch to a shorter version once viewers
    know the ad ([Thinkbox](https://thinkbox.tv/getting-on-tv/tv-advertising-basics/tv-ads-explained)).
  - A cutdown works when it keeps the original's most memorable scenes
    ([WARC](https://www.warc.com/content/article/tv-strategy-the-optimal-tv-ad-length/103325)).
  - In one case a 10 s cutdown almost doubled the 30 s ad's awareness index
    ([WARC](https://www.warc.com/newsandopinion/news/optimum-tv-ad-length-varies/en-gb/33975)).
  - Online, a 6 s ad is cited at about 60% of a 30 s ad's impact
    ([Mumbrella, citing Ehrenberg-Bass](https://mumbrella.com.au/?p=521950)).
- **6 s bumpers.**
  - A bumper should hold one idea, with about 2 s left for the end thought
    ([Think with Google](https://www.thinkwithgoogle.com/intl/en-gb/marketing-strategies/video/youtube-bumper-ads-best-practices-video-editing)).
  - Bumpers work better written natively than trimmed from a long ad
    ([Smart Insights](https://www.smartinsights.com/social-media-marketing/youtube-marketing/how-to-create-an-effective-youtube-bumper-ad-campaign/)).
  - Google has a "Trim video" tool that cuts long videos into bumpers
    ([Google Ads Help](https://support.google.com/google-ads/answer/12921529)).

### What changes per format, and what must not

| Stays the same | Changes |
|---|---|
| Key visual, line, logo, colours, fonts, brand rules | Composition and crop; type size and line length; where the logo sits; length (film) |

- **Out of home:** about 7 words, big sans-serif type and high contrast, because a poster is seen
  for 3 to 5 s ([Billboard Insider](https://billboardinsider.com/roy-park-jr-on-the-7-word-rule/),
  [Blip](https://www.blipbillboards.com/blog/5-rules-for-clear-billboard-messages/)).
  - Artwork is supplied at 1/10 scale (48-sheet) or 1/4 scale (6-sheet), at 300 to 450 dpi
    ([Bauer](https://www.bauermediaoutdoor.co.uk/resources/specifications/48-sheet-billboards-specification),
    [Global](https://global.com/wp-content/uploads/2020/10/48-Sheets-1.pdf)).
  - Specs differ by media owner and by site, so every OOH file says "Confirm with the media owner".
  - Digital 6-sheets play no sound and allow only subtle animation. Some councils ask for stills only
    ([Bauer Adshel Live](https://www.bauermediaoutdoor.co.uk/resources/specifications/adshel-live-specification)).
- **Social:**
  - **Safe zones.** Meta Reels and Stories keep text out of the top 14%, the bottom 35% and 6% at
    each side ([Meta Ads Guide](https://www.facebook.com/business/ads-guide/update/video/instagram-reels)).
    TikTok's zones move as its interface changes
    ([TikTok specs](https://ads.tiktok.com/help/article/video-ads-specifications)).
  - **Sound off.** Plan for viewers with no sound: captions add about 12% view time
    ([MarTech, Meta](https://martech.org/facebook-releases-new-video-ad-features-including-automated-captions)).
  - **Open strong.** Show the brand and the hook in the first 3 s. Google's ABCD is Attract, Brand,
    Connect, Direct
    ([Google](https://business.google.com/us/think/future-of-marketing/creative-best-practices-youtube-ads/)).
- **Display:** the IAB fixed sizes (300×250, 728×90, 160×600, 300×600, 320×50, 970×250), with
  file-weight caps
  ([IAB](https://www.iab.com/wp-content/uploads/2019/04/IABNewAdPortfolio_LW_FixedSizeSpec.pdf)).
- **Print:** sizes vary by publication. Use the publication's trim, bleed and type area. The draft
  pack has two example titles.
- Every size, safe area and source is in [format-packs.md](format-packs.md).

### What tools do, and what people say

| Tool | What "all sizes" means there | Liked / disliked |
|---|---|---|
| Adobe GenStudio for Performance Marketing ([Adobe](https://business.adobe.com/uk/products/genstudio/performance-marketing/creation.html)) | Resizes approved assets with Generative Expand and locked templates; reframes video automatically | Brand governance is liked. Users of Photoshop's Generative Expand report seams, a soft fill at about 2000 px and no batch mode ([Adobe community](https://community.adobe.com/t5/photoshop-ecosystem-discussions/generate-high-resolution-content-when-using-ai-generate-to-a-high-resolution-file-300dpi/m-p/15572618)) |
| Premiere Auto Reframe ([ProVideo Coalition](https://www.provideocoalition.com/auto-reframe-for-adobe-premiere-pro-will-make-social-media-reformats-easier/)) | Tracks the subject, with editable keyframes | Struggles when there are two subjects |
| Canva Copy & resize, Magic Switch ([Canva](https://www.canva.com/nl_nl/pro/magic-resize/)) | Re-lays the design into many sizes in one go | Re-layout beats cropping; text gets cramped |
| Pencil AI Auto-Resize ([Pencil](https://help.trypencil.com/en/articles/15076079-how-can-i-use-ai-auto-resize-to-resize-one-creative-into-every-format-i-need)) | Tick the formats and it generates each one | Still images only; beta |
| Celtra, Smartly ([Smartly](https://smartly.io/page/creative)) | Modular templates with a locked logo and fonts, plus approval steps | Enterprise price; output depends on the input |
| Google PMax auto-crop, Meta Advantage+ Expand image ([Search Engine Land](https://searchengineland.com/google-image-optimization-features-performance-max-455805), [AdsUploader](https://adsuploader.com/blog/advantage-plus-creative-enhancements)) | The platform crops or fills for you | Corner logos are "the first casualty" ([report](https://www.influencers-time.com/performance-max-auto-crop-video-ads-why-you-must-audit-them/)); logos, hands and product edges get distorted |
| Runway Edit Studio Expand Ratio ([Runway help](https://help.runwayml.com/hc/en-us/articles/52264567609363-Expanding-a-video-s-aspect-ratio-with-Edit-Studio)) | Aleph 2 makes the new edges of a clip | One shot at a time, no cuts, 2 to 30 s |

**What "one click" can mean.** In industry it means one action over a locked template, followed by
a person's review ([Ziflow](https://www.ziflow.com/blog/creative-automation)). That works reliably
for stills. Cutdowns and OOH still need a person's eye. So for us, one click starts every format at
once and gives back a board to review, where any tile can be fixed in one more click. It does not
mean "done without looking".

### What our models allow (capabilities/runway.json, model-research-2026-10-13.md)

| Need | Model on Runway | Ratios | Cost |
|---|---|---|---|
| Crop a still | none (relay, Pillow) | any | free |
| Extend a still | `ideogram_4_5` mask: pad the picture and fill the padding. **No real outpaint exists** | output follows the padded input | 8 cr medium, 25 cr high |
| Regenerate a still at a new shape | `gemini_image3_pro` with the master as reference | 30 ratios up to 4K (closest strip 3168:1344, about 2.36:1) | 20 cr (1K/2K), 40 cr (4K) |
| Extreme strips (4:1, 8:1) | `gemini_image3.1_flash` | 4096:1024, 2816:352, 8192:2048 … | 11 cr at 2K |
| Delivery size (OOH, print) | `magnific_precision_upscaler_v2` | 2-16× | 25 cr, **150 cr above 4096 px** |
| Reframe a clip | none (stitch, ffmpeg crop); **no model tracks a subject** | any | free |
| Outpaint a clip | `aleph2` `targetAspectRatio`, one shot | 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 21:9 (**no 4:5**) | 28 cr/s, 56 cr minimum |
| Remake a clip at a new shape | `veo3.1` / `_fast` | **16:9 and 9:16 only** | 10-40 cr/s |
| Remake at 4:5 or 1:1 | `seedance2_5` (18 ratios), `wan3` (15 ratios) | need **model-swap** first | 20-68 / 5-20 cr/s |
| Cutdown | none (stitch re-edits the same takes) | | free |

Two more facts shape the design:
- Logos or text in an input make Runway fail with `INTERNAL.BAD_OUTPUT.01`. So models get the
  **clean plate**, the picture with no type and no logo.
- Text must never go to a model (3.21's rule for end cards).

## 2. The design

### Approaches

| | How | Run cost (reference campaign) | Verdict |
|---|---|---|---|
| A. Crop only | Subject-aware crop of everything, type as layers | ~$8 (only delivery upscales) | Free and on-brand, but a 16:9 picture cropped to 9:16 keeps 32% of its width. It becomes the free first step inside D |
| B. Regenerate everything | A new picture or film for each shape, from the concept | ~$27, $50+ with second takes | Best composition, but the product and the people drift between channels. Video needs model-swap |
| C. Extend everything | Ideogram mask for stills, Aleph 2 for every shot | ~$27 | At 9:16, 68% of the frame is invented: seams, made-up product parts, soft fill at print size |
| **D. A method per format (chosen)** | Crop if it holds, extend if the gap is moderate, regenerate if the shape is extreme, layout for banners; re-edit for lengths; Aleph only on shots where the crop fails | **~$7 preview, ~$15 delivered** | It versions the way studios do and spends only where a crop fails. It keeps one picture across channels, and every choice can be changed per tile |

The reference campaign has a 16:9 key visual at 2K and a 30 s film of 10 shots. It needs:
- **17 still formats:** Reels/Stories, feed 4:5, feed 1:1 and LinkedIn; 48-, 96- and 6-sheet, D6
  and D48; an A4 page and a DPS; six IAB sizes.
- **7 video deliverables:** 30, 15 and 6 s at 16:9; 15 and 6 s at 9:16; 15 s at 4:5 and 1:1.

### The rules D follows

1. **Ask once what must stay.** Fin asks "What must stay in every size?" and you tap the subject and
   the product. The answer is stored on the set as protected boxes: one per still master, one per
   shot for video. The logo and type come from the Brand board as layers.
2. **Pick a method for each format** (the thresholds are set by the paid tests):
   - **Crop** if the crop keeps every protected box inside the format's safe area. Free.
   - **Extend** if the added area is at most about 40% of the target: an Ideogram 4.5 mask on the
     padded clean plate.
   - **Regenerate** if the gap is larger or the shape is extreme: Gemini 3 Pro with the master and
     the named references, at the nearest ratio, then cropped.
   - **Layout** for banners (728×90, 320×50, 160×600): a crop plus the type layers on a brand colour.
     Free.
3. **Type is a layer.** The line, logo, supers, legal and end card are laid out for each format from
   the Brand board (fonts, logo, clear space) and the format's safe area. They are rendered at export
   and can be edited per tile. On social, the spoken lines are burnt in as captions (sound off).
4. **Video lengths are re-edits.**
   - Dex proposes the beats ("Keep shots 1, 4, 6 and the end card") and you see the list before
     anything renders.
   - Edie cuts the 15 s and the 6 s from the same takes. Each cutdown is an edit list of windows,
     on connected-video's in/out shape.
   - Each length gets its end card from `card_layout(w, h)`. The mix is trimmed with a fade until
     audio-mix can rebuild it to length.
5. **Video shapes are crops first.**
   - Claude vision proposes a crop box per shot per aspect from three stills (in, middle, out), with
     a slow pan only when they differ.
   - Aleph 2 outpaints only the shots whose crop would cut a protected box. 4:5 is made at 3:4 and
     then cropped.
6. **Jude checks every format.** The checks never block:
   - the subject and logo sit inside the safe area, with the logo's clear space;
   - type is at least the format's minimum size;
   - an OOH line is 7 words or fewer;
   - the brand line is there;
   - every video ends on its end card;
   - social video carries supers and shows the brand in the first 3 s.
7. **Costs** are recorded per job and shown only in History. Crops are free and are not jobs.

### The one-click flow

```
 Key visual (16:9)  or  The ad (30 s)
        │ select → selection bar: [ Make all sizes ]
        ▼
 ┌ Make all sizes ──────────────────────────────┐
 │ Plan: (•) Campaign launch  ( ) Social ( ) OOH │
 │       ( ) Print ( ) Display ( ) Film ( ) Mine  │
 │ Film lengths: [30] → [15] [6]   + length      │
 └───────────────────────────────────────────────┘
        │ (first time) Fin: "What must stay in every size?"  → tap Maya, the bottle
        ▼
 Send tray · "What Fin will make" (no prices)
   ☑ Reels 9:16 · 1440×2560 ........ Extend
   ☑ Feed 4:5 · 1440×1800 .......... Crop
   ☑ 48-sheet · 6.1×3.0 m .......... Crop
   ☑ 6-sheet · 1.2×1.8 m ........... Regenerate
   ☑ 728×90 leaderboard ............ Layout
   ☑ Film 15 s 16:9 ................ Re-edit (Dex's beats)
   ☑ Film 15 s 9:16 ................ Reframe · 2 shots extended
   …                                  [ Send ]
        ▼
 Campaign board · "First Light · 24 formats"            [Safe areas S] [Export ▾]
 ┌ Film and online video ─────────────────────────────────────────────┐
 │ [30s 16:9 ▶] [15s 16:9 ▶] [6s 16:9 ▶] [15s 9:16 ▶] [15s 4:5 ▶] … │
 ├ Social ──────────────────────────────────────────────────────────┤
 │ [Reels ✓] [Feed 4:5 ✓] [1:1 ⚑ Jude] [LinkedIn ✓]                  │
 ├ Out of home ─────────────────────────────────────────────────────┤
 │ [48-sheet ✓🔒] [96-sheet ⟳ making] [6-sheet ✓] [D6 ✓] [D48 ✓]       │
 ├ Print ─── [A4 page ✓] [DPS ✓]                                      │
 ├ Display ─ [300×250] [728×90] [160×600] [300×600] [320×50] [970×250] │
 └────────────────────────────────────────────────────────────────────┘
   Tile: Redo · Change method · Adjust crop · Edit type · Fix in image editor · Lock
        ▼
 Export all → one zip at delivery size + manifest.json
   first-light_uk-48-sheet_7200x3600.png  "Confirm with the media owner"
 Master changes → "Master changed · 7 out of date" [Update sizes] (locked tiles stay)
```

## 3. Costs (from the catalogue, $0.01 per credit)

| Part | Method | Count | Credits | $ |
|---|---|---|---|---|
| Stills that crop | Crop | 6 | 0 | 0 |
| Stills that extend | Ideogram 4.5 medium | 6 | 48 | 0.48 |
| Stills that regenerate | Gemini 3 Pro 2K ×4, 4K ×1 | 5 | 120 | 1.20 |
| Banners | Layout | 6 | 0 | 0 |
| Cutdowns 15 s and 6 s | Re-edit | 2 lengths | 0 | 0 |
| Vertical, 4:5 and 1:1 video | Crop, plus Aleph 2 on about 2 shots × 3 s per aspect | 6 shots | 504 | 5.04 |
| Planning (protect ask, crop boxes, beats) | Claude | | | ~0.50 |
| **Preview pass** | | | | **~7.20** |
| Delivery upscales (48-, 96-, 6-sheet, A4, DPS) | Magnific, above 4096 px | 5 | 750 | 7.50 |
| **Delivered** | | | | **~14.70** |

Redoing 5 formats adds $1 to $3. For comparison: B costs about $27 and C about $27 per pass.

## 4. Phases

| Phase | What | Size | Spends |
|---|---|---|---|
| 0 | Paid tests CF-T1..T6 (below), person-run | S | ~$8.30 |
| 1 | Contract: protect boxes, plan, size status, lock, crop, layers, length and edit list, checks; new methods; relay `resize` and `cutdown` shapes; the `campaign-launch` pack; capability and cost-model entries | M | no |
| 2 | Campaign board and free crops: sheet, tray rows, ask, rule table, grid with lanes, overlays, status, Adjust crop, Lock, Update sizes, Export zip with manifest. Usable alone | L | no |
| 3 | Type as layers per format, Edit type, Jude's checks for each format | M | no |
| 4 | Paid stills: extend, regenerate, layout; Change method and Redo; Export at full size with upscales | L | yes |
| 5 | Cutdowns: Dex's beats, Edie's re-edit, an end card per length, the mix trimmed | L | no Runway |
| 6 | Video re-aspect: crop boxes per shot, pan, Adjust crop, Aleph 2 only where needed | L | yes |
| 7 | Optional: "Show in place" mock-ups; Seedance or WAN regeneration after model-swap | M | some |

The whole feature is XL, about 18 to 22 days for one engineer working with agents. It depends on:
- frame-aspect, for the crop maths;
- art-boards and board-autolayout, for the board and the tile placement;
- connected-video phase 1, for the stitch edit list;
- ad-end-card, for the card at any size;
- audio-mix, for a mix rebuilt to length (phase 5 works without it, using a fade);
- model-swap, for phase 7 only.

### Paid tests (approval needed; never run in CI or on the owner's local live relay)

| Test | What | Cost |
|---|---|---|
| CF-T1 | Ideogram 4.5 mask extend of a 16:9 key visual to 9:16, 2:3, 1:1, 2:1 and 4:1, at medium and at high | 5 × (8 + 25) cr = $1.65 |
| CF-T2 | Gemini 3 Pro regenerate with the master as reference at 768:1344, 832:1248 and 3168:1344 (2K), and 3392:5056 (4K); Gemini 3.1 Flash at 4096:1024 | 60 + 40 + 11 cr = $1.11 |
| CF-T3 | Aleph 2 `targetAspectRatio` on a 3 s product shot and a 3 s character shot, to 9:16 and 1:1. Also checks whether the audio is kept | 4 × 84 cr = $3.36 |
| CF-T4 | Magnific upscale of the best 2:1 still to 7200 × 3600 | 150 cr = $1.50 |
| CF-T5 | Claude crop boxes and the 15 s and 6 s beat plans for a 10-shot film | ~$0.30 (Bedrock) |
| CF-T6 | Veo 3.1 Fast, silent, 4 s at 9:16 from a CF-T2 vertical frame (regenerate against Aleph) | 40 cr = $0.40 |
| | **Total** | **$8.02 Runway + ~$0.30; cap $10** |

The results go in `docs/production-tool/campaign-formats-tests-<date>.md`. They set the extend
threshold and the default method for each format.

## 5. Questions for Shrey (each with a recommendation)

1. **Method.** A method per format, set by rule and changeable on each tile (D), or crop only first?
   *Recommend D, built so that phase 2 (crop only) works on its own.*
2. **Preview, then delivery.** Should Make all sizes make 2K previews, and run the large upscales
   (about $1.50 each) only on "Export at full size"? *Recommend yes. It halves the cost of a pass.*
3. **Campaign plan.** Add one mixed "Campaign launch" pack (the 17 stills and 7 films above), and let
   clients save their own mix? *Recommend yes.*
4. **"See it on a billboard."** In-place mock-ups for pitching: the poster on a roadside 48-sheet,
   the reel on a phone? *Recommend yes, as phase 7, using licensed mock-up photos with fixed corners
   rather than generated scenes, labelled "Mock-up".*
5. **Lengths.** From a 30 s master, make 15 s and 6 s by default, with 20 s and 10 s on request?
   *Recommend 15 s and 6 s; any length can be typed in.*
6. **Vertical video.** Crop per shot, with Aleph outpaint only where the crop fails, or remake the
   vertical natively on Veo 9:16 by default? *Recommend crop plus Aleph, with "Remake for vertical"
   as a method on the tile.*
7. **4:5 video.** Aleph has no 4:5. Is it acceptable to make it at 3:4 and crop (losing about 6% of
   the height)? *Recommend yes.*
8. **Copy per channel.** May Skye suggest a shorter line for OOH when the line runs over 7 words,
   as an ask only? *Recommend yes, never automatic.*
9. **Social captions.** Burn captions of the spoken lines into the 9:16, 4:5 and 1:1 versions by
   default, but not into the TV versions? *Recommend yes, editable on each tile.*
10. **Where it lives.** Show the existing Format set entity on the canvas as a Campaign board (a
    formats board of tiles) instead of 3.19's Format set node card? *Recommend yes, since boards are
    picture collections (board-autolayout BA2).*
11. **Paid tests.** Approve CF-T1..T6: about $8.30, capped at $10, run by Sai on his own stack?
    *Recommend approve.*
