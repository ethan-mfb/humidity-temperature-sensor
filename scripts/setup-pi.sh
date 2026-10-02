#!/usr/bin/env bash
#
# Pi-side setup for the DHT22 capture tooling.
#
# Takes a freshly flashed Raspberry Pi OS Lite image to the point where
# capture-sensor.mjs can run: toolchain, libgpiod, node, the compiled helper,
# and the access checks from the root README.
#
# Idempotent — safe to re-run. Run it on the pi, not in the dev container.
#
# Usage: ./setup-pi.sh [--skip-node]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The helper and its node wrapper live in the dht22-capture package, which both
# this tooling and the web-api depend on.
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/../dht22-capture" && pwd)"
HELPER_NAME="gpiod-capture"
HELPER_PATH="${PACKAGE_DIR}/bin/${HELPER_NAME}"

# onoff supports v16 only, and it is the web-api's GPIO library. The capture
# script itself runs on anything modern; this is here so one pi serves both.
NODE_VERSION=16
NVM_VERSION="v0.40.3"

# The header chip on a Pi Zero 2 W. The helper resolves by this label
# rather than by chip number, which is not stable across kernels.
CHIP_LABEL="pinctrl-bcm2835"

# BCM 2 == physical pin 3, the data pin in the README's "Connecting the sensor".
DATA_PIN_BCM=2

SKIP_NODE=0
for arg in "$@"; do
  case "$arg" in
    --skip-node) SKIP_NODE=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
ok() { printf '\033[32m  + %s\033[0m\n' "$1"; }

# Everything below assumes the character device. Bail early somewhere that has
# no GPIO at all rather than failing three steps later with something cryptic.
if ! compgen -G "/dev/gpiochip*" > /dev/null; then
  echo "No /dev/gpiochip* found. Run this on the pi, not the dev container." >&2
  exit 1
fi

say "Updating the system"
sudo apt update
sudo apt full-upgrade -y

say "Installing build tools and libgpiod"
# build-essential and python3 are for the web-api's epoll native addon; the
# libgpiod packages are for the capture helper. Lite 2026-09-15 already ships
# all but libgpiod-dev; listing them keeps this independent of the base image.
sudo apt install -y build-essential python3 libgpiod-dev pkg-config gpiod

if [ "$SKIP_NODE" -eq 0 ]; then
  say "Installing node ${NODE_VERSION} via nvm"
  if [ ! -s "$HOME/.nvm/nvm.sh" ]; then
    curl -o- "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  else
    ok "nvm already installed"
  fi

  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
  ok "node $(node --version) at $(which node)"
fi

say "Checking GPIO access"
if id -nG | grep -qw gpio; then
  ok "user $(whoami) is in the gpio group, so no sudo is needed"
else
  warn "user $(whoami) is NOT in the gpio group — capture will fail without sudo."
  warn "that group comes from raspberrypi-sys-mods udev rules; check the image."
fi

if gpiodetect | grep -q "$CHIP_LABEL"; then
  ok "found header chip: $(gpiodetect | grep "$CHIP_LABEL")"
else
  warn "no chip labelled $CHIP_LABEL. gpiodetect reports:"
  gpiodetect | sed 's/^/      /'
  warn "pass --chip-label or --chip to the capture script if this is expected."
fi

# The kernel dht11 driver owns the line exclusively. If it is loaded the helper
# exits with EBUSY, which is worth catching here instead of mid-capture.
if [ -e /sys/bus/iio/devices/iio:device0/in_humidityrelative_input ]; then
  warn "a dht11 iio device is present — the kernel driver is holding the pin."
  warn "remove 'dtoverlay=dht11' from /boot/firmware/config.txt and reboot."
fi

say "Building the capture helper"
cd "$PACKAGE_DIR"
npm run build
ok "built ${HELPER_PATH}"

say "Linking the capture tooling to the package"
cd "$SCRIPT_DIR"
npm install
ok "scripts/ can import dht22-capture"

say "Smoke test: one frame on BCM ${DATA_PIN_BCM}"
# Non-fatal. A sensor that is not wired yet still leaves a working setup; this
# only reports what the hardware did.
helper_output="$("$HELPER_PATH" --line "$DATA_PIN_BCM" 2>&1 || true)"
edges="$(printf '%s\n' "$helper_output" | grep -c '^[01] ' || true)"

if [ "$edges" -ge 80 ]; then
  ok "captured ${edges} edges — a complete AM2302 frame is 85"
elif [ "$edges" -gt 0 ]; then
  warn "captured only ${edges} edges; expected 85. Check the wiring and pull-up."
else
  warn "captured no edges. Check the sensor is on physical pin 3 (BCM ${DATA_PIN_BCM})."
  printf '%s\n' "$helper_output" | sed 's/^/      /'
fi

say "Setup complete"

# nvm appends its source line to ~/.bashrc, which the calling shell read before
# this script ran, so node is on PATH here but not out there.
if [ "$SKIP_NODE" -eq 0 ]; then
  cat <<EOF
  node is not on the calling shell's PATH yet — nvm appends to ~/.bashrc, which
  that shell has already read. Pick up the change with:

    source ~/.bashrc

  or open a new ssh session.
EOF
fi

cat <<EOF
  Capture:   cd ${SCRIPT_DIR} && node capture-sensor.mjs --samples 30 --out baseline.jsonl
  Node path: $(command -v node || echo '(node not installed)')

  See scripts/README.md for the output format and the end-of-run summary.
EOF
