# Campaign formats: paid tests, 2026-10-16

Run by Claude for the owner (CF11, "you run the tests"), on Runway with the owner's key, outside the app.
634 credits ($6.34) in all, under the $10 cap. Outputs: `~/Videos/napkin-tests/campaign/` on the owner's machine.
Script: `cf_tests.py` (bodies checked against Runway's OpenAPI, 2024-11-06).

**Inputs.** Master still: a 1365×768 frame from the owner's test project. By mistake this was the fantasy
frame (a girl with a bowl in stone ruins, a blue portal and a bronze seal), not the sunlit-kitchen frame the
prompts described. Every model followed the picture and ignored the kitchen words, which is itself a
finding (below). Clip: a 3 s cut of a 4 s Veo 3.1 clip of a baby in a high chair, 1280×720, with no sound.

| Test | What ran | Result |
|---|---|---|
| CF-T1 | Ideogram 4.5 mask extend of the 16:9 master to 9:16, 2:3, 1:1, 2:1 and 4:1, at `medium` and `high`. The master sits at its own pixels on a canvas of the target shape, the rest is a blurred stretch, and the mask is black there (16 px overlap). | **`high` filled every shape well**, continuing the ruins, stones and light convincingly, up to 4:1 (3072×768) and 9:16 (1365×2427). **`medium` left the blurred padding unfilled on 2:3, 1:1 and 4:1** (3 of 5). Output keeps the canvas size. |
| CF-T2 | Gemini 3 Pro regenerate with the master as a reference at 768:1344, 832:1248, 3168:1344 and 3392:5056 (4K); Gemini 3.1 Flash at 4096:1024 | **Pro recomposes cleanly at every shape** (same character, bowl, portal, seal and light; nothing important cut off). It returns sizes a little off the asked ratio (768:1344 gave 768×1376; 832:1248 gave 848×1264), so a crop to the exact size is needed. **Flash at 4:1 was poor**: a smeared double of the bowl and the hair. |
| CF-T3 | Aleph 2 `targetAspectRatio` 9:16 and 1:1 on the 3 s baby clip (no product clip existed, so the product half was not run) | **Both outpaint naturally**: the kitchen continues up and down (9:16) and to the sides (1:1), and the baby is untouched. The 9:16 output is only **612×1088**, so a delivery size needs an upscale. Audio retention could not be tested: the source had no sound. |
| CF-T4 | Magnific precision upscaler v2, ×4, on the 2:1 high extend (1536×768 → 6144×3072) | Clean, with some real detail added and no halos. A 48-sheet needs ×4 on a 2K preview, or ×8. |
| CF-T5 | Claude crop boxes and beat plans | Not run: no Runway spend; to check when phase 6 is built. |
| CF-T6 | Veo 3.1 Fast, silent, 4 s at 720:1280 from the CF-T2 9:16 regenerate | **Good**: the same character, natural motion, 720×1280. A sound "Remake for vertical" route. |

## What this sets for phase 4 onward
1. **Extend at `high` only** (25 cr, $0.25 a still). `medium` (8 cr) fails too often to offer.
2. **Extend reaches every still shape tested, up to 4:1 and 9:16.** There is no need for an extend threshold
   below that: use extend whenever the master must stay exactly as made, with the crop first when the
   protected area already fits.
3. **Regenerate on Gemini 3 Pro**, never Flash, when the subject should fill the new shape (e.g. a 9:16 hero
   where an extend leaves the subject small), then crop to the exact size.
4. **The picture dominates the words**: neither method followed "sunlit kitchen" against a ruins master. The
   method prompt should describe only continuation ("continue the scene beyond its edges, keep everything
   inside exactly"), never the scene.
5. **Video re-aspect: Aleph 2 works**, but upscale its 9:16 (612×1088) for delivery. **Veo from a vertical
   regenerate frame** is the "Remake for vertical" route; with characters, use the reference-capable models
   (Kling O3, Hailuo 3, WAN 3; feat/runway-video-models).
6. **Delivery upscales**: Magnific ×4 is clean; plan ×8 for the largest print sizes.
