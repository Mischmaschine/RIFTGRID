# RIFTGRID

> Build worlds. Not servers.

RIFTGRID is a desired-state game-server control plane for Kubernetes. This repository currently focuses on the first real vertical slice: authenticate, discover existing nodes, create a Paper/Vanilla Minecraft world, explain placement, provision persistent storage/network/workload, observe health, stream console output and start/stop the same persistent world.

## Quick start

1. Copy `.env.example` to `.env` and set a strong `SESSION_SECRET`.
2. Start PostgreSQL and Redis: `docker compose -f infrastructure/docker/compose.yml up -d`.
3. Install and migrate: `pnpm install && pnpm db:migrate`.
4. Ensure your current kubeconfig can access the target cluster and has the permissions documented in `docs/kubernetes.md`.
5. Run `pnpm dev`, open `http://localhost:3000`, and create the first administrator.

For an isolated local Kubernetes cluster, install Docker and k3d, then run `pnpm cluster:dev`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run web, API and worker |
| `pnpm test` | Run domain and API tests |
| `pnpm typecheck` | Type-check all packages |
| `pnpm build` | Build the complete monorepo |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm cluster:dev` | Create a local k3d cluster |

See [PLAN.md](./PLAN.md) and [docs/architecture.md](./docs/architecture.md) for scope and design.
