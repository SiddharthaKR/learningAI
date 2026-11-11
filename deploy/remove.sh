#!/usr/bin/env bash
# Take LearnHarness Office down: stop and disable the service and delete its
# systemd unit. Keeps the app code, data/, .env, SearXNG and every other service.
set -u
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PORT="$(app_port)"

step "Checking (read-only)"
need_cmd systemctl; need_cmd ss
if ! unit_exists; then
  ok "$SERVICE is not installed ($UNIT_PATH missing); nothing to remove"
  exit 0
fi
ok "unit found at $UNIT_PATH"
if unit_active; then
  ok "$SERVICE is running"
  N="$(connections "$PORT")"
  [ "$N" -gt 0 ] && warn "$N established connection(s) on port $PORT; users will be cut off"
else
  ok "$SERVICE is not running"
fi

step "Will do"
info "stop (if running), disable, and delete $UNIT_PATH"
info "Stays untouched: $APP_DIR (code), $APP_DIR/data, $ENV_FILE, SearXNG, all other services."
info "To bring it back later: deploy/start.sh"
confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }

step "Applying"
$SUDO systemctl disable --now "$SERVICE" || die "could not stop/disable $SERVICE"
$SUDO rm -f "$UNIT_PATH" || die "could not delete $UNIT_PATH"
$SUDO systemctl daemon-reload
$SUDO systemctl reset-failed "$SERVICE" 2>/dev/null || true
ok "$SERVICE removed"
