# Getting Started

## Requirements

- Node.js 20+
- pnpm 11.19.0
- PostgreSQL and Redis
- Docker Desktop or another container runtime
- A reachable Kubernetes cluster and current kubeconfig

## Guided installation

On a clean x86-64 Linux host:

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh | bash
```

The terminal wizard configures an isolated k3d cluster and the complete control plane. It preserves an existing RIFTGRID installation and persistent data when re-run.

## Local development

```powershell
Copy-Item .env.example .env
docker compose -f infrastructure/docker/compose.yml up -d
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. Use `pnpm cluster:dev` to create an isolated local k3d cluster.

## First deployment

1. Sign in to the RIFTGRID console.
2. Open **Deploy Server**.
3. Choose an installer or **Custom Docker**.
4. Configure runtime, resources, persistence, network, and placement.
5. Review the generated intent and submit once.
6. Follow the task until it reaches `SUCCESS` and the deployment reaches `RUNNING`.

Minecraft requires acceptance of its EULA. FiveM additionally requires a Cfx.re license key stored in an existing Kubernetes Secret.

Detailed guides: [Installation](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/installation.md) · [Guided installer](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/installer.md) · [Development](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/development.md) · [Kubernetes](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/kubernetes.md)
