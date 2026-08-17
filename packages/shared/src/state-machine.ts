import { RiftgridError } from "./errors.js";
import type { ServerState } from "./types.js";

const transitions: Record<ServerState, ReadonlySet<ServerState>> = {
  PENDING: new Set(["SCHEDULING", "FAILED"]),
  SCHEDULING: new Set(["INSTALLING", "FAILED"]),
  INSTALLING: new Set(["SCHEDULING", "STARTING", "FAILED"]),
  STARTING: new Set(["SCHEDULING", "RUNNING", "STOPPING", "FAILED"]),
  RUNNING: new Set(["STOPPING", "BACKING_UP", "MIGRATING", "FAILED"]),
  STOPPING: new Set(["STOPPED", "FAILED"]),
  STOPPED: new Set(["STARTING", "RESTORING", "MIGRATING", "FAILED"]),
  BACKING_UP: new Set(["RUNNING", "STOPPED", "FAILED"]),
  RESTORING: new Set(["STOPPED", "FAILED"]),
  MIGRATING: new Set(["STARTING", "FAILED"]),
  FAILED: new Set(["SCHEDULING", "STARTING", "STOPPING", "STOPPED"]),
};

export function canTransition(from: ServerState, to: ServerState): boolean {
  return from === to || transitions[from].has(to);
}

export function assertTransition(from: ServerState, to: ServerState): void {
  if (!canTransition(from, to)) {
    throw new RiftgridError("INVALID_SERVER_STATE", `Invalid server transition: ${from} -> ${to}`, 409, { from, to });
  }
}

export function validTransitions(from: ServerState): ServerState[] {
  return [...transitions[from]];
}
