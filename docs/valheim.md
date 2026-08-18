# Valheim installer

RIFTGRID installs the official Linux Valheim Dedicated Server with SteamCMD App `896660`. The first-party runtime image is built from `infrastructure/images/valheim-server` and validates the server files on each cold start.

Worlds, permission files and server state remain below `/data/saves` on the deployment PVC. The installer allocates the configured UDP game port and its following UDP query port, matching Valheim's documented two-port contract. Public/private listing and the optional crossplay backend are configurable.

The server password is injected from an existing Kubernetes Secret and is never stored as plaintext in PostgreSQL or returned by the API. The entrypoint rejects passwords shorter than five characters before starting the server.

The default local development image is `riftgrid/valheim-server:0.1.0`; production deployments should publish and pin the image through `VALHEIM_RUNTIME_IMAGE`.
