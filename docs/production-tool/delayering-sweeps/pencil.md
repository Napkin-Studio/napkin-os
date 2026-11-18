> Update 2026-10-23, after this sweep: the owner's link is a trypencil (Pencil AI, Brandtech) LinkedIn post of 2026-10-21, "Delayering is now a thing! One image. Every layer editable.", which says the feature converts any image into separate editable layers for typography, design elements, subjects and backgrounds and is powered by ByteDance's Seedream 5. The sweep's conclusion that no public Pencil source existed was true of docs and changelogs at the time; the post is the source. See the research doc, section 2.

# Pencil "delayering" and its direct peers

Sweep date: 2026-10-23. Angle: what Pencil shipped as "delayering" (an AI-generated image split into selectable, editable layers), which Pencil it was, and the closest peers.

Note on inputs: the brief at `scratchpad/delayering/brief.md` did not exist when this agent ran (the scratchpad was empty after the workflow restart). This sweep follows the angle text alone. Web search budget for the session ran out near the end; every fact below still carries a URL that was opened or a search snippet marked as such.

## Short answer

No public source, as of 2026-10-23, shows any product called Pencil shipping a feature named "delayering". Three Pencils exist: **pen.dev** (formerly pencil.dev, Tom Krcha's agentic design canvas), **trypencil.com** (Brandtech's Pencil, ad-creative generation) and "Pencil Studio" (no evidence of such a product). pen.dev's own docs describe only "Remove background", "Vectorize image" (which puts editable vector layers in a frame beside the original) and agent-driven background replacement; its pricing lists image and SVG generation quotas, not layer splitting. trypencil's public material describes layer-aware editing of PSD and Figma files and the Scribble agent (28 Sept 2026), not splitting a flat image. The only vendor that uses the word "delayer" for this operation is **Bria** (its `image_to_psd` route is titled "Delayer Image"). Either the "delayering" feature is unannounced, very recent and unindexed, or the term is internal to our brief.

The capability itself is real and crowded. Shipped, dated and verified at primary sources: **Lovart Edit Elements** (10 Nov 2025), **Qwen-Image-Layered** (open weights, 19 Dec 2025), **Canva Magic Layers** (11 Mar 2026, public beta), **ByteDance Seedream 5.0 Pro Layer Separation** (8 Jul 2026; API endpoint "Layerize" through resellers from mid-Aug 2026) and **Luma Layers** (29 Jul 2026, generates as layers natively with Uni-1). **Adobe** announced "Layered Image Editing (in development)" on 28 Oct 2025 and has not announced it shipping. Recraft, Freepik, Kittl, Figma and Krea show no first-party feature of this kind in anything found.

## Findings

### 1. Which Pencil

**pen.dev (formerly pencil.dev)**
- pencil.dev announced 30 Sept 2025 by Tom Krcha as "an MCP driven canvas built around open design files that live directly in your codebase". https://x.com/tomkrcha/status/1973033972654559476 (2025-09-30, date from post id)
- Rebranded to pen.dev and relaunched as "an agentic canvas ... Import any website or webapp to the canvas, iterate, and push back to code." https://x.com/tomkrcha/status/2100570466692071493 (2026-09-17, date from post id)
- "Code on Canvas" launched 15 Apr 2026 (agents build custom tools and interactive components on the canvas). https://x.com/tomkrcha/status/2044433115985457392 (2026-04-15)
- Image handling in the docs: "PNG and JPEG files become image layers", "SVG files become editable canvas layers"; the built-in browser and Chrome extension import web pages "as editable layers"; "Imported layers do not retain the page's JavaScript interactions." https://docs.pen.dev/core-concepts/import-and-export (fetched 2026-10-23)
- Image editing in the docs: "Remove background replaces the image fill with a transparent cutout." "Vectorize image creates editable vector layers in a separate frame beside the design and leaves the original image in place. Select one layer at a time." You can also ask an agent to replace an image's background. Both need sign-in and internet. https://docs.pen.dev/core-concepts/drawing-and-editing (fetched 2026-10-23)
- Pricing (fetched 2026-10-23): Free $0, 25 image and SVG generations/month, 1 agent; Pro $16/user/month, 350 generations, 3 agents in parallel; Ultra $48/user/month, 750 generations, 6 agents, shared usage pool; Enterprise custom. No layer-splitting feature named. https://pen.dev/pricing
- The homepage, FAQ, downloads page and docs index mention no layer splitting, no "delayering", and no changelog (pen.dev/changelog returns 404). https://pen.dev, https://pen.dev/faq, https://pen.dev/downloads, https://docs.pen.dev (all fetched 2026-10-23)
- A third-party review (last reviewed 2026-08-29) lists no image-splitting capability and notes Qwen Image Layered only as a "similar tool". https://www.therundown.ai/tools/pencil

**trypencil.com (Pencil by Brandtech)**
- Scribble, "a new agent specifically built for marketers", launched 28 Sept 2026; press release mentions resizing, remixing video, versioning, brand guidelines. No layers, no delayering. https://trypencil.com/blog/articles/pencil-launches-scribble-to-orchestrate-ai-for-marketers (2026-09-28)
- Help centre says Scribble "reads the layers, so resizes and edits keep your copy, logos and products intact" and offers PSD workflows from layered Photoshop files; the Figma guide says a flattened import leaves one layer. (Search snippets of help.trypencil.com and trypencil.com/blog/articles/figma-integration, 2026; not opened directly, so: unverified at primary source.)
- Homepage lists generate_images / generate_videos workflow nodes, Canvas, model integrations (OpenAI, Google, Adobe, Runway, Stability AI, Topaz); release notes page is an iframe that did not load. https://www.trypencil.com, https://trypencil.com/resources/release-notes (fetched 2026-10-23)

**"Pencil Studio"**: no product by this name found in any search.

**Who does say "delayer"**: Bria's Image Editing API has a route titled "Delayer Image" (`POST /{visual_id}/image_to_psd`) that "turns any image into a layered PSD, with a background layer where identified objects are removed, a foreground layer without background, and a layer per object"; it needs the `/register` route first and is slated to be replaced by an isolated version. https://docs.bria.ai/image-editing/v1-endpoints/image-to-psd (search snippet 2026; the fetched page redirected to a general API index and the OpenAPI bundle did not contain the route, so: partially unverified). Bria also publishes an "ad-delayer" agent skill (last commit 2026-10-14) that returns six assets: background, product shot, logo, headline, body copy, CTA, each with position, size and typography. https://skills.suedeai.ai/directory/bria-ai/bria-skill/ad-delayer/ (fetched 2026-10-23)

### 2. Canva Magic Layers

- Announced 11 Mar 2026 (press release via Business Wire, 403 on fetch; reported 12-14 Mar 2026). Public beta in US, UK, Canada, Australia; "currently supports single-page PNG and JPG files". Powered by the "Canva Design Model", Canva's proprietary foundation model. Text "restored as live, editable text boxes"; icons, shapes and background elements become separate movable objects; users "can change backgrounds, colours, fonts, and layouts without generating a new image". Cameron Adams (co-founder, CPO): "There's been an explosion of AI-generated content that has, until now, been a dead end." https://ecommercenews.com.au/story/canva-unveils-magic-layers-to-turn-flat-images-editable (2026-03-12), https://storyboard18.com/digital/how-canvas-magic-layers-turns-ai-images-into-fully-editable-designs-92082.html (2026-03-14), https://martechvibe.com/?p=28860 (2026-03-13)
- Canva help centre (search snippet, page 403 on fetch): "works with PNG files (single-page only) and JPG files (single-page only)"; longest edge over 5000px not supported; "works best with graphic designs, illustrations, and stylised visuals", photo-realistic images "may not separate as cleanly". https://www.canva.com/help/editable-magic-layers/ (2026; unverified at primary)
- User flow (third-party tutorial, 2026-03-12, updated 2026-04-25): Magic Layers icon on the Canva homepage or under image editing in the editor; choose/upload image; wait for processing (no time given); click an element, Position, Layers tab. Quality: simple flat graphics separate "fairly cleanly"; a complex overlapping title image showed pixelation and elements not separating. https://brendacadman.com/how-to-use-magic-layers-in-canva/
- Canva's own X promotion 27 Jul 2026: "Split one image into editable elements, so you can move, remove, tweak, or completely reimagine every part." https://x.com/canva/status/2081717255616843923 (2026-07-27, date from post id)
- Plan: not stated by Canva in anything opened. Third parties say it is a premium feature drawing on the monthly AI allowance / Pro, Teams, Education, Nonprofit. Unverified.
- Fill-behind: not stated by Canva. Approach: stated as the Canva Design Model; no technical detail published.

### 3. Lovart Edit Elements and Editable Text Layers

- Edit Elements launched 10 Nov 2025. Separates text, subjects and backgrounds; text content, font, colour and layout editable; processing "a few dozen seconds, during which the AI recalculates and regenerates the image"; the AI "fills in backgrounds"; cost 5 points per use, free accounts get 100 points/day. Observed limits: a cup's shadow disappeared, text in an unavailable font overran, a crown above a figure in a complex banner was not separated. https://en.kocpc.com.tw/?p=14112 (published 2025-11-12, updated 2026-08-04; secondary)
- Lovart docs: "Select the element on the Canvas. Click Edit Elements in the top bar. Move, resize, or rotate the separated parts. Change the font, size, and content of text elements. Export multiple layers as PSD, or select several layers, flatten them, and export as an image." "Works best on images with clear subjects, text, and backgrounds." https://www.lovart.ai/docs/edit-your-design/advanced-ai-editing (fetched 2026-10-23)
- Lovart blog (2026-05-15) calls it "one-click semantic layer decomposition", not "magical perfect masks every time"; hard cases: hair, fur, smoke, glass, chrome, crowds, reflections, contact shadows; advises keeping headline text out of generated pixels. https://www.lovart.ai/blog/edit-elements-layered-editing-ai-deep-dive
- Editable Text Layers (May 2026 update): "Lovart now separates text-raster output into a layered format (background image + positioned text layers) behind the scenes"; "Pro unlocks Batch Export, Editable Text Layers, and Brand Kit 2.0." https://www.lovart.ai/fr/blog/lovart-product-update-may-2026 (May 2026; byline dates on the page are inconsistent)
- Approach: not stated; the observed "regenerates the image" and "fills in backgrounds" is consistent with segmentation plus inpainting or a layered-generation model.

### 4. ByteDance Seedream 5.0 Pro Layer Separation ("Layerize")

- Seedream 5.0 Pro introduced 8 Jul 2026. "Through text descriptions, it can separate an image into independent layers, outputting editable design assets." Demo: a poster split into more than 10 layers (text, parrot subject, background, decorations); "background areas that the main subject covered are inpainted and restored"; layers keep transparency, can be dragged or scaled; the subject can be swapped. No technical explanation. https://seed.bytedance.com/en/blog/beyond-generation-it-understands-design-introducing-seedream-5-0-pro (2026-07-08)
- BytePlus on X, 13 Aug 2026: "Introducing Layer Separation for Seedream 5.0 Pro. Turn a generated image into independent, editable layers. Move, resize, recolor, replace or remove individual elements while keeping the rest of the com[position]". https://x.com/BytePlusGlobal/status/2087776914283045244 (2026-08-13, date from post id)
- API spec (reseller docs, EvoLink; BytePlus's own page returned only a nav index): model `doubao-seedream-5.0-pro-layerize`; exactly one PNG/JPEG input, 512x512 to 6000x6000, 30 MB; optional prompt, natural language or `<bbox>` tags in 0-1000 normalised coordinates; output a base image (z_index 0) plus layers (z_index 1+), each PNG with alpha, total 1-17 images; per-layer `bounding_box`, `name`, `description`; about 120 s per request; links valid 24 h; if any layer fails the whole request fails and is refunded. https://evolink.ai/docs/en/api-manual/image-series/seedream/seedream-5.0-pro-layerize-image-generate (fetched 2026-10-23)
- Pricing (EvoLink blog, 2026-08-15, quoting BytePlus list): input image $0.003; output image $0.0225 (at or under 2,610,000 px) or $0.045 (above); EvoLink 20% below. Billing is per output image, so layer count drives cost. "the area underneath is reconstructed, not left as a hole". https://evolink.ai/blog/seedream-5-0-pro-layerize-release
- Atlas Cloud: $0.018 per image; "regions of the background hidden behind extracted subjects are seamlessly inpainted". https://www.atlascloud.ai/models/bytedance/seedream-v5.0-pro/layer-decomposition (fetched 2026-10-23)
- Layer.ai hosts the same model as `bytedance-seedream-5-pro-layerize` ("base composite plus up to 16 independently editable layers"). https://www.layer.ai/docs/models/bytedance-seedream-5-pro-layerize (fetched 2026-10-23)
- Several thin wrappers (OpenArt "Extract Layers", AIReiter, imagetolayers-style sites) state they run on Seedream 5.0 Pro.

### 5. Qwen-Image-Layered (open weights)

- Paper arXiv:2512.15603 submitted 17 Dec 2025; weights released 19 Dec 2025; Hugging Face demo 22 Dec 2025; Apache-2.0. "decomposes a single RGB image into multiple semantically disentangled RGBA layers". Architecture: RGBA-VAE (shared latent for RGB and RGBA), VLD-MMDiT (variable number of layers), multi-stage training from a pretrained image model; training data extracted from PSD files. https://arxiv.org/abs/2512.15603, https://github.com/QwenLM/Qwen-Image-Layered (fetched 2026-10-23)
- Layer count is a parameter (examples 3, 4, 8; HF demo up to 10); any layer can be decomposed again ("infinite decomposition"). Gradio app exports PPTX, ZIP and PSD. Prompt describes the whole image "including occluded parts" and does not control individual layers. "The released weights are specifically fine-tuned for the image-to-multi-RGBA decomposition task"; text-to-layers is weak. Occlusion completion is not stated explicitly in the README or docs. https://docs.qwenlm.ai/qwen-image-layered/index.html (2025-12-19)
- Product Hunt 22 Dec 2025: #4 of the day, 267 upvotes; a top comment calls the model "fairly large". https://hunted.space/dashboard/qwen3/launches/qwen-image-layered
- Many standalone "image to layers" sites (image-layer.com, imagelayerseparator.com, etc.) state they run on Qwen-Image-Layered; one caps free output at 4 layers. (Search snippets; secondary.)

### 6. Luma AI Layers (generate as layers)

- Published 29 Jul 2026. Powered by Uni-1. "Generates images as independent, editable layers, and decomposes uploaded images into layers." "every object, text element, and background becomes its own asset"; text is "not baked into pixels", live text with font, colour and brand fonts; regenerate one object, swap a product, restyle a background, change Z-order, extract any layer on transparency, upscale a layer to 2K; "Untouched layers aren't passed back through the model". Available in Luma Agents (lumalabs.ai/app). "Uni-1 generates layers from the first pixel, so layering is part of how the model understands a scene rather than a post-processing step." https://lumalabs.ai/news/introducing-layers (2026-07-29)
- Pricing page: Layers cost 75 credits (1K), 105 (2K), 175 (4K) per image; Uni-1 image 30 credits; Plus $30/mo 10,000 credits, Pro $90/mo 40,000, Ultra $300/mo 150,000. https://lumalabs.ai/pricing (fetched 2026-10-23)
- Luma's comparison piece (2026-08-03) names Codia AI Magic Layer (free), ImageToLayers.com (3-10 layers, PSD/ZIP, "AI background completion"), Photoshop, ON1, Luminar as alternatives to Canva and implies Canva's is Pro-gated. https://lumalabs.ai/news/canva-magic-layers-alternatives

### 7. Adobe

- Adobe MAX, 28 Oct 2025: Firefly Image Model 5 in public beta, native 4MP; "Layered Image Editing (in development)" promising "precise, context-aware compositing that keeps every change perfectly coherent". https://news.adobe.com/news/2025/10/adobe-max-2025-firefly (2025-10-28)
- TechCrunch same day: the model "treats different objects as layers and allows you to edit them using prompts", with resize and rotate. https://techcrunch.com/2025/10/28/adobe-firefly-image-5-brings-support-for-layers-will-let-creators-make-custom-models/
- 19 Mar 2026: Image Model 5 "now generally available"; no mention of Layered Image Editing. https://blog.adobe.com/en/publish/2026/03/19/adobe-firefly-expands-video-image-creation-with-new-ai-capabilities-custom-models
- 27 Aug 2026 Photoshop post: "Every Prompt to Edit result becomes a generative layer in your layer stack"; Firefly Image 5 still labelled "(Preview)" in Photoshop; no object decomposition feature. https://blog.adobe.com/en/publish/2026/08/27/new-photoshop-innovations-bring-you-more-choice-control-at-every-stage-of-your-creative-process
- Historical: "Project Stardust" sneak at MAX 2023 treated photo elements as layers; a Sept 2025 Photoshop community request for automatic decomposition into layers got "great feature request" from Adobe staff. (Search snippets; secondary.)

### 8. Peers with no first-party feature found

- **Recraft**: 2025 blog posts on selection flow and layer alignment; V4 (Feb 2026) and V4.1 (May 2026) model releases; nothing on splitting images into layers. (Search snippets; secondary.)
- **Figma**: Config 2026 (23-25 Jun) shipped code layers, Motion, shaders, custom AI skills; nothing on image decomposition. https://www.figma.com/blog/config-2026-recap/ (search snippet)
- **Krea**: only a community node app "Image Breakdown" on krea.ai; no first-party feature. https://www.krea.ai/nodes/app/versatileprestigiouschimpanzee/image-breakdown (search snippet)
- **Freepik**, **Kittl**: no evidence of such a feature; Kittl has a Vectorizer (raster to vector paths), Freepik's library sells layered PSDs. (Search snippets.)
- **RunDiffusion "Image-to-Layers"** (31 Oct 2025, updated 8 Apr 2026): auto-segmentation (SAM-style controls: points per side, confidence, stability score, min object size), each element to its own layer, PSD export; no inpainting mentioned. https://www.rundiffusion.com/introducing-image-to-layers-a-rundiffusion-exclusive-workflow-with-psd-export
- **Layer.ai "Split into Layers"**: characters, props, foreground, background on separate layers; PSD import/export; model not named on the feature page (its model docs host Seedream Layerize). https://layer.ai/features/split-into-layers (fetched 2026-10-23)

## Comparison table

| Product | Date | Input | Output layers | Fill-behind | Editing after | Approach (stated / inferred) | Price |
|---|---|---|---|---|---|---|---|
| Pencil (pen.dev) | n/a | PNG/JPEG become image layers; Vectorize image | Vector layers in a side frame; transparent cutout (remove bg) | n/a | Vector editing; agent bg replace | Not a raster delayering feature | Free 25 gen/mo; Pro $16; Ultra $48 |
| Pencil (trypencil) | Scribble 2026-09-28 | Layered PSD / Figma | Keeps existing layers | n/a | Resize, swap, version | Layer-aware editing of layered sources, not splitting | Enterprise, not published |
| Bria "Delayer Image" | API (undated; skill updated 2026-10-14) | Any image (registered) | Background with objects removed, foreground cutout, one per object; ad skill: bg, product, logo, headline, body, CTA | Yes (background "where identified objects are removed") | PSD | Segmentation + removal (stated structure); unverified at primary | Paid API, rates not opened |
| Canva Magic Layers | 2026-03-11 (beta) | Single-page PNG/JPG, longest edge ≤ 5000px | Objects, shapes, icons, backgrounds; text as live text boxes | Not stated | Move, resize, recolour, swap bg, edit text | "Canva Design Model" (stated); details not published | Premium / AI allowance (unverified) |
| Lovart Edit Elements | 2025-11-10 | Any canvas image | Subjects, backgrounds, text (text editable) | Yes (observed: AI fills backgrounds) | Move, resize, rotate, edit text, PSD export | "semantic layer decomposition" (stated); regenerates image (observed) | 5 points/use; 100 free points/day; text layers Pro (May 2026) |
| Seedream 5.0 Pro Layer Separation | 2026-07-08 (model); API 2026-08-13/15 | One PNG/JPEG, 512² to 6000² | Base + up to 16 PNG-alpha layers, each with z_index, bbox, name, description; text is a raster layer | Yes (stated: inpainted) | Move, scale, recolour, replace via re-generation | Layer-control capability of the generation model (stated); ~120 s | ~$0.0225 / $0.045 list per output image (+$0.003 input); $0.018 on Atlas |
| Qwen-Image-Layered | 2025-12-19 | One RGB image | N RGBA layers (N chosen; 3-10 shown); recursive | Not stated | Resize, reposition, recolour; PSD/PPTX/ZIP | Diffusion decomposer (RGBA-VAE + VLD-MMDiT), stated in paper | Free, Apache-2.0, self-host |
| Luma Layers (Uni-1) | 2026-07-29 | Prompt (generate as layers) or uploaded image | Every object, text element, background; text live | Not stated | Regenerate one layer, Z-order, extract, upscale, aspect ratio | Native layered generation "from the first pixel" (stated) | 75-175 credits/image; Plus $30/mo 10k credits |
| Adobe Firefly Layered Image Editing | Announced 2025-10-28, "in development" | Generated images (implied) | Objects as layers | Not stated | Prompt, resize, rotate | Firefly Image 5 (stated) | Not shipped |
| RunDiffusion Image-to-Layers | 2025-10-31 | Any image | One layer per detected element; PSD | Not mentioned | Photoshop | Auto-segmentation (stated), no inpainting mentioned | "Free to start" |

## What this means for Napkin

- "Delayering" is not an established market term and no Pencil has publicly shipped it. If the owner saw it somewhere, we need that link; otherwise we should not design against an assumed Pencil feature. The common names are "Magic Layers", "Layer Separation", "Edit Elements", "Layers", "Split into layers"; "Delayer" is Bria's.
- The capability is a commodity at model level: one hosted API (Seedream 5.0 Pro Layerize: one call, about 120 s, up to 16 layers plus base, bbox and name metadata, background inpainted, roughly $0.25-0.50 list for a 10-layer split) and one open model (Qwen-Image-Layered, Apache-2.0, PSD export). The product work is the canvas UX and the data model, not the model.
- Fill-behind is the quality line that separates toys from tools. Seedream (stated), Lovart (observed) and Bria (stated structure) fill the hole; SAM-style segmentation (RunDiffusion) does not; Qwen and Canva do not say. Any spec of ours should name fill-behind as a `done_when`.
- Live text is the second line. Canva and Luma return editable text boxes; Seedream returns text as a raster layer; Lovart added text layers as a Pro feature six months after Edit Elements. For brand and ad work, a text layer we can retype matters more than object count.
- Latency and failure are non-trivial: 120 s typical on Seedream, "a few dozen seconds" on Lovart, all-or-nothing failure on Seedream. The UX must be asynchronous with a visible job state and a refund path, which matches how our Runway jobs already behave.
- Price norms users see: 5 points on Lovart (effectively free daily), 75-175 Luma credits, inside the paid AI allowance on Canva. Charging per split is accepted; exposing per-layer cost is not.
- Every vendor warns about the same failures: complex overlapping compositions, photo-realistic images (Canva says it works best on graphics), hair, glass, lost contact shadows, tiny text. Our test plan should carry these cases, not just a clean poster.
- Luma's native "generate as layers" is the structural alternative to post-hoc decomposition: if generation is ours to control, asking the model for layers up front avoids reconstruction artefacts. Worth checking whether Runway or any provider we already use exposes this.

## Open questions

- Which Pencil, and where did "delayering" appear (in-app, X post, demo)? Nothing indexed by 2026-10-23 uses the term for either Pencil. Owner to supply the link.
- Does Qwen-Image-Layered complete occluded regions (amodal)? The paper's abstract and README do not state it; demos suggest partial completion. Needs a hands-on test.
- Canva's plan gating and processing time are not stated by Canva anywhere opened; the help page returned 403.
- Is Seedream Layerize exposed directly on BytePlus ModelArk under that id, and at the list prices EvoLink quotes? BytePlus's own API page returned only a navigation index.
- Is Luma Layers available through the Luma API, or only in Luma Agents? The announcement names only the app.
- Has Adobe shipped Layered Image Editing anywhere since Oct 2025? No announcement found through Aug 2026.
- Does Runway (our only provider) or Bria offer layer decomposition on terms we can use? Bria's route needs `/register` and is being replaced; not opened at primary.
- Did search miss an Oct 2026 pen.dev release? The CLI npm page and pen.dev changelog could not be opened; a check of `@pen.dev/cli` versions would settle it.
