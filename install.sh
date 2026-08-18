#!/usr/bin/env bash
set -Eeuo pipefail

RIFTGRID_REPOSITORY="${RIFTGRID_REPOSITORY:-https://github.com/Mischmaschine/RIFTGRID.git}"
RIFTGRID_REF="${RIFTGRID_REF:-main}"
INSTALL_DIR="${RIFTGRID_INSTALL_DIR:-/opt/riftgrid}"
CLUSTER_NAME="${RIFTGRID_CLUSTER_NAME:-riftgrid}"
PUBLIC_HOST="${RIFTGRID_PUBLIC_HOST:-}"
AGENTS="${RIFTGRID_AGENTS:-0}"
API_PORT="${RIFTGRID_KUBE_API_PORT:-6550}"
BIND_ADDRESS="${RIFTGRID_BIND_ADDRESS:-0.0.0.0}"
ASSUME_YES=false
NON_INTERACTIVE=false
DRY_RUN=false
SKIP_RUNTIME_IMAGES=false
DOCKER=(docker)
K3D=(k3d)

if [[ -t 1 ]]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; LIME=$'\033[38;5;154m'; CYAN=$'\033[36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  RED=''; GREEN=''; LIME=''; CYAN=''; DIM=''; BOLD=''; RESET=''
fi

usage() {
  cat <<'EOF'
RIFTGRID guided installer for Linux

Usage: bash install.sh [options]

  --yes                    Accept prerequisite installation prompts
  --non-interactive        Use defaults/environment variables; implies --yes
  --install-dir PATH       Installation directory (default: /opt/riftgrid)
  --host HOST              Public hostname or IP used in dashboard links
  --cluster-name NAME      k3d cluster name (default: riftgrid)
  --agents COUNT           Additional k3d agent nodes (default: 0)
  --skip-runtime-images    Do not build/import FiveM, Rust and Valheim images
  --dry-run                Print the resolved plan without changing the host
  --help                   Show this help

Environment variables with matching RIFTGRID_* names may also be used.
EOF
}

while (($#)); do
  case "$1" in
    --yes) ASSUME_YES=true ;;
    --non-interactive) NON_INTERACTIVE=true; ASSUME_YES=true ;;
    --install-dir) INSTALL_DIR="${2:?missing path}"; shift ;;
    --host) PUBLIC_HOST="${2:?missing host}"; shift ;;
    --cluster-name) CLUSTER_NAME="${2:?missing name}"; shift ;;
    --agents) AGENTS="${2:?missing count}"; shift ;;
    --skip-runtime-images) SKIP_RUNTIME_IMAGES=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

step_number=0
step() { step_number=$((step_number + 1)); printf '\n%s[%s/8]%s %s%s%s\n' "$LIME" "$step_number" "$RESET" "$BOLD" "$1" "$RESET"; }
info() { printf '  %s>%s %s\n' "$CYAN" "$RESET" "$1"; }
success() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
fail() { printf '\n%sInstallation stopped:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }
run() { if $DRY_RUN; then printf '  %sDRY RUN%s ' "$DIM" "$RESET"; printf '%q ' "$@"; printf '\n'; else "$@"; fi; }

prompt() {
  local message="$1" default="$2" answer
  if $NON_INTERACTIVE || [[ ! -e /dev/tty ]]; then printf '%s' "$default"; return; fi
  printf '  %s [%s]: ' "$message" "$default" >/dev/tty
  IFS= read -r answer </dev/tty || true
  printf '%s' "${answer:-$default}"
}

confirm() {
  local message="$1" answer
  $ASSUME_YES && return 0
  if [[ ! -e /dev/tty ]]; then return 1; fi
  printf '  %s [y/N]: ' "$message" >/dev/tty
  IFS= read -r answer </dev/tty || true
  [[ "$answer" =~ ^[YyJj]$ ]]
}

as_root() {
  if [[ ${EUID:-$(id -u)} -eq 0 ]]; then run "$@"; else run sudo "$@"; fi
}

detect_public_host() {
  local detected
  detected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${detected:-localhost}"
}

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    as_root apt-get install -y ca-certificates curl git openssl
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y ca-certificates curl git openssl
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y ca-certificates curl git openssl
  else
    fail 'Install curl, git and openssl manually; this distribution has no supported package manager.'
  fi
}

install_docker() {
  local installer
  installer="$(mktemp)"
  trap 'rm -f "${installer:-}"' RETURN
  curl -fsSL https://get.docker.com -o "$installer"
  as_root sh "$installer"
  command -v systemctl >/dev/null 2>&1 && as_root systemctl enable --now docker
  trap - RETURN
  rm -f "$installer"
}

install_k3d() {
  local installer
  installer="$(mktemp)"
  trap 'rm -f "${installer:-}"' RETURN
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh -o "$installer"
  as_root bash "$installer"
  trap - RETURN
  rm -f "$installer"
}

printf '\n%sRIFTGRID%s  guided host setup\n' "$BOLD" "$RESET"
printf '%sOne command. Your cluster. Your data.%s\n' "$DIM" "$RESET"

step 'Checking this host'
[[ "$(uname -s)" == "Linux" ]] || fail 'The guided installer currently supports Linux. Use the development guide on Windows/macOS.'
[[ "${AGENTS}" =~ ^[0-9]+$ ]] || fail '--agents must be a non-negative integer.'
[[ "${CLUSTER_NAME}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || fail 'Cluster name must contain lowercase letters, numbers and hyphens.'
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "/opt" ]] || fail 'Installation directory must be a dedicated absolute path.'
if [[ ${EUID:-$(id -u)} -ne 0 ]] && ! command -v sudo >/dev/null 2>&1; then fail 'sudo is required when the installer is not run as root.'; fi
[[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "amd64" ]] || fail 'The bundled game runtime images currently require x86-64.'
success "Linux $(uname -m) detected"

step 'Choosing the installation settings'
PUBLIC_HOST="${PUBLIC_HOST:-$(detect_public_host)}"
INSTALL_DIR="$(prompt 'Installation directory' "$INSTALL_DIR")"
PUBLIC_HOST="$(prompt 'Dashboard hostname or IP' "$PUBLIC_HOST")"
AGENTS="$(prompt 'Additional Kubernetes worker nodes' "$AGENTS")"
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || fail 'Dashboard host must be a hostname or IPv4 address without scheme or path.'
[[ "$AGENTS" =~ ^[0-9]+$ ]] || fail 'Worker-node count must be a non-negative integer.'
info "Dashboard: http://${PUBLIC_HOST}:3000"
info "API:       http://${PUBLIC_HOST}:4000"
info "Games:     ${PUBLIC_HOST}:30000-30100"
info "Location:  ${INSTALL_DIR}"
info "Cluster:   ${CLUSTER_NAME} (1 server + ${AGENTS} agents)"

if $DRY_RUN; then
  success 'Plan resolved; dry-run requested, so the host was not changed.'
  exit 0
fi

step 'Installing required tools'
missing_base=false
for command in curl git openssl; do command -v "$command" >/dev/null 2>&1 || missing_base=true; done
if $missing_base; then confirm 'Install curl, git and OpenSSL with the system package manager?' || fail 'Required tools are missing.'; install_base_packages; fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  confirm "Install Docker Engine and the Compose plugin using Docker's official installer?" || fail 'Docker with Compose v2 is required.'
  install_docker
fi
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
    K3D=(sudo k3d)
    info 'Docker currently requires sudo; reconnect after setup to apply docker-group membership.'
    target_user="${SUDO_USER:-${USER:-}}"
    [[ -n "$target_user" && "$target_user" != "root" ]] && as_root usermod -aG docker "$target_user"
  else
    fail 'Docker is installed but its daemon is unavailable.'
  fi
fi
if ! command -v k3d >/dev/null 2>&1; then
  confirm 'Install k3d using its official release installer?' || fail 'k3d is required for the all-in-one installation.'
  install_k3d
fi
success 'Docker, Compose, Git, curl, OpenSSL and k3d are available'

step 'Preparing the RIFTGRID source'
if [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR/.git" ]]; then fail "$INSTALL_DIR already exists and is not a RIFTGRID checkout."; fi
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info 'Existing RIFTGRID checkout found; keeping its files and persistent data.'
  if confirm 'Fast-forward the existing checkout before installation?'; then run git -C "$INSTALL_DIR" pull --ff-only; fi
else
  as_root mkdir -p "$INSTALL_DIR"
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then as_root chown "$(id -u):$(id -g)" "$INSTALL_DIR"; fi
  run git clone --branch "$RIFTGRID_REF" --depth 1 "$RIFTGRID_REPOSITORY" "$INSTALL_DIR"
fi
run chmod +x "$INSTALL_DIR/scripts/riftgrid"
run mkdir -p "$INSTALL_DIR/runtime"
success 'Source is ready'

step 'Creating the Kubernetes cluster'
if "${K3D[@]}" cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "$CLUSTER_NAME"; then
  info "Existing k3d cluster ${CLUSTER_NAME} found; it will be reused."
else
  run "${K3D[@]}" cluster create "$CLUSTER_NAME" \
    --servers 1 --agents "$AGENTS" \
    --api-port "127.0.0.1:${API_PORT}" \
    --port "30000-30100:30000-30100@server:0" \
    --port "30000-30100:30000-30100/udp@server:0" \
    --k3s-arg "--kube-apiserver-arg=service-node-port-range=30000-32767@server:0" \
    --k3s-arg "--tls-san=host.docker.internal@server:0" \
    --wait
fi
kubeconfig="$("${K3D[@]}" kubeconfig get "$CLUSTER_NAME")"
printf '%s\n' "$kubeconfig" >"$INSTALL_DIR/runtime/kubeconfig"
run sed -i -E 's#server: https://[^:]+:#server: https://host.docker.internal:#' "$INSTALL_DIR/runtime/kubeconfig"
namespace_yaml="$("${DOCKER[@]}" exec "k3d-${CLUSTER_NAME}-server-0" kubectl create namespace riftgrid-servers --dry-run=client -o yaml)"
printf '%s\n' "$namespace_yaml" | "${DOCKER[@]}" exec -i "k3d-${CLUSTER_NAME}-server-0" kubectl apply -f - >/dev/null
success 'Kubernetes is ready; the game namespace exists'

step 'Generating installation secrets'
if [[ -f "$INSTALL_DIR/.env" ]]; then
  info 'Existing .env found; database and session secrets were preserved.'
else
  postgres_password="$(openssl rand -hex 24)"
  session_secret="$(openssl rand -hex 48)"
  cat >"$INSTALL_DIR/.env" <<EOF
RIFTGRID_PUBLIC_HOST=${PUBLIC_HOST}
RIFTGRID_CLUSTER_NAME=${CLUSTER_NAME}
RIFTGRID_BIND_ADDRESS=${BIND_ADDRESS}
RIFTGRID_KUBECONFIG=${INSTALL_DIR}/runtime/kubeconfig
KUBERNETES_NAMESPACE=riftgrid-servers
GAME_PUBLIC_HOST=${PUBLIC_HOST}
PORT_RANGE_START=30000
PORT_RANGE_END=30100
POSTGRES_PASSWORD=${postgres_password}
DATABASE_URL=postgresql://riftgrid:${postgres_password}@postgres:5432/riftgrid
SESSION_SECRET=${session_secret}
SESSION_COOKIE_SECURE=false
WEB_ORIGIN=http://${PUBLIC_HOST}:3000
PUBLIC_API_URL=http://${PUBLIC_HOST}:4000
EOF
fi
run chmod 600 "$INSTALL_DIR/.env" "$INSTALL_DIR/runtime/kubeconfig"
success 'Installation secrets are present with mode 0600'

step 'Building the control plane'
compose=("${DOCKER[@]}" compose --env-file "$INSTALL_DIR/.env" -f "$INSTALL_DIR/infrastructure/docker/compose.install.yml")
run "${compose[@]}" up -d postgres redis
run "${compose[@]}" build migrate api worker web
run "${compose[@]}" run --rm migrate
run "${compose[@]}" up -d api worker web
success 'Database migrations and control-plane startup completed'

step 'Preparing game runtime images'
if $SKIP_RUNTIME_IMAGES; then
  info 'Runtime image build was skipped by request.'
else
  for runtime in fivem rust valheim; do
    image="riftgrid/${runtime}-server:0.1.0"
    run "${DOCKER[@]}" build -t "$image" "$INSTALL_DIR/infrastructure/images/${runtime}-server"
    run "${K3D[@]}" image import "$image" -c "$CLUSTER_NAME"
  done
  success 'FiveM, Rust and Valheim runtime images are available on the cluster'
fi

step 'Verifying the installation'
healthy=false
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/login >/dev/null 2>&1; then healthy=true; break; fi
  sleep 2
done
$healthy || { "${compose[@]}" ps; fail "RIFTGRID did not become healthy. Run: cd $INSTALL_DIR && docker compose --env-file .env -f infrastructure/docker/compose.install.yml logs"; }
as_root ln -sfn "$INSTALL_DIR/scripts/riftgrid" /usr/local/bin/riftgrid
success 'API and dashboard health checks passed'

printf '\n%sSetup complete.%s\n' "$GREEN$BOLD" "$RESET"
printf 'Open:    %shttp://%s:3000/login%s\n' "$LIME" "$PUBLIC_HOST" "$RESET"
printf 'Then create the first administrator account in the browser.\n\n'
printf 'Useful commands:\n'
printf '  riftgrid status\n  riftgrid logs api\n  riftgrid doctor\n  riftgrid update\n\n'
printf '%sSecurity note:%s this quick installation uses HTTP. Put RIFTGRID behind TLS before exposing it to the internet.\n' "$BOLD" "$RESET"
