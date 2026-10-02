#!/usr/bin/env bash
#
# Pi-side, one-time setup for hosting the hts PWA with nginx.
#
# Installs the hts site into nginx, which the pi image provides, and creates
# the directory releases are unpacked into. The site is only enabled once the
# TLS certificate is in place. Making the certificate, and deploying, are done
# by hand; see "Publishing the hts PWA" in the root README.
#
# Idempotent — safe to re-run. Run it on the pi, not in the dev container.
#
# Usage: ./setup-pi-hosting.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="/var/www/hts"
CERT_DIR="/etc/ssl/hts"
SITE_NAME="hts"
# The user who deploys; they unpack releases without sudo.
DEPLOY_USER="$(id -un)"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
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

# nginx refuses to start at all if an enabled site's certificate is missing,
# so the site is only enabled once the certificate is there.
if [[ -f "$CERT_DIR/hts.crt" && -f "$CERT_DIR/hts.key" ]]; then
  say "Enabling the $SITE_NAME site"
  sudo ln -sfn "/etc/nginx/sites-available/$SITE_NAME" "/etc/nginx/sites-enabled/$SITE_NAME"
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx
else
  sudo rm -f "/etc/nginx/sites-enabled/$SITE_NAME"
  warn "no certificate in $CERT_DIR, so the site is installed but not enabled."
  warn "Put hts.crt and hts.key there (see \"Publishing the hts PWA\" in the root"
  warn "README), then re-run this script."
fi
