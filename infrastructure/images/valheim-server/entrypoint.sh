#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_NAME:?SERVER_NAME is required}"
: "${WORLD_NAME:?WORLD_NAME is required}"
: "${GAME_PORT:?GAME_PORT is required}"
: "${PUBLIC_SERVER:?PUBLIC_SERVER is required}"
: "${CROSSPLAY:?CROSSPLAY is required}"
: "${SERVER_PASSWORD:?SERVER_PASSWORD is required}"

if (( ${#SERVER_PASSWORD} < 5 )); then
  echo "SERVER_PASSWORD must contain at least five characters." >&2
  exit 64
fi

install_dir=/data/server
save_dir=/data/saves
mkdir -p "$install_dir" "$save_dir"

steamcmd \
  +force_install_dir "$install_dir" \
  +login anonymous \
  +app_update 896660 validate \
  +quit

crossplay_arguments=()
if [[ "$CROSSPLAY" == "1" ]]; then
  crossplay_arguments=(-crossplay)
fi

export LD_LIBRARY_PATH="$install_dir/linux64:${LD_LIBRARY_PATH:-}"
exec "$install_dir/valheim_server.x86_64" \
  -nographics \
  -batchmode \
  -name "$SERVER_NAME" \
  -port "$GAME_PORT" \
  -world "$WORLD_NAME" \
  -password "$SERVER_PASSWORD" \
  -savedir "$save_dir" \
  -public "$PUBLIC_SERVER" \
  "${crossplay_arguments[@]}"
