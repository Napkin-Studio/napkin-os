# Research sweep: native multi-layer and transparent image generation (2024–2026)

Written 2026-10-23. Angle: generating images *as* layers (multi-layer RGBA) and
transparent-image diffusion, plus image-to-layers decomposition, with licence and
hosting facts for each system.

Note on inputs: the brief at `scratchpad/delayering/brief.md` was not present when
this sweep ran (the directory was empty after the workflow restart). The sweep
follows the angle text only. The session's shared web-search budget ran out near
the end; the last few checks (PixelART and PSDiffusion code links, the ART_v1.0
Hugging Face mirror, the FLUX.1-dev LICENSE.md text) could only be tried by direct
fetch and are marked unverified where they failed.

## Short answer

There is exactly one strong, permissively licensed, publicly hosted model that turns
a flat image into RGBA layers: **Qwen-Image-Layered** (Alibaba, Apache-2.0, released
2025-12-19, 20B parameters, fine-tune of Qwen-Image). It is slow and heavy
(50 steps, latency grows linearly with layer count, bf16 weights need an 80 GB-class
GPU; a 24 GB RTX 4090 run was reported hanging), but it can be self-hosted on our
own AWS GPU and is also served by fal (~$0.05/image, secondary) and Replicate
(~$0.03/run, secondary). For graphic-design flats, **LayerD** (CyberAgent,
ICCV 2025, Apache-2.0 code and matting weights, LaMa inpainting, CPU-capable,
exports PSD/SVG) is a cheap permissive fallback that Qwen-Image-Layered beats on
Crello.

Native **text-to-multi-layer** generation is not available to us under a permissive
licence: ART (Microsoft) had its weights withdrawn in July 2025 over training-data
provenance; ART+/PrismLayers, CLD, SynLayers, AlphaVAE, LayerDiffuse-Flux and
OmniPSD are FLUX.1-dev derivatives (FLUX.1 [dev] Non-Commercial License covers the
model and its derivatives); MRT (Canva, CVPR 2026, the current state of the art) and
LASAGNA (Adobe) are unreleased. Single-layer **transparent** generation is hostable
via LayerDiffuse on SDXL (CreativeML OpenRAIL-M weights, 8 GB VRAM, 2024 quality),
and commercially reachable via APIs: Runware (LayerDiffuse on FLUX Dev) and Alibaba
Model Studio (qwen-image-2.1-pro/turbo emit an alpha channel when the prompt asks).
Qwen-Image-2.1's open weights (7B, native RGBA, 2026-09) are under the Qwen Research
License, non-commercial only.

## A. Single-layer transparent (RGBA) generation

### LayerDiffuse / LayerDiffusion (Zhang & Agrawala, Stanford)
- Paper: arXiv 2402.17113, v1 2024-02-27, v4 2024-06-23. "Latent transparency"
  encodes alpha as a small latent offset; 1M transparent layer pairs collected with a
  human-in-the-loop scheme; user study prefers native transparency over
  generate-then-matte in 97% of cases. Supports single transparent images and
  two-layer (fg/bg-conditioned, joint) generation.
  https://arxiv.org/abs/2402.17113
- Code: lllyasviel/LayerDiffuse (landing), layerdiffusion/sd-forge-layerdiffuse and
  lllyasviel/LayerDiffuse_DiffusersCLI, all Apache-2.0. The Diffusers CLI needs
  "only 8GB Nvidia VRAM", SDXL only, t2i and i2i; fg/bg-conditioned modes are
  still TODO there. The Forge extension carries all modes: `layer_xl_transparent_attn`
  (rank-256 LoRA, SDXL), `layer_xl_fgble2bg`, `layer_xl_bgble2fg`, `layer_xl_bg2ble`,
  and SD1.5 `fg2bg`, `bg2fg`, `joint` (three images at once). The SDXL joint model
  was put on hold ("requires 4x more VRAM", "3x slower"). Examples at 1024x1024 and
  896x1152 (SDXL), 512 (SD1.5).
  https://github.com/lllyasviel/LayerDiffuse
  https://github.com/layerdiffusion/sd-forge-layerdiffuse
  https://github.com/lllyasviel/LayerDiffuse_DiffusersCLI
- Weights: huggingface.co/LayerDiffusion/layerdiffusion-v1, **License:
  creativeml-openrail-m** (RAIL; use-based restrictions, commercial use allowed).
  14 files (xl attn 743 MB, xl conv 3.62 GB, vae_transparent_decoder 208 MB,
  encoder 2.37 MB, SD1.5 set). Base SDXL is CreativeML Open RAIL++-M; its card says
  "intended for research purposes only" (card wording, not a licence clause).
  https://huggingface.co/LayerDiffusion/layerdiffusion-v1/tree/main
  https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
- Hosting: fal has `fal-ai/layer-diffusion` (SDXL with alpha; details page did not
  render, unverified). Dataset and training code were "planned" and, as far as the
  landing page shows, never released.
  https://fal.ai/models/fal-ai/layer-diffusion/api

### LayerDiffuse-Flux (RedAIGC / FireRedTeam), 2025
- New TransparentVAE plus a LoRA on FLUX.1-dev for single transparent images; t2i
  and i2i demos; no multi-layer output. Code licence not stated.
  https://github.com/FireRedTeam/LayerDiffuse-Flux
- Weights: huggingface.co/RedAIGC/Flux-version-LayerDiffuse, card says
  **License: afl-3.0** (Academic Free License 3.0). Base is **FLUX.1-dev**, so the
  derivative sits under the FLUX.1 [dev] Non-Commercial License regardless.
  https://huggingface.co/RedAIGC/Flux-version-LayerDiffuse
- Quality: PrismLayers' comparison found the FLUX port scored below the original
  SDXL LayerDiffuse on natural-object layer quality (attributed to training data).
  https://arxiv.org/abs/2505.22523
- Hosting: Runware blog 2025-05-23: `advancedFeatures.layerDiffuse: true`,
  "LayerDiffuse currently works only with FLUX Dev models", PNG/WebP output,
  768px+ recommended, "expect more cherry-picking". No price on the post.
  https://runware.ai/blog/introducing-layerdiffuse-generate-images-with-built-in-transparency-in-one-step

### Alfie (Univ. of Modena and Reggio Emilia), ECCV 2024 Workshops (AI4VA)
- arXiv 2408.14826, 2024-08-27. Training-free inference-time changes to PixArt-Σ
  (latent masking to keep subjects whole and centred), RGBA out. Code at
  aimagelab/alfie ("Official PyTorch implementation"); no LICENSE file was found
  (raw LICENSE fetch 404), so code licence unverified. Base PixArt-Σ weights are
  **openrail++** and the card says "intended for research purposes only".
  https://arxiv.org/abs/2408.14826
  https://github.com/aimagelab/alfie
  https://huggingface.co/PixArt-alpha/PixArt-Sigma-XL-2-1024-MS

### AlphaVAE, 2025-07-12 (arXiv 2507.09308)
- RGBA VAE that extends a pretrained RGB VAE with an alpha channel; trained on ~8K
  images (vs 1M for LayerDiffuse); +4.9 dB PSNR, +3.2% SSIM over LayerDiffuse in
  reconstruction; ALPHA benchmark. Code converts the **FLUX.1-dev** VAE to 4-channel
  and ships a generation LoRA. Weights huggingface.co/o0o0o00o0/AlphaVAE,
  **License: mit** on the card, but the VAE is a FLUX.1-dev derivative (flag).
  Used as the RGBA-VAE basis by OmniPSD.
  https://arxiv.org/abs/2507.09308
  https://github.com/o0o0o00o0/AlphaVAE
  https://huggingface.co/o0o0o00o0/AlphaVAE

### Trans-Adapter (Dai, Li, Zhou, Loy), ICCV 2025 (arXiv 2508.01098)
- Plug-and-play adapter so diffusion inpainting models (SD-Inpainting, BrushNet)
  emit RGB and alpha together; LayerBench and a non-reference alpha-edge metric.
  Weights on Google Drive, code licence not stated, SD1.5-inpainting base
  (OpenRAIL-M lineage), evaluation at 512.
  https://ykdai.github.io/projects/trans-adapter
  https://github.com/ykdai/Trans-Adapter

### Qwen-Image-2.1 (Alibaba), 2026-09 — native RGBA in the base model
- HF card: 7B visual generation component (32 single-stream DiT layers), "Generate
  regular or transparent (RGBA) images from text", edit transparent layers, extract
  subjects, up to 10 reference images, examples at 2048x2048. **License: Qwen
  RESEARCH LICENSE AGREEMENT**: "FOR NON-COMMERCIAL PURPOSES ONLY", "Non-Commercial
  shall mean for research or evaluation purposes only", commercial use requires a
  separate licence from model-business@notice.qwencloud.com. Commit history:
  initial commit Sep 14 2026, LICENSE Sep 18, README Sep 20. Not deployed by any HF
  Inference Provider. Qwen-Image-2.1-Turbo (8 steps, 7B) is under the same licence.
  https://huggingface.co/Qwen/Qwen-Image-2.1
  https://huggingface.co/Qwen/Qwen-Image-2.1/raw/main/LICENSE
  https://huggingface.co/Qwen/Qwen-Image-2.1/commits/main
  https://huggingface.co/Qwen/Qwen-Image-2.1-Turbo
- Hosted: Alibaba Model Studio API reference (updated 2026-10-11): `qwen-image-2.1-pro`
  and `qwen-image-2.1-turbo` "automatically decide whether to output a standard image
  or an image with a transparent (alpha) channel based on the prompt description";
  no parameter controls it; no transparency documented for `qwen-image-3.0(-pro)`;
  no RGBA-layered or multi-layer output on any Model Studio model.
  https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference

## B. Text-to-multi-layer generation

### Text2Layer (Adobe), 2023-07-19 (arXiv 2307.09781)
- Older than the window. Autoencoder over (background, foreground, mask, composite),
  then latent diffusion; two layers plus mask. "Preprint. Work in progress"; no code
  or weights found.
  https://arxiv.org/abs/2307.09781

### LayerFusion (Virginia Tech + Adobe), 2024-12-05 (arXiv 2412.04460)
- Text to RGBA foreground + RGB background + blended RGB in one pass, attention-level
  harmonisation, no optimisation. Project page still says "Code (coming soon)";
  base model unnamed.
  https://arxiv.org/abs/2412.04460
  https://layerfusion.github.io/

### ART: Anonymous Region Transformer (Microsoft Research Asia), CVPR 2025
- arXiv 2502.18364, 2025-02-25. Global prompt + anonymous bounding-box layout to
  variable RGBA layers ("50+"; dataset averages 11 layers); layer-wise region crop
  attention ">12x faster" than full attention. Backbone **FLUX.1[dev]** (LoRA for
  ablations); 86M-param ViT RGBA decoder (8x8x4 patches); 1024x1024 system
  results; training data ~1M private multi-layer designs. Inference 19.2 s
  (26.6 s with composite prediction), hardware unspecified. User study (30 people)
  prefers ART over LayerDiffuse and COLE on most axes but ART trails COLE on
  **typography** (COLE has a text renderer; ART does not). Limitations: repeated and
  merged layers.
  https://arxiv.org/html/2502.18364v1
- Code MIT, but README "Important Notice (updated 2025/07/23)": "since the model was
  trained using data that may have come from illegal sources ... we have removed the
  model weights and inference checkpoints from this repository, along with all
  associated download links. The training code ... has also been removed." The HF
  mirror ART-Release/ART_v1.0 returns HTTP 401 (gated or removed; unverified).
  https://raw.githubusercontent.com/microsoft/art-msra/main/README.md
  https://huggingface.co/ART-Release/ART_v1.0

### PrismLayers / PrismLayersPro and ART+ (Chen, Yuan et al.), 2025-05-28
- arXiv 2505.22523. Open datasets: PrismLayers 200K, PrismLayersPro 20K (accurate
  alpha mattes), generated by a training-free LayerFLUX / MultiLayerFLUX pipeline;
  ART+ is ART fine-tuned on PrismLayersPro, wins 60% head-to-head vs ART and
  "matches the visual quality of ... FLUX.1-[dev]". Code redredsheep/PrismLayers is
  MIT; checkpoints (base ART, ART+, transparent VAE, TIPS scorer) are on Google Drive
  with **no stated licence**; 1024 resolution. Because ART+ is an ART fine-tune, it
  is FLUX.1-dev-derived and inherits the ART provenance problem.
  Dataset huggingface.co/datasets/artplus/PrismLayersPro: **apache-2.0**, 20k rows in
  21 style splits; further sets PrismLayersPlus (80.8k), PrismLayersPlus-
  MultiResolution (91.4k), PrismLayersReal, PrismLayersObjectTransparency (licences
  not shown on the org page).
  https://arxiv.org/abs/2505.22523
  https://github.com/redredsheep/PrismLayers
  https://huggingface.co/datasets/artplus/PrismLayersPro
  https://huggingface.co/datasets/artplus

### PSDiffusion (Huang et al.), 2025-05-16, v2 2025-11-08 (arXiv 2505.11468)
- Simultaneous multi-layer text-to-image with a global layer interaction mechanism on
  a pretrained diffusion model (unnamed). No code or weights found (HF paper page
  fetch 404, search budget exhausted): unverified.
  https://arxiv.org/abs/2505.11468

### LASAGNA (UC Santa Cruz + Adobe), 2026-01-21, v2 2026-05-08 (arXiv 2601.15507)
- Background + RGBA foreground *including shadows and reflections* in one forward
  pass, conditioned on text, fg, bg and location masks; LASAGNA-48K dataset and
  LASAGNA-BENCH (242 samples). Dataset and benchmark "will be publicly released";
  no code or weights found.
  https://arxiv.org/abs/2601.15507

### LayerComposer, now CanvasComposer (Snap Inc.), arXiv 2510.20820
- v1 2025-10-23 as "LayerComposer: Multi-Human Personalized Generation via Layered
  Canvas"; v4 2026-09-02 retitled "CanvasComposer: Personalized Group Photo
  Generation via a Multi-Reference Canvas" (arXiv comments: SIGGRAPH Asia 2026).
  Input: RGBA cutouts placed on a canvas; transparent latent pruning; frozen
  **FLUX Kontext** DiT with rank-512 LoRA; up to 4 identities (quality drops at 5-6);
  1024x1024 eval. Output is a **single flattened image, not layers**. No code or
  weights; training data internal. The old project page (snap-research.github.io/
  layercomposer) is 404.
  https://arxiv.org/abs/2510.20820
  https://arxiv.org/html/2510.20820v4

### LayerTracer (Show Lab, NUS), 2025-02-03, v3 2025-08-13 (arXiv 2502.01105)
- Text or image to *layered SVG*: a DiT generates multi-phase raster "construction
  blueprints" (9-grid black-line icons at 768, 4-grid emoji at 1024), then
  layer-wise vectorisation. Code MIT; LoRAs merged into "flux.1" checkpoints
  (variant unstated, Google Drive, no weight licence); merged model needs "around
  50GB" memory. Icons and emoji only.
  https://arxiv.org/abs/2502.01105
  https://github.com/showlab/LayerTracer

### MRT: Masked Region Transformer (Canva Research), CVPR 2026
- arXiv 2605.27235, 2026-05-26. 20B masked-region diffusion model built on
  **Qwen-Image** (full-parameter fine-tune with FSDP2), WAN-2.1 VAE encoder for
  regional latents; unifies text-to-layers, image-to-layers, layers-to-layers;
  trained on >10M multilingual designs, >43M unique layers, >60% with overflow
  layers; canvas layer + semi-transparent background + K RGBA foregrounds, 2-50
  layers; 512 then 1024 training. DMD2 distillation 50→16/8 steps (14.4 s → 4.5 s
  on H200 at 16 steps; ~2.3 s at 8 steps, FID 16.0→18.6). ~5-6 s for a 1K image with
  ~20 layers on one H100, ~3 s on 4xH100; vs Qwen-Image-Layered: up to 108.5x faster
  at ~20 layers, 10.5-23.6x lower peak memory; user study win rates 79.5% layer
  quality, 68.9% integrity, 82.6% granularity. Image-to-layers compared with Lovart,
  RoboNeo and LayerD; text-to-layers with ART. Typography is a user-study dimension
  only. Limitations: shadows stay on the background, limited photorealistic
  generalisation. **No code, weights or demo**; corresponding author at canva.com.
  https://arxiv.org/abs/2605.27235
  https://arxiv.org/html/2605.27235v1
  https://mrt-cvpr.github.io/

## C. Image-to-layers decomposition (delayering)

### LayerD (CyberAgent + Tohoku Univ.), ICCV 2025
- arXiv 2509.25134, 2025-09-29. Iteratively extracts the unoccluded top layer with
  BiRefNet (Swin-L, trained on Crello), inpaints the hole with **LaMa** (FLUX.1 Fill
  was tried and "tended to insert unwanted objects"), palette-based refinement, max 3
  iterations by default; images resized to shorter side 512. Crello: 19,478 train /
  1,852 val / 1,971 test designs. User study 3.74 vs 3.52 (YOLO baseline) vs 3.31
  (VLM baseline). Text is treated as "a variant of vector shapes"; optional OCR
  (EAST, GOT-OCR2); elements classified text / vector / image; exports **SVG and
  PSD**. Small text and ambiguous granularity are stated limitations; errors compound
  across iterations.
  https://arxiv.org/abs/2509.25134
  https://arxiv.org/html/2509.25134
- Code **Apache-2.0**; matting weights cyberagent/layerd-birefnet **Apache-2.0**
  (0.2B, ~1 GB); LaMa wrapper vendored Apache-2.0 (~200 MB); runs on CPU or CUDA.
  https://github.com/CyberAgentAILab/LayerD
  https://github.com/CyberAgentAILab/LayerD/blob/main/docs/architecture.md
  https://huggingface.co/cyberagent/layerd-birefnet

### Qwen-Image-Layered (Alibaba Qwen), 2025-12
- Timeline (GitHub README): paper 2025-12-18 (arXiv 2512.15603, dated 2025-12-17 on
  arXiv), weights on HF/ModelScope 2025-12-19, demos 2025-12-22. **"Qwen-Image-Layered
  is licensed under Apache 2.0."** Fine-tune of Qwen-Image (20B, Apache-2.0,
  2025-08-04). Components: RGBA-VAE, VLD-MMDiT (variable layer count), three-stage
  training (500K/400K/400K steps) on layered data parsed from PSD files (count not
  reported) plus an internal t2i set. Training max 20 layers; model card shows 3, 4
  and 8 layers and recursive decomposition of any layer; `layers` param;
  `resolution` buckets 640 (recommended) and 1024; 50 steps, true_cfg 4.0;
  `QwenImageLayeredPipeline` in Diffusers; python-pptx / psd-tools export.
  Authors note text-to-multi-RGBA is limited (weights tuned for image-to-layers).
  https://huggingface.co/Qwen/Qwen-Image-Layered
  https://github.com/QwenLM/Qwen-Image-Layered
  https://arxiv.org/abs/2512.15603
- Quality: Crello (fine-tuned on Crello train) merge-0: RGB L1 0.0594 / alpha soft
  IoU 0.8705 vs LayerD 0.0709 / 0.7520; merge-5: 0.0363 / 0.9160 vs 0.0396 / 0.8650.
  RGBA-VAE on AIM-500: PSNR 38.83, SSIM 0.980, rFID 5.31 vs AlphaVAE-on-FLUX 36.94 /
  0.974 / 11.79. Text: "accurately decomposing both text and objects" (qualitative,
  Fig. 3), text comes out as raster layers edited with Qwen-Image-Edit. No inference
  cost reported.
  https://arxiv.org/html/2512.15603v1
- Compute and speed: no VRAM figure from Qwen. GitHub issue #30 (2026-05-27, open, no
  reply): RTX 4090 24 GB, bf16, 640x640, 4 layers, 50 steps, ~23.9 GB used, >8 h
  with progress at 0%. ComfyUI docs: bf16 "requires high VRAM", an
  `qwen_image_layered_fp8mixed.safetensors` variant exists, 50 steps + CFG "will at
  least double the generation time", each run decodes layers+1 images. DataCamp
  (2026-01-19, secondary): >57 GB of weights, Colab T4 ran out of RAM; Replicate
  call "takes 30-60 seconds"; shadow remnants left on the background layer. MRT
  paper (2026-05): Qwen-Image-Layered latency scales linearly with layer count.
  https://github.com/QwenLM/Qwen-Image-Layered/issues/30
  https://docs.comfy.org/tutorials/image/qwen/qwen-image-layered
  https://www.datacamp.com/tutorial/qwen-image-layered
- Hosting: fal `fal-ai/qwen-image-layered` (`num_layers` default 4, 28 steps,
  guidance 5, PNG/WebP, "Commercial use" label; price not on the page, ~$0.050/image
  per CostGoat 2026-08-31 and PricePerToken, secondary). Replicate
  `qwen/qwen-image-layered` (2-8 layers, RGBA PNG per layer, "Apache 2.0, per the
  Qwen team"; ~$0.03/run per DataCamp, secondary). Not found on Alibaba Model
  Studio, Together or Runware (searches found nothing; absence not proven).
  https://fal.ai/models/fal-ai/qwen-image-layered/api
  https://replicate.com/qwen/qwen-image-layered

### CLD: Controllable Layer Decomposition (Liu et al., Tsinghua "thuteam"), 2025-11-20
- arXiv 2511.16249 (cs.GR). LayerDecompose-DiT + Multi-Layer Conditional Adapter;
  examples show background + 9-16 foregrounds; new benchmark. Code MIT; LoRA weights
  huggingface.co/thuteam/CLD **apache-2.0** (Dec 2025) but require **FLUX.1-dev** and
  alimama-creative/FLUX.1-dev-Controlnet-Inpainting-Alpha, so the runnable system is a
  FLUX.1-dev derivative. Fine-tuned with LoRA on PrismLayersPro (per the paper).
  https://arxiv.org/abs/2511.16249
  https://github.com/monkek123King/CLD
  https://huggingface.co/thuteam/CLD

### SynLayers: "Does Synthetic Layered Design Data Benefit Layered Design Decomposition?" (Wu et al., HKUST), 2026-05-14
- arXiv 2605.15167. Builds on CLD; pure synthetic layered data beats training on
  PrismLayersPro; gains level off around 50K samples; synthetic data lets you balance
  layer-count distribution. Code MIT; Stage 1 Qwen3-VL-8B bbox captioner on HF;
  Stage 2 checkpoints on **FLUX.1-dev** with the alimama inpainting adapter.
  https://arxiv.org/abs/2605.15167
  https://github.com/YangHaolin0526/SynLayers

### OmniPSD (NUS Show Lab + Lovart AI), 2025-12-10 (arXiv 2512.09247)
- Text-to-PSD (layers arranged spatially on one canvas) and image-to-PSD (iterative
  in-context extraction and erasure of text and foreground) on **Flux-dev /
  Flux-Kontext**, RGBA-VAE extended from AlphaVAE. No code or weights found.
  https://arxiv.org/abs/2512.09247

### CreatiParser, 2026-04-21, v2 2026-07-14 (arXiv 2604.19632)
- Hybrid: a VLM parses text into a **text rendering protocol** (editable text), a
  multi-branch RGBA diffusion model emits background and sticker layers; ParserReward
  + GRPO; +23.7% average on Parser-40K and Crello. The only system found that outputs
  editable text rather than raster text layers. No code found.
  https://arxiv.org/abs/2604.19632

### LiWi: Layering in the Wild, 2026-05-14, v3 2026-05-24 (arXiv 2605.14552)
- Natural-image (not design) layering: agent-driven data pipeline, LiWi-100k dataset,
  shadow-guided learning, degradation-restoration objective; SOTA on RGB L1 / alpha
  IoU for natural images. "We will soon release our code and dataset." Nothing
  released yet.
  https://arxiv.org/abs/2605.14552

### PixelART (Jia, Zhang, Tang, Yuan, Liu), 2026-09-19 (arXiv 2609.22789)
- Pixel-space rectified-flow transformer trained from scratch (no RGBA VAE, no t2i
  pretraining) on ~4M multi-layer design templates; SOTA on Design-Multi-Layer-Bench
  and LICA with ">80% fewer parameters and 98% lower latency than Qwen-Image-Layered"
  (self-reported). No code or weights found (HF paper page 404). If released it would
  be the first permissive-by-construction small delayering model, since there is no
  base-model licence to inherit.
  https://arxiv.org/abs/2609.22789

## D. Datasets

- **MuLAn** (Huawei Noah's Ark; CVPR 2024; arXiv 2404.02790, 2024-04-03): >44K
  multi-layer annotations of COCO 2017 and LAION Aesthetic 6.5+ images, >100K RGBA
  instances, background RGB + one RGBA layer per instance; distributed as annotations
  only (36.6 GB). HF card: **cc-by-nc-sa-4.0** (non-commercial).
  https://arxiv.org/abs/2404.02790  https://huggingface.co/datasets/mulan-dataset/v1.0
- **PrismLayersPro**: 20K synthetic multi-layer transparent designs, **apache-2.0**;
  PrismLayers 200K; later Plus sets 80.8K and 91.4K (licences unverified).
  https://huggingface.co/datasets/artplus/PrismLayersPro
- **Crello** (CyberAgent): 19,478 / 1,852 / 1,971 design templates; the de-facto
  decomposition benchmark used by LayerD, Qwen-Image-Layered, CreatiParser.
  https://arxiv.org/html/2509.25134
- **LASAGNA-48K**, **LiWi-100k**, **SynLayers**: announced; LASAGNA and LiWi not yet
  released; SynLayers pipeline code is MIT but no dataset download link.
- **Design-Multi-Layer-Bench** (ART, 5K) and **LICA** are the text-to-layers / layer
  benchmarks the Yuan group uses; MLTD (~1M, ART) is private.

## E. Licence and hosting matrix

| System | Weights public | Weight licence | Base | Self-host on our AWS GPU for commercial use? |
|---|---|---|---|---|
| Qwen-Image-Layered | yes (HF, ModelScope) | Apache-2.0 | Qwen-Image (Apache-2.0) | **Yes.** Needs 80 GB-class GPU in bf16 (fp8 variant exists); slow. |
| LayerD | yes | Apache-2.0 code + matting; LaMa Apache-2.0 | BiRefNet (MIT) + LaMa | **Yes.** CPU-capable; design flats only; weaker than Qwen-Image-Layered. |
| LayerDiffuse SDXL/SD1.5 | yes | CreativeML OpenRAIL-M (RAIL: use-based restrictions, commercial allowed) | SDXL (OpenRAIL++-M) | **Yes, with RAIL terms** (flag). 8 GB VRAM. 2024 quality; single layer or 2-layer. |
| Trans-Adapter | yes (Google Drive) | not stated | SD1.5 inpainting (OpenRAIL-M) | Unclear; code licence missing. |
| AlphaVAE | yes (HF) | MIT on card | FLUX.1-dev VAE + LoRA | **No** as a FLUX.1-dev derivative (flag; VAE-only derivation is a grey area). |
| LayerDiffuse-Flux | yes (HF) | AFL-3.0 on card | FLUX.1-dev | **No** (FLUX.1 [dev] Non-Commercial). Use via Runware API instead. |
| CLD, SynLayers | LoRAs yes | Apache-2.0 / MIT | FLUX.1-dev + alimama inpainting ControlNet | **No** (FLUX.1-dev derivative). |
| ART | **withdrawn 2025-07-23** | none | FLUX.1-dev | **No.** Provenance notice; do not use mirrors. |
| ART+ / PrismLayers | Google Drive, no licence | none stated | ART (FLUX.1-dev) | **No.** Inherits ART and FLUX.1-dev. Dataset (Apache-2.0) is fine for training. |
| LayerTracer | Google Drive | none stated | FLUX.1 (variant unstated) | **No** unless variant is schnell (unverified); icons/emoji SVG only. |
| Alfie | code only | code licence unverified | PixArt-Σ (OpenRAIL++, "research only" card) | Not advisable (flag). |
| Qwen-Image-2.1 / 2.1-Turbo | yes | Qwen Research License (non-commercial) | - | **No** for self-host. Use via Alibaba Model Studio qwen-image-2.1-pro/turbo (alpha output). |
| MRT (Canva) | no | - | Qwen-Image | **Cannot use.** |
| OmniPSD, LASAGNA, PSDiffusion, CreatiParser, LiWi, PixelART, LayerFusion, Text2Layer, CanvasComposer | no | - | FLUX-dev/Kontext (OmniPSD, CanvasComposer), from scratch (PixelART), unnamed others | **Cannot use** today. |

FLUX.1 [dev] licence basis: the HF card names the "FLUX.1 [dev] Non-Commercial
License"; "Generated outputs can be used for personal, scientific, and commercial
purposes", the restriction is on the model and its derivatives. The LICENSE.md raw
fetch returned 401, so the exact "Derivative" definition is unverified here.
https://huggingface.co/black-forest-labs/FLUX.1-dev
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev

## What this means for Napkin

- For "delayer a flat generated image into editable RGBA layers", the only permissive,
  production-grade option we can self-host is Qwen-Image-Layered (Apache-2.0). Plan
  on an 80 GB GPU (A100/H100 class) or the fp8 variant, 50 steps, roughly 30-60 s per
  image at 640 px, and latency that grows with layer count. fal (~$0.05) and
  Replicate (~$0.03) are the no-ops path while we measure our own throughput.
- LayerD is the cheap complement for poster- and social-style flats: Apache-2.0 end to
  end, CPU-capable, PSD/SVG export, text/vector/image element classification. It
  loses to Qwen-Image-Layered on Crello (alpha IoU 0.75 vs 0.87) but costs almost
  nothing to run, so it fits as a first pass or a fallback tier.
- There is no permissively licensed text-to-multi-layer generator. Every open one is a
  FLUX.1-dev derivative (non-commercial), withdrawn (ART), or unreleased (MRT, LASAGNA,
  OmniPSD, PSDiffusion). Design the pipeline as generate-flat (Runway or other API)
  then decompose, not as native layered generation.
- Single transparent cutouts (one RGBA layer) are the easy case: LayerDiffuse on SDXL
  is hostable under OpenRAIL-M at 8 GB VRAM; better quality is reachable only through
  APIs today (Runware LayerDiffuse on FLUX Dev; Alibaba Model Studio
  qwen-image-2.1-pro/turbo alpha output). Qwen-Image-2.1 open weights are
  research-only; do not self-host them for customers.
- Licence traps to write into the design record: FLUX.1 [dev] Non-Commercial covers
  fine-tunes and LoRAs (CLD, SynLayers, AlphaVAE, LayerDiffuse-Flux, ART+); MuLAn is
  CC-BY-NC-SA; PixArt-Σ and SDXL cards say "research purposes only"; ART weights were
  pulled over training-data provenance, so any ART-derived checkpoint (ART+, TIPS) is
  off the table even if a mirror exists.
- Text comes out of every open delayering model as raster text layers (Qwen-Image-
  Layered, LayerD, MRT). Only CreatiParser (unreleased) emits editable text. If brand
  typography must stay editable on the canvas, keep generated imagery text-free and
  set type ourselves, or OCR the text layer and re-set it.
- Shadows and reflections are the shared failure mode: Qwen-Image-Layered leaves
  shadow remnants on the background; MRT says shadows "often stay on the background
  layer"; LASAGNA (Adobe, unreleased) is the only work that bakes effects into the
  foreground. Expect manual clean-up on product shots and lit scenes.
- The frontier (MRT: 2-50 layers, overflow-aware canvas layer, semi-transparent
  backgrounds, ~5 s on one H100, built on Qwen-Image) is closed and belongs to Canva.
  Model the canvas for a variable number of RGBA layers with off-canvas overflow and
  a separate semi-transparent background now, so the decomposer can be swapped when
  something comparable is released (PixelART or LiWi are the likeliest).

## Open questions

- Measured throughput and peak memory of Qwen-Image-Layered on the GPUs we can get in
  our AWS region (A10G 24 GB, L4, A100 40/80 GB, H100), bf16 vs the fp8-mixed
  checkpoint, at 640 vs 1024 and at 4 vs 8 layers. The 24 GB hang report is
  unanswered; nobody has published a timing table.
- Whether 640 px layers (the recommended bucket) are acceptable for our outputs, and
  whether per-layer upscaling preserves alpha edges.
- Qwen-Image-Layered training data is "a large corpus of PSD files"; provenance is not
  described. Is that a risk of the ART kind for an external-customer product?
- Does fal's "Commercial use" label and Replicate's hosting carry any output terms
  beyond Apache-2.0? Exact per-image prices were not on either model page.
- Will PixelART, LiWi, LASAGNA or MRT release weights, and under what licence? PixelART
  is trained from scratch, so it would not inherit a base-model licence.
- Is Qwen-Image-Layered available on Alibaba Model Studio under another name? Searches
  found no entry; absence is not proven.
- Whether the FLUX.1 [dev] licence's "Derivative" definition reaches a VAE-only
  derivative such as AlphaVAE (LICENSE.md could not be fetched here).
