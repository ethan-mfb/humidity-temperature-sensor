#!/usr/bin/env bash
#
# Builds the hts PWA and deploys it to the pi.
#
# Each deploy is a new directory under /var/www/hts/releases. The current
# symlink switches to it in one step, so nginx never serves a mix of two
# versions. The newest few releases are kept for rolling back.
#
# Run it from the dev container, after setup-pi-hosting.sh has run on the pi.
#
# Usage: ./deploy.sh [user@host]   (default: alpha@rpi20w.local)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="alpha@rpi20w.local"
WEB_ROOT="/var/www/hts"
RELEASES_KEPT=3

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
  -*) echo "Unknown option: $1" >&2; exit 2 ;;
  *) HOST="$1" ;;
esac

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_DIR="$WEB_ROOT/releases/$RELEASE"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

say "Building"
(cd "$SCRIPT_DIR/.." && npm run build)

say "Uploading release $RELEASE to $HOST"
# The remote commands expand these paths locally on purpose.
# shellcheck disable=SC2029
ssh "$HOST" "mkdir -p '$RELEASE_DIR'"
scp -rq "$SCRIPT_DIR/../dist/." "$HOST:$RELEASE_DIR/"

say "Switching to $RELEASE"
# shellcheck disable=SC2029
ssh "$HOST" "ln -sfn '$RELEASE_DIR' '$WEB_ROOT/current.tmp' \
  && mv -T '$WEB_ROOT/current.tmp' '$WEB_ROOT/current' \
  && ls -1d '$WEB_ROOT'/releases/* | sort -r | tail -n +$((RELEASES_KEPT + 1)) | xargs -r rm -rf"

say "Deployed. Open clients will offer the update within the hour, or on their next launch."
