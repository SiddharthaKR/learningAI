#!/usr/bin/env bash
# Stop LearnHarness Office. Checks state and active connections first and asks
# before stopping. The unit stays installed; it never starts at boot (run start.sh).
set -u
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PORT="$(app_port)"

step "Checking (read-only)"
need_cmd systemctl; need_cmd ss
unit_exists || die "$SERVICE is not installed ($UNIT_PATH missing); nothing to stop"
if ! unit_active; then
  ok "$SERVICE is not running; nothing to do"
  exit 0
fi
ok "$SERVICE is running"
N="$(connections "$PORT")"
if [ "$N" -gt 0 ]; then warn "$N established connection(s) on port $PORT; users may be mid-chat and will be cut off"
else ok "no established connections on port $PORT"; fi

step "Will do"
info "stop $SERVICE only (stays installed; start again with start.sh; remove.sh takes it down fully)"
info "Other services on this host are not touched."
confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }

step "Applying"
$SUDO systemctl stop "$SERVICE" || die "systemctl stop failed"
unit_active && die "$SERVICE is still active" || ok "$SERVICE stopped"
