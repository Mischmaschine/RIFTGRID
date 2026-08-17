import { describe, expect, it } from "vitest";
import type { NodeCandidate } from "@riftgrid/shared";
import { schedule } from "./index.js";

const base = (id: string, memoryAllocated: number): NodeCandidate => ({
  id, name: id, healthy: true, maintenance: false, schedulingEnabled: true,
  capacity: { cpuMillicores: 8000, memoryMiB: 16384, storageGiB: 500 },
  allocated: { cpuMillicores: 1000, memoryMiB: memoryAllocated, storageGiB: 50 },
  labels: { region: "fra" }, taints: [], workloadCount: 2,
});

describe("scheduler", () => {
  it("selects the explainable highest-capacity candidate", () => {
    const result = schedule([base("fra-02", 12000), base("fra-04", 2000)], { cpuMillicores: 2000, memoryMiB: 4096, storageGiB: 30 });
    expect(result.selected.id).toBe("fra-04");
    expect(result.explanation).toContain("sufficient resources");
  });
  it("rejects maintenance nodes and preserves rejection evidence", () => {
    const maintenance = { ...base("fra-01", 1000), maintenance: true };
    expect(() => schedule([maintenance], { cpuMillicores: 1000, memoryMiB: 1024, storageGiB: 10 })).toThrow(/eligible/);
  });
  it("enforces required labels", () => {
    expect(() => schedule([base("fra-04", 1000)], { cpuMillicores: 1000, memoryMiB: 1024, storageGiB: 10 }, { requiredLabels: { region: "hel" } })).toThrow();
  });
});
