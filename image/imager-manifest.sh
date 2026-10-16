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
# Run it where Imager runs, on the image where it will stay: the manifest
# points at the image by absolute path. Needs only bash.
#
# Usage: ./imager-manifest.sh <humidity-temp-sensor-v<VERSION>.img.xz>
# Writes <the image>.rpi-imager-manifest next to it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=base-image.env
. "${SCRIPT_DIR}/base-image.env"

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \?//' >&2
  exit 2
fi

IMAGE_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
IMAGE_FILE="$(basename "$IMAGE_PATH")"
VERSION="${IMAGE_FILE#humidity-temp-sensor-v}"
VERSION="${VERSION%.img.xz}"
MANIFEST="${IMAGE_PATH}.rpi-imager-manifest"

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
      "name": "Humidity temperature sensor v${VERSION}",
      "description": "Raspberry Pi OS Lite (64-bit) with the packages for the sensor and hts",
      "icon": "https://downloads.raspberrypi.com/raspios_armhf/Raspberry_Pi_OS_(32-bit).png",
      "url": "$(file_url "$IMAGE_PATH")",
      "image_download_size": $(wc -c < "$IMAGE_PATH" | tr -d ' '),
      "init_format": "${BASE_IMAGE_INIT_FORMAT}",
      "devices": ["pi3-64bit"]
    }
  ]
}
JSON

echo "Wrote ${MANIFEST}"
echo "Open it in Imager (double-click it, or: rpi-imager \"${MANIFEST}\")."
