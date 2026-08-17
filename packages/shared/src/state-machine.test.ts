import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./state-machine.js";

describe("server state machine", () => {
  it("allows the complete startup and shutdown paths", () => {
    expect(canTransition("STOPPED", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "RUNNING")).toBe(true);
    expect(canTransition("RUNNING", "STOPPING")).toBe(true);
    expect(canTransition("STOPPING", "STOPPED")).toBe(true);
  });
  it("rejects impossible jumps", () => {
    expect(() => assertTransition("STOPPED", "RUNNING")).toThrow(/Invalid server transition/);
    expect(canTransition("PENDING", "RUNNING")).toBe(false);
  });
  it("makes reconciliation idempotent", () => expect(canTransition("RUNNING", "RUNNING")).toBe(true));
  it("allows interrupted startup reconciliation to restart from scheduling", () => {
    expect(canTransition("INSTALLING", "SCHEDULING")).toBe(true);
    expect(canTransition("STARTING", "SCHEDULING")).toBe(true);
  });
});
