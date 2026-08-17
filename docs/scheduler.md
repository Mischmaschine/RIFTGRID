# Explainable scheduler

The scheduler first rejects nodes that are unhealthy, in maintenance, disabled, tainted without matching tolerations, missing requested labels or lacking CPU/memory capacity. It then scores remaining candidates from free CPU, free memory and lower workload count. The full candidate list, rejection reasons, score components and selected node are persisted as a scheduling decision.

If no node passes hard constraints, the API exposes `NO_CLUSTER_CAPACITY`; the UI instructs the administrator to add or free a node manually. RIFTGRID never buys infrastructure.
