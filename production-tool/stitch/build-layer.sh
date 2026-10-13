#!/usr/bin/env bash
# Build the ffmpeg Lambda layer for the stitch function (x86_64):
#   bin/ffmpeg, bin/ffprobe  static build from johnvansickle.com (GPL, libx264 + libfreetype)
# Output: ffmpeg-layer.zip (about 70 MB; publish it through S3, it is over the 50 MB direct limit).
#
#   production-tool/stitch/build-layer.sh [out.zip]
# deploy-production-tool.yml runs this and publishes the layer when the stitch
# function has none (or when asked to rebuild it).
#
# The download is pinned: version, URL and sha256 below must equal licences/binaries.toml
# (the licence gate checks it). The upstream keeps only some old releases, so when the URL
# is gone the script tries the mirror, FFMPEG_MIRROR (s3://$BUCKET/<FFMPEG_MIRROR_PATH>),
# which the deploy writes after its first verified download. The verified tarball is left
# next to the output zip for that upload.
set -euo pipefail
FFMPEG_VERSION=7.0.2
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"
FFMPEG_SHA256=abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67
FFMPEG_MIRROR_PATH="build/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"
tarball="ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"

out="$(realpath -m "${1:-ffmpeg-layer.zip}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
if ! curl -fsSL -o "$tarball" "$FFMPEG_URL"; then
  if [[ -z "${FFMPEG_MIRROR:-}" ]]; then
    echo "build-layer.sh: $FFMPEG_URL failed and FFMPEG_MIRROR is not set" >&2
    exit 1
  fi
  echo "build-layer.sh: upstream unavailable, trying the mirror $FFMPEG_MIRROR" >&2
  aws s3 cp --only-show-errors "$FFMPEG_MIRROR" "$tarball"
fi
echo "$FFMPEG_SHA256  $tarball" | sha256sum -c --quiet -
mkdir -p layer/bin
tar -xJf "$tarball" --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
mv ffmpeg ffprobe layer/bin/
(cd layer && zip -qr9 "$out" bin)
cp "$tarball" "$(dirname "$out")/$tarball"
echo "$out"
