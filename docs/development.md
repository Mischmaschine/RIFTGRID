# Development

Use Node 20+, pnpm 11+, PostgreSQL 16 and Redis 7. Copy `.env.example`, start dependencies with the Compose file, migrate, then use `pnpm dev`. Unit tests do not require Kubernetes. Integration testing needs a kubeconfig and a default StorageClass.

The development login begins with a one-time bootstrap endpoint. It is disabled as soon as the first user exists. Mock cluster data is never enabled implicitly; without Kubernetes connectivity the UI reports the real error.
