# Decomposing a finished image into layers: research sweep (2024–2026)

Sweep date: 2026-10-23. Scope: taking one finished image and splitting it into
editable layers (segmentation, amodal completion, generative layer
decomposition, object removal / fill-behind, shadow and reflection handling),
then keeping the recomposition coherent (harmonisation, relighting, shadow
generation, insertion). Every item carries a URL and a date; "unverified" marks
anything not read at a primary source. Note: the brief at
`scratchpad/delayering/brief.md` did not exist when this agent ran (the
directory was empty), so this sweep works from the angle text alone and assumes
the known product constraints: canvas-first production tool, external
customers, permissive open-source only, GPU budget uncertain.

## Short answer

A fully permissive, CPU-only "delayering" pipeline exists today, but it is a
cut-out pipeline, not a true decomposer: open-vocabulary detection
(Florence-2, MIT; Grounding DINO, Apache-2.0) → masks (SAM 2.1, Apache-2.0;
BiRefNet, MIT) → fill-behind with a small GAN (MI-GAN, MIT weights) →
compositing. It gives per-object RGBA layers with a plausibly filled
background. It does not complete occluded parts of objects, and it leaves
shadows and reflections baked into the background.

The only permissive generative decomposer with public weights is
Qwen-Image-Layered (Apache-2.0, Dec 2025, CVPR 2026). It is a 20B model: a
third-party measurement shows 213 s and 72 GB peak on an H200 for a 1024 px
image. It needs a server GPU, and its training data is PSD design files, so
natural photos are its weak spot (confirmed by two 2026 follow-ups). Every
model that separates shadows and reflections into their own layer for stills
(LayerDecomp, ObjectDrop, MetaShadow) is unreleased or non-commercial
(ObjectClear). Most 2025 object-removal and composition LoRAs sit on FLUX.1
[dev] / Fill-dev, whose licence is non-commercial even when the LoRA's own code
is MIT. Recomposition coherence has thin permissive options: PCT-Net
harmonisation (MPL-2.0, runs on CPU), IC-Light v1 (OpenRAIL-M, SD1.5), and a
general Apache-2.0 editor (Qwen-Image-Edit, FLUX.2 klein 4B, OmniGen2) as a
GPU "make it fit" pass. The field moved fast in 2026 (PixelART, Sep 2026: 1B
params, 3 s, 6.6 GB, weights not public yet), so the layer data model should
not depend on any one model.

## A. Segmentation and matting (what becomes a layer)

**SAM 2 / SAM 2.1 (Meta).** Promptable segmentation (points, boxes, masks) for
images and video. Code and checkpoints Apache-2.0. Released 2024-07-29; 2.1
checkpoints 2024-09-29. Sizes: Hiera Tiny 38.9M, Small 46M, Base+ 80.8M, Large
224.4M params; A100 speed 91.2 / 84.8 / 64.1 / 39.5 FPS. No CPU or ONNX numbers
on the official page; CPU use of the tiny model is feasible by size but
unmeasured here (inference). Source: https://github.com/facebookresearch/sam2
(read 2026-10-23).

**SAM 3 (Meta, arXiv 2511.16719, v1 2025-11-20, v2 2026-03-28).** "Promptable
Concept Segmentation": a noun phrase or an image exemplar returns masks for
every instance of that concept. One model does detection, segmentation and
video tracking; 848M params (repo) / 0.9B (HF card). Claims 75–80% of human
performance on its SA-Co benchmark (270K concepts), "doubles the accuracy of
existing systems" on image and video PCS. Speed: ~30 ms per image with 100+
objects on an H200 (Meta blog). Requires CUDA 12.6+ GPU, PyTorch 2.7+.
Weights gated on Hugging Face. Licence: Meta's custom "SAM License" (last
updated 2025-11-19): a non-exclusive, worldwide, royalty-free licence to use,
reproduce, distribute, modify and create derivatives; no commercial
restriction; restrictions on trade-controlled and military uses and on reverse
engineering; redistribution only under the same agreement with a copy
attached; research publications must acknowledge use. Not an OSI licence.
SAM 3.1 (2026-03-27) adds object multiplexing: up to 16 objects per pass, 32
FPS video on one H100, ~7x faster at 128 objects. Sources:
https://arxiv.org/abs/2511.16719, https://github.com/facebookresearch/sam3,
https://raw.githubusercontent.com/facebookresearch/sam3/main/LICENSE,
https://huggingface.co/facebook/sam3, https://huggingface.co/facebook/sam3.1,
https://ai.meta.com/blog/segment-anything-model-3/ (all read 2026-10-23).

**BiRefNet (ZhengPeng7).** Dichotomous segmentation / matting (foreground vs
background, hair-level edges). Code MIT; weights on HF and GitHub releases, no
separate weights licence stated. arXiv 2024-01-07; code+weights 2024-03-07;
ONNX 2024-08-19; lite-2K 2024-09-24; HR (2048²) 2025-02-01; HR-matting
2025-02-12; dynamic resolution (256–2304) 2025-03-31. Speed at 1024²: A100
86.8 ms FP32 / 69.4 ms FP16; RTX 4090 95.8 / 57.7 ms; GPU memory 4.8 GB FP32,
3.5 GB FP16. ONNX on A100 ~165 ms (Swin-L), ~94 ms (Swin-T). CPU speed not
stated. DIS-VD S-measure 0.927 (HR), 0.911 (Swin-L), 0.882 (Swin-T). Note:
BRIA RMBG-2.0 is a BiRefNet derivative under CC BY-NC 4.0 (see blocked list).
Source: https://github.com/ZhengPeng7/BiRefNet (read 2026-10-23).

**Smaller permissive mattes (CPU-grade).** U²-Net (Pattern Recognition 2020,
Apache-2.0; u2net.pth 176.3 MB, u2netp.pth 4.7 MB)
https://github.com/xuebinqin/U-2-Net. IS-Net / DIS (ECCV 2022, code
Apache-2.0; `isnet-general-use.pth` 2022-08-17; DIS5K dataset has its own
terms) https://github.com/xuebinqin/DIS. InSPyReNet (ACCV 2022, MIT)
https://github.com/plemeri/InSPyReNet. BEN2 (paper 2025-01-08; base model MIT,
94.6M params; the "full" model is API-only via backgrounderase.com)
https://huggingface.co/PramaLLC/BEN2. rembg (MIT) wraps u2net, isnet,
birefnet-general(-lite), sam, bria-rmbg; installs CPU-only via
`rembg[cpu]`; **its default model is now bria-rmbg, which "requires a paid
agreement for commercial use"**, so the model must be pinned
https://github.com/danielgatis/rembg. (All read 2026-10-23.)

**Open-vocabulary detection (to name and box the objects before masking).**
Grounding DINO (code 2023-03-22, Apache-2.0; CPU-only mode since 2023-03-27;
COCO zero-shot 48.4 AP for Swin-T) https://github.com/IDEA-Research/GroundingDINO.
Grounding DINO 1.5/1.6 and DINO-X are cloud-API only (DDS API, V1 deprecated
2025-04-20) https://github.com/IDEA-Research/Grounded-SAM-2 (Apache-2.0 repo,
component licences bundled; needs a CUDA toolchain to compile deformable
attention). Florence-2-large (MIT, 0.77B params, paper 2023-11-10; object
detection, phrase grounding, region proposal, Refcoco RES 35.8 mIoU; runs on
CPU in fp32) https://huggingface.co/microsoft/Florence-2-large. OWLv2
(Apache-2.0, 0.2B, 2023-06) https://huggingface.co/google/owlv2-base-patch16-ensemble.
YOLO-World (CVPR 2024; GPL-3.0 with a paid commercial licence by contact; V2.1
2025-02-08; LVIS AP 18.5–28.7; a -Seg variant exists)
https://github.com/AILab-CVC/YOLO-World. YOLOE (2025-03) is AGPL-3.0 per a
Roboflow listing (secondary, unverified). (All read 2026-10-23.)

## B. Amodal completion (finishing the hidden part of an object)

**pix2gestalt (CVPR 2024 Highlight, arXiv 2401.14398).** Modal mask → whole
object as RGBA. Fine-tuned from an image-conditioned Stable Diffusion
(`sd-image-conditioned-v2`). Demo needs 22–28 GB VRAM. Weights on HF
(cvlab/pix2gestalt-weights). **Licence CC BY-NC 4.0** (LICENSE file); training
images from SA-1B, "research purposes only". Blocked. Sources:
https://github.com/cvlab-columbia/pix2gestalt,
https://raw.githubusercontent.com/cvlab-columbia/pix2gestalt/main/LICENSE
(read 2026-10-23).

**Amodal Completion via Progressive Mixed Context Diffusion (CVPR 2024
Highlight, arXiv 2312.15540; UPenn + Adobe).** Training-free: a pretrained
diffusion inpainting model grows the occluded object outward using context
beyond the bounding box, then trims background. Qualitative evidence only.
Code at github.com/k8xu/amodal; **no LICENSE file** (raw LICENSE returns 404),
so the licence is unstated; depends on Grounded-SAM, LaMa, InstaOrder. Sources:
https://k8xu.github.io/amodal/, https://github.com/k8xu/amodal (read 2026-10-23).

**Open-World Amodal Appearance Completion (CVPR 2025, arXiv 2411.13019).**
Training-free, text query → RGBA completed object. Code Apache-2.0, but the
pipeline chains LISA-13B-llama2 (Llama 2 licence), InstaOrder, RAM++,
Grounded-SAM and Stable Diffusion 2 inpainting (OpenRAIL++). Heavy (a 13B VLM
server plus SD2). No numbers on the page. Source: https://github.com/saraao/amodal
(read 2026-10-23).

**SynergyAmodal: "Deocclude Anything with Text Control" (ACM MM 2025, arXiv
2504.19506).** Weights on HF (cloudyfall/DeoccAnything). **CC BY-NC-SA 4.0,
"for academic research use only"**; EntitySeg images non-commercial. Blocked.
Source: https://github.com/imlixinyang/SynergyAmodal (read 2026-10-23).

**CObL: Zero-Shot Ordinal Layering without User Prompting (ICCV 2025
Highlight, arXiv 2508.08498, 2025-08-11; Harvard).** One photo → an
occlusion-ordered stack of amodally completed RGBA object layers, generated in
parallel with inference-time guidance so the layers composite back to the
input. Modules attached to frozen Stable Diffusion; trained on a few thousand
synthetic tabletop scenes; generalises zero-shot to real tabletops only. Code
MIT (github.com/aneeldamaraju/cobl); weights not listed on the repo page.
Sources: https://arxiv.org/abs/2508.08498, https://vision.seas.harvard.edu/cobl/,
https://github.com/aneeldamaraju/cobl (read 2026-10-23).

**Multi-Agent Amodal Completion (arXiv 2509.17757, 2025-09-22).** Agents build
the inpainting mask and a fine-grained prompt; outputs RGBA directly from
Diffusion Transformer attention maps. No code or base model stated. Source:
https://arxiv.org/abs/2509.17757 (read 2026-10-23).

**Referring Layer Decomposition (ICLR 2026, arXiv 2602.19358, 2026-02-22).**
Defines the task of predicting a complete RGBA layer for a prompted element
(points, boxes, masks or text). RefLade dataset: ~1.11M image–layer–prompt
triplets plus 100K curated layers; RefLayer baseline. Code and weights not
stated on arXiv (unverified). Source: https://arxiv.org/abs/2602.19358 (read
2026-10-23).

## C. Generative layer decomposition (one image → several RGBA layers)

**LayerDecomp: Generative Image Layer Decomposition with Visual Effects (CVPR
2025, arXiv 2411.17864, 2024-11-26; Adobe Research + UCSC).** Input: composite
image + binary object mask. Output: clean background and a transparent
foreground layer that keeps the object's shadow and reflection. Fine-tuned from
a 5B-parameter text-to-image DiT; 6,000 camera-captured pairs plus simulated
triplets from stock images; pixel-space consistency loss. Object removal on
RORD (tight mask): PSNR 24.79 vs PowerPaint 21.26, SD-XL Inpainting 20.81,
ControlNet Inpainting 22.01; FID 21.73 vs 56.56 / 56.28 / 53.71. **No code,
weights or dataset released** (none on arXiv or the project page as of
2026-10-23). Sources: https://arxiv.org/html/2411.17864,
https://rayjryang.github.io/LayerDecomp/.

**DiffDecompose (arXiv 2505.21541, v3 2025-09-01).** Layer-wise decomposition
of alpha-composited images (semi-transparent overlays: flares, glassware,
logos). Diffusion Transformer with in-context decomposition; AlphaBlend
dataset. The abstract says code "will be available" at
github.com/Wangzt1121/DiffDecompose "upon paper acceptance"; release not
verified. Source: https://arxiv.org/abs/2505.21541 (read 2026-10-23).

**Qwen-Image-Layered (Alibaba; arXiv 2512.15603, 2025-12-17; weights
2025-12-19; CVPR 2026).** End-to-end: one RGB image → a variable number of
semantically separated RGBA layers (examples 3, 4, 8; up to 20 in training;
any layer can be decomposed again). RGBA-VAE, VLD-MMDiT, three-stage training
(500K/400K/400K steps) adapted from Qwen-Image; training data extracted from
PSD files. **Licence Apache-2.0 (code and weights).** Resolution buckets 640
(recommended) and 1024; 50 steps, CFG 4. Benchmarks (Crello): RGB L1 0.0594 vs
LayerD 0.0709; alpha soft IoU 0.8705 vs 0.7520. RGBA-VAE on AIM-500: PSNR
38.83 vs AlphaVAE (FLUX) 36.94. Hardware: not stated by Qwen; PixelART (Sep
2026) measured **213.4 s and 72.4 GB peak on one H200 at 1024²**, 20B params.
ComfyUI ships an fp8 variant and calls the model slow. Limitations (repo):
prompt describes the whole image, not per-layer content; text-to-layers is
poor. Sources: https://huggingface.co/Qwen/Qwen-Image-Layered/blob/main/README.md,
https://github.com/QwenLM/Qwen-Image-Layered, https://arxiv.org/html/2512.15603,
https://docs.comfy.org/tutorials/image/qwen/qwen-image-layered,
https://arxiv.org/html/2609.22789 (all read 2026-10-23).

**LayerD: Decomposing Raster Graphic Designs into Layers (ICCV 2025, arXiv
2509.25134; CyberAgent).** Non-generative-first pipeline: iteratively extract
the unoccluded foreground with BiRefNet-based matting, fill, repeat; classifies
elements (text / vector / image); exports SVG and PSD. **Apache-2.0** code and
fine-tuned matting weights (HF cyberagent/layerd-birefnet; BiRefNet itself
MIT). The README example runs with `device="cpu"`. On LICA it has the highest
pixel PSNR (37.22 vs PixelART 36.39, Qwen 31.99) but the lowest VLM visual
score (3.64 vs 4.44 / 3.93), i.e. precise but less plausible layers. Sources:
https://github.com/CyberAgentAILab/LayerD, https://arxiv.org/html/2609.22789
(read 2026-10-23).

**Controllable Layer Decomposition (CLD, arXiv 2511.16249, 2025-11-20;
checkpoints Dec 2025).** LD-DiT + Multi-Layer Conditional Adapter; box-guided,
designer-controllable separation. Code MIT; LoRA weights on HF (thuteam/CLD,
tagged apache-2.0) — **but they are LoRAs on FLUX.1-dev plus the
alimama FLUX.1-dev ControlNet-Inpainting-Alpha**, so the FLUX.1 [dev]
Non-Commercial License governs (PixelART's Appendix L lists CLD under that
licence). Sources: https://github.com/monkek123King/CLD,
https://huggingface.co/thuteam/CLD, https://arxiv.org/abs/2511.16249 (read
2026-10-23).

**From Inpainting to Layer Decomposition (arXiv 2511.20996, v2 2026-03-23;
CVPR 2026).** Lightweight fine-tune of a diffusion inpainting model with a
linear-attention context-fusion module; trained only on synthetic data from
open-source assets; targets object removal and occlusion recovery. Base model
not named; no code stated. Source: https://arxiv.org/abs/2511.20996 (read
2026-10-23).

**Cycle-Consistent Tuning for Layered Image Decomposition (arXiv 2602.20989,
2026-02-24; CVPR 2026; Shenzhen Univ. VCC).** LoRA on a large diffusion
foundation model; jointly trains decompose and compose so the recomposition
matches the input; demonstrated on logo-on-surface separation. Project page
has an empty Downloads section; no code found. Sources:
https://arxiv.org/abs/2602.20989, https://vcc.tech/research/2026/ImgDecom (read
2026-10-23).

**CreatiParser (arXiv 2604.19632, 2026-04-21, v2 2026-07-14).** Parses a raster
design into text (via VLM → text-render protocol), background and RGBA sticker
layers; GRPO with a ParserReward; +23.7% average over prior methods on
Parser-40K and Crello. No code stated. Source: https://arxiv.org/abs/2604.19632
(read 2026-10-23).

**LiWi: Layering in the Wild (arXiv 2605.14552, 2026-05-14; JD.com).** The
first 2026 work aimed at natural photos rather than designs. Agent-driven data
pipeline builds LiWi-100K; fine-tunes Qwen-Image-Layered with shadow-guided
learning (illumination effects) and a degradation-restoration objective (alpha
boundaries). Reports the base Qwen-Image-Layered has a domain gap on photos.
**Model access is by request form; code not released; licence unstated.**
Sources: https://arxiv.org/abs/2605.14552, https://rassetmusty.github.io/LiWi/
(read 2026-10-23).

**SynLayers (arXiv 2605.15167, 2026-05-14).** Purely synthetic layered design
data can outperform PrismLayersPro for training CLD; gains saturate around 50K
samples. Code at github.com/YangHaolin0526/SynLayers (not opened). Source:
https://arxiv.org/abs/2605.15167 (read 2026-10-23).

**PixelART (arXiv 2609.22789, 2026-09-19; Tsinghua + Canva Research).**
Pixel-space rectified-flow transformer trained from scratch for image-to-layer
decomposition: no RGBA VAE, no text-to-image pretraining. PixelART-H 1.05B
params (+2B layout detector). On one H200 at 1024²: **3.1 s and 6.6 GB peak vs
213.4 s and 72.4 GB for Qwen-Image-Layered**. Design-Multi-Layer-Bench
composite PSNR 36.92 vs Qwen 32.46 vs LayerD 36.07; VLM visual 4.57/4.81 vs
4.14/4.37 vs 3.49/3.13. Limitations (Appendix J): weak at completing regions
behind large occluders, less reliable on natural photos, degrades beyond 32
layers, needs a bounding-box layout from a detector or the user, and the 4M
training corpus and the detector are not public. Release: evaluation scripts
and outputs promised; **weights not stated**. Source:
https://arxiv.org/html/2609.22789 (read 2026-10-23).

**LayerEditor: Editing Images into Reusable Layers via Compositional Edit-Prior
Distillation (arXiv 2610.24738, 2026-10-17).** Instruction editing that also
emits ordered RGBA layers; LayerEditor-100K dataset. No code stated. Source:
https://arxiv.org/abs/2610.24738 (read 2026-10-23).

**Generative Omnimatte (CVPR 2025 Highlight, arXiv 2411.16683, v2
2025-03-24).** Video only: video + object masks → per-object layers including
shadows and reflections, via a video-inpainting model (Casper) fine-tuned to
remove object effects. The original Lumiere-based model is not public; a public
reimplementation (Apache-2.0) fine-tunes CogVideoX-Fun-5B-InP and
Wan2.1-Fun-1.3B/14B-InP, takes 1–2 min per clip on an A100 (4–5 min on an
A6000), and "does not match" the original. Not a still-image tool. Sources:
https://arxiv.org/abs/2411.16683, https://github.com/gen-omnimatte/gen-omnimatte-public
(read 2026-10-23).

**"Image as Layers".** No paper with this title was found; the nearest matches
are the items above. Unverified.

## D. Object removal and fill-behind

**LaMa (WACV 2022; Samsung Research).** Fourier-convolution inpainting; the
standard "erase" baseline. Code **Apache-2.0** (LICENSE: Samsung Research,
2021). The big-lama checkpoint was trained on Places365-Challenge (476 GB) and
is distributed outside the repo (Google Drive / HF `smartywu/big-lama`);
**no licence statement accompanies the weights**. GitHub issue #366 (opened
2026-09-01, still open 2026-10-18) asks whether the weights are Apache-2.0 and
how the Places2 "non-commercial research and educational purposes" terms
apply; no maintainer reply. Runs on CPU (`device=cpu`; IOPaint, Apache-2.0,
archived 2025-08-13, listed "support CPU & GPU & Apple Silicon"). Sources:
https://github.com/advimman/lama, https://raw.githubusercontent.com/advimman/lama/main/LICENSE,
https://github.com/advimman/lama/issues/366, https://github.com/Sanster/IOPaint
(read 2026-10-23).

**MI-GAN (ICCV 2023; Picsart).** Mobile-grade inpainting distilled from
CoModGAN; "one order of magnitude smaller and faster than recent SOTA". Models
at 256 and 512 (FFHQ, Places2); ONNX pipeline accepts arbitrary resolution
(HF andraniksargsyan/migan, MIT). **Code MIT; weights MIT** (LICENSE-WEIGHTS,
Picsart AI Research 2024). No published CPU timings (the ICCV PDF was not
retrievable here). Trained on Places2, so the same dataset-terms question as
LaMa exists in principle, but the authors have granted an explicit MIT licence
on the weights. Sources: https://github.com/Picsart-AI-Research/MI-GAN,
https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS,
https://huggingface.co/andraniksargsyan/migan (read 2026-10-23).

**MAT (CVPR 2022).** 512² transformer inpainting; **CC BY-NC 4.0**, "research
purposes only". Blocked. Source: https://raw.githubusercontent.com/fenglinglwb/MAT/main/LICENSE
(read 2026-10-23).

**PowerPaint (ECCV 2024, arXiv 2312.03594).** Task-prompted inpainting:
removal, context-aware fill, shape-guided insertion, outpainting. Code MIT;
v2-1 weights (2024-05-22) tagged **apache-2.0** on HF; BrushNet-based on the SD
1.5 family (CreativeML OpenRAIL-M). GPU. LayerDecomp's table puts PowerPaint
at RORD PSNR 20.88 (loose) / 21.26 (tight). Sources:
https://github.com/open-mmlab/PowerPaint, https://huggingface.co/JunhaoZhuang/PowerPaint-v2-1
(read 2026-10-23).

**BrushNet (ECCV 2024, arXiv 2403.06976).** Dual-branch inpainting adapter;
checkpoints for SD1.5 and SDXL on Google Drive; BrushNetX via BrushEdit
(2024-12-17). **Apache-2.0** (LICENSE). GPU; no VRAM figures. Sources:
https://github.com/TencentARC/BrushNet, https://raw.githubusercontent.com/TencentARC/BrushNet/main/LICENSE
(read 2026-10-23).

**RORem: Robust Object Remover with Human-in-the-Loop (CVPR 2025, arXiv
2501.00740).** SDXL-inpainting fine-tune on 200K+ human-verified removal
triplets; RORem-LCM LoRA for 4-step inference; a discriminator predicts
success within ~3% of human ratings. README: **Apache-2.0** (a HF mirror notes
the LICENSE file is missing from the repo); HF `LetsThink/RORem` tagged
apache-2.0, 3B params F16. Base SDXL-inpainting is OpenRAIL++. GPU. Sources:
https://github.com/leeruibin/RORem, https://huggingface.co/LetsThink/RORem
(read 2026-10-23).

**ObjectClear: Precise Object and Effect Removal (CVPR 2026, arXiv 2505.22636,
2025-05-28; NTU S-Lab).** Removes the object and its associated effects
(shadows/reflections) with target-aware attention; SDXL-inpainting base; OBER
dataset (37,994 pairs, gated). **NTU S-Lab License 1.0: non-commercial only.**
Blocked. Sources: https://github.com/zjx0101/ObjectClear,
https://huggingface.co/jixin0101/ObjectClear (read 2026-10-23).

**OmniPaint (ICCV 2025, arXiv 2503.08677, 2025-03-11).** Mask-only removal of
objects and their effects, plus insertion; introduces the reference-free CFD
metric. The weights are **MIT-licensed LoRAs on FLUX.1-dev**, so the FLUX.1
[dev] Non-Commercial License applies to any deployment. 28 steps; GPU. Sources:
https://github.com/yeates/OmniPaint, https://huggingface.co/yeates/OmniPaint
(read 2026-10-23).

**Qwen-Image-Edit / -2509 / -2511 (Alibaba, Apache-2.0, 20B).** Instruction
editing including "removing fine hair strands", adding/removing elements,
multi-image composition (1–3 inputs, 2509), ControlNet-style depth/edge/pose
conditioning, merged lighting LoRA (2511). Technical report 2025-08-04; 2509
released Sept 2025. VRAM not stated; ComfyUI uses fp8 weights and a 4-step
Lightning LoRA; the sibling Qwen-Image-Layered measured 72.4 GB in bf16 at
1024², so expect a server GPU or fp8 on a 24 GB card (inference). No removal
benchmark on the cards. Sources: https://huggingface.co/Qwen/Qwen-Image-Edit,
https://huggingface.co/Qwen/Qwen-Image-Edit-2509, https://huggingface.co/Qwen/Qwen-Image-Edit-2511,
https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit (read 2026-10-23).

**FLUX family (Black Forest Labs).** FLUX.1 Fill dev (12B inpainting) and
FLUX.1 Kontext dev (12B in-context editing, paper 2025-06-17): **FLUX.1 [dev]
Non-Commercial License**, gated. FLUX.2 [klein] (2026-01-15): 4B and 4B-Base
are **Apache-2.0** (~13 GB VRAM, 4 steps, text-to-image plus single- and
multi-reference editing; mask inpainting not mentioned); 9B variants are under
the FLUX Non-Commercial License v2.1 ("may only ... use ... for Non-Commercial
Purposes", no production use). FLUX Erase (2026-05-21) is API-only, built on
Klein 9B per BFL docs, removes "traces like shadows"; BFL's own 198-image eval
reports 68.5% wins vs GPT Image-2 and 63.2% vs Finegrain Eraser. Sources:
https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev,
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev,
https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence,
https://huggingface.co/black-forest-labs/FLUX.2-klein-4B,
https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/blob/main/LICENSE.md,
https://bfl.ai/blog/flux-erase-remove-anything-leave-no-trace (read 2026-10-23).

**"Erase-anything".** No paper, repo or weights found under this name
(unverified; may refer to FLUX Erase or to community LoRAs on FLUX Fill such
as `lrzjason/ObjectRemovalFluxFill`, which is non-commercial via its base).

**Video-only effect removal (context, not for stills).** VOID (arXiv
2604.02296, 2026-04-02; CogVideoX-based two-pass pipeline; ComfyUI docs say
the weights are Apache-2.0 and attribute it to Netflix) and SVOR (Xiaomi,
arXiv 2026-03-10, code 2026-04-21, Apache-2.0, LoRAs on Wan2.1-VACE-1.3B, ~33
GB default) both remove objects with shadows and reflections. PROVE-Bench (ACM
MM 2026, arXiv 2605.14534) ranks SVOR first on removal coherence (RC-S 0.5197)
among 11 video removers; it evaluates no still-image models. Sources:
https://docs.comfy.org/tutorials/utility/void-video-inpainting,
https://arxiv.org/abs/2604.02296, https://github.com/xiaomi-research/svor,
https://xiaomi-research.github.io/prove/ (read 2026-10-23).

## E. Shadows, reflections and "visual effects" layers

**ObjectDrop (ECCV 2024, arXiv 2403.18818, 2024-03-27; Google).**
Counterfactual before/after photos teach a diffusion model to remove an object
with its shadows and reflections; bootstrap supervision for insertion. **No
code or weights** (confirmed by the bcmi shadow-generation survey list).
Sources: https://arxiv.org/abs/2403.18818,
https://github.com/bcmi/Awesome-Object-Shadow-Generation (read 2026-10-23).

**MetaShadow (CVPR 2025, arXiv 2412.02635, 2024-12-03; Adobe).**
Object-centred shadow detection, removal and reference-based synthesis in one
framework. **No code.** Source: https://arxiv.org/abs/2412.02635 (read
2026-10-23).

**LayerDecomp** (above) is the only still-image decomposer that explicitly
puts shadow and reflection into the foreground layer; unreleased. **ObjectClear**
removes effects but is non-commercial. **LiWi** models illumination effects
but is request-only. **Qwen-Image-Layered** makes no claim about effects.

**Shadow generation for an inserted or moved layer.**
GPSDiffusion (CVPR 2025; MIT; DESOBAv2; integrated in libcom; authors warn
"performance ... is unstable", generate several and pick)
https://github.com/bcmi/GPSDiffusion-Object-Shadow-Generation. SGDiffusion
(CVPR 2024; repo Apache-2.0; SD2.1-style training script; DESOBAv2 = 28,573
object–shadow pairs from 21,575 real outdoor images)
https://github.com/bcmi/Object-Shadow-Generation-Dataset-DESOBAv2. Controllable
Shadow Generation with Single-Step Diffusion from Synthetic Data (Jasper AI,
arXiv 2412.11972, 2024-12-16): rectified-flow, one step, controls θ/φ light
direction, size (softness), intensity; benchmark released on HF, **weights not
stated** https://gojasper.github.io/controllable-shadow-generation-project/.
Embedding Physical Reasoning into Diffusion-Based Shadow Generation (Stony
Brook, arXiv 2512.06174; MIT; code "will be released") 
https://github.com/cvlab-stonybrook/ShadowGeneration. VSDiffusion (ECCV 2026)
and CoShadow (arXiv 2603.02743) have no code. (All read 2026-10-23.)

**Reflection generation.** libcom ships RGDiffusion (ReflectionGenerationModel);
no separate paper checked (unverified).

## F. Recomposition coherence (light, shadow, perspective, colour)

**Harmonisation (colour/illumination of the pasted layer).**
PCT-Net (CVPR 2023; Rakuten; **MPL-2.0**; full-resolution; inference on CPU
via `--gpu cpu`) https://github.com/rakutentech/PCT-Net-Image-Harmonization.
Harmonizer (ECCV 2022; 20 MB; real-time Full HD on GPU, up to 8K; **CC
BY-NC-SA 4.0**) blocked https://github.com/ZHKKKe/Harmonizer. Region-to-Region
(arXiv 2025; MIT; generative, SD-inpainting + DiffHarmony-derived weights;
iHarmony4) https://github.com/anonymity-111/Region_to_Region. The bcmi survey
lists no 2025–2026 illumination-aware harmonisation paper with code; the only
2025–26 generative entry with code is Region-to-Region
https://github.com/bcmi/Awesome-Image-Harmonization. libcom (Apache-2.0
toolbox, updated Oct 2026) bundles PCTNet/LBM harmonisation, PHDNet/PHDiffusion
painterly harmonisation, OPA/FOPA placement, BargainNet harmony scoring,
GPSDiffusion shadows, RGDiffusion reflections, OSInsert generative insertion
and a FluxKontext blending model — the last inherits the FLUX non-commercial
licence https://github.com/bcmi/libcom. (All read 2026-10-23.)

**Relighting the layer to the scene.**
IC-Light (ICLR 2025; lllyasviel): code **Apache-2.0**; v1 weights
(`iclight_sd15_fc/fbc`, SD1.5, text- or background-conditioned) tagged
**creativeml-openrail-m** on HF; README says replace BRIA RMBG-1.4 with
BiRefNet for commercial work. **IC-Light V2 (Flux-based, announced 2024-10-27)
is "non-commercial only" and its weights were never released** (API via fal
only, per the thread through Aug 2025). Sources:
https://github.com/lllyasviel/IC-Light, https://huggingface.co/lllyasviel/ic-light,
https://github.com/lllyasviel/IC-Light/discussions/98. LBM: Latent Bridge
Matching (ICCV 2025 Highlight, arXiv 2503.07535, 2025-03-10; Jasper AI):
single-step relighting of a foreground to a background, SDXL-based 3B; also
object removal, shadow, normals, depth. **Weights CC BY-NC 4.0; code CC BY-NC
4.0.** Blocked. https://huggingface.co/jasperai/LBM_relighting,
https://github.com/gojasper/LBM. Video relighters (Light-A-Video ICCV 2025,
LightCtrl ICLR 2026, RelightVid) all wrap IC-Light (secondary). (All read
2026-10-23.)

**Insertion / composition models (place a layer and let the model fix light,
shadow, perspective).**
AnyDoor (arXiv 2307.09481; code MIT; ckpt 2023-12-17; SD2.1 + DINOv2; weights
licence unstated; HF card returned 401) https://github.com/ali-vilab/AnyDoor.
ObjectStitch (arXiv 2212.00932; Adobe; shadow-aware compositing; **no code**)
https://arxiv.org/abs/2212.00932. ObjectMover (CVPR 2025, arXiv 2503.08037;
moves an object inside an image with a fine-tuned video model: relights,
re-poses, fills occlusion, keeps shadows/reflections in sync; **no code
statement**) https://arxiv.org/abs/2503.08037. DreamFuse (ICCV 2025, arXiv
2504.08291; ByteDance + SYSU; positional-affine fusion + localised DPO; 80K
dataset; **FLUX.1-dev LoRA, "follows the FLUX-DEV License"**) blocked
https://github.com/LL3RD/DreamFuse-Code. Insert Anything (AAAI 2026 oral,
arXiv 2504.15009; MIT code, **LoRA on FLUX.1 Fill dev** → non-commercial; 10 GB
with Nunchaku, 26–40 GB otherwise) blocked https://github.com/song-wensong/insert-anything.
MagicQuill (CVPR 2025, arXiv 2411.09703; SD1.5 + BrushNet + LLaVA; 8 GB VRAM;
**CC BY-NC 4.0**) blocked https://raw.githubusercontent.com/magic-quill/MagicQuill/main/LICENSE.
OmniGen2 (2025-06-16; code Apache-2.0, weights licence not stated on the
page; ~17 GB VRAM, <3 GB with sequential CPU offload; in-context composition
of people/objects/scenes) https://github.com/VectorSpaceLab/OmniGen2.
Qwen-Image-Edit-2509/2511 and FLUX.2 klein 4B (above) are the permissive
general editors that can do "insert and harmonise" by instruction. (All read
2026-10-23.)

## G. Three buckets

**(1) Runs on a CPU today, permissive.**
- Masks: BiRefNet Swin-T / lite via ONNX (MIT), U²-Net / U²-NetP (Apache-2.0),
  IS-Net (Apache-2.0), InSPyReNet (MIT), BEN2 base (MIT), SAM 2.1 Tiny/Small
  (Apache-2.0; 38.9M/46M params; CPU timing not published, inference).
- Naming/boxing: Florence-2-large (MIT, 0.77B, fp32 on CPU), Grounding DINO
  Swin-T (Apache-2.0, `--cpu-only`), OWLv2 (Apache-2.0, 0.2B).
- Fill-behind: MI-GAN 512 ONNX (MIT code and weights). LaMa (Apache-2.0 code;
  weights licence unresolved).
- Design decomposition: LayerD (Apache-2.0; `device="cpu"` in the README).
- Harmonisation: PCT-Net (MPL-2.0, `--gpu cpu`); classical alpha/Poisson
  blending and colour transfer (libcom functions).
None of these publish CPU latencies; we would have to measure.

**(2) Needs a GPU.**
- SAM 3 / 3.1 (CUDA required; 848M; ~30 ms/image on H200).
- Qwen-Image-Layered (20B; 72.4 GB bf16 peak and 213 s at 1024² on H200; fp8
  available) — the only permissive generative decomposer.
- Qwen-Image-Edit 2509/2511 (20B), OmniGen2 (~17 GB), FLUX.2 klein 4B (~13 GB).
- SD-family inpainting: PowerPaint v2-1, BrushNet, RORem (SDXL), Region-to-Region.
- IC-Light v1 (SD1.5), GPSDiffusion / SGDiffusion shadows.
- Amodal: Open-World Amodal (13B VLM + SD2), CObL (SD), pix2gestalt (22–28 GB,
  but blocked).
- Video: Generative Omnimatte reimplementation (A100, minutes per clip), SVOR
  (~33 GB), VOID.

**(3) Licence-blocked for a commercial product (without a separate agreement).**
- Non-commercial weights: pix2gestalt (CC BY-NC 4.0), SynergyAmodal (CC
  BY-NC-SA 4.0), MAT (CC BY-NC 4.0), ObjectClear (S-Lab 1.0), MagicQuill (CC
  BY-NC 4.0), Harmonizer (CC BY-NC-SA 4.0), LBM relighting (CC BY-NC 4.0),
  IC-Light V2 (non-commercial, unreleased), BRIA RMBG-1.4 / 2.0 (CC BY-NC +
  commercial agreement).
- FLUX non-commercial base: anything on FLUX.1-dev, Fill-dev, Kontext-dev or
  FLUX.2 klein 9B — OmniPaint, CLD, DreamFuse, Insert Anything, libcom's
  FluxKontext blending, community "ObjectRemovalFluxFill" LoRAs.
- Copyleft: YOLO-World (GPL-3.0), YOLOE (AGPL-3.0, secondary).
- Unresolved: LaMa big-lama weights (no licence text; Places2 terms; issue
  open since 2026-09-01 with no reply).
- API-only, paid: FLUX Erase, Grounding DINO 1.5/1.6, DINO-X, IC-Light V2 (fal),
  BEN2 full.
- Not available at all (no public weights as of 2026-10-23): LayerDecomp,
  ObjectDrop, MetaShadow, ObjectStitch, ObjectMover, LiWi (request form),
  PixelART, CreatiParser, LayerEditor, Cycle-Consistent Tuning, From Inpainting
  to Layer Decomposition, Multi-Agent Amodal, Controllable Shadow Generation
  (weights), Stony Brook shadow (pending); RefLayer and DiffDecompose unverified.
- Custom but commercially usable: SAM 3 "SAM License" (royalty-free, no
  commercial restriction, trade-control clauses, redistribute only under the
  same terms). SD1.5/SD2/SDXL weights are OpenRAIL-M/++ (commercial use with
  use-based restrictions; cards say "research purposes only").

## What this means for Napkin

- A permissive, CPU-only delayering tier is buildable now: Florence-2 or
  Grounding DINO to find objects → SAM 2.1 or BiRefNet for masks → MI-GAN to
  fill the hole → ordered RGBA layers. It yields "cut-out plus plausible
  background", with no amodal completion and shadows left in the background.
  That is the honest floor, and it is licence-clean if we pin rembg away from
  the BRIA default and prefer MI-GAN over LaMa.
- True generative decomposition is a GPU product feature. Qwen-Image-Layered
  (Apache-2.0) is the only candidate with public weights; budget a server GPU
  (72 GB bf16 or fp8 on 24 GB, minutes per image at 1024) and expect weaker
  results on photos than on designs (LiWi and PixelART both report this). If
  the product path is API-first, this belongs behind an async job, not a
  canvas interaction.
- Shadow and reflection layers for stills are not available permissively.
  Plan for a two-step approximation: dilate the mask to swallow the shadow
  before fill, then regenerate a shadow for the moved layer with GPSDiffusion
  (MIT) or leave shadows as an explicit "not yet" in the UI. Do not promise
  ObjectDrop-grade effect handling.
- Recomposition coherence has one permissive CPU option (PCT-Net harmonisation,
  MPL-2.0) and GPU options via general Apache-2.0 editors (Qwen-Image-Edit
  2511, FLUX.2 klein 4B, OmniGen2) used as a "make this layer fit" instruction
  pass. IC-Light v1 is usable under OpenRAIL-M if the owner accepts its
  use-restriction terms; the stronger relighters (IC-Light V2, LBM) are
  non-commercial.
- Treat the FLUX.1-dev ecosystem as off-limits: most 2025 removal, layering
  and composition LoRAs (OmniPaint, CLD, DreamFuse, Insert Anything) inherit
  the non-commercial licence regardless of their MIT/Apache code. FLUX.2 klein
  4B is the one Apache-2.0 FLUX model.
- SAM 3 is attractive (concept prompts, 30 ms on H200) and its licence allows
  commercial use, but it is a custom Meta licence with trade-control clauses
  and a same-terms redistribution rule, gated weights, and a hard CUDA
  requirement. Decide whether "permissive OSS" means OSI-approved only.
- The research is moving monthly (PixelART Sep 2026: 1B params, 3 s, 6.6 GB;
  LayerEditor Oct 2026). Design the layer document format now as an ordered
  list of RGBA layers with optional effect layers and provenance (which model,
  which mask), so the decomposer can be swapped when a small permissive one
  ships.
- Before any build, run our own CPU benchmark (BiRefNet lite, SAM 2.1 tiny,
  MI-GAN 512, PCT-Net) on the target hardware. None of these projects publish
  CPU latencies.

## Open questions

- Will PixelART, LiWi or LayerDecomp release weights, and under what licence?
  (PixelART's authors say the corpus and detector stay private.)
- Does the Places2 non-commercial dataset term bind the LaMa big-lama weights
  (and, in principle, MI-GAN's Places2 model despite its MIT grant)? A legal
  read is needed before shipping either.
- What is Qwen-Image-Layered's real latency and quality at 640 px in fp8 on a
  24 GB GPU, and how far does it degrade on product photography versus
  designs?
- Is Meta's SAM License acceptable under the project's "permissive OSS" rule,
  given it is not OSI-approved and requires same-terms redistribution?
- Can FLUX.2 klein 4B do mask-constrained inpainting well enough for
  fill-behind, or is it editing-only? Not verified at a primary source.
- Are SD1.5/SDXL OpenRAIL licences (and the "research purposes only" lines on
  their cards) acceptable to the owner for PowerPaint, BrushNet, RORem,
  IC-Light v1 and Region-to-Region?
- Could LayerD's iterative matting-and-fill loop (Apache-2.0, CPU) be adapted
  from graphic designs to photos with BiRefNet-matting plus MI-GAN fill, as a
  cheap middle tier?
- Which reflection-generation model is in libcom (RGDiffusion) and what is its
  licence? Not checked.

## Source list (primary unless marked)

Segmentation: https://github.com/facebookresearch/sam2 ·
https://arxiv.org/abs/2511.16719 · https://github.com/facebookresearch/sam3 ·
https://raw.githubusercontent.com/facebookresearch/sam3/main/LICENSE ·
https://huggingface.co/facebook/sam3 · https://huggingface.co/facebook/sam3.1 ·
https://ai.meta.com/blog/segment-anything-model-3/ ·
https://github.com/ZhengPeng7/BiRefNet · https://github.com/xuebinqin/U-2-Net ·
https://github.com/xuebinqin/DIS · https://github.com/plemeri/InSPyReNet ·
https://huggingface.co/PramaLLC/BEN2 · https://huggingface.co/briaai/RMBG-2.0 ·
https://github.com/danielgatis/rembg · https://github.com/IDEA-Research/GroundingDINO ·
https://github.com/IDEA-Research/Grounded-SAM-2 ·
https://huggingface.co/microsoft/Florence-2-large ·
https://huggingface.co/google/owlv2-base-patch16-ensemble ·
https://github.com/AILab-CVC/YOLO-World
Amodal: https://github.com/cvlab-columbia/pix2gestalt ·
https://raw.githubusercontent.com/cvlab-columbia/pix2gestalt/main/LICENSE ·
https://k8xu.github.io/amodal/ · https://github.com/k8xu/amodal ·
https://github.com/saraao/amodal · https://github.com/imlixinyang/SynergyAmodal ·
https://arxiv.org/abs/2508.08498 · https://vision.seas.harvard.edu/cobl/ ·
https://github.com/aneeldamaraju/cobl · https://arxiv.org/abs/2509.17757 ·
https://arxiv.org/abs/2602.19358
Layer decomposition: https://arxiv.org/html/2411.17864 ·
https://rayjryang.github.io/LayerDecomp/ · https://arxiv.org/abs/2505.21541 ·
https://huggingface.co/Qwen/Qwen-Image-Layered/blob/main/README.md ·
https://github.com/QwenLM/Qwen-Image-Layered · https://arxiv.org/html/2512.15603 ·
https://docs.comfy.org/tutorials/image/qwen/qwen-image-layered ·
https://github.com/CyberAgentAILab/LayerD · https://github.com/monkek123King/CLD ·
https://huggingface.co/thuteam/CLD · https://arxiv.org/abs/2511.16249 ·
https://arxiv.org/abs/2511.20996 · https://arxiv.org/abs/2602.20989 ·
https://vcc.tech/research/2026/ImgDecom · https://arxiv.org/abs/2604.19632 ·
https://arxiv.org/abs/2605.14552 · https://rassetmusty.github.io/LiWi/ ·
https://arxiv.org/abs/2605.15167 · https://arxiv.org/html/2609.22789 ·
https://arxiv.org/abs/2610.24738 · https://arxiv.org/abs/2411.16683 ·
https://github.com/gen-omnimatte/gen-omnimatte-public
Removal: https://github.com/advimman/lama ·
https://raw.githubusercontent.com/advimman/lama/main/LICENSE ·
https://github.com/advimman/lama/issues/366 · https://github.com/Sanster/IOPaint ·
https://github.com/Picsart-AI-Research/MI-GAN ·
https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS ·
https://huggingface.co/andraniksargsyan/migan ·
https://raw.githubusercontent.com/fenglinglwb/MAT/main/LICENSE ·
https://github.com/open-mmlab/PowerPaint · https://huggingface.co/JunhaoZhuang/PowerPaint-v2-1 ·
https://github.com/TencentARC/BrushNet ·
https://raw.githubusercontent.com/TencentARC/BrushNet/main/LICENSE ·
https://github.com/leeruibin/RORem · https://huggingface.co/LetsThink/RORem ·
https://github.com/zjx0101/ObjectClear · https://huggingface.co/jixin0101/ObjectClear ·
https://github.com/yeates/OmniPaint · https://huggingface.co/yeates/OmniPaint ·
https://huggingface.co/Qwen/Qwen-Image-Edit · https://huggingface.co/Qwen/Qwen-Image-Edit-2509 ·
https://huggingface.co/Qwen/Qwen-Image-Edit-2511 ·
https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit ·
https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev ·
https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev ·
https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence ·
https://huggingface.co/black-forest-labs/FLUX.2-klein-4B ·
https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/blob/main/LICENSE.md ·
https://bfl.ai/blog/flux-erase-remove-anything-leave-no-trace ·
https://docs.comfy.org/tutorials/utility/void-video-inpainting ·
https://arxiv.org/abs/2604.02296 · https://github.com/xiaomi-research/svor ·
https://xiaomi-research.github.io/prove/ ·
https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting ·
https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1
Shadows and coherence: https://arxiv.org/abs/2403.18818 ·
https://arxiv.org/abs/2412.02635 · https://github.com/bcmi/Awesome-Object-Shadow-Generation ·
https://github.com/bcmi/GPSDiffusion-Object-Shadow-Generation ·
https://github.com/bcmi/Object-Shadow-Generation-Dataset-DESOBAv2 ·
https://arxiv.org/abs/2412.11972 · https://gojasper.github.io/controllable-shadow-generation-project/ ·
https://github.com/cvlab-stonybrook/ShadowGeneration ·
https://github.com/rakutentech/PCT-Net-Image-Harmonization · https://github.com/ZHKKKe/Harmonizer ·
https://github.com/anonymity-111/Region_to_Region · https://github.com/bcmi/Awesome-Image-Harmonization ·
https://github.com/bcmi/libcom · https://github.com/lllyasviel/IC-Light ·
https://huggingface.co/lllyasviel/ic-light · https://github.com/lllyasviel/IC-Light/discussions/98 ·
https://huggingface.co/jasperai/LBM_relighting · https://github.com/gojasper/LBM ·
https://arxiv.org/abs/2503.07535 · https://github.com/ali-vilab/AnyDoor ·
https://arxiv.org/abs/2212.00932 · https://arxiv.org/abs/2503.08037 ·
https://ll3rd.github.io/DreamFuse/ · https://github.com/LL3RD/DreamFuse-Code ·
https://github.com/song-wensong/insert-anything · https://huggingface.co/WensongSong/Insert-Anything ·
https://raw.githubusercontent.com/magic-quill/MagicQuill/main/LICENSE ·
https://github.com/VectorSpaceLab/OmniGen2
Secondary only: Roboflow licence table (YOLOE AGPL), LibreYOLO SAM 3 notes,
ComfyUI Wiki on IC-Light V2.
