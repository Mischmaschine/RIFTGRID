# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability, exposed credential, authentication bypass, privilege escalation, secret disclosure, or destructive storage behavior.

Use GitHub's private vulnerability reporting feature for this repository when available. If it is not available, contact the repository owner privately through the verified contact channel on their GitHub profile.

Include:

- affected component and version/commit;
- reproduction steps with secrets removed;
- realistic impact;
- relevant logs or screenshots after redaction;
- any proposed mitigation.

You should receive an acknowledgement within seven days. Please allow time for investigation and coordinated remediation before disclosure.

## Security boundaries

RIFTGRID assumes:

- PostgreSQL, Redis, and Kubernetes API endpoints are on trusted networks;
- kubeconfig credentials are scoped to the required cluster and namespaces;
- external credentials are supplied through Kubernetes Secrets;
- TLS, ingress, backup encryption, and external secret management are configured for the deployment environment;
- operators review destructive restore/delete actions before approval.

Never attach real `.env` files, kubeconfigs, database dumps, Minecraft worlds, backup archives, session cookies, or Cfx.re license keys to an issue.
