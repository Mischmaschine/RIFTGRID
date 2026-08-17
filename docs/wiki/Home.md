# RIFTGRID Wiki

Welcome to the operator-focused RIFTGRID wiki.

RIFTGRID is a self-hosted desired-state control plane for persistent game infrastructure on Kubernetes. It separates universal orchestration from installer-specific setup and game-specific intelligence.

## Start here

1. [Getting Started](Getting-Started)
2. [Architecture](Architecture)
3. [Operations](Operations)
4. [Security](Security)
5. [Frequently Asked Questions](FAQ)

## Core principles

- Desired state is durable.
- Observed Kubernetes reality is never replaced by decorative status.
- Persistent storage identity survives normal reconciliation.
- Mutations are asynchronous, auditable tasks.
- Installers get software running; adapters understand the game.
- Secrets remain in Kubernetes Secrets.

For detailed engineering documentation, use the repository [`docs/`](https://github.com/Mischmaschine/RIFTGRID/tree/main/docs) directory.
