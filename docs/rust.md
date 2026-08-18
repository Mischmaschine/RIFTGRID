# Rust installer

RIFTGRID installs the official Linux Rust Dedicated Server with SteamCMD App `258550`. The first-party runtime image is built from `infrastructure/images/rust-server` and installs or validates the selected public/staging branch on every cold start.

Persistent data lives under `/data`. The configured identity keeps world saves and configuration stable across pod recreation. Public allocations are created for the UDP game/query ports and the TCP Rust+ companion endpoint. WebRCON listens inside the pod for readiness and administration but is not exposed through a public NodePort.

The WebRCON password is read from an existing Kubernetes Secret. Only the Secret name and data-key are stored in RIFTGRID configuration or templates.

The default local development image is `riftgrid/rust-server:0.1.0`; production deployments should publish and pin the image through `RUST_RUNTIME_IMAGE`.
