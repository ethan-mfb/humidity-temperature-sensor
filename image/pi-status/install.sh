#!/usr/bin/env bash
#
# Installs pi-status into a root filesystem: the script, its boot service and
# its nginx site.
#
# build-image.sh runs it against the mounted image. setup-pi-hosting.sh runs
# it against / on the pi, so a pi flashed before pi-status existed gets it,
# and a re-run picks up changes. It does not start or reload anything.
#
# Usage: sudo ./install.sh <root>   (e.g. / on the pi)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  ""|-h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
esac
ROOT="${1%/}"

install -D -m 755 "$SCRIPT_DIR/pi-status.sh" "$ROOT/usr/local/sbin/pi-status"
install -D -m 644 "$SCRIPT_DIR/pi-status.service" "$ROOT/etc/systemd/system/pi-status.service"
install -D -m 644 "$SCRIPT_DIR/nginx-pi-status.conf" "$ROOT/etc/nginx/sites-available/pi-status"

# What systemctl enable would do, without needing a running systemd.
mkdir -p "$ROOT/etc/systemd/system/multi-user.target.wants"
ln -sfn /etc/systemd/system/pi-status.service \
  "$ROOT/etc/systemd/system/multi-user.target.wants/pi-status.service"

# Until pi-status first runs, serve the status page rather than nothing,
# unless hts is already being served.
mkdir -p "$ROOT/var/www/pi-status" "$ROOT/etc/nginx/sites-enabled"
if [[ ! -e "$ROOT/etc/nginx/sites-enabled/hts" ]]; then
  ln -sfn /etc/nginx/sites-available/pi-status "$ROOT/etc/nginx/sites-enabled/pi-status"
fi
