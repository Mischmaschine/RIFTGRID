import { describe, expect, it } from "vitest";
import { hasPermission, requirePermission } from "./index.js";

describe("permissions", () => {
  it("keeps viewers read-only", () => {
    expect(hasPermission("VIEWER", "server.view")).toBe(true);
    expect(hasPermission("VIEWER", "server.start")).toBe(false);
  });
  it("allows super administrators all declared permissions", () => expect(() => requirePermission("SUPER_ADMIN", "settings.manage")).not.toThrow());
});
