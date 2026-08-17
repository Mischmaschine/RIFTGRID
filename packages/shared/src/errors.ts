export const errorCodes = [
  "NO_CLUSTER_CAPACITY", "INSUFFICIENT_CLUSTER_CAPACITY", "NODE_UNAVAILABLE",
  "NODE_IN_MAINTENANCE", "INVALID_SERVER_STATE", "INVALID_GAME_CONFIGURATION",
  "GAME_VERSION_UNAVAILABLE", "STORAGE_UNAVAILABLE", "PORT_ALLOCATION_FAILED",
  "BACKUP_FAILED", "RESTORE_FAILED", "MIGRATION_NOT_SUPPORTED", "UNAUTHORIZED",
  "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export class RiftgridError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "RiftgridError";
  }
}

export function errorMessage(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    NO_CLUSTER_CAPACITY: "No connected node can satisfy this world. Add capacity or reduce its resource request.",
    INSUFFICIENT_CLUSTER_CAPACITY: "Cluster capacity is exhausted. Add another node manually.",
    NODE_UNAVAILABLE: "The selected node is unavailable.",
    NODE_IN_MAINTENANCE: "The selected node is in maintenance mode.",
    INVALID_SERVER_STATE: "This action is not valid in the server's current state.",
    INVALID_GAME_CONFIGURATION: "The game configuration is invalid.",
    GAME_VERSION_UNAVAILABLE: "The selected game version is unavailable.",
    STORAGE_UNAVAILABLE: "Persistent storage is unavailable.",
    PORT_ALLOCATION_FAILED: "No collision-free network port could be allocated.",
    BACKUP_FAILED: "The backup could not be completed.",
    RESTORE_FAILED: "The backup could not be restored safely.",
    MIGRATION_NOT_SUPPORTED: "The server storage cannot be migrated to that node.",
    UNAUTHORIZED: "Sign in to continue.",
    FORBIDDEN: "You do not have permission to perform this action.",
    NOT_FOUND: "The requested resource does not exist.",
    CONFLICT: "The requested operation conflicts with current state.",
    INTERNAL_ERROR: "RIFTGRID could not complete the operation.",
  };
  return messages[code];
}
