# Build environment for build-image.sh. Run through build.sh, which adds
# --privileged for loop devices and pins the platform to arm64.
#
# Debian trixie matches the target image, so e2fsprogs here understands every
# ext4 feature the official rootfs was created with.
FROM debian:trixie-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils jq fdisk e2fsprogs mount util-linux && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /image
