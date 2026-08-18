# Guided installer

RIFTGRID includes a terminal-first Linux installer inspired by the short onboarding path used by modern game control planes: copy one command, answer a small number of questions, then finish the first-admin bootstrap in the browser.

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh | bash
```

Because the script is piped to Bash, interactive input is read directly from the terminal. To inspect it before execution, download it first:

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh -o install-riftgrid.sh
less install-riftgrid.sh
bash install-riftgrid.sh
```

## What the wizard does

1. Verifies Linux, privilege escalation and input constraints.
2. Asks for the installation directory, dashboard hostname/IP and optional k3d worker count.
3. Checks `curl`, Git, OpenSSL, Docker with Compose v2 and k3d. Missing components are installed only after confirmation.
4. Clones RIFTGRID without replacing an unrelated or non-empty target.
5. Creates a dedicated k3d cluster, or reuses the named cluster when it already exists.
6. Creates the `riftgrid-servers` namespace and a container-safe kubeconfig.
7. Generates unique PostgreSQL and session secrets. An existing `.env` is preserved.
8. Starts persistent PostgreSQL/Redis services, applies migrations, builds the control plane and verifies API/UI health.
9. Builds and imports the first-party FiveM, Rust and Valheim runtime images.

The installer never deletes Docker volumes, Kubernetes PVCs, namespaces, clusters or game workloads. Re-running it preserves an existing `.env` and data volumes. It refuses to install over a directory that is not already a RIFTGRID Git checkout.

## Requirements

- A Linux host using x86-64
- Internet access during installation
- `sudo` or a root shell
- Ports `3000/tcp`, `4000/tcp` and `30000-30100/tcp+udp` available as required by your deployments
- At least 4 GB RAM for evaluation; game workloads need additional memory

The guided path creates one local k3d server node plus the requested number of agents. For production clusters, external PostgreSQL/Redis, ingress/TLS and custom storage, use the Helm installation instead.

## Options and automation

Preview the resolved plan without changing the host:

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh | bash -s -- --dry-run --host panel.example.test
```

Run unattended with explicit values:

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh | \
  bash -s -- --non-interactive --host panel.example.test --agents 1
```

Available options are listed by `bash install.sh --help`. Environment variables such as `RIFTGRID_INSTALL_DIR`, `RIFTGRID_PUBLIC_HOST`, `RIFTGRID_CLUSTER_NAME`, `RIFTGRID_AGENTS`, `RIFTGRID_KUBE_API_PORT` and `RIFTGRID_REPOSITORY` provide equivalent automation hooks.

## Day-two commands

The wizard installs a small `riftgrid` management command:

```bash
riftgrid status
riftgrid logs api
riftgrid doctor
riftgrid restart
riftgrid update
```

`riftgrid stop` stops only API, worker and web; PostgreSQL, Redis, the Kubernetes cluster and game workloads remain running. `riftgrid update` refuses to overwrite local Git changes, applies migrations, and then rebuilds the services.

## First login and TLS

Open `http://HOST:3000/login` and create the first administrator. Bootstrap closes after that account exists.

The all-in-one path intentionally starts on HTTP so it works without owning a domain. Do not expose it directly to the public internet. Put both the dashboard and API behind HTTPS, set `WEB_ORIGIN` and `PUBLIC_API_URL` to their public HTTPS origins, set `SESSION_COOKIE_SECURE=true`, then rebuild the web image and restart the control plane.

## Troubleshooting

Run `riftgrid doctor`, followed by `riftgrid status`. Service logs are available with `riftgrid logs api`, `riftgrid logs worker`, or `riftgrid logs web`. If Docker group membership was added during setup, reconnect the shell before invoking the management CLI without `sudo`.
