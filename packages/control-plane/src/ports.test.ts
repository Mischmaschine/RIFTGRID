import { describe, expect, it } from "vitest";
import { chooseAvailablePort } from "./ports.js";
describe("port allocator", () => {
  it("never collides", () => expect(chooseAvailablePort(new Set([30000, 30001]), 30000, 30010)).toBe(30002));
  it("fails explicitly when exhausted", () => expect(() => chooseAvailablePort(new Set([1, 2]), 1, 2)).toThrow(/No port/));
  it("rejects invalid ranges", () => expect(() => chooseAvailablePort(new Set(), 10, 1)).toThrow(RangeError));
});
