#!/usr/bin/env bash
#
# Builds a custom Raspberry Pi OS Lite (64-bit) image for Raspberry Pi Imager.
#
# Downloads the latest official Lite arm64 image, installs everything listed in
# packages.txt into it through a chroot, and writes a .img.xz to out/ that
# Imager flashes through "Use custom".
#
# Needs root, loop devices and an arm64 userland (native or via binfmt/qemu),
# so it does not run in the dev container. Use build.sh, which provides all
# three in a privileged docker container.
#
# Usage: ./build-image.sh [--url <img.xz url>] [--grow-mb <n>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_SUFFIX="humidity-temp-sensor"
PACKAGES_FILE="${SCRIPT_DIR}/packages.txt"

# Redirects to the current release, e.g.
# .../raspios_lite_arm64-2026-09-15/2026-09-15-raspios-trixie-arm64-lite.img.xz
LATEST_URL="https://downloads.raspberrypi.com/raspios_lite_arm64_latest"

CACHE_DIR="${CACHE_DIR:-${SCRIPT_DIR}/cache}"
WORK_DIR="${WORK_DIR:-${CACHE_DIR}/work}"
OUT_DIR="${OUT_DIR:-${SCRIPT_DIR}/out}"

# Headroom added to the root partition before installing. The official image
# ships with only a few hundred MB free, which build-essential alone exceeds.
# The extra space costs nothing once compressed, and the first boot still grows
# the partition to fill the card.
GROW_MB=1024

SOURCE_URL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --url) SOURCE_URL="$2"; shift 2 ;;
    --grow-mb) GROW_MB="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
ok() { printf '\033[32m  + %s\033[0m\n' "$1"; }

if [ "$EUID" -ne 0 ]; then
  echo "Must run as root (loop devices, mount, chroot). Use build.sh." >&2
  exit 1
fi

for tool in curl xz sfdisk jq losetup e2fsck resize2fs fstrim chroot sha256sum; do
  command -v "$tool" > /dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done

# Package list: one per line, '#' comments and blank lines ignored.
mapfile -t PACKAGES < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' -e '/^$/d' "$PACKAGES_FILE")
if [ "${#PACKAGES[@]}" -eq 0 ]; then
  echo "No packages listed in ${PACKAGES_FILE}" >&2
  exit 1
fi

mkdir -p "$CACHE_DIR" "$WORK_DIR" "$OUT_DIR"

say "Resolving the base image"
if [ -z "$SOURCE_URL" ]; then
  SOURCE_URL="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$LATEST_URL")"
fi
SOURCE_FILE="$(basename "$SOURCE_URL")"
BASE_NAME="${SOURCE_FILE%.img.xz}"
ok "$SOURCE_URL"

say "Downloading ${SOURCE_FILE}"
EXPECTED_SHA="$(curl -fsSL "${SOURCE_URL}.sha256" | awk '{print $1}')"
SOURCE_PATH="${CACHE_DIR}/${SOURCE_FILE}"

if [ -f "$SOURCE_PATH" ] && echo "${EXPECTED_SHA}  ${SOURCE_PATH}" | sha256sum -c --status; then
  ok "cached copy matches the published sha256"
else
  # -C - resumes a partial download left by an interrupted run.
  curl -fL -C - -o "${SOURCE_PATH}.part" "$SOURCE_URL"
  echo "${EXPECTED_SHA}  ${SOURCE_PATH}.part" | sha256sum -c --status || {
    rm -f "${SOURCE_PATH}.part"
    echo "sha256 mismatch for ${SOURCE_FILE}; deleted the download, re-run to retry." >&2
    exit 1
  }
  mv "${SOURCE_PATH}.part" "$SOURCE_PATH"
  ok "sha256 verified"
fi

IMG="${WORK_DIR}/${BASE_NAME}-${IMAGE_SUFFIX}.img"
MNT="${WORK_DIR}/rootfs"
ROOT_LOOP=""
BOOT_LOOP=""

cleanup() {
  set +e
  if mountpoint -q "$MNT"; then
    umount -R "$MNT"
  fi
  [ -n "$BOOT_LOOP" ] && losetup -d "$BOOT_LOOP"
  [ -n "$ROOT_LOOP" ] && losetup -d "$ROOT_LOOP"
  BOOT_LOOP=""
  ROOT_LOOP=""
}
trap cleanup EXIT

say "Expanding the image by ${GROW_MB}MB"
xz -dc -T0 "$SOURCE_PATH" > "$IMG"
truncate -s "+${GROW_MB}M" "$IMG"
# Grow partition 2 (root) into the new space. The disk identifier, and so every
# PARTUUID in cmdline.txt and fstab, is left alone.
printf ', +\n' | sfdisk --quiet --no-reread --no-tell-kernel -N 2 "$IMG"

# Loop devices are attached per partition with an explicit offset, rather than
# with losetup -P. Inside a container /dev is a static snapshot, so the
# /dev/loopNpM nodes that -P creates never appear there.
PART_TABLE="$(sfdisk --json "$IMG")"
SECTOR_SIZE="$(jq -r '.partitiontable.sectorsize // 512' <<< "$PART_TABLE")"
attach_partition() {
  local index="$1" start size
  start="$(jq -r ".partitiontable.partitions[${index}].start" <<< "$PART_TABLE")"
  size="$(jq -r ".partitiontable.partitions[${index}].size" <<< "$PART_TABLE")"
  losetup --find --show \
    --offset "$((start * SECTOR_SIZE))" --sizelimit "$((size * SECTOR_SIZE))" "$IMG"
}
BOOT_LOOP="$(attach_partition 0)"
ROOT_LOOP="$(attach_partition 1)"

# e2fsck exits 1 when it corrected something, which is fine here.
e2fsck -fy "$ROOT_LOOP" > /dev/null || [ "$?" -le 1 ]
resize2fs "$ROOT_LOOP" > /dev/null
ok "root filesystem resized"

say "Mounting"
mkdir -p "$MNT"
mount "$ROOT_LOOP" "$MNT"
mount "$BOOT_LOOP" "$MNT/boot/firmware"
mount --bind /dev "$MNT/dev"
mount --bind /dev/pts "$MNT/dev/pts"
mount -t proc proc "$MNT/proc"
mount -t sysfs sysfs "$MNT/sys"

if ! chroot "$MNT" /bin/true 2> /dev/null; then
  echo "Cannot execute the image's arm64 binaries on this $(uname -m) host." >&2
  echo "Register qemu with binfmt first, e.g.:" >&2
  echo "  docker run --privileged --rm tonistiigi/binfmt --install arm64" >&2
  exit 1
fi
ok "chroot works ($(uname -m) host)"

say "Installing packages: ${PACKAGES[*]}"
# Give the chroot working DNS. resolv.conf may be a symlink in the image, so the
# original is moved aside, not overwritten through.
mv "$MNT/etc/resolv.conf" "$MNT/etc/resolv.conf.image-build" 2> /dev/null || true
cp /etc/resolv.conf "$MNT/etc/resolv.conf"

# Stop package postinst scripts from starting daemons inside the chroot.
printf '#!/bin/sh\nexit 101\n' > "$MNT/usr/sbin/policy-rc.d"
chmod +x "$MNT/usr/sbin/policy-rc.d"

# An empty machine-id is what makes systemd treat the first boot as a first
# boot. Keep whatever the image shipped with in case a postinst writes one.
rm -f "$WORK_DIR/machine-id.orig"
[ -e "$MNT/etc/machine-id" ] && cp -a "$MNT/etc/machine-id" "$WORK_DIR/machine-id.orig"

in_chroot() {
  chroot "$MNT" /usr/bin/env DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 "$@"
}
in_chroot apt-get update
in_chroot apt-get install -y "${PACKAGES[@]}"
in_chroot apt-get clean
rm -rf "$MNT"/var/lib/apt/lists/*

# nginx enables a default site on port 80, which would clash with the hts
# site's own default server there. With it gone, nginx starts on boot
# listening on nothing until hts/deploy/setup-pi-hosting.sh adds the hts site.
if [ -e "$MNT/etc/nginx/sites-enabled/default" ]; then
  rm -f "$MNT/etc/nginx/sites-enabled/default"
  ok "removed nginx's default site"
fi

say "Restoring first-boot state"
if [ -e "$WORK_DIR/machine-id.orig" ]; then
  cp -a "$WORK_DIR/machine-id.orig" "$MNT/etc/machine-id"
else
  rm -f "$MNT/etc/machine-id"
fi
rm -f "$MNT/usr/sbin/policy-rc.d"
rm -f "$MNT/etc/resolv.conf"
mv "$MNT/etc/resolv.conf.image-build" "$MNT/etc/resolv.conf" 2> /dev/null || true

cat > "$MNT/etc/humidity-temp-sensor-image" <<EOF
base_image=${SOURCE_FILE}
base_sha256=${EXPECTED_SHA}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
packages=${PACKAGES[*]}
EOF
ok "build info written to /etc/humidity-temp-sensor-image"

# Discarding free blocks punches holes in the image file, so space freed by
# apt reads back as zeros and compresses to almost nothing.
fstrim "$MNT/boot/firmware" || warn "fstrim failed on boot; the image will compress less well"
fstrim "$MNT" || warn "fstrim failed on root; the image will compress less well"

cleanup

say "Compressing"
OUT_FILE="${OUT_DIR}/${BASE_NAME}-${IMAGE_SUFFIX}.img.xz"
xz -T0 -6 -c "$IMG" > "$OUT_FILE"
rm -f "$IMG"
(cd "$OUT_DIR" && sha256sum "$(basename "$OUT_FILE")" > "$(basename "$OUT_FILE").sha256")

say "Done"
cat <<EOF
  Image:  ${OUT_FILE}
  sha256: $(cut -d' ' -f1 "${OUT_FILE}.sha256")

  In Raspberry Pi Imager, choose "Use custom" and select the .img.xz.
EOF
