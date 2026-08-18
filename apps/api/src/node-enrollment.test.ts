import { describe, expect, it } from "vitest";
import { nodeInstallerScript } from "./node-installer.js";

describe("node enrollment installer", () => {
  it("keeps both secrets interactive and out of command arguments", () => {
    const script = nodeInstallerScript();
    expect(script).toContain("RIFTGRID one-time enrollment code");
    expect(script).toContain("K3s node token");
    expect(script).toContain("ENROLLMENT_TOKEN=$(read_hidden");
    expect(script).not.toContain("--k3s-token");
    expect(script).not.toContain("--enrollment-token");
  });

  it("refuses unsupported systems and preserves an existing agent", () => {
    const script = nodeInstallerScript();
    expect(script).toContain("ubuntu:22.04|ubuntu:24.04|debian:12");
    expect(script).toContain("An existing inactive k3s agent installation was found. It was not overwritten.");
  });
});
