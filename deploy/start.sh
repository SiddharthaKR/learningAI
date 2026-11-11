#!/usr/bin/env bash
# Start LearnHarness Office. Runs read-only checks first, shows a summary, and
# changes nothing until you confirm. Installs the systemd unit if it is missing.
set -u
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PORT="$(app_port)"

step "Checking (read-only)"
need_cmd systemctl; need_cmd ss; need_cmd curl; need_cmd node; need_cmd npm
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))"
ok "node $(node -v), npm at $(command -v npm)"
[ "$(id -u)" -ne 0 ] || warn "running as root: the service would run as root. Use the normal service account instead."

[ -f "$ENV_FILE" ] || die ".env not found at $ENV_FILE (copy .env.example and fill it in, see DEPLOY.md)"
ok ".env present"
[ "$(stat -c %a "$ENV_FILE")" = "600" ] || warn ".env permissions are $(stat -c %a "$ENV_FILE"), expected 600"
for k in SESSION_SECRET LLM_BASE_URL LLM_MODEL; do
  [ -n "$(env_get "$k")" ] || die "$k is empty in .env"
done
ok "required .env values set"

[ -d "$APP_DIR/.next" ] || die "no build found. Run: cd $APP_DIR && npm ci && npm run build"
ok "build found (.next)"
[ -d "$APP_DIR/data" ] || warn "data/ does not exist yet; the app will create it on first use (DEPLOY.md: chmod 700)"

LLM_URL="$(env_get LLM_BASE_URL)"
if curl -s -o /dev/null -m 5 "${LLM_URL%/}/models"; then ok "LLM endpoint reachable ($LLM_URL)"
else warn "LLM endpoint not reachable ($LLM_URL); the app will start but chats will fail"; fi
if [ "$(env_get SEARCH_PROVIDER)" = "searxng" ]; then
  SX="$(env_get SEARXNG_URL)"
  if curl -s -o /dev/null -m 5 "${SX:-http://127.0.0.1:8080}"; then ok "SearXNG reachable"
  else warn "SearXNG not reachable at ${SX:-http://127.0.0.1:8080}; web search will fail (this script does not manage it)"; fi
fi

if unit_active; then
  ok "$SERVICE is already running; nothing to do"
  exit 0
fi

OWNER="$(port_owner "$PORT")"
if [ -n "$OWNER" ]; then
  warn "port $PORT is already in use by another process:"
  printf '%s\n' "$OWNER" >&2
  die "free the port or set a different PORT in .env, then re-run"
fi
ok "port $PORT is free"

# Build the unit from the template for this user, app path and npm location.
NEW_UNIT="$(mktemp)"; trap 'rm -f "$NEW_UNIT"' EXIT
sed -e "s#/home/<USER>/app#$APP_DIR#g" -e "s#<USER>#$(id -un)#g" \
    -e "s#/usr/bin/npm#$(command -v npm)#g" "$DEPLOY_DIR/learnharness.service" > "$NEW_UNIT"

ACTION=""
if ! unit_exists; then
  ACTION="install the unit and start it (manual start only, never at boot)"
  step "Unit to be installed at $UNIT_PATH"; cat "$NEW_UNIT"
elif ! diff -q "$UNIT_PATH" "$NEW_UNIT" >/dev/null; then
  ACTION="overwrite the changed unit and start it (manual start only, never at boot)"
  step "Installed unit differs from the template"; diff "$UNIT_PATH" "$NEW_UNIT"
else
  ACTION="start it (unit already installed and unchanged; manual start only, never at boot)"
fi

step "Will do"
info "$ACTION"
info "Other services on this host are not touched."
confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }

step "Applying"
if ! unit_exists || ! diff -q "$UNIT_PATH" "$NEW_UNIT" >/dev/null; then
  $SUDO install -m 644 "$NEW_UNIT" "$UNIT_PATH" || die "could not write $UNIT_PATH"
  $SUDO systemctl daemon-reload
  ok "unit written"
fi
# Manual start only: never enable at boot, and undo an older install that did.
if systemctl is-enabled --quiet "$SERVICE" 2>/dev/null; then
  $SUDO systemctl disable "$SERVICE" >/dev/null 2>&1 && ok "boot auto-start disabled (left over from an older install)"
fi
$SUDO systemctl start "$SERVICE" || die "systemctl start failed"

for _ in $(seq 1 30); do
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then
    ok "$SERVICE is up on port $PORT"; exit 0
  fi
  sleep 1
done
warn "service did not answer within 30s; last log lines:"
$SUDO journalctl -u "$SERVICE" -n 20 --no-pager >&2
exit 1
