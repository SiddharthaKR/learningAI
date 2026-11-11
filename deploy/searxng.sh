#!/usr/bin/env bash
# Manage the SearXNG Docker container used for web search.
# Usage: deploy/searxng.sh start | stop | remove
# Read-only checks run first; nothing changes until you confirm.
# Only touches the container named "searxng". Never touches other containers,
# images, or the config directory (~/searxng by default).
set -u
# shellcheck source=common.sh
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"

CONTAINER="searxng"
IMAGE="searxng/searxng"
CONF_DIR="${SEARXNG_DIR:-$HOME/searxng}"
PORT="${SEARXNG_PORT:-8080}"

cmd="${1:-}"
case "$cmd" in start|stop|remove) ;; *) echo "usage: $0 start|stop|remove"; exit 2;; esac

step "Checking (read-only)"
need_cmd docker; need_cmd curl; need_cmd ss
if docker info >/dev/null 2>&1; then D="docker"
elif $SUDO docker info >/dev/null 2>&1; then D="$SUDO docker"; warn "using sudo for docker (user not in the docker group)"
else die "cannot talk to the Docker daemon"; fi
ok "docker reachable"

# State of the container, and a guard against a name clash with something else.
STATE="$($D inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)"
if [ -n "$STATE" ]; then
  IMG="$($D inspect -f '{{.Config.Image}}' "$CONTAINER")"
  case "$IMG" in
    "$IMAGE"|"$IMAGE":*) ok "container '$CONTAINER' exists ($STATE, image $IMG)";;
    *) die "a container named '$CONTAINER' exists but uses image '$IMG', not $IMAGE. Refusing to touch it.";;
  esac
else
  ok "container '$CONTAINER' does not exist"
fi

wait_ready() {
  for _ in $(seq 1 30); do
    if curl -s -m 2 "http://127.0.0.1:$PORT/search?q=test&format=json" | grep -q '"results"'; then
      ok "SearXNG answers JSON on 127.0.0.1:$PORT"; return 0
    fi
    sleep 1
  done
  warn "no JSON answer within 30s; last container logs:"; $D logs --tail 20 "$CONTAINER" >&2
  return 1
}

case "$cmd" in
start)
  if [ "$STATE" = "running" ]; then ok "already running; nothing to do"; exit 0; fi

  if [ -z "$STATE" ]; then
    # Creating a new container: validate config and port first.
    [ -f "$CONF_DIR/settings.yml" ] || die "$CONF_DIR/settings.yml not found (see DEPLOY.md section 5)"
    grep -Eq 'json' "$CONF_DIR/settings.yml" || die "settings.yml does not enable the json format (search.formats)"
    grep -Eq 'secret_key: *"?<RANDOM_HEX>' "$CONF_DIR/settings.yml" && die "settings.yml still has the <RANDOM_HEX> placeholder secret_key"
    ok "settings.yml looks valid"
  fi
  OWNER="$(port_owner "$PORT")"
  if [ -n "$OWNER" ]; then
    warn "port $PORT is in use by another process:"; printf '%s\n' "$OWNER" >&2
    die "free the port or set SEARXNG_PORT (and SEARXNG_URL in the app .env)"
  fi
  ok "port $PORT is free"

  step "Will do"
  if [ -n "$STATE" ]; then info "docker start $CONTAINER (existing container, $STATE)"
  else
    info "create and start: docker run -d --name $CONTAINER --restart unless-stopped -p 127.0.0.1:$PORT:8080 -v $CONF_DIR:/etc/searxng $IMAGE"
  fi
  info "Other containers are not touched."
  confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }

  step "Applying"
  if [ -n "$STATE" ]; then $D start "$CONTAINER" >/dev/null || die "docker start failed"
  else $D run -d --name "$CONTAINER" --restart unless-stopped \
         -p "127.0.0.1:$PORT:8080" -v "$CONF_DIR:/etc/searxng" "$IMAGE" >/dev/null || die "docker run failed"; fi
  wait_ready
  ;;
stop)
  [ -n "$STATE" ] || die "container '$CONTAINER' does not exist; nothing to stop"
  [ "$STATE" = "running" ] || { ok "not running ($STATE); nothing to do"; exit 0; }
  if unit_exists && unit_active; then warn "$SERVICE is running; web search in the app will fail while SearXNG is stopped"; fi

  step "Will do"
  info "docker stop $CONTAINER (stays stopped until you run 'start'; the container and config are kept)"
  confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }
  step "Applying"
  $D stop "$CONTAINER" >/dev/null || die "docker stop failed"
  ok "stopped"
  ;;
remove)
  [ -n "$STATE" ] || { ok "container '$CONTAINER' does not exist; nothing to remove"; exit 0; }
  if unit_exists && unit_active; then warn "$SERVICE is running; web search in the app will fail after removal"; fi

  step "Will do"
  info "stop (if running) and delete the container '$CONTAINER'"
  info "Stays untouched: the $IMAGE image, $CONF_DIR, all other containers."
  info "To recreate later: deploy/searxng.sh start"
  confirm "Proceed?" || { info "Aborted, nothing changed."; exit 1; }
  step "Applying"
  $D rm -f "$CONTAINER" >/dev/null || die "docker rm failed"
  ok "removed"
  ;;
esac
