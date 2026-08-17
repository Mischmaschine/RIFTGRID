# Security

- Opaque sessions are stored only as SHA-256 hashes and sent via HTTP-only, SameSite=Lax cookies; production requires `Secure` cookies.
- Passwords use bcrypt with a configurable cost. Bootstrap closes after the first account.
- Zod validates every boundary; Drizzle parameterizes SQL.
- RBAC checks precede resource access and mutation. Audit events store actor and structured context.
- WebSocket connections authenticate from the same session before subscription.
- File paths (when the file manager lands) must be resolved beneath a server-specific root and verified after canonicalization.
- Kubernetes manifests disallow privilege escalation, run non-root where the upstream image permits it, drop capabilities and enforce resources.
- User strings are never interpolated into shell commands. Kubernetes exec receives argument arrays.
