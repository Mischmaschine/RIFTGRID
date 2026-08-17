import { describe, expect, it } from "vitest";
import { bytesToMiB, parseBytes, parseCpuMillicores } from "./quantity.js";
describe("Kubernetes quantities", () => {
  it("parses CPU formats", () => { expect(parseCpuMillicores("4")).toBe(4000); expect(parseCpuMillicores("750m")).toBe(750); });
  it("parses binary memory", () => expect(bytesToMiB(parseBytes("8Gi"))).toBe(8192));
});
