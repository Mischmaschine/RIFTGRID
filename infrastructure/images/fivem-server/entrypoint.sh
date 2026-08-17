#!/bin/sh
set -eu

: "${FIVEM_ARTIFACT_URL:?FIVEM_ARTIFACT_URL is required}"
: "${CFX_LICENSE_KEY:?CFX_LICENSE_KEY must come from a Kubernetes Secret}"

SERVER_ROOT=/data/server
SERVER_DATA=/data/server-data
TX_DATA=/data/txData
GAME_PORT=${GAME_PORT:-30120}
TXADMIN_PORT=${TXADMIN_PORT:-40120}
SERVER_PROFILE=${SERVER_PROFILE:-default}

mkdir -p "$SERVER_ROOT" "$TX_DATA"
if [ ! -x "$SERVER_ROOT/run.sh" ]; then
  archive=$(mktemp)
  curl --fail --location --retry 4 --output "$archive" "$FIVEM_ARTIFACT_URL"
  tar -xJf "$archive" -C "$SERVER_ROOT"
  rm -f "$archive"
fi

if [ ! -d "$SERVER_DATA/resources" ]; then
  rm -rf "$SERVER_DATA"
  git clone --depth 1 https://github.com/citizenfx/cfx-server-data.git "$SERVER_DATA"
fi

if [ ! -f "$SERVER_DATA/server.cfg" ]; then
  cat > "$SERVER_DATA/server.cfg" <<EOF
endpoint_add_tcp "0.0.0.0:${GAME_PORT}"
endpoint_add_udp "0.0.0.0:${GAME_PORT}"
ensure mapmanager
ensure chat
ensure spawnmanager
ensure sessionmanager
ensure basic-gamemode
ensure hardcap
ensure rconlog
sets tags "${TAGS:-riftgrid}"
sets locale "${LOCALE:-en-US}"
sv_hostname "${SERVER_NAME:-RIFTGRID FiveM}"
sets sv_projectName "${SERVER_NAME:-RIFTGRID FiveM}"
sets sv_projectDesc "Managed by RIFTGRID"
set onesync on
sv_maxclients ${MAX_CLIENTS:-48}
EOF
fi

cd "$SERVER_ROOT"
exec ./run.sh \
  +set serverProfile "$SERVER_PROFILE" \
  +set txAdminPort "$TXADMIN_PORT" \
  +set txAdminInterface 0.0.0.0 \
  +set txDataPath "$TX_DATA" \
  +set sv_licenseKey "$CFX_LICENSE_KEY"
