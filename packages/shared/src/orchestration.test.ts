import { describe, expect, it } from "vitest";
import { aggregateStackHealth, DependencyCycleError, lifecyclePlan, type OrchestrationComponent, type OrchestrationRelationship } from "./orchestration.js";

const components: OrchestrationComponent[] = [{ id: "game", required: true }, { id: "database", required: true }, { id: "cache", required: false }];
const relationships: OrchestrationRelationship[] = [
  { sourceComponentId: "game", targetComponentId: "database", type: "USES_DATABASE", requiredForStartup: true },
  { sourceComponentId: "game", targetComponentId: "cache", type: "USES_CACHE", requiredForStartup: false },
];

describe("generic stack orchestration", () => {
  it("starts required providers first and stops dependants first", () => {
    expect(lifecyclePlan(components, relationships, "START").map((step) => step.componentId)).toEqual(["cache", "database", "game"]);
    expect(lifecyclePlan(components, relationships, "STOP").map((step) => step.componentId)).toEqual(["game", "database", "cache"]);
  });
  it("restarts as reverse stop followed by ordered start", () => {
    expect(lifecyclePlan(components, relationships, "RESTART")).toEqual([
      { componentId: "game", action: "STOP" }, { componentId: "database", action: "STOP" }, { componentId: "cache", action: "STOP" },
      { componentId: "cache", action: "START" }, { componentId: "database", action: "START" }, { componentId: "game", action: "START" },
    ]);
  });
  it("rejects dependency cycles regardless of game ecosystem", () => {
    expect(() => lifecyclePlan(components, [
      { sourceComponentId: "game", targetComponentId: "database", type: "USES_DATABASE", requiredForStartup: true },
      { sourceComponentId: "database", targetComponentId: "game", type: "DEPENDS_ON", requiredForStartup: true },
    ], "START")).toThrow(DependencyCycleError);
  });
  it("derives aggregate health from required components", () => {
    expect(aggregateStackHealth([{ required: true, state: "RUNNING" }, { required: true, state: "FAILED" }])).toBe("DEGRADED");
    expect(aggregateStackHealth([{ required: true, state: "RUNNING" }, { required: false, state: "STOPPED" }])).toBe("RUNNING");
  });
});
