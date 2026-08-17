# Persistent workload backups

Backups run through the existing task/worker/control-plane path and store compressed, checksum-addressed archives on a dedicated per-server backup PVC. Minecraft is quiesced with `save-all flush` and `save-off`; `save-on` is restored in a `finally` boundary. The source PVC is mounted read-only while archiving.

The API and UI expose manual creation, task progress, history, archive size, SHA-256 checksum, failure details, restore, deletion, and scheduled policies. A restore is permitted only while both desired and actual server state are `STOPPED`; the workload remains stopped afterward so the operator controls the next start.

Successful creation applies the server policy or organization defaults for retention days and count while always protecting the newly created known-good archive. Expired archives are removed from storage before their database rows are deleted. Retention failures are recorded as activity without invalidating the new backup. A failed creation performs best-effort removal of its partial archive and retains the failed history row for diagnosis.

The current provider uses portable Kubernetes data jobs. A production provider can add CSI snapshots behind the same gateway without changing the persisted task model.
