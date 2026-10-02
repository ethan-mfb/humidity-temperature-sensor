#!/usr/bin/env bash
#
# Pi-side, one-time setup for hosting the hts PWA with nginx.
#
# Installs the hts site into nginx, which the pi image provides, creates the
# directory releases are unpacked into, and (re)installs pi-status from
# image/pi-status. pi-status then decides whether nginx serves hts or a status
# page listing what is missing. Making the certificate, and deploying, are
# done by hand; see "Publishing the hts PWA" in the root README.
#
# Idempotent — safe to re-run. Run it on the pi, not in the dev container.
#
# Usage: ./setup-pi-hosting.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_STATUS_DIR="$SCRIPT_DIR/../../image/pi-status"
WEB_ROOT="/var/www/hts"
CERT_DIR="/etc/ssl/hts"
SITE_NAME="hts"
# The user who deploys; they unpack releases without sudo.
DEPLOY_USER="$(id -un)"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
die() { printf '\033[31m  x %s\033[0m\n' "$1" >&2; exit 1; }

if ! command -v nginx > /dev/null; then
  die "nginx is not installed. It comes with the pi image: reflash with an image built
    from image/ (see image/README.md). On a pi flashed from an older image, run
    'sudo apt-get install -y nginx && sudo rm -f /etc/nginx/sites-enabled/default'
    and re-run this script."
fi

say "Creating $WEB_ROOT for $DEPLOY_USER"
sudo mkdir -p "$WEB_ROOT/releases"
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WEB_ROOT"

say "Installing the $SITE_NAME site"
sudo install -m 644 "$SCRIPT_DIR/nginx-hts.conf" "/etc/nginx/sites-available/$SITE_NAME"
sudo mkdir -p "$CERT_DIR"

say "Installing pi-status"
sudo "$PI_STATUS_DIR/install.sh" /
sudo systemctl daemon-reload

# pi-status only enables the hts site if its certificate, a release and
# nginx -t all check out. Otherwise nginx serves a status page on port 80
# saying what is missing, rather than failing to start.
say "Choosing what nginx serves"
sudo pi-status
sudo systemctl enable nginx
sudo systemctl restart nginx
