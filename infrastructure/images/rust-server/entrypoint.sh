#!/usr/bin/env bash
set -Eeuo pipefail

: "${SERVER_NAME:?SERVER_NAME is required}"
: "${SERVER_IDENTITY:?SERVER_IDENTITY is required}"
: "${STEAM_BRANCH:?STEAM_BRANCH is required}"
: "${WORLD_SEED:?WORLD_SEED is required}"
: "${WORLD_SIZE:?WORLD_SIZE is required}"
: "${MAX_PLAYERS:?MAX_PLAYERS is required}"
: "${GAME_PORT:?GAME_PORT is required}"
: "${QUERY_PORT:?QUERY_PORT is required}"
: "${RCON_PORT:?RCON_PORT is required}"
: "${COMPANION_PORT:?COMPANION_PORT is required}"
: "${RCON_PASSWORD:?RCON_PASSWORD is required}"

install_dir=/data/server
mkdir -p "$install_dir"

branch_arguments=()
if [[ "$STEAM_BRANCH" == "staging" ]]; then
  branch_arguments=(-beta staging)
fi

steamcmd \
  +force_install_dir "$install_dir" \
  +login anonymous \
  +app_update 258550 "${branch_arguments[@]}" validate \
  +quit

exec "$install_dir/RustDedicated" \
  -batchmode \
  +server.port "$GAME_PORT" \
  +server.queryport "$QUERY_PORT" \
  +server.hostname "$SERVER_NAME" \
  +server.description "${SERVER_DESCRIPTION:-A RIFTGRID Rust server}" \
  +server.identity "$SERVER_IDENTITY" \
  +server.seed "$WORLD_SEED" \
  +server.worldsize "$WORLD_SIZE" \
  +server.maxplayers "$MAX_PLAYERS" \
  +rcon.port "$RCON_PORT" \
  +rcon.password "$RCON_PASSWORD" \
  +rcon.web 1 \
  +app.port "$COMPANION_PORT" \
  -logfile -
