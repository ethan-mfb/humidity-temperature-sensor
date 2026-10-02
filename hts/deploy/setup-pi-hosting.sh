#!/usr/bin/env bash
#
# Pi-side, one-time setup for hosting the hts PWA with nginx.
#
# Installs nginx, the hts site and the directory deploy.sh releases into. The
# TLS certificate is not made here; see "Hosting on the pi" in ../README.md.
#
# Idempotent — safe to re-run. Run it on the pi, not in the dev container.
#
# Usage: ./setup-pi-hosting.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="/var/www/hts"
CERT_DIR="/etc/ssl/hts"
SITE_NAME="hts"

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }

say "Installing nginx"
sudo apt-get install -y nginx

say "Creating $WEB_ROOT for $USER"
sudo mkdir -p "$WEB_ROOT/releases"
sudo chown -R "$USER:$USER" "$WEB_ROOT"

say "Installing the $SITE_NAME site"
sudo install -m 644 "$SCRIPT_DIR/nginx-hts.conf" "/etc/nginx/sites-available/$SITE_NAME"
sudo ln -sfn "/etc/nginx/sites-available/$SITE_NAME" "/etc/nginx/sites-enabled/$SITE_NAME"
# The default site listens on port 80, which the web-api owns.
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p "$CERT_DIR"

if [[ -f "$CERT_DIR/hts.crt" && -f "$CERT_DIR/hts.key" ]]; then
  say "Reloading nginx"
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx
else
  warn "no certificate in $CERT_DIR. nginx will not start the site until"
  warn "hts.crt and hts.key are there. See \"Hosting on the pi\" in hts/README.md,"
  warn "then re-run this script."
fi
