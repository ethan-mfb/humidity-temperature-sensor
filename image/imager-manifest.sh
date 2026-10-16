#!/usr/bin/env bash
#
# Writes a Raspberry Pi Imager manifest for a built image, so Imager offers OS
# customization for it.
#
# Imager 2 greys out customization for "Use custom" images: it only knows how
# to customize an image from the init_format in its OS list. Opening this
# manifest in Imager lists the image as an OS with the init_format of the base
# release it was built on.
#
# Imager takes the image's URL as written, never relative to the manifest, so
# it is absolute: a file:// URL to the image by default, which ties the manifest
# to this machine and to where the image is now, or the --url it is published
# at. Needs only bash.
#
# The build's <image>.imager-info, when next to the image, adds the sizes and
# checksums Imager verifies the write with.
#
# Usage: ./imager-manifest.sh [--url <https url>] [--out <file>] <image .img.xz>
# Writes <the image>.rpi-imager-manifest next to it unless --out says where.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=base-image.env
. "${SCRIPT_DIR}/base-image.env"

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \?//' >&2
  exit 2
}

IMAGE_URL=""
MANIFEST=""
while [ "$#" -gt 1 ]; do
  case "$1" in
    --url) IMAGE_URL="$2"; shift 2 ;;
    --out) MANIFEST="$2"; shift 2 ;;
    *) usage ;;
  esac
done
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  usage
fi

IMAGE_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
IMAGE_FILE="$(basename "$IMAGE_PATH")"
MANIFEST="${MANIFEST:-${IMAGE_PATH}.rpi-imager-manifest}"

# Imager wants an absolute file:// URL. Percent-encode everything but the
# characters a path can carry as they are, so a space in it survives.
file_url() {
  local path="$1" out="" char i
  for ((i = 0; i < ${#path}; i++)); do
    char="${path:i:1}"
    case "$char" in
      [A-Za-z0-9/._~-]) out+="$char" ;;
      *) out+="$(printf '%%%02X' "'$char")" ;;
    esac
  done
  printf 'file://%s' "$out"
}
IMAGE_URL="${IMAGE_URL:-$(file_url "$IMAGE_PATH")}"
case "$IMAGE_URL" in
  file:///* | https://*) ;;
  *) echo "--url must be an https:// URL" >&2; exit 2 ;;
esac
case "$IMAGE_URL" in
  *\"* | *\\* | *\ *) echo "--url must not contain quotes, backslashes or spaces" >&2; exit 2 ;;
esac

# Without the build's info file, as for an image from before it was written,
# the manifest says only what can be read off the file itself.
version="${IMAGE_FILE#humidity-temp-sensor-v}"
version="${version%.img.xz}"
init_format="$BASE_IMAGE_INIT_FORMAT"
image_download_size="$(wc -c < "$IMAGE_PATH" | tr -d ' ')"
release_date="" extract_size="" extract_sha256="" image_download_sha256=""

INFO="${IMAGE_PATH}.imager-info"
if [ -f "$INFO" ]; then
  # Read as data, key by key, rather than sourced: it may have been downloaded.
  while IFS='=' read -r key value; do
    case "$key" in
      version) [[ "$value" =~ ^[0-9A-Za-z.+-]+$ ]] && version="$value" ;;
      release_date) [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && release_date="$value" ;;
      init_format) [[ "$value" =~ ^[a-z-]+$ ]] && init_format="$value" ;;
      extract_size) [[ "$value" =~ ^[0-9]+$ ]] && extract_size="$value" ;;
      extract_sha256) [[ "$value" =~ ^[0-9a-f]{64}$ ]] && extract_sha256="$value" ;;
      image_download_sha256) [[ "$value" =~ ^[0-9a-f]{64}$ ]] && image_download_sha256="$value" ;;
    esac
  done < "$INFO"
fi

optional_fields=""
[ -n "$release_date" ] && optional_fields+="
      \"release_date\": \"${release_date}\","
[ -n "$extract_size" ] && optional_fields+="
      \"extract_size\": ${extract_size},"
[ -n "$extract_sha256" ] && optional_fields+="
      \"extract_sha256\": \"${extract_sha256}\","
[ -n "$image_download_sha256" ] && optional_fields+="
      \"image_download_sha256\": \"${image_download_sha256}\","

# The Zero 2 W is the only board this project runs on. Its tags and icon are
# as in Imager's own OS list; pi3-64bit is the tag 64-bit images for it carry.
cat > "$MANIFEST" <<JSON
{
  "imager": {
    "devices": [
      {
        "name": "Raspberry Pi Zero 2 W",
        "tags": ["pi3-64bit", "pi3-32bit"],
        "default": true,
        "icon": "https://downloads.raspberrypi.com/imager/icons/RPi_Zero_2_W.png",
        "description": "Raspberry Pi Zero 2 W",
        "matching_type": "inclusive",
        "capabilities": []
      }
    ]
  },
  "os_list": [
    {
      "name": "Humidity temperature sensor v${version}",
      "description": "Raspberry Pi OS Lite (64-bit) with the packages for the sensor and hts",
      "icon": "https://downloads.raspberrypi.com/raspios_armhf/Raspberry_Pi_OS_(32-bit).png",
      "url": "${IMAGE_URL}",${optional_fields}
      "image_download_size": ${image_download_size},
      "init_format": "${init_format}",
      "devices": ["pi3-64bit"]
    }
  ]
}
JSON

echo "Wrote ${MANIFEST}"
echo "Open it in Imager (double-click it, or: rpi-imager \"${MANIFEST}\")."
