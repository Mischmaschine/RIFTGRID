import { RiftgridError } from "@riftgrid/shared";

type Protocol = "TCP" | "UDP";

export function chooseAvailablePort(used: ReadonlySet<number>, start: number, end: number): number {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || start > end) throw new RangeError("Invalid port range");
  for (let port = start; port <= end; port += 1) if (!used.has(port)) return port;
  throw new RiftgridError("PORT_ALLOCATION_FAILED", `No port is available in ${start}-${end}.`, 409);
}

export function chooseAvailableProtocolPort(allocations: ReadonlyArray<{ port: number; protocol: Protocol }>, protocol: Protocol, start: number, end: number, preferred?: number): number {
  const used = new Set(allocations.filter((allocation) => allocation.protocol === protocol).map((allocation) => allocation.port));
  if (preferred !== undefined && preferred >= start && preferred <= end && !used.has(preferred)) return preferred;
  return chooseAvailablePort(used, start, end);
}
