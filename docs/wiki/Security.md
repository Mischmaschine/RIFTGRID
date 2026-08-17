# Security

## Never commit or paste

- `.env` files or session secrets
- kubeconfigs or service-account tokens
- Kubernetes Secret values
- database passwords or dumps
- world files or backup archives
- Cfx.re license keys

## Deployment checklist

- Scope Kubernetes credentials to required namespaces and resources.
- Put PostgreSQL, Redis, and the Kubernetes API on trusted networks.
- Terminate TLS at the ingress or reverse proxy.
- Use an external secret manager for production.
- Back up PostgreSQL and persistent workload data independently.
- Review organization roles and keep at least one enabled super administrator.
- Treat restore, reinstall, and delete as explicit destructive operations.

Use the repository [security policy](https://github.com/Mischmaschine/RIFTGRID/security/policy) for private vulnerability reports.
