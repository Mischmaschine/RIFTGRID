import { RiftgridError, type CandidateDecision, type NodeCandidate, type PlacementRequest, type ResourceRequest, type SchedulingResult } from "@riftgrid/shared";

function remaining(capacity: number, allocated: number): number { return Math.max(0, capacity - allocated); }

export function schedule(nodes: NodeCandidate[], request: ResourceRequest, placement: PlacementRequest = {}): SchedulingResult {
  const candidates: CandidateDecision[] = nodes.map((node) => {
    const reasons: string[] = [];
    if (placement.nodeId && placement.nodeId !== node.id) reasons.push("not the requested node");
    if (!node.healthy) reasons.push("node is unhealthy");
    if (node.maintenance) reasons.push("node is in maintenance");
    if (!node.schedulingEnabled) reasons.push("scheduling is disabled");
    if (remaining(node.capacity.cpuMillicores, node.allocated.cpuMillicores) < request.cpuMillicores) reasons.push("insufficient CPU");
    if (remaining(node.capacity.memoryMiB, node.allocated.memoryMiB) < request.memoryMiB) reasons.push("insufficient memory");
    if (remaining(node.capacity.storageGiB, node.allocated.storageGiB) < request.storageGiB) reasons.push("insufficient storage");
    for (const [key, value] of Object.entries(placement.requiredLabels ?? {})) {
      if (node.labels[key] !== value) reasons.push(`label ${key}=${value} is required`);
    }
    const untolerated = node.taints.filter((taint) => !(placement.toleratedTaints ?? []).includes(taint));
    if (untolerated.length) reasons.push(`untolerated taints: ${untolerated.join(", ")}`);
    if (reasons.length) return { nodeId: node.id, nodeName: node.name, accepted: false, score: null, reasons, factors: {} };

    const cpuFree = remaining(node.capacity.cpuMillicores, node.allocated.cpuMillicores) / node.capacity.cpuMillicores;
    const memoryFree = remaining(node.capacity.memoryMiB, node.allocated.memoryMiB) / node.capacity.memoryMiB;
    const density = 1 / (1 + node.workloadCount);
    const score = Number((cpuFree * 0.4 + memoryFree * 0.45 + density * 0.15).toFixed(4));
    return { nodeId: node.id, nodeName: node.name, accepted: true, score, reasons: ["healthy", "sufficient resources", "placement requirements matched"], factors: { cpuFree, memoryFree, density } };
  });
  const winner = candidates.filter((candidate) => candidate.accepted).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!winner) throw new RiftgridError("NO_CLUSTER_CAPACITY", "No eligible Kubernetes node has enough resources.", 409, { candidates });
  const selected = nodes.find((node) => node.id === winner.nodeId)!;
  return { selected, candidates, explanation: `${selected.name} selected because it is healthy, has sufficient resources and matches all placement requirements (score ${winner.score}).` };
}
