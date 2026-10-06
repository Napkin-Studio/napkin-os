#!/usr/bin/env bash
# Build the ffmpeg Lambda layer for the stitch function (x86_64):
#   bin/ffmpeg, bin/ffprobe  static build from johnvansickle.com (GPL, libx264 + libfreetype)
#   fonts/DejaVuSans-Bold.ttf  for the end card (DejaVu fonts licence)
# Output: ffmpeg-layer.zip (about 70 MB; publish it through S3, it is over the 50 MB direct limit).
#
#   production-tool/stitch/build-layer.sh [out.zip]
# deploy-production-tool.yml runs this and publishes the layer when the stitch
# function has none (or when asked to rebuild it).
set -euo pipefail
out="$(realpath -m "${1:-ffmpeg-layer.zip}")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
curl -fsSL -o ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
mkdir -p layer/bin layer/fonts
tar -xJf ffmpeg.tar.xz --strip-components=1 --wildcards '*/ffmpeg' '*/ffprobe'
mv ffmpeg ffprobe layer/bin/
curl -fsSL -o dejavu.tar.bz2 https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2
tar -xjf dejavu.tar.bz2 --strip-components=2 --wildcards '*/ttf/DejaVuSans-Bold.ttf'
mv DejaVuSans-Bold.ttf layer/fonts/
(cd layer && zip -qr9 "$out" bin fonts)
echo "$out"
