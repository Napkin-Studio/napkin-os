# Products: how layers from AI images are offered today (2025-2026)

Sweep date: 2026-10-23. Angle: commercial products and their UX for turning a flat (AI) image into layers.

Method notes. The brief at `scratchpad/delayering/brief.md` did not exist when this agent ran (the directory was empty), so this sweep follows the angle text only. The shared web-search budget ran out two-thirds of the way through; the last third was done by opening URLs already found. `canva.com`, `helpx.adobe.com`, `help.weavy.ai`, `docs.midjourney.com`, Business Wire and PetaPixel all returned 403/404 to the fetcher, so Canva, Photoshop help, Weavy's Compositor and Midjourney's editor docs are covered from secondary sources and are marked as such.

## Short answer

Flat-image-to-layers went from research demo to shipped feature in twelve months. Canva (Magic Layers, public beta 10-11 March 2026), Luma (Layers, 29 July 2026), Magnific/Freepik (Auto Layers in Magnific One, 8 October 2026), OpenArt and Layer.ai (both wrapping ByteDance's Seedream 5.0 Pro Layerize), Playground (Extract Text, March 2026; Smart Layers, May 2026, thinly sourced) and a dozen single-purpose converters (IntoLayers, ImageToLayers, ImageToPSD, PixMind, RunDiffusion, Codia) all sell the same move: upload or generate, press one button, get objects, text and a background as separate layers. Adobe announced "Layered Image Editing" for Firefly Image Model 5 on 28 October 2025 and, as of its March, April and June 2026 posts, has not shipped it; MAX 2026 is 10-12 November 2026. Open weights exist: Alibaba's Qwen-Image-Layered (arXiv 17 December 2025, Apache 2.0), which Krea exposes as a node.

Two approaches are visible. Most products decompose after the fact (segmentation or a diffusion "layer decomposer", then inpaint the background). Luma (Uni-1) and Canva (Canva Design Model) claim their models generate as layers from the start, with decomposition as the fallback for uploads. Nobody documents amodal completion (whether a layer is whole behind an occluder); the standalone converters are the only ones that say plainly that the background behind an object is filled in, and IntoLayers says it is "a guess, not a recovery".

The differentiators are: live editable text (Canva, Luma, Ideogram "Layerize text", Playground "Extract Text"; everyone else returns raster text), per-layer prompt regeneration (Luma, OpenArt, Ideogram Studio, Photoroom, Codia), and export (PSD from Lovart, Layer.ai, RunDiffusion, IntoLayers, ImageToLayers, ImageToPSD, Seedream Layerize; PNG stack from OpenArt; flatten-to-PNG only from Luma; nothing portable from Canva). The complaints are consistent across every product: soft or pixelated edges, hair/glass/smoke, orphaned or missing shadows, font substitution, merged layers when objects overlap or share colours, non-deterministic grouping, 45-120 s latency on the standalone tools, credit burn, and in Canva's case a text-substitution bug that changed words.

## Findings

### A. Products that split a flat image into layers

**Canva Magic Layers** (public beta, announced 10-11 March 2026; Canva newsroom https://www.canva.com/newsroom/news/magic-layers/, not openable here, 403; details from AlternativeTo 13 Mar 2026 https://alternativeto.net/news/2026/3/canva-now-lets-you-convert-static-images-into-fully-editable-multi-layered-designs, Storyboard18 14 Mar 2026 https://www.storyboard18.com/amp/digital/how-canvas-magic-layers-turns-ai-images-into-fully-editable-designs-ws-l-92082.htm, computertech.co 16 Mar 2026 https://computertech.co/canva-magic-layers-review/).
- User does: select an image element (not a page background), Edit, Magic Studio, Magic Layers; or launch from the home screen and pick an upload. Single-page PNG/JPG only. (White Deer, 28 Jun 2026, https://whitedeer.com.au/t037/)
- Layers out: objects, icons, shapes, people, a background, and text restored as live Canva text boxes with fonts matched "as closely as possible". Layout preserved.
- Background filled behind objects: not documented anywhere I could open. One review lists "background artifacts where missing areas were invented", which implies fill. (White Deer)
- Regenerate with prompt: Canva's own Magic Edit exists, but Magic Layers itself is described as a decomposer. One tester notes partial regeneration "changes parts other than the ones I want to fix" (note.com, 25 May 2026, https://note.com/012yuta/n/ne1cb435999e8?hl=en).
- Export: no PSD or cross-tool layered export; layers stay in Canva (computertech.co).
- Plan: Free and Pro via Settings > Labs, US/UK/CA/AU; draws from the shared Canva AI credit pool. Canva's help page reportedly says it "works best with graphic designs, illustrations, and stylized visuals" and photos "may not separate as cleanly" (from search summary of https://www.canva.com/help/editable-magic-layers-variantb/, not opened; unverified).
- Approach: "Canva Design Model, a foundation model for generating editable visual content" (Storyboard18). Decomposition of existing flat images; it does not generate layered designs from scratch in this feature.
- 10 June 2026: Magic Layers available inside ChatGPT (Canva app) and Gemini (connector); Canva does the conversion and hosts the edit (Vaizle, https://insights.vaizle.com/canva-magic-layers-now-works-in-chatgpt-and-gemini/, citing Canva newsroom https://www.canva.com/newsroom/news/magic-layers-ai-assistants/, 403 here).
- Incident: 26-28 April 2026, Magic Layers replaced "Palestine" with "Ukraine" in user posters; Canva said it fixed it and added checks; no cause given (GIGAZINE 28 Apr 2026, https://gigazine.net/gsc_news/en/20260428-canva-apologizes-ai-replaces-palestine/).

**Canva Magic Grab / Grab Text** (older, 2023-2024). Help page 403; search summary: click an object or drag over several to move/resize it while the background stays; not available on images in frames or grids (https://www.canva.com/en_in/help/using-magic-grab/, unverified). Canva made Affinity free in late 2025; not verified in this sweep.

**Luma Layers** (live 29 July 2026; https://lumalabs.ai/news/introducing-layers; how-to dated 13 July 2026, https://lumalabs.ai/learning-center/articles/editing-with-layers; pricing https://lumalabs.ai/pricing).
- User does: right-click an image on the board, Extract Layers, choose 1K or 2K (2K costs double), optionally type which elements to separate ("let Luma determine the most useful layers, or tell it exactly which elements you need").
- Layers out: "every object, text element, and background becomes its own asset", each on transparent surroundings, in a named, ordered stack; background usually at the bottom.
- Background fill: not documented.
- Regenerate: select a layer, type an instruction, change applies only to that layer; multi-select (e.g. "a product and its shadow") edits in one pass; the original is hidden, not discarded, and grouped with the variation so you can switch.
- Text: edit content, font, size, colour, position; admins upload custom brand fonts.
- Panel conventions: click a layer in the composition or by name in the stack; drag to reorder; shift-click + G to group; eye icon to hide (hidden layers excluded from flatten); delete. Locking and hover-select not documented.
- Export: Flatten combines visible layers into one PNG at the highest layer resolution; individual layers can be dragged to the board and downloaded. PSD not mentioned.
- Price: Layers costs 75 / 105 / 175 credits per image at 1K / 2K / 4K; Uni-1 create/modify 30 credits. Plus $30/mo (10,000 credits), Pro $90, Ultra $300. At Plus rate that is about $0.23 (1K) to $0.53 (4K) per extraction (my arithmetic).
- Approach: Uni-1 "creates images as layers from the start" ("Native to Generation"); uploads are decomposed by "parsing regions and their relationships, not just clustering similar pixels" (vendor claim).

**Magnific One, Auto Layers** (8 October 2026; Unite.AI https://www.unite.ai/magnific-one-debuts-with-art-direction-decided-before-image-generation/; VentureBeat https://venturebeat.com/orchestration/magnific-one-launches-to-give-teams-an-image-generator-that-avoids-the-ai-look-and-automatically-upholds-their-brand-kit; official page https://www.magnific.com/one returned 403).
- Auto Layers "splits a generated image into editable layers"; work continues in Designer (vector control, "set exact type, colors and text on an existing image without regenerating it") or in Figma and Photoshop through plugins. Layer types and text handling are not described in the coverage.
- Price: credits per Final image 180 (High 2K), 250 (High 4K), 600 (Max 2K), 1,000 (Max 4K); individual annual plans Premium $14.50/mo, Premium+ $33.75/mo, Pro Starter $82.50/mo. Available on all paid plans.
- Context: Freepik rebranded as Magnific on 28 April 2026, $230M ARR, bootstrapped (TNW, https://thenextweb.com/news/freepik-rebrands-as-magnific). Pikaso/Mystic/Spaces now live under magnific.com; the old Freepik support article redirects to https://www.magnific.com/ai/docs/quickstart (403 here).

**Adobe Firefly "Layered Image Editing"** (announced 28 October 2025, status "in development"; https://news.adobe.com/news/2025/10/adobe-max-2025-firefly). TechCrunch the same day: Image Model 5 "treats different objects as layers" so you can edit them with prompts or resize/rotate (https://techcrunch.com/2025/10/28/adobe-firefly-image-5-brings-support-for-layers-will-let-creators-make-custom-models/). Not mentioned in Adobe's 10 March 2026 (https://blog.adobe.com/en/publish/2026/03/10/image-editing-just-got-smarter-with-ai-photoshop-firefly), 19 March 2026 (Image Model 5 GA, https://blog.adobe.com/en/publish/2026/03/19/adobe-firefly-expands-video-image-creation-with-new-ai-capabilities-custom-models), 9 April 2026 (Precision Flow, AI Markup; https://blog.adobe.com/en/publish/2026/04/09/new-image-editing-features-adobe-firefly-get-you-from-almost-there-to-exactly-right) or 18 June 2026 (creative agent; https://news.adobe.com/news/2026/06/adobe-unveils-major-expansion) posts. Adobe MAX 2026 is 10-12 November 2026, Miami Beach (https://blog.adobe.com/en/publish/2026/09/21/your-guide-to-the-ai-sessions-at-adobe-max-2026).

**Ideogram Studio** (replaces Canvas and Magic Fill; docs undated, https://docs.ideogram.ai/edit/studio).
- Canvas of layers (images or text). Canvas tools (AI edit, Extend, Regenerate, Remix, Reframe, Layerize text) run on the whole canvas and add a version; layer tools (Replace image, AI edit, Select area, Extend, Upscale, Remove background, Crop) act on one layer.
- "Layerize text" finds text in an image and converts it into editable text layers; works on any plan when signed in. There is no object-selection tool; Select area is a brush (paid).
- Export: file type and size; downloading a single layer saves its source file. Extend caps at 2048 px long side. Pricing page returned 404/503; search summary says Basic $7/mo annual with Magic Fill/Extend (unverified).

**Playground** (playground.com). Extract Text launched 8 March 2026, "turns flat text in templates into fully editable layers" (everydev profile, secondary, https://www.everydev.ai/developers/playground-inc). "Smart Layers" (May 2026) for editing individual objects and text appears only in a roundup from a search summary (low confidence). Pricing: Free 10 images/3 h; Pro $15/mo; Pro Plus $45/mo (fast.io review updated 25 Jun 2026, https://fast.io/resources/playground-ai-review-2026/).

**OpenArt Extract Layers** (feature page https://openart.ai/features/image-to-layers/; how-to dated 2 October 2026, https://openart.ai/blog/how-to-split-an-image-into-editable-layers/).
- Uses Seedream 5.0 Pro for every split; Whole Image or Select Area (freehand loop); max layers 2-16, "treats your number as a limit, so you may get fewer".
- Layers out: background, products, people, text, decorations, each a transparent PNG saved to the Asset Library; reorder cards, hide, regenerate a single layer. Text "comes out as a picture of the words". No PSD.
- Failure modes stated by the vendor: fuzzy/rough edges on low-quality inputs (upscale first); overlapping or similar-colour objects merge (lower the count or split a smaller area).

**Layer.ai Split into Layers** (https://layer.ai/features/split-into-layers) with **ByteDance Seedream 5.0 Pro Layerize** (https://layer.ai/models/bytedance-seedream-5-pro-layerize.md): "a base composite plus independently editable layers", up to 16, count adapts to the scene, model labels each layer, optional prompt guides boundaries, PSD export; priced 0.73 CU per layer. Full PSD import/export round-trip. No ByteDance primary page opened; medium confidence.

**RunDiffusion Image-to-Layers** (31 October 2025, updated 8 April 2026; https://www.rundiffusion.com/introducing-image-to-layers-a-rundiffusion-exclusive-workflow-with-psd-export). Auto-segmentation with exposed knobs (Points Per Side, Confidence Threshold, Stability Score Threshold, Minimum Object Size: the SAM parameter set) to a layered PSD. Background fill not stated.

**IntoLayers** (https://intolayers.com/, guides dated Sept 2026). The most explicit about mechanics: base layer "with separated elements removed and the gaps filled in"; "hidden areas are a guess, not a recovery"; one transparent PNG per subject, text block or graphic; layers auto-named, positions and z-order kept; PSD default with background as pixel layer and elements as smart objects; text is raster. Timing: about 45 s for 2 layers, median 82 s for 6 at 1K. Price: 10 credits for a 2-layer 1K run; 1.5K/2K and 3+ layers need a paid plan. Small elements are enlarged (median 2.17x). Says all text layers were character-for-character correct in 15 test runs (self-reported).

**ImageToLayers** (https://imagetolayers.com/): rebuilds background areas previously covered; "reconstructions are AI estimates"; PSD/ZIP on Creator ($10/mo annual, 12,000 credits/yr) and Studio ($30/mo annual); 60-120 s per image.

**ImageToPSD** (https://imagetopsd.com/): subjects, text, badges, backgrounds; box a region to extract up to 50 layers; fills hidden areas "including textures and shadows"; in-browser reorder before export; $4.90 for 200 credits (about 49 layers), files deleted after 1 h.

**PixMind** (14 August 2026, https://www.pixmind.io/posts/ai-image-to-editable-psd-layers): 2-16 layers or Auto, 1K/1.5K/2K; PSD keeps names, positions, order, visibility; text is a pixel layer; recovers no fonts, vector paths, smart objects or history; warns about overlapping edges, translucent materials, hair, glass, smoke, small text; layers "can merge (a person and a headline) or fragment one object"; Figma does not import PSD so a ZIP of PNGs is recommended.

**Codia Magic Layer** (https://codia.ai/ai-image-layer-editor, undated): product, text, background, decoration layer groups; edit in Codia Studio; text-to-editable-text is a separate tool. Luma's own comparison lists Codia as the free alternative to a feature Canva "reserves for Pro" (https://lumalabs.ai/news/canva-magic-layers-alternatives, 3 Aug 2026).

**Photoroom** (help 2 March 2026, https://help.photoroom.com/en/articles/10098172-make-images-appear-on-different-layers): import cuts the subject out, but Photoroom "sometimes places multiple parts of an image on a single layer"; the fix is manual (duplicate, crop, remove, realign). "Edit with AI" is prompt-based per image or per selected layer; search summary says it "works best with minor changes to foreground layers and cannot change the image beyond the existing layer boundary" (unverified at the article itself). Pricing: Pro 8,000 credits/mo, Edit with AI up to 400 generations on Pro (https://www.photoroom.com/pricing, prices not shown).

### B. Models underneath (for context; the models sweep covers depth)

- **Qwen-Image-Layered** (Alibaba Qwen; arXiv 17 Dec 2025, https://arxiv.org/abs/2512.15603; CVPR 2026): one RGB image to a variable number of RGBA layers; RGBA-VAE, VLD-MMDiT, multi-stage training, training data mined from PSD files; code and weights released, Apache 2.0; examples at 3 or 8 layers, any layer can be decomposed again; 640 px recommended "for this version" (model card mirror, https://huggingface.co/Runware/Qwen-Image-Layered/blob/main/README.md). Amodal completion not addressed. Exposed in **Krea Nodes** as "Qwen Image Layered: Decompose your image into semantic layers" (docs last updated 13 Apr 2026, https://www.krea.ai/docs/user-guide/features/nodes; Nodes need Pro, about $30/mo).
- **Seedream 5.0 Pro Layerize** (ByteDance): see Layer.ai above; also what OpenArt runs.
- **Canva Design Model** and **Luma Uni-1**: proprietary; both claim layer-native generation.
- **Adobe Firefly Image Model 5**: GA 19 Mar 2026; the layered editing it was meant to power has not shipped.

### C. Editors where "layers" means compositing, not decomposition

**Adobe Photoshop** (HelpX 403; from Adobe PR and community posts).
- Generative Fill creates a generative layer with a mask and variations (tutorial sources only; the HelpX page could not be opened). Partner models in Generative Fill: Google Gemini 2.5 Flash Image and FLUX.1 Kontext, GA 28 Oct 2025 (https://news.adobe.com/news/2025/10/adobe-max-2025-creative-cloud); Gemini 3.1 / Nano Banana 2 and Firefly Image 5 in v27.6, April 2026, with "Find distractions" in the Remove tool and a cloud/on-device choice (HelpX what's-new via search summary, unverified).
- Harmonize (place object, remove background, match colour/light/shadow) and Generative Upscale: beta 29 Jul 2025 (TechCrunch, https://techcrunch.com/2025/07/29/adobe-adds-new-ai-powered-image-editing-features-to-photoshop), GA 28 Oct 2025. The Remove tool was reworked to "focus on removing the object and filling the gap with the background" rather than reading the whole scene.
- v27.9.1 (4 Aug 2026): send selected layers to Firefly Boards (https://community.adobe.com/announcements-710/photoshop-v27-9-1-is-live-explore-ideas-faster-with-firefly-boards-smarter-ai-prompts-and-streamlined-editing-1634244). Creative agent (18 Jun 2026) can "organize layers" from a description.
- MAX 2025 Sneaks (30 Oct 2025, https://blog.adobe.com/en/publish/2025/10/30/adobe-max-2025-sneaks-where-ai-creativity-play-collide): Project New Depths edits "radiance fields" (3D photos) so objects can be placed in front of or behind existing ones (session page https://www.adobe.com/max/2025/sessions/project-new-depths-gs3-4.html; presenter Élie Michel); Project Turn Style rotates 2D objects as 3D; Project Light Touch relights; Project Surface Swap swaps materials; Project Trace Erase removes objects with their shadows and reflections; Project Clean Take is audio. None shipped as of this sweep.
- Firefly Boards: Rotate Object (2D to 3D), PDF export, bulk download (Oct 2025 PR).

**Midjourney web editor** (docs 403/404; AlternativeTo 18 Apr 2025, https://alternativeto.net/news/2025/4/midjourney-unveils-updated-image-editor-with-layers-and-smart-selection-for-all-tiers/; TitanXT 12 May 2025, https://www.titanxt.io/post/exploring-midjourneys-new-layer-feature-what-works-and-what-doesnt-yet). Layers = stack uploaded images onto a composition; Smart Select = AI mask from positive/negative points; Erase Background gives a transparent PNG of the erased areas (docs via search summary); Retexture restyles the whole composition keeping structure. Layers flatten after each submitted edit (secondary). Complaints: cannot rotate or flip layers, no harmonize, pasted-on look without Retexture, Smart Select misses small or low-contrast parts.

**Figma Weave** (Weavy acquired 30 Oct 2025, https://www.figma.com/blog/welcome-weavy-to-figma/). Node-based canvas; product page lists "layers, masking, color grading, compositing, inpainting, and relighting" as native (https://www.figma.com/solutions/figma-ai-tool-weave/); Compositor node treats images/video/audio as layers (help article 403; search summary). Config, 24 Jun 2026: 20+ Weave workflows run on a selected image inside Figma Design (style transfer, logo onto product shots, flat image to 3D), Professional plan and above, open beta; Figma-frame-as-node later (https://www.figma.com/blog/config-2026-recap/; Diginomica 3 Jul 2026, https://diginomica.com/config-2026-weave-layer-precision-design-workflows-figma). Pricing: Free 150 credits / 5 workflows; Starter $24; Professional $45; Max $100 (https://weave.figma.com/pricing). No decomposition feature found.

**Recraft** (V4 17 Feb 2026, https://www.recraft.ai/blog/introducing-recraft-v4-design-taste-meets-image-generation; V4.1 14 May 2026). Vector models output "actual SVG files with structured layers and clean geometry"; Vector Editor (9 Jul 2026) lets you double-click a shape to edit anchor points and recolour (https://www.recraft.ai/blog/vector-editor). Raster side: Select (Lasso/Brush/Area/Wand), Erase fills with AI, Scissors cuts to transparent, Modify Area inserts from a prompt (25 Apr 2025, https://www.recraft.ai/blog/editing-got-easier-with-a-new-more-intuitive-selection-flow); Remove background is one click to a transparent image but downscales large inputs (https://www.recraft.ai/docs/recraft-studio/image-editing/background-tools). No raster layer decomposition. API V4.1 raster $0.035, Vector $0.08, Pro Vector $0.30 per image (The Rundown, reviewed 29 Aug 2026, secondary).

**Lovart** (https://www.lovart.ai/docs/getting-started/how-lovart-works; https://www.lovart.ai/docs/export-your-assets/export-formats): infinite canvas, every element editable by tools or prompt, new edits appear as new assets; export PSD for "Multiple objects" selections (drag-select then batch export), PNG/JPEG/MP4/SVG/PPTX otherwise. An X post advertises "Multi-layer Export: keep every element editable" (not openable; date unverified). A third-party review says production work still needs a Photoshop/Illustrator pass (PixAI blog, 503 here).

**Krea**: real-time canvas, Nodes (Pro), Compositor node blends two layers with opacity, Qwen Image Layered node (above). **Leonardo** Canvas: brush masks, inpaint/outpaint, no layers (help article 5 Jul 2023, https://intercom.help/leonardo-ai/en/articles/8092594-canvas-2-0; nothing newer found). **Kittl**: vectorizer and text effects; users report "text handling bugs that can disrupt layering and resizing" (toolsforhumans, reviewed 24 Mar 2026, https://www.toolsforhumans.ai/ai-tools/kittl).

### D. Transparent output from the model vendors

- **OpenAI**: `background="transparent"` with PNG/WebP on GPT Image 1, 1.5, 2 (preview) and GPT Image 2.5 Flare/Sunburst; "a drawn checkerboard is not transparency"; check alpha at hair, glass, shadows; repeat the requirement in follow-up edits (https://developers.openai.com/api/docs/guides/image-prompting). gpt-image-1 shuts down 23 Oct 2026, gpt-image-1.5 on 1 Dec 2026. Preview announced 20 Aug 2026; users report opaque alpha of 252-254 instead of 255 and a thin grey halo in RGB beyond the alpha edge (https://community.openai.com/t/transparent-backgrounds-are-now-available-in-preview-for-gpt-image-2-in-the-api/1391541).
- **Google**: Nano Banana Pro (20 Nov 2025, https://blog.google/innovation-and-ai/products/nano-banana-pro/) does localized edits, up to 14 reference images, 2K/4K; the Gemini API image docs list `gemini-nano-banana-2.1`, `gemini-3.1-flash-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image`, document no alpha output, no mask input and no layers (https://ai.google.dev/gemini-api/docs/image-generation). Practitioners generate on #00FF00 and key it out (Schmid, 19 Jan 2026, https://www.philschmid.de/generate-stickers). Mixboard (public beta US, 23 Sep 2025, https://blog.google/technology/google-labs/mixboard/) edits boards by language with Nano Banana; no layers. Whisk's URL now redirects to flow.google.com (observed 23 Oct 2026).
- **Apple Image Playground**: iOS 26 added ChatGPT styles and "Any Style" (9 Jun 2025, https://www.apple.com/newsroom/2025/06/apple-intelligence-gets-even-more-powerful-with-new-capabilities-across-apple-devices/); nothing on layers or transparency.

### E. Named in the angle, nothing found

Picsart, Pixlr, Phot.ai and Lummi: no layer-separation feature surfaced in 2025-2026 sources (Pixlr has manual layers and PXD files). Pixelcut rebranded to Pixa in March 2026 with an "AI creative agent" (secondary); Clipdrop still runs under Jasper (secondary). Weavy's Compositor node details and Canva's help pages could not be opened.

## UX conventions that recur

- Entry is one action on an existing image: right-click > Extract Layers (Luma); Edit > Magic Studio > Magic Layers (Canva); an Auto Layers step after Final (Magnific One); a tool card with Whole Image / Select Area (OpenArt).
- An optional plain-language instruction for which elements to separate (Luma, Seedream Layerize prompt, Krea node prompt editing). Nobody requires it.
- Layer count is a maximum, 2-16 (OpenArt, PixMind, Seedream's 16 cap); the model may return fewer; Qwen is variable with 3/8 examples.
- Layers come named and labelled by the model (Seedream, IntoLayers, Luma) in a z-ordered stack with the background or a "base composite" at the bottom; eye icon to hide, drag to reorder, shift-click + G to group (Luma); cards to reorder (OpenArt).
- Locked background is not a documented convention; the base layer is just the bottom layer. Hover-to-highlight objects is only documented for Photoshop's Object Finder, which I could not open (unverified); Luma and Canva use click-to-select on the composition.
- "Edit this object" is a per-layer prompt field (Luma), a Regenerate button on the layer card (OpenArt), a layer-tools panel (Ideogram Studio) or "Edit with AI" on a selected layer (Photoroom). Luma keeps the original hidden and grouped with the variant.
- Text is either live text with a substituted font (Canva, Luma, Ideogram Layerize text, Playground Extract Text) or a raster "picture of the words" (OpenArt, IntoLayers, PixMind, ImageToPSD).
- Resolution tiers that double cost (Luma 1K/2K/4K; IntoLayers and PixMind 1K/1.5K/2K); credits shared with every other AI tool in the suite (Canva, Photoroom, Magnific).
- Export splits the market: flatten to PNG (Luma), PSD with smart objects (IntoLayers), PSD or ZIP of PNGs (ImageToLayers, PixMind, ImageToPSD), per-layer PNGs into an asset library (OpenArt), in-suite only (Canva).
- Disclosure of guesswork is becoming normal: "hidden areas are a guess, not a recovery" (IntoLayers); "AI estimates rather than recovered original pixels" (ImageToLayers); "check for holes, fringes, and duplicated textures" (PixMind).

## Complaints users and reviewers make

- Edges: soft, blurry or pixelated cutouts, worse on hair, glass, smoke, translucency and heavy shadow overlap; "doesn't approach Photoshop's precision masking" (computertech.co, White Deer, note.com on Canva; OpenArt and PixMind on their own tools). Zoomed-in Canva parts are noticeably blurrier than Photoshop cutouts and unfit for print (note.com).
- Shadows: missing under moved objects, or left behind as orphan shadows and empty patches (White Deer).
- Grouping: overlapping or similar-colour objects merge into one layer; one object fragments across layers; the same image gives different groupings on a second run (computertech.co, OpenArt, PixMind). Photoroom puts several objects on one layer and offers only a manual split.
- Text: fonts substituted with the nearest available; handwritten and logo text lose their look; effects (shadow, 3D) flatten (note.com, computertech.co, White Deer). Canva's model changed words outright in April 2026.
- Background: invented content where elements were removed; transparent PNG inputs come back with a black background (White Deer).
- Speed: standalone converters take 45-120 s at 1K; Canva estimated 8-15 s (computertech.co, secondhand). Full-resolution export is desktop-only for RunDiffusion.
- Credits: two Canva runs used 50% of a monthly AI allowance (note.com); Magic Layers shares the pool with every other premium tool.
- Lock-in: no PSD or editable export from Canva; Luma flattens to PNG.
- Compositing editors: Photoshop Generative Fill leaves a halo that survives flattening (Adobe Community, 2 Jul 2026, https://community.adobe.com/questions-712/generative-fill-is-creating-a-halo-that-is-impossible-to-remove-1630427); Midjourney layers cannot be rotated or flipped and lack harmonize; GPT-Image-2 transparent PNGs carry 252-254 alpha and grey fringes.

## What this means for Napkin

- The baseline is now fixed by Canva and Luma: one action, named layers in a z-stack, background separated, text restored as live text, per-layer prompt edits, and a credit price around $0.20-0.50 per extraction at 1-2K. Shipping less than that in 2026 will read as behind.
- The open gap is portability and honesty. Canva keeps layers inside Canva; Luma exports a flattened PNG; only the small converters give PSD plus a PNG stack and say which pixels are guessed. An agency tool that exports PSD/Figma-ready layers and marks reconstructed regions has a position no large vendor occupies.
- Text is both the most valued output and the most dangerous. Every positive Canva review is about retyping headlines; the one incident that made the news was a word substitution. Napkin should OCR, re-verify the recovered string against the source pixels, show a diff, and never let the model retype silently.
- Build-or-buy is real: Qwen-Image-Layered is Apache 2.0 and already runs as a Krea node; Seedream 5.0 Pro Layerize is sold per layer through Layer.ai/OpenArt-style wrappers at roughly 0.7 units a layer. The proprietary "native layers" claims (Luma, Canva) are not something Napkin can license.
- Plan for latency and QA, not a click. Decomposition runs 45-120 s on the standalone tools; the recomposed preview, per-layer regenerate, and a check for holes, fringes and duplicated textures are the UI, not extras.
- Shadows and edges decide perceived quality. Luma's multi-select of "a product and its shadow" and Adobe's Trace Erase (shadow and reflection aware) point to treating shadows as their own layer; hair, glass and smoke should be flagged as low-confidence layers rather than silently cut.
- Transparent asset generation from the big models is uneven: OpenAI gives alpha (preview, with a 252-254 alpha quirk), Google gives none. Any pipeline needs an alpha-normalise and de-fringe step regardless of source.
- Watch 10-12 November 2026: if Adobe ships Layered Image Editing at MAX, Photoshop becomes the default destination for layered AI images, and PSD fidelity matters more, not less.

## Open questions

- Does Canva Magic Layers inpaint the background behind separated objects, and what does its help page say about photos vs graphics? (canva.com unreachable here.)
- Does Luma Layers fill behind objects, and will it export PSD? Neither is documented.
- Do Seedream 5.0 Pro Layerize and Qwen-Image-Layered produce whole (amodal) layers behind occluders, or only the visible fragment? No source states it either way.
- What layer types and text handling does Magnific One's Auto Layers actually return? The launch coverage does not say.
- Is Playground's "Smart Layers" (May 2026) real and what does it do? Only one roundup mentions it.
- Does Photoshop's Object Finder hover-highlight still define the hover-to-select convention, and has Adobe moved any of the MAX 2025 sneaks (Turn Style, Trace Erase, New Depths) into Photoshop before MAX 2026?
- How do Canva and Luma price a failed or partial extraction? No refund or retry policy was found for either.
