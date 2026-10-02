#!/usr/bin/env bash
#
# Runs build-image.sh in a privileged arm64 docker container.
#
# Run it on a machine with docker, not in the dev container: the build needs
# loop devices, which the dev container is not given.
#
# Usage: ./build.sh [build-image.sh options]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDER_IMAGE=humidity-temp-image-builder

# The download cache and the working .img live in a named volume rather than a
# bind mount. Loop devices over files on Docker Desktop's host file sharing are
# slow at best, and only the finished .img.xz needs to reach the host.
CACHE_VOLUME=humidity-temp-image-cache

# arm64 makes the chroot native. On an x86_64 host docker runs the whole
# container under qemu, which Docker Desktop registers out of the box.
docker build --platform linux/arm64 -t "$BUILDER_IMAGE" "$SCRIPT_DIR"

mkdir -p "$SCRIPT_DIR/out"
docker run --rm --privileged --platform linux/arm64 \
  -v "$SCRIPT_DIR:/image" \
  -v "$CACHE_VOLUME:/cache" \
  -e CACHE_DIR=/cache \
  -e WORK_DIR=/cache/work \
  -e OUT_DIR=/image/out \
  "$BUILDER_IMAGE" \
  ./build-image.sh "$@"
