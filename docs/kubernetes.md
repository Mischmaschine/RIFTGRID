# Kubernetes integration

RIFTGRID loads in-cluster credentials when deployed and the selected kubeconfig context during local development. The official Kubernetes client performs discovery, log streaming, exec and declarative resource upserts.

The control-plane ServiceAccount may list/watch nodes and pods, and manage StatefulSets, PVCs, Services, ConfigMaps and pod exec/logs only in the game namespace. Do not grant cluster-admin. Game pods are non-privileged and drop Linux capabilities.
