# Architecture

The API persists user intent and enqueues idempotent work. The worker reconciles that intent through domain services; it does not treat a successful API request as a running server. PostgreSQL remains the record of intent, decisions, state and audit history. Redis carries jobs and real-time events. Kubernetes is the source for workload observation.

```text
Web -> Fastify API -> PostgreSQL
              |          ^
              v          |
            Redis -> Worker -> Scheduler -> Kubernetes API
                         |                    |
                         +---- Game adapter <-+
```

Core packages depend on the game SDK, never on a concrete adapter. The composition root registers adapters. Kubernetes objects use deterministic names (`rg-<server id>`) so create/retry/reconcile operations are idempotent.

## Trust boundaries

The browser never receives Kubernetes credentials. Sessions are opaque, hashed and revocable. Every mutating route checks a permission. Kubernetes access is scoped with the supplied RBAC manifest. Game containers run non-privileged, with dropped capabilities, a read-only root filesystem where supported, resource limits, and a per-world PVC.
