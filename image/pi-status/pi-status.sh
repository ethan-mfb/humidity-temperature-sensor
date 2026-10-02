#!/usr/bin/env bash
#
# Decides what nginx serves, and writes a status page saying why.
#
# Checks that the hts PWA can be served: its nginx site is installed, its
# certificate is there, unexpired and matches its key, a release is deployed,
# and nginx accepts the config. If everything passes, nginx serves hts. If
# anything fails, nginx serves the status page on port 80 instead, so a broken
# certificate shows the problem at http://rpi20w.local/ rather than leaving
# nginx unable to start.
#
# Runs at every boot before nginx (pi-status.service). Run it by hand after
# fixing something: it reloads nginx if nginx is running.
#
# Usage: sudo pi-status

set -uo pipefail

SITES_AVAILABLE="/etc/nginx/sites-available"
SITES_ENABLED="/etc/nginx/sites-enabled"
HTS_SITE="hts"
STATUS_SITE="pi-status"
CERT="/etc/ssl/hts/hts.crt"
KEY="/etc/ssl/hts/hts.key"
RELEASE_INDEX="/var/www/hts/current/index.html"
STATUS_DIR="/var/www/pi-status"
STATUS_PAGE="$STATUS_DIR/index.html"
# Warn this long before the certificate expires.
CERT_WARN_SECONDS=$((30 * 24 * 60 * 60))
SETUP_HINT="See \"Publishing the hts PWA\" in the repository's README."

case "${1:-}" in
  "") ;;
  -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

if [[ $EUID -ne 0 ]]; then
  echo "pi-status changes nginx's enabled sites; run it with sudo." >&2
  exit 1
fi

problems=()
warnings=()
nginx_test_output=""

problem() { problems+=("$1"); }
warning() { warnings+=("$1"); }

enable_site() {
  ln -sfn "$SITES_AVAILABLE/$1" "$SITES_ENABLED/$1"
}
disable_site() {
  rm -f "$SITES_ENABLED/$1"
}

check_certificate() {
  if [[ ! -f "$CERT" ]]; then
    problem "No certificate at $CERT. $SETUP_HINT"
  fi
  if [[ ! -f "$KEY" ]]; then
    problem "No certificate key at $KEY. $SETUP_HINT"
  fi
  [[ -f "$CERT" && -f "$KEY" ]] || return
  if ! command -v openssl > /dev/null; then
    warning "openssl is not installed, so the certificate was not checked."
    return
  fi
  if ! openssl x509 -in "$CERT" -noout 2> /dev/null; then
    problem "$CERT is not a readable PEM certificate."
    return
  fi
  if ! openssl x509 -in "$CERT" -noout -checkend 0 > /dev/null; then
    problem "The certificate expired on $(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2). Make a new one with mkcert."
  elif ! openssl x509 -in "$CERT" -noout -checkend "$CERT_WARN_SECONDS" > /dev/null; then
    warning "The certificate expires on $(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2). Make a new one with mkcert before then."
  fi
  local cert_pub key_pub
  cert_pub="$(openssl x509 -in "$CERT" -noout -pubkey 2> /dev/null)"
  key_pub="$(openssl pkey -in "$KEY" -pubout 2> /dev/null)"
  if [[ -z "$key_pub" ]]; then
    problem "$KEY is not a readable private key."
  elif [[ "$cert_pub" != "$key_pub" ]]; then
    problem "$KEY is not the key for $CERT. Copy the pair that mkcert made together."
  fi
}

check_hts() {
  if [[ ! -f "$SITES_AVAILABLE/$HTS_SITE" ]]; then
    problem "The hts site is not installed. Run hts/deploy/setup-pi-hosting.sh. $SETUP_HINT"
  fi
  check_certificate
  if [[ ! -f "$RELEASE_INDEX" ]]; then
    problem "No release is deployed: $RELEASE_INDEX does not exist. $SETUP_HINT"
  fi
}

# Enables hts in place of the status page, and keeps it only if nginx
# accepts the result.
try_hts() {
  enable_site "$HTS_SITE"
  disable_site "$STATUS_SITE"
  if nginx_test_output="$(nginx -t 2>&1)"; then
    return 0
  fi
  problem "nginx rejected the hts site. Its output is below."
  return 1
}

serve_status_page() {
  disable_site "$HTS_SITE"
  enable_site "$STATUS_SITE"
}

html_escape() {
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

list_items() {
  local item
  for item in "$@"; do
    printf '      <li>%s</li>\n' "$(printf '%s' "$item" | html_escape)"
  done
}

write_page() {
  local mode="$1" failed_units title
  failed_units="$(systemctl list-units --failed --no-legend --plain 2> /dev/null || true)"
  if [[ "$mode" == "$HTS_SITE" ]]; then
    title="hts is being served"
  else
    title="hts is not being served"
  fi
  mkdir -p "$STATUS_DIR"
  {
    cat <<HTML
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>$(hostname) status</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 48rem; padding: 0 1rem; color: rgba(28, 32, 36, 1); }
      h1 { color: rgba(180, 40, 30, 1); }
      .status--ok h1 { color: rgba(30, 120, 60, 1); }
      pre { background: rgba(28, 32, 36, 0.06); padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
      li { margin-bottom: 0.5rem; }
    </style>
  </head>
  <body class="status$([[ "$mode" == "$HTS_SITE" ]] && printf ' status--ok')">
    <h1>$title</h1>
    <p>$(hostname), checked $(date -R) by <code>pi-status</code>.</p>
HTML
    if ((${#problems[@]})); then
      printf '    <h2>Problems</h2>\n    <ul>\n'
      list_items "${problems[@]}"
      printf '    </ul>\n'
    fi
    if ((${#warnings[@]})); then
      printf '    <h2>Warnings</h2>\n    <ul>\n'
      list_items "${warnings[@]}"
      printf '    </ul>\n'
    fi
    if [[ -n "$nginx_test_output" && "$mode" != "$HTS_SITE" ]]; then
      printf '    <h2><code>nginx -t</code></h2>\n    <pre>%s</pre>\n' "$(printf '%s' "$nginx_test_output" | html_escape)"
    fi
    if [[ -n "$failed_units" ]]; then
      printf '    <h2>Failed systemd units</h2>\n    <pre>%s</pre>\n' "$(printf '%s' "$failed_units" | html_escape)"
    fi
    cat <<HTML
    <h2>After fixing</h2>
    <p>On the pi, run <code>sudo pi-status</code>. It checks again, and reloads nginx onto hts if
      everything passes. It also runs at every boot.</p>
  </body>
</html>
HTML
  } > "$STATUS_PAGE.tmp"
  mv "$STATUS_PAGE.tmp" "$STATUS_PAGE"
}

check_hts
if ((${#problems[@]} == 0)) && try_hts; then
  mode="$HTS_SITE"
else
  serve_status_page
  mode="$STATUS_SITE"
fi
write_page "$mode"

if [[ "$mode" == "$HTS_SITE" ]]; then
  echo "pi-status: serving hts."
else
  echo "pi-status: serving the status page on port 80:"
  printf '  - %s\n' "${problems[@]}"
fi
((${#warnings[@]})) && printf '  ! %s\n' "${warnings[@]}"

# At boot this runs before nginx, which then starts on the chosen sites.
if systemctl is-active --quiet nginx 2> /dev/null; then
  systemctl reload nginx
fi
exit 0
