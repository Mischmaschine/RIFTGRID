# Contributing to RIFTGRID

Thanks for helping improve RIFTGRID. Changes should keep infrastructure behavior explicit, persistent data safe, and operator-visible state truthful.

## Before you start

1. Search existing issues and pull requests.
2. Open a focused issue for behavior changes or larger features.
3. Never include credentials, kubeconfigs, database dumps, world archives, or private logs.
4. Keep installer concerns separate from game-adapter concerns.

## Development workflow

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

Run quality gates sequentially before submitting:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull-request expectations

- Explain the problem and the chosen tradeoff.
- Identify database, Kubernetes, security, and persistent-data impact.
- Include tests for state-machine, scheduling, parsing, or policy behavior.
- Include screenshots for visible UI changes.
- Document new environment variables and operational prerequisites.
- Do not use destructive migration or workload-recreation shortcuts.

## Architecture guardrails

- PostgreSQL remains authoritative for desired state.
- Kubernetes remains authoritative for observed workload reality.
- Durable mutations run through tasks and respect operation ownership.
- Secrets are referenced by name and key; plaintext values do not enter ordinary deployment configuration.
- Persistent storage must not be replaced implicitly during reconciliation.
- Core orchestration must not acquire game-specific assumptions.

By contributing, you confirm that you have the right to submit the work. Repository publication does not change the project's licensing terms.
