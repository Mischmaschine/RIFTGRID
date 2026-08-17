# FiveM installer and adapter

FiveM is implemented as a first-party installer plus a separate runtime adapter. The installer discovers an explicit official Linux FXServer artifact, uses the locally built `riftgrid/fivem-server:0.1.0` runtime image, persists FXServer, `cfx-server-data`, `server.cfg`, and txAdmin data under `/data`, and exposes both TCP/UDP game traffic and the txAdmin HTTP endpoint through the normal RIFTGRID allocation pipeline.

The deployment schema covers the official artifact URL, public server identity, locale, tags, player limit, game and txAdmin ports, txAdmin profile, and a required Kubernetes Secret reference for `CFX_LICENSE_KEY`. RIFTGRID stores only the Secret name and key. The credential value is never accepted as an ordinary environment value, returned by the API, or written into `server.cfg`.

An optional managed MariaDB/MySQL binding can be selected in the deployment wizard. Non-secret connection metadata is injected as `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, and `DATABASE_USER`; `DATABASE_PASSWORD` is mounted from the managed database's Kubernetes Secret. Resources can consume those process environment variables without RIFTGRID persisting a plaintext connection string.

The adapter models health, players, resources, txAdmin, configuration, database, and performance capabilities. Logs are available through the common console view, but command input is deliberately read-only until a supported FXServer/txAdmin command transport is implemented; RIFTGRID does not send Minecraft RCON commands to FiveM.

Final live acceptance remains `BLOCKED_BY_EXTERNAL_SECRET`. No successful FiveM deployment may be claimed until a valid Cfx.re registration key is supplied in namespace `riftgrid-servers`, a real FXServer pod becomes ready, txAdmin onboarding is verified, both game protocols are reachable, and a FiveM client connection succeeds.
