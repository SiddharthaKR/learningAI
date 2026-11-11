# Shared helpers for start.sh / stop.sh / remove.sh. Sourced, not executed.
# Scope: these scripts only touch the "learnharness" systemd service. They never
# touch other services, SearXNG, the app code, data/ or .env.

SERVICE="learnharness"
UNIT_PATH="/etc/systemd/system/${SERVICE}.service"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DEPLOY_DIR")"
ENV_FILE="$APP_DIR/.env"

info() { printf '  %s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*" >&2; }
die()  { printf '  [FAIL] %s\n' "$*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

# Ask y/N. Defaults to No; refuses to run unattended.
confirm() {
  [ -t 0 ] || die "needs an interactive terminal to confirm: $1"
  local reply
  read -r -p "  $1 [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# Read KEY from .env without sourcing it (values may contain shell characters).
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

app_port() { local p; p="$(env_get PORT)"; echo "${p:-3000}"; }

unit_exists() { [ -f "$UNIT_PATH" ]; }
unit_active() { systemctl is-active --quiet "$SERVICE"; }

# Number of established TCP connections on the app port (a rough "users online" signal).
connections() { ss -tnH state established "( sport = :$1 )" 2>/dev/null | wc -l; }

# Who is listening on a port (needs sudo to see other users' processes).
port_owner() { $SUDO ss -ltnp "( sport = :$1 )" 2>/dev/null | tail -n +2; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }
