import { describe, expect, it } from "vitest";
import { cleanLogText } from "./logs.js";

describe("console log sanitization", () => {
  it("removes ANSI color and reset sequences without changing log content", () => {
    expect(cleanLogText("\u001b[38;5;42m[script:oxmysql]\u001b[0m\u001b[93mCREATE INDEX\u001b[97m")).toBe("[script:oxmysql]CREATE INDEX");
  });

  it("removes terminal control bytes while preserving ordinary Unicode", () => {
    expect(cleanLogText("Grüße\u0000 aus FiveM")).toBe("Grüße aus FiveM");
  });

  it("removes repeated txAdmin terminal-title commands", () => {
    const title = "\u001b]0;(0) Riftgrid - txAdmin - txAdmin\u0007";
    expect(cleanLogText(`${title}${title}\u001b[36m[txAdmin]\u001b[97m Sending resources list.`)).toBe("[txAdmin] Sending resources list.");
  });
});
