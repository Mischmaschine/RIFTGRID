import { CustomDockerInstaller, FiveMInstaller, InstallerRegistry, type InstallerManifest } from "@riftgrid/game-sdk";
import { MinecraftInstaller } from "@riftgrid/game-minecraft";

const planned = (input: Pick<InstallerManifest["metadata"], "id" | "name" | "description" | "icon"> & { status: "IN_DEVELOPMENT" | "PLANNED"; runtime: { id: string; name: string; description: string }; features: string[] }): InstallerManifest => ({
  apiVersion: "riftgrid.io/v1alpha1",
  kind: "Installer",
  metadata: { id: input.id, name: input.name, description: input.description, icon: input.icon, version: "0.1.0", provenance: "RIFTGRID_OFFICIAL", verified: true },
  spec: {
    status: input.status,
    category: "FEATURED",
    adapterId: input.id === "fivem" ? "fivem" : null,
    runtimes: [input.runtime],
    features: input.features,
    delivery: input.id === "fivem" ? ["DOWNLOAD"] : ["CONTAINER_IMAGE"],
    storage: { persistent: true, mountPath: "/data" },
    network: [],
    health: ["PROCESS"],
  },
});

export function createInstallerRegistry(): InstallerRegistry {
  return new InstallerRegistry()
    .register(new MinecraftInstaller())
    .register(new CustomDockerInstaller())
    .register(new FiveMInstaller())
    .registerManifest(planned({ id: "rust", name: "Rust", description: "Rust dedicated server installation through SteamCMD.", icon: "shield", status: "PLANNED", runtime: { id: "STEAMCMD", name: "SteamCMD", description: "Valve content delivery runtime." }, features: ["SteamCMD delivery", "Persistent world data"] }))
    .registerManifest(planned({ id: "valheim", name: "Valheim", description: "Valheim dedicated server installation through SteamCMD.", icon: "mountain", status: "PLANNED", runtime: { id: "STEAMCMD", name: "SteamCMD", description: "Valve content delivery runtime." }, features: ["SteamCMD delivery", "Persistent world data"] }));
}
