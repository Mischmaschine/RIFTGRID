import { describe, expect, it } from "vitest";
import { chooseAvailablePort, chooseAvailableProtocolPort } from "./ports.js";
describe("port allocator", () => {
  it("never collides", () => expect(chooseAvailablePort(new Set([30000, 30001]), 30000, 30010)).toBe(30002));
  it("allows TCP and UDP to share a preferred port", () => expect(chooseAvailableProtocolPort([{ port: 30002, protocol: "TCP" }], "UDP", 30000, 30010, 30002)).toBe(30002));
  it("does not reuse a port already allocated for the same protocol", () => expect(chooseAvailableProtocolPort([{ port: 30002, protocol: "UDP" }], "UDP", 30002, 30010, 30002)).toBe(30003));
  it("fails explicitly when exhausted", () => expect(() => chooseAvailablePort(new Set([1, 2]), 1, 2)).toThrow(/No port/));
  it("rejects invalid ranges", () => expect(() => chooseAvailablePort(new Set(), 10, 1)).toThrow(RangeError));
});
