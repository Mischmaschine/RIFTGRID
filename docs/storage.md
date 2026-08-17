# Storage

The storage boundary provisions, observes, snapshots and restores server volumes. The initial Kubernetes implementation creates one PVC per server from the configured StorageClass. Migration is permitted only when the StorageClass topology/access mode supports the target; RIFTGRID must never claim a migration succeeded before the target mounts the same data.
