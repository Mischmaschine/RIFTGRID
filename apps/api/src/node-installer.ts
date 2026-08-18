export function nodeInstallerScript() {
  return `#!/bin/sh
set -eu

RIFTGRID_URL=""
KUBERNETES_SERVER_URL=""
NODE_NAME=""
EXPECTED_ARCH=""

usage() {
  echo "Usage: sudo sh riftgrid-node-install.sh --riftgrid-url URL --server-url URL --node-name NAME --architecture AMD64|ARM64"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --riftgrid-url) RIFTGRID_URL="\${2:-}"; shift 2 ;;
    --server-url) KUBERNETES_SERVER_URL="\${2:-}"; shift 2 ;;
    --node-name) NODE_NAME="\${2:-}"; shift 2 ;;
    --architecture) EXPECTED_ARCH="\${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then echo "Run this installer with sudo." >&2; exit 1; fi
if [ -z "$RIFTGRID_URL" ] || [ -z "$KUBERNETES_SERVER_URL" ] || [ -z "$NODE_NAME" ] || [ -z "$EXPECTED_ARCH" ]; then usage; exit 2; fi
case "$NODE_NAME" in *[!a-z0-9-]*|''|-*|*-) echo "Invalid node name." >&2; exit 2;; esac
if [ ! -r /etc/os-release ]; then echo "Unsupported operating system: Linux with /etc/os-release is required." >&2; exit 1; fi
. /etc/os-release
case "\${ID:-}:\${VERSION_ID:-}" in ubuntu:22.04|ubuntu:24.04|debian:12) ;; *) echo "Supported systems: Ubuntu 22.04/24.04 and Debian 12." >&2; exit 1;; esac
case "$(uname -m):$EXPECTED_ARCH" in x86_64:AMD64|aarch64:ARM64|arm64:ARM64) ;; *) echo "Selected architecture does not match this server." >&2; exit 1;; esac

if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y curl ca-certificates
fi

read_hidden() {
  prompt="$1"
  printf "%s" "$prompt" > /dev/tty
  stty -echo < /dev/tty
  if ! IFS= read -r secret < /dev/tty; then stty echo < /dev/tty; exit 1; fi
  stty echo < /dev/tty
  printf "\\n" > /dev/tty
  printf "%s" "$secret"
}
ENROLLMENT_TOKEN=$(read_hidden "RIFTGRID one-time enrollment code: ")
K3S_TOKEN=$(read_hidden "K3s node token (copied from the control-plane server): ")
if [ -z "$ENROLLMENT_TOKEN" ] || [ -z "$K3S_TOKEN" ]; then echo "Both secrets are required." >&2; exit 1; fi

check_in() {
  payload=$(printf '{"status":"%s","message":"%s"}' "$1" "$2")
  curl -fsS --connect-timeout 10 -X POST "$RIFTGRID_URL/api/v1/node-enrollments/check-in" \
    -H "Authorization: Bearer $ENROLLMENT_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$payload" >/dev/null
}

check_in PREFLIGHT "Remote server reached RIFTGRID and passed OS and architecture checks"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet k3s-agent; then
  check_in VERIFYING "An active k3s agent already exists; waiting for Kubernetes discovery"
  echo "An active k3s agent already exists. RIFTGRID will verify the node without reinstalling it."
  exit 0
fi
if [ -e /etc/systemd/system/k3s-agent.service ] || [ -e /etc/rancher/node/password ]; then
  check_in FAILED "An inactive or incomplete k3s agent installation already exists"
  echo "An existing inactive k3s agent installation was found. It was not overwritten." >&2
  exit 1
fi

check_in INSTALLING "Installing the k3s agent"
K3S_INSTALLER=$(mktemp)
trap 'rm -f "$K3S_INSTALLER"' EXIT
if ! curl -sfL https://get.k3s.io -o "$K3S_INSTALLER"; then
  check_in FAILED "Could not download the official k3s installer" || true
  echo "Could not download the official k3s installer." >&2
  exit 1
fi
if ! K3S_URL="$KUBERNETES_SERVER_URL" K3S_TOKEN="$K3S_TOKEN" INSTALL_K3S_EXEC="agent --node-name $NODE_NAME" sh "$K3S_INSTALLER"; then
  check_in FAILED "The k3s agent installer failed" || true
  echo "The k3s agent installer failed. Review its output above." >&2
  exit 1
fi
check_in VERIFYING "k3s agent installed; waiting for Kubernetes to report the node as Ready" || true
unset K3S_TOKEN ENROLLMENT_TOKEN
echo "k3s agent installed. RIFTGRID is waiting for Kubernetes to report node $NODE_NAME as Ready."
`;
}
