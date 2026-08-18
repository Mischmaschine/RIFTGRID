# Installation

## Guided all-in-one installation

For a new single Linux host, use the interactive installer:

```bash
curl -fsSL https://raw.githubusercontent.com/Mischmaschine/RIFTGRID/main/install.sh | bash
```

It installs RIFTGRID into `/opt/riftgrid` by default and guides the operator through host naming and cluster sizing. Read the complete [guided installer reference](installer.md), especially the firewall and TLS notes, before exposing the dashboard publicly.

## Existing Kubernetes cluster

The first supported production path is the Helm chart in `infrastructure/helm/riftgrid`. Supply external PostgreSQL and Redis URLs, a 32+ character session secret, public web/API origins, image repositories and a StorageClass. The release creates the control-plane ServiceAccount and the namespace used for game workloads.

Required cluster capabilities: Kubernetes 1.28+, dynamic ReadWriteOnce PVC provisioning, NodePort or an operator-supplied service strategy, metrics access for richer scheduling, and outbound image/download access for Minecraft installation.
