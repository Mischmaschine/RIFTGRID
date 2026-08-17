# Operations

## Normal lifecycle

Use the RIFTGRID UI or API for start, stop, restart, reconcile, backup, restore, migration, and reinstall operations. Do not manually patch database state while the normal reconciler can inspect Kubernetes and converge it.

## Persistent data

- Workload PVCs are separate from StatefulSet lifecycle.
- Reconciliation must not recreate storage implicitly.
- Backups use a dedicated backup claim and SHA-256 metadata.
- Restore requires an intentionally stopped workload.

## Diagnosing drift

1. Check the task and its current step.
2. Compare desired and actual RIFTGRID state.
3. Inspect pod readiness, restart count, events, PVC binding, and Service allocation.
4. Confirm API, worker, PostgreSQL, and Redis health.
5. Retry only through the existing reconciliation path after identifying the cause.

## Quality verification

Run repository gates sequentially:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

More: [Backups](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/backups.md) · [Networking](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/networking.md) · [Storage](https://github.com/Mischmaschine/RIFTGRID/blob/main/docs/storage.md)
