# Desired state and reconciliation

`desiredState` records intent (`RUNNING` or `STOPPED`). `actualState` records the last observed lifecycle state. API actions only update intent and create a unique task. The worker acquires a PostgreSQL advisory lock per server, validates a state transition, applies deterministic Kubernetes resources, then waits for adapter health before reporting `RUNNING`.

The worker also scans observed running workloads and desired/actual drift every 30 seconds. A failed adapter health observation changes the recorded state to `FAILED` and creates one reconcile task when no active task already owns that server. Healthy, converged servers do not create background task noise.

Retries are safe: database uniqueness prevents duplicate active tasks and ports, while server-id-derived Kubernetes names turn resource creation into upserts. A task reports success only after Kubernetes and the adapter confirm the outcome.
