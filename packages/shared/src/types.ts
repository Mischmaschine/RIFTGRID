export const serverStates = [
  "PENDING", "SCHEDULING", "INSTALLING", "STARTING", "RUNNING", "STOPPING",
  "STOPPED", "BACKING_UP", "RESTORING", "MIGRATING", "FAILED",
] as const;
export type ServerState = (typeof serverStates)[number];
export type DesiredServerState = "RUNNING" | "STOPPED";

export const taskStatuses = ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export const taskTypes = [
  "CREATE_SERVER", "START_SERVER", "STOP_SERVER", "RESTART_SERVER", "BACKUP_SERVER",
  "RESTORE_SERVER", "MIGRATE_SERVER", "REINSTALL_SERVER", "DELETE_SERVER", "RECONCILE_SERVER",
] as const;
export type TaskType = (typeof taskTypes)[number];

export interface ResourceRequest {
  cpuMillicores: number;
  memoryMiB: number;
  storageGiB: number;
}

export interface PlacementRequest {
  nodeId?: string;
  requiredLabels?: Record<string, string>;
  toleratedTaints?: string[];
}

export interface NodeCandidate {
  id: string;
  name: string;
  healthy: boolean;
  maintenance: boolean;
  schedulingEnabled: boolean;
  capacity: ResourceRequest;
  allocated: ResourceRequest;
  labels: Record<string, string>;
  taints: string[];
  workloadCount: number;
  internalIp?: string;
  kubernetesVersion?: string;
  events?: Array<{ type: string; reason: string; message: string; timestamp: string | null }>;
}

export interface CandidateDecision {
  nodeId: string;
  nodeName: string;
  accepted: boolean;
  score: number | null;
  reasons: string[];
  factors: Record<string, number>;
}

export interface SchedulingResult {
  selected: NodeCandidate;
  explanation: string;
  candidates: CandidateDecision[];
}
