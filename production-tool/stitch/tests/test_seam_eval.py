"""The offline seam eval (eval/seam_eval.py), run by CI's stitch pytest step with no ci.yml change."""

import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
import seam_eval  # noqa: E402

pytestmark = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs ffmpeg")


@pytest.fixture(scope="module")
def report():
    return seam_eval.evaluate()


def test_matched_patches_pass_and_shifted_or_recoloured_ones_fail(report):
    for case in report["cases"]:
        assert case["right"], case
        assert case["exact"] is True, case


def test_five_chained_patches_keep_the_margin_at_50_db_and_far_gops_untouched(report):
    chain = report["chain"]
    assert chain["patches"] == 5 and chain["marginFrames"] > 0
    assert chain["marginPsnrMin"] >= seam_eval.PSNR_MIN, chain
    assert chain["farPsnrMin"] == float("inf"), chain
    assert report["ok"]
