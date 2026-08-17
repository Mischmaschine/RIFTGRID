import { describe, expect, it } from "vitest";
import { MinecraftAdapter, MinecraftInstaller, minecraftConfigurationSchema, minecraftInstallerManifest } from "./index.js";

describe("Minecraft adapter", () => {
  it("requires explicit EULA acceptance", () => expect(() => minecraftConfigurationSchema.parse({ software: "PAPER", eulaAccepted: false })).toThrow(/EULA/));
  it("publishes installation provenance separately from adapter capabilities", () => {
    expect(minecraftInstallerManifest.metadata.provenance).toBe("RIFTGRID_OFFICIAL");
    expect(minecraftInstallerManifest.spec.adapterId).toBe("minecraft");
    expect([...new MinecraftAdapter().capabilities()]).toContain("worlds");
  });
  it("builds a persistent Paper workload without shell interpolation", async () => {
    const installer = new MinecraftInstaller();
    const definition = await installer.createServerDefinition({ software: "PAPER", version: "1.21.4", eulaAccepted: true, maxPlayers: 50, motd: "Rift", difficulty: "normal", gamemode: "survival", onlineMode: true }, { cpuMillicores: 2000, memoryMiB: 4096, storageGiB: 30 });
    expect(definition.environment.TYPE).toBe("PAPER");
    expect(definition.environment.INIT_MEMORY).toBe("512M");
    expect(definition.environment.MAX_MEMORY).toBe("2867M");
    expect(definition.dataMountPath).toBe("/data");
    expect(definition.command).toBeUndefined();
  });
  it("reserves container headroom outside the JVM heap", async () => {
    const installer = new MinecraftInstaller();
    const definition = await installer.createServerDefinition({ software: "PAPER", version: "LATEST", eulaAccepted: true, maxPlayers: 20, motd: "Rift", difficulty: "normal", gamemode: "survival", onlineMode: true }, { cpuMillicores: 2000, memoryMiB: 2048, storageGiB: 5 });
    expect(definition.environment.INIT_MEMORY).toBe("512M");
    expect(definition.environment.MAX_MEMORY).toBe("1433M");
    expect(definition.environment.MEMORY).toBeUndefined();
  });
  it("parses player events", () => expect(new MinecraftAdapter().parseConsole("[Server thread/INFO]: Max joined the game")?.type).toBe("player.join"));
});
