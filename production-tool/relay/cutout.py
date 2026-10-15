"""Rhea's cut-out on our server (the cutout op; features/image-editor.clan, ui-behaviour 3.12).

Remove background runs on the person's device first (web/src/ml/cutout.ts, BiRefNet-lite on WebGPU).
The browser sends the cutout op here when it has no WebGPU or little memory, and the editor then says
"ran on our server". No provider is involved and nothing is charged: the relay runs the same model.

Segmenters:
- OnnxSegmenter: onnx-community/BiRefNet_lite-ONNX (MIT code and weights; licences/weights.toml) under
  onnxruntime on the CPU. The weights file is named by CUTOUT_WEIGHTS and must hash to WEIGHTS_SHA256;
  onnxruntime and numpy are installed only where it runs (a Lambda layer, a person's rollout step).
- MockSegmenter: a labelled stand-in for local work and tests: the picture minus what matches its border.

from_env() picks one: CUTOUT_WEIGHTS gives the real one; NAPKIN_CUTOUT=mock the stand-in; else None,
and the relay answers capability_missing.
"""

from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
from typing import Optional, Protocol

from PIL import Image, ImageChops, ImageFilter

# The model, at the revision whose file hashes licences/weights.toml lists (the gate reads this name).
CUTOUT_MODEL_NAME = "onnx-community/BiRefNet_lite-ONNX"
REVISION = "de15b22ba131738a16dff04aab8bdf8dc32e3ac1"
WEIGHTS_FILE = "onnx/model.onnx"  # fp32 on the CPU; the browser runs onnx/model_fp16.onnx on WebGPU
WEIGHTS_SHA256 = "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333"
SIDE = 1024  # BiRefNet's input: 1024 x 1024, ImageNet mean and std (its preprocessor_config.json)
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


class Segmenter(Protocol):
    model: str
    kind: str  # "generated" or "mock", as a job's outputs are labelled

    def matte(self, img: Image.Image) -> Image.Image:
        """An L image the picture's size: 255 where the subject is."""
        ...


class MockSegmenter:
    """Everything that differs from the picture's border colour, softened. Labelled mock: it is a
    stand-in, never a real cut-out."""
    model = "mock-cutout"
    kind = "mock"

    def __init__(self, tolerance: int = 40):
        self.tolerance = tolerance

    def matte(self, img: Image.Image) -> Image.Image:
        rgb = img.convert("RGB")
        w, h = rgb.size
        edge = [rgb.getpixel((x, y)) for x in range(0, w, max(1, w // 32)) for y in (0, h - 1)]
        edge += [rgb.getpixel((x, y)) for y in range(0, h, max(1, h // 32)) for x in (0, w - 1)]
        bg = tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))
        diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg))
        r, g, b = diff.split()
        most = ImageChops.lighter(ImageChops.lighter(r, g), b)
        hard = most.point(lambda v: 255 if v > self.tolerance else 0)
        return hard.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.2))


class OnnxSegmenter:
    """BiRefNet-lite under onnxruntime (MIT). Loads lazily, once, after checking the file's hash."""
    model = "birefnet_lite"
    kind = "generated"

    def __init__(self, path: str | Path, sha256: str = WEIGHTS_SHA256):
        self.path, self.sha256 = Path(path), sha256
        self._session = None

    def _load(self):
        if self._session is None:
            digest = hashlib.sha256()
            with open(self.path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    digest.update(chunk)
            if digest.hexdigest() != self.sha256:
                raise ValueError(f"{self.path} is not {CUTOUT_MODEL_NAME}@{REVISION[:7]} (its hash differs)")
            import onnxruntime  # installed where the real segmenter runs (rollout: a Lambda layer)
            self._session = onnxruntime.InferenceSession(str(self.path), providers=["CPUExecutionProvider"])
        return self._session

    def matte(self, img: Image.Image) -> Image.Image:
        session = self._load()
        import numpy as np  # with onnxruntime, where the real segmenter runs
        x = np.asarray(img.convert("RGB").resize((SIDE, SIDE), Image.BILINEAR), dtype=np.float32) / 255.0
        x = ((x - np.array(MEAN, np.float32)) / np.array(STD, np.float32)).transpose(2, 0, 1)[None]
        logits = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
        alpha = (1.0 / (1.0 + np.exp(-logits)) * 255.0).clip(0, 255).astype(np.uint8)
        return Image.fromarray(alpha, mode="L").resize(img.size, Image.BILINEAR)


def cut_out(data: bytes, segmenter: Segmenter) -> tuple[bytes, int, int]:
    """The picture with its background made transparent: an RGBA PNG the picture's size."""
    img = Image.open(io.BytesIO(data))
    img.load()
    rgba = img.convert("RGBA")
    alpha = segmenter.matte(img)
    if alpha.size != rgba.size:
        alpha = alpha.resize(rgba.size, Image.BILINEAR)
    rgba.putalpha(ImageChops.multiply(rgba.getchannel("A"), alpha.convert("L")))
    out = io.BytesIO()
    rgba.save(out, format="PNG")
    return out.getvalue(), rgba.width, rgba.height


def from_env(env: Optional[dict] = None) -> Optional[Segmenter]:
    env = os.environ if env is None else env
    path = (env.get("CUTOUT_WEIGHTS") or "").strip()
    if path:
        return OnnxSegmenter(path)
    if (env.get("NAPKIN_CUTOUT") or "").strip() == "mock":
        return MockSegmenter()
    return None
