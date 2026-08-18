import type { GameAdapter, GameEvent, GameHealth, GameServerDefinition, GameVersion, Installer, InstallerManifest } from "@riftgrid/game-sdk";
import type { ResourceRequest } from "@riftgrid/shared";
import { z } from "zod";

export const minecraftConfigurationSchema = z.object({
  software: z.enum(["PAPER", "VANILLA"]),
  version: z.string().min(1).max(32).default("LATEST"),
  eulaAccepted: z.literal(true, { errorMap: () => ({ message: "The Minecraft EULA must be accepted." }) }),
  maxPlayers: z.number().int().min(1).max(1000).default(20),
  motd: z.string().max(120).default("A RIFTGRID world"),
  difficulty: z.enum(["peaceful", "easy", "normal", "hard"]).default("normal"),
  gamemode: z.enum(["survival", "creative", "adventure", "spectator"]).default("survival"),
  onlineMode: z.boolean().default(true),
});
export type MinecraftConfiguration = z.infer<typeof minecraftConfigurationSchema>;

export const minecraftInstallerManifest: InstallerManifest = {
  apiVersion: "riftgrid.io/v1alpha1",
  kind: "Installer",
  metadata: {
    id: "minecraft",
    name: "Minecraft",
    version: "1.0.0",
    description: "Persistent Paper and Vanilla servers with automatic version resolution.",
    icon: "blocks",
    provenance: "RIFTGRID_OFFICIAL",
    verified: true,
  },
  spec: {
    status: "READY",
    category: "FEATURED",
    adapterId: "minecraft",
    runtimes: [
      { id: "PAPER", name: "Paper", description: "Optimized, plugin-ready Java server." },
      { id: "VANILLA", name: "Vanilla", description: "Official unmodified Java server." },
    ],
    features: ["One-click deployment", "Automatic version resolution", "Persistent world data", "Managed health checks"],
    delivery: ["CONTAINER_IMAGE", "DOWNLOAD"],
    storage: { persistent: true, mountPath: "/data" },
    network: [{ name: "game", protocol: "TCP", containerPort: 25565 }],
    health: ["TCP", "ADAPTER"],
  },
};

export class MinecraftInstaller implements Installer<MinecraftConfiguration> {
  manifest() { return minecraftInstallerManifest; }
  configurationSchema() { return minecraftConfigurationSchema; }

  async supportedVersions(): Promise<GameVersion[]> {
    try {
      const response = await fetch("https://api.papermc.io/v2/projects/paper", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Paper API unavailable");
      const body = await response.json() as { versions: string[] };
      return body.versions.slice(-12).reverse().map((id, index) => ({ id, label: id, stable: index < 6 }));
    } catch {
      return [{ id: "LATEST", label: "Latest (resolved during installation)", stable: true }];
    }
  }

  async createServerDefinition(input: MinecraftConfiguration, resources: ResourceRequest): Promise<GameServerDefinition> {
    const config = minecraftConfigurationSchema.parse(input);
    // The Kubernetes memory limit covers the whole container, not only the JVM
    // heap. Keep 30% for metaspace, direct buffers, thread stacks, native code,
    // and the image helper so small Paper servers do not hit the cgroup limit.
    const maxMemoryMiB = Math.max(512, Math.floor(resources.memoryMiB * 0.7));
    const initialMemoryMiB = Math.min(512, maxMemoryMiB);
    return {
      image: "itzg/minecraft-server:java25",
      environment: {
        EULA: "TRUE", TYPE: config.software, VERSION: config.version,
        INIT_MEMORY: `${initialMemoryMiB}M`, MAX_MEMORY: `${maxMemoryMiB}M`, MAX_PLAYERS: String(config.maxPlayers), MOTD: config.motd,
        DIFFICULTY: config.difficulty, MODE: config.gamemode, ONLINE_MODE: String(config.onlineMode),
        ENABLE_RCON: "true", RCON_PORT: "25575", USE_AIKAR_FLAGS: "true",
      },
      ports: [{ name: "game", containerPort: 25565, protocol: "TCP", public: true }],
      dataMountPath: "/data", resources,
      probe: { kind: "tcp", port: 25565, initialDelaySeconds: 20, periodSeconds: 5, failureThreshold: 60 },
      shutdownGraceSeconds: 120,
      security: { runAsNonRoot: false, readOnlyRootFilesystem: false },
    };
  }
}

export class MinecraftAdapter implements GameAdapter {
  metadata() { return { id: "minecraft", name: "Minecraft", description: "Persistent Paper and Vanilla worlds", icon: "cube" }; }
  capabilities() { return new Set(["console", "players", "worlds", "plugins", "files", "properties", "backups", "performance"] as const); }

  evaluateHealth(pod: { phase?: string; ready: boolean; message?: string }): GameHealth {
    return { healthy: pod.phase === "Running" && pod.ready, ready: pod.ready, message: pod.ready ? "Minecraft query endpoint is ready" : (pod.message ?? `Pod phase: ${pod.phase ?? "unknown"}`) };
  }

  parseConsole(line: string): GameEvent | null {
    if (/Done \([\d.]+s\)!/.test(line)) return { type: "server.ready", data: {} };
    const joined = line.match(/:\s([A-Za-z0-9_]{1,16}) joined the game/);
    if (joined?.[1]) return { type: "player.join", data: { name: joined[1] } };
    const left = line.match(/:\s([A-Za-z0-9_]{1,16}) left the game/);
    if (left?.[1]) return { type: "player.leave", data: { name: left[1] } };
    return null;
  }

  gracefulStopCommand() { return ["rcon-cli", "stop"]; }
  consoleCommand(command: string) { return ["rcon-cli", command]; }
  orchestrationCapabilities() { return { playerAware: true, supportsGracefulShutdown: true, supportsLiveQuery: true, supportsRcon: true, supportsInstanceGroups: true, supportsProxyRegistration: false, supportsResourceManagement: false, supportsWorldSave: true }; }
  populationQuery() { return { command: ["rcon-cli", "list"], parse(output: string) { const match = output.match(/There are (\d+) of a max of (\d+) players online/i); return match?.[1] && match[2] ? { currentPlayers: Number(match[1]), maxPlayers: Number(match[2]), sampledAt: new Date().toISOString() } : null; } }; }
  backupCommandPlan() { return { prepare: [["rcon-cli", "save-all", "flush"], ["rcon-cli", "save-off"]], finalize: [["rcon-cli", "save-on"]] }; }
}
