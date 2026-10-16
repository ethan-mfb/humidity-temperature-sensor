#!/usr/bin/env bash
#
# Pi-side: installs an hts release and switches nginx to it.
#
# Unpacks the build into /var/www/hts/releases/<version>, moves the current
# symlink onto it in one step, runs pi-status, and removes old releases, keeping
# the live one and the two newest others to roll back to.
#
# The build is the hts-<version>.tgz that the hts Release workflow attaches to
# the hts-v<version> GitHub release. With no argument, the newest hts-v* tag in
# this clone (after a fetch) is installed.
#
# Run it on the pi, not in the dev container. Nothing here connects to the pi.
#
# Usage: ./install-hts.sh                    the newest release
#        ./install-hts.sh <version>          that release, e.g. 0.1.1
#        ./install-hts.sh <hts-<version>.tgz> a build already on the pi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="${HTS_WEB_ROOT:-/var/www/hts}"
RELEASES_DIR="$WEB_ROOT/releases"
RELEASES_URL="${HTS_RELEASES_URL:-https://github.com/ethan-mfb/humidity-temperature-sensor/releases/download}"
REPO_DIR="${HTS_REPO_DIR:-$SCRIPT_DIR/../..}"
read -ra PI_STATUS <<< "${HTS_PI_STATUS:-sudo pi-status}"
TAG_PREFIX="hts-v"
# The live release counts toward this.
KEEP_RELEASES=3
VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+$'

case "${1:-}" in
  -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
esac

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1" >&2; }
die() { printf '\033[31m  x %s\033[0m\n' "$1" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

newest_tagged_version() {
  git -C "$REPO_DIR" fetch --tags --quiet 2> /dev/null \
    || warn "could not fetch tags; using the ones this clone already has"
  git -C "$REPO_DIR" tag --list "${TAG_PREFIX}*" --sort=-version:refname \
    | head -n 1 \
    | sed "s/^${TAG_PREFIX}//"
}

download() {
  local version="$1" tarball="$work/hts-$1.tgz"
  local url="$RELEASES_URL/${TAG_PREFIX}$version/hts-$version.tgz"
  say "Downloading hts $version" >&2
  curl -fsSL -o "$tarball" "$url" \
    || die "could not download $url. If the tag was just pushed, the hts Release workflow may still be building it."
  printf '%s\n' "$tarball"
}

case "${1:-}" in
  "")
    version="$(newest_tagged_version)"
    [[ -n "$version" ]] || die "no ${TAG_PREFIX}* tags in $REPO_DIR. Release hts first; see \"Releasing\" in the README."
    tarball="$(download "$version")"
    ;;
  *.tgz)
    tarball="$1"
    [[ -f "$tarball" ]] || die "$tarball does not exist."
    version="$(basename "$tarball" .tgz)"
    version="${version#hts-}"
    ;;
  *)
    version="$1"
    [[ "$version" =~ $VERSION_PATTERN ]] || die "$version is not a version like 0.1.1."
    tarball="$(download "$version")"
    ;;
esac

[[ "$version" =~ $VERSION_PATTERN ]] \
  || die "$(basename "$tarball") should be named hts-<version>.tgz, as the release steps make it."

release="$RELEASES_DIR/$version"
# Overwriting a release that may be live would change it under the clients
# already running it. Bump the version instead.
[[ ! -e "$release" ]] || die "hts $version is already installed at $release. Release a new version instead."

say "Unpacking hts $version"
unpacked="$work/unpacked"
mkdir -p "$unpacked"
tar -xzf "$tarball" -C "$unpacked"
# nginx reads it as www-data. mktemp -d made it 700, and the "./" entry in the
# tarball carries whatever mode dist had where it was built.
chmod 755 "$unpacked"
[[ -f "$unpacked/index.html" ]] || die "$(basename "$tarball") has no index.html at its top level. Package it with: tar -czf hts-$version.tgz -C dist ."
mkdir -p "$RELEASES_DIR"
mv -T "$unpacked" "$release"

say "Switching to hts $version"
# mv replaces the symlink in one step, so nginx never serves half of one
# release and half of another.
ln -sfn "$release" "$WEB_ROOT/current.tmp"
mv -T "$WEB_ROOT/current.tmp" "$WEB_ROOT/current"
"${PI_STATUS[@]}"

say "Removing old releases"
live="$(basename "$(readlink "$WEB_ROOT/current")")"
mapfile -t others < <(
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | grep -vxF "$live" \
    | sort -rV
)
for old in "${others[@]:$((KEEP_RELEASES - 1))}"; do
  rm -rf "${RELEASES_DIR:?}/$old"
  echo "  removed $old"
done

echo "  serving hts $live; kept: $(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f ' )"
