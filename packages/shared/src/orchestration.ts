export const relationshipTypes = ["PROXY_FOR", "DEPENDS_ON", "CONNECTS_TO", "USES_DATABASE", "USES_CACHE", "DISCOVERS", "ROUTES_TO", "SHARES_STORAGE_WITH"] as const;
export type ComponentRelationshipType = typeof relationshipTypes[number];
export const workloadSemantics = ["PERSISTENT", "EPHEMERAL", "SESSION", "STATEFUL"] as const;
export type WorkloadSemantics = typeof workloadSemantics[number];
export type StackLifecycleAction = "START" | "STOP" | "RESTART";
export type StackHealth = "RUNNING" | "STOPPED" | "DEGRADED" | "TRANSITIONING" | "EMPTY";

export interface OrchestrationComponent { id: string; required: boolean; }
export interface OrchestrationRelationship { sourceComponentId: string; targetComponentId: string; type: ComponentRelationshipType; requiredForStartup: boolean; }
export interface LifecycleStep { componentId: string; action: "START" | "STOP"; }

export class DependencyCycleError extends Error {
  constructor(public readonly componentIds: string[]) { super(`Required component dependencies contain a cycle: ${componentIds.join(", ")}`); this.name = "DependencyCycleError"; }
}

export function dependencyOrder(components: OrchestrationComponent[], relationships: OrchestrationRelationship[]): string[] {
  const ids = new Set(components.map((component) => component.id));
  const indegree = new Map(components.map((component) => [component.id, 0]));
  const dependants = new Map(components.map((component) => [component.id, [] as string[]]));
  for (const relationship of relationships) {
    if (!relationship.requiredForStartup || !ids.has(relationship.sourceComponentId) || !ids.has(relationship.targetComponentId)) continue;
    if (relationship.sourceComponentId === relationship.targetComponentId) throw new DependencyCycleError([relationship.sourceComponentId]);
    indegree.set(relationship.sourceComponentId, (indegree.get(relationship.sourceComponentId) ?? 0) + 1);
    dependants.get(relationship.targetComponentId)!.push(relationship.sourceComponentId);
  }
  const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  const result: string[] = [];
  while (ready.length) {
    const id = ready.shift()!; result.push(id);
    for (const dependant of dependants.get(id) ?? []) {
      const next = (indegree.get(dependant) ?? 0) - 1; indegree.set(dependant, next);
      if (next === 0) { ready.push(dependant); ready.sort(); }
    }
  }
  if (result.length !== components.length) throw new DependencyCycleError([...indegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id));
  return result;
}

export function lifecyclePlan(components: OrchestrationComponent[], relationships: OrchestrationRelationship[], action: StackLifecycleAction): LifecycleStep[] {
  const startOrder = dependencyOrder(components, relationships);
  const stopOrder = [...startOrder].reverse();
  if (action === "START") return startOrder.map((componentId) => ({ componentId, action: "START" }));
  if (action === "STOP") return stopOrder.map((componentId) => ({ componentId, action: "STOP" }));
  return [...stopOrder.map((componentId) => ({ componentId, action: "STOP" as const })), ...startOrder.map((componentId) => ({ componentId, action: "START" as const }))];
}

export function aggregateStackHealth(components: Array<{ required: boolean; state: string | null }>): StackHealth {
  if (!components.length) return "EMPTY";
  const required = components.filter((component) => component.required);
  const considered = required.length ? required : components;
  const states = considered.map((component) => component.state ?? "UNKNOWN");
  if (states.every((state) => state === "RUNNING")) return "RUNNING";
  if (states.every((state) => state === "STOPPED")) return "STOPPED";
  if (states.some((state) => ["PENDING", "SCHEDULING", "INSTALLING", "STARTING", "STOPPING", "PROVISIONING", "BACKING_UP", "RESTORING", "MIGRATING"].includes(state))) return "TRANSITIONING";
  return "DEGRADED";
}
