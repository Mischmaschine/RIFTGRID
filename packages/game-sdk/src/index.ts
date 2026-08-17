import type { ResourceRequest } from "@riftgrid/shared";
import { z, type ZodType } from "zod";

export type GameCapability = "console" | "players" | "worlds" | "plugins" | "files" | "properties" | "backups" | "performance" | "resources" | "serverConfig" | "database" | "txAdmin";

export interface GameMetadata { id: string; name: string; description: string; icon: string; }
export interface GameVersion { id: string; label: string; stable: boolean; }
export type InstallerProvenance = "RIFTGRID_OFFICIAL" | "VERIFIED" | "COMMUNITY" | "LOCAL";
export type InstallerStatus = "READY" | "IN_DEVELOPMENT" | "PLANNED";
export const installerManifestSchema = z.object({
  apiVersion: z.literal("riftgrid.io/v1alpha1"),
  kind: z.literal("Installer"),
  metadata: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1).max(80),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i),
    description: z.string().min(1).max(240),
    icon: z.string().min(1).max(40),
    provenance: z.enum(["RIFTGRID_OFFICIAL", "VERIFIED", "COMMUNITY", "LOCAL"]),
    verified: z.boolean(),
  }),
  spec: z.object({
    status: z.enum(["READY", "IN_DEVELOPMENT", "PLANNED"]),
    category: z.enum(["FEATURED", "GAME_SERVER", "CUSTOM"]),
    adapterId: z.string().min(1).max(64).nullable(),
    runtimes: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), description: z.string().min(1) })),
    features: z.array(z.string().min(1)),
    delivery: z.array(z.enum(["CONTAINER_IMAGE", "DOWNLOAD", "STEAMCMD", "LOCAL_ARTIFACT"])),
    storage: z.object({ persistent: z.boolean(), mountPath: z.string().nullable() }),
    network: z.array(z.object({ name: z.string().min(1), protocol: z.enum(["TCP", "UDP"]), containerPort: z.number().int().min(1).max(65535) })),
    health: z.array(z.enum(["TCP", "HTTP", "PROCESS", "ADAPTER"])),
  }),
}).superRefine((manifest, context) => {
  if (manifest.metadata.provenance === "COMMUNITY" && manifest.metadata.verified) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["metadata", "verified"], message: "Community installers are not implicitly verified." });
  }
  if (manifest.spec.status === "READY" && manifest.spec.runtimes.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["spec", "runtimes"], message: "Ready installers require at least one runtime." });
  }
});
export type InstallerManifest = z.infer<typeof installerManifestSchema>;
export interface NetworkPortRequirement { name: string; containerPort: number; protocol: "TCP" | "UDP"; public: boolean; }
export interface WorkloadProbe {
  kind: "tcp" | "http";
  port: number;
  path?: string;
  initialDelaySeconds: number;
  periodSeconds: number;
  failureThreshold: number;
}
export interface GameServerDefinition {
  image: string;
  command?: string[];
  args?: string[];
  environment: Record<string, string>;
  secretEnvironment?: Array<{ name: string; secretName: string; key: string }>;
  ports: NetworkPortRequirement[];
  dataMountPath: string;
  resources: ResourceRequest;
  probe: WorkloadProbe;
  shutdownGraceSeconds: number;
  security: { runAsNonRoot: boolean; readOnlyRootFilesystem: boolean; };
}
export interface Installer<TConfiguration = unknown> {
  manifest(): InstallerManifest;
  configurationSchema(): ZodType<TConfiguration, any, any>;
  supportedVersions(): Promise<GameVersion[]>;
  createServerDefinition(configuration: TConfiguration, resources: ResourceRequest): Promise<GameServerDefinition>;
}
export interface GameHealth { healthy: boolean; ready: boolean; message: string; playerCount?: number; }
export interface GameEvent { type: "player.join" | "player.leave" | "server.ready" | "message"; data: Record<string, unknown>; }
export interface GamePlayer { id?: string; name: string; joinedAt?: string; }
export interface AdapterContext { serverId: string; namespace: string; podName?: string; configuration: unknown; }

export interface GameAdapter {
  metadata(): GameMetadata;
  capabilities(): ReadonlySet<GameCapability>;
  evaluateHealth(pod: { phase?: string; ready: boolean; message?: string }): GameHealth;
  parseConsole(line: string): GameEvent | null;
  gracefulStopCommand(): string[];
  consoleCommand(command: string): string[] | null;
}

export class GameAdapterRegistry {
  private readonly adapters = new Map<string, GameAdapter>();
  register(adapter: GameAdapter): this {
    const id = adapter.metadata().id;
    if (this.adapters.has(id)) throw new Error(`Adapter already registered: ${id}`);
    this.adapters.set(id, adapter);
    return this;
  }
  get(id: string): GameAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown game adapter: ${id}`);
    return adapter;
  }
  list(): GameAdapter[] { return [...this.adapters.values()]; }
}

export class InstallerRegistry {
  private readonly manifests = new Map<string, InstallerManifest>();
  private readonly implementations = new Map<string, Installer>();

  register(installer: Installer): this {
    const manifest = installerManifestSchema.parse(installer.manifest());
    this.registerManifest(manifest);
    this.implementations.set(manifest.metadata.id, installer);
    return this;
  }

  registerManifest(input: InstallerManifest): this {
    const manifest = installerManifestSchema.parse(input);
    if (this.manifests.has(manifest.metadata.id)) throw new Error(`Installer already registered: ${manifest.metadata.id}`);
    this.manifests.set(manifest.metadata.id, manifest);
    return this;
  }

  get(id: string): Installer {
    const installer = this.implementations.get(id);
    if (!installer) throw new Error(`Installer is not deployable: ${id}`);
    return installer;
  }

  manifest(id: string): InstallerManifest {
    const manifest = this.manifests.get(id);
    if (!manifest) throw new Error(`Unknown installer: ${id}`);
    return manifest;
  }

  list(): InstallerManifest[] { return [...this.manifests.values()]; }
}

export const customDeploymentConfigurationSchema = z.object({
  image: z.string().min(1).max(300).refine((value) => !/\s/.test(value), "Docker image references cannot contain whitespace."),
  command: z.array(z.string().min(1).max(512)).max(32).default([]),
  args: z.array(z.string().max(1024)).max(64).default([]),
  ports: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,14}$/), containerPort: z.number().int().min(1).max(65535), protocol: z.enum(["TCP", "UDP"]), public: z.boolean().default(true) })).min(1).max(16),
  environment: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(4096)).default({}),
  secretEnvironment: z.array(z.object({ name: z.string().regex(/^[A-Z_][A-Z0-9_]*$/), secretName: z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/), key: z.string().min(1).max(253) })).max(32).default([]),
  dataMountPath: z.string().startsWith("/").max(240).default("/data"),
  healthCheck: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tcp"), port: z.number().int().min(1).max(65535) }),
    z.object({ kind: z.literal("http"), port: z.number().int().min(1).max(65535), path: z.string().startsWith("/").max(240).default("/") }),
  ]),
  shutdownGraceSeconds: z.number().int().min(10).max(600).default(60),
  runAsNonRoot: z.boolean().default(false),
  readOnlyRootFilesystem: z.boolean().default(false),
}).superRefine((configuration, context) => {
  if (!configuration.ports.some((port) => port.containerPort === configuration.healthCheck.port && port.protocol === "TCP")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["healthCheck", "port"], message: "Health check port must reference a declared TCP port." });
  const names = configuration.ports.map((port) => port.name);
  if (new Set(names).size !== names.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["ports"], message: "Port names must be unique." });
});
export type CustomDeploymentConfiguration = z.infer<typeof customDeploymentConfigurationSchema>;

export const customDockerInstallerManifest: InstallerManifest = {
  apiVersion: "riftgrid.io/v1alpha1",
  kind: "Installer",
  metadata: { id: "custom-docker", name: "Deploy any server", version: "1.0.0", description: "Run an arbitrary OCI image through the same RIFTGRID scheduling, storage, networking and health pipeline.", icon: "container", provenance: "RIFTGRID_OFFICIAL", verified: true },
  spec: {
    status: "READY", category: "CUSTOM", adapterId: "generic",
    runtimes: [{ id: "OCI", name: "OCI Container", description: "Any Kubernetes-compatible container image." }],
    features: ["Custom image and arguments", "Environment variables", "Kubernetes Secret references", "Persistent storage", "TCP or HTTP health"],
    delivery: ["CONTAINER_IMAGE"], storage: { persistent: true, mountPath: "/data" }, network: [], health: ["TCP", "HTTP"],
  },
};

export class CustomDockerInstaller implements Installer<CustomDeploymentConfiguration> {
  manifest() { return customDockerInstallerManifest; }
  configurationSchema() { return customDeploymentConfigurationSchema; }
  async supportedVersions(): Promise<GameVersion[]> { return [{ id: "IMAGE_DEFINED", label: "Defined by image reference", stable: true }]; }
  async createServerDefinition(input: CustomDeploymentConfiguration, resources: ResourceRequest): Promise<GameServerDefinition> {
    const configuration = customDeploymentConfigurationSchema.parse(input);
    return {
      image: configuration.image,
      ...(configuration.command.length ? { command: configuration.command } : {}),
      ...(configuration.args.length ? { args: configuration.args } : {}),
      environment: configuration.environment,
      secretEnvironment: configuration.secretEnvironment,
      ports: configuration.ports,
      dataMountPath: configuration.dataMountPath,
      resources,
      probe: { ...configuration.healthCheck, initialDelaySeconds: 5, periodSeconds: 5, failureThreshold: 24 },
      shutdownGraceSeconds: configuration.shutdownGraceSeconds,
      security: { runAsNonRoot: configuration.runAsNonRoot, readOnlyRootFilesystem: configuration.readOnlyRootFilesystem },
    };
  }
}

export class GenericWorkloadAdapter implements GameAdapter {
  metadata() { return { id: "generic", name: "Generic Workload", description: "Core Kubernetes health and lifecycle intelligence for arbitrary servers.", icon: "container" }; }
  capabilities() { return new Set<GameCapability>(); }
  evaluateHealth(pod: { phase?: string; ready: boolean; message?: string }): GameHealth { return { healthy: pod.phase === "Running" && pod.ready, ready: pod.ready, message: pod.ready ? "Configured workload health check passed" : (pod.message ?? `Pod phase: ${pod.phase ?? "unknown"}`) }; }
  parseConsole(_line: string): GameEvent | null { return null; }
  gracefulStopCommand() { return ["sh", "-c", "kill -TERM 1"]; }
  consoleCommand(_command: string) { return null; }
}

export const fiveMConfigurationSchema = z.object({
  artifactUrl: z.string().url().refine((value) => { try { return new URL(value).hostname === "runtime.fivem.net"; } catch { return false; } }, "FXServer artifacts must come from runtime.fivem.net."),
  serverName: z.string().min(3).max(64),
  maxClients: z.number().int().min(1).max(2048).default(48),
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).default("en-US"),
  tags: z.array(z.string().min(1).max(32)).max(24).default([]),
  gamePort: z.number().int().min(1024).max(65535).default(30120),
  txAdminPort: z.number().int().min(1024).max(65535).default(40120),
  serverProfile: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("default"),
  licenseSecretName: z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/),
  licenseSecretKey: z.string().min(1).max(253).default("license-key"),
  database: z.object({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(3306),
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/),
    user: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
    passwordSecretName: z.string().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/),
    passwordSecretKey: z.string().min(1).max(253).default("user-password"),
  }).optional(),
});
export type FiveMConfiguration = z.infer<typeof fiveMConfigurationSchema>;

export const fiveMInstallerManifest: InstallerManifest = {
  apiVersion: "riftgrid.io/v1alpha1",
  kind: "Installer",
  metadata: { id: "fivem", name: "FiveM", version: "0.1.0", description: "Acquire official Linux FXServer artifacts and run the included txAdmin through RIFTGRID.", icon: "radio", provenance: "RIFTGRID_OFFICIAL", verified: true },
  spec: {
    status: "READY", category: "FEATURED", adapterId: "fivem",
    runtimes: [{ id: "FXSERVER", name: "FXServer", description: "Official Cfx.re Linux server artifact with bundled txAdmin." }],
    features: ["Official artifact acquisition", "txAdmin integration", "Persistent resources and txData", "TCP/UDP game networking", "Secret-backed Cfx.re license", "Secret-backed MariaDB/MySQL binding"],
    delivery: ["DOWNLOAD"], storage: { persistent: true, mountPath: "/data" },
    network: [{ name: "game-tcp", protocol: "TCP", containerPort: 30120 }, { name: "game-udp", protocol: "UDP", containerPort: 30120 }, { name: "txadmin", protocol: "TCP", containerPort: 40120 }],
    health: ["HTTP", "ADAPTER"],
  },
};

export class FiveMInstaller implements Installer<FiveMConfiguration> {
  manifest() { return fiveMInstallerManifest; }
  configurationSchema() { return fiveMConfigurationSchema; }
  async supportedVersions(): Promise<GameVersion[]> {
    try {
      const response = await fetch("https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Cfx.re artifact registry unavailable");
      const html = await response.text(); const match = html.match(/<a\s+href\s*=\s*["']([^"']+\/fx\.tar\.xz)["'][^>]*>\s*LATEST RECOMMENDED/i);
      if (!match?.[1]) throw new Error("Recommended artifact link was not present");
      const url = new URL(match[1], response.url).toString(); const build = url.match(/\/([0-9]+)-[^/]+\/fx\.tar\.xz$/)?.[1] ?? "current";
      return [{ id: url, label: `Latest recommended (${build})`, stable: true }];
    } catch {
      return [{ id: "", label: "Paste the recommended official artifact URL", stable: true }];
    }
  }
  async createServerDefinition(input: FiveMConfiguration, resources: ResourceRequest): Promise<GameServerDefinition> {
    const configuration = fiveMConfigurationSchema.parse(input);
    const databaseEnvironment = configuration.database ? {
      DATABASE_HOST: configuration.database.host,
      DATABASE_PORT: String(configuration.database.port),
      DATABASE_NAME: configuration.database.name,
      DATABASE_USER: configuration.database.user,
    } : {};
    const secretEnvironment = [
      { name: "CFX_LICENSE_KEY", secretName: configuration.licenseSecretName, key: configuration.licenseSecretKey },
      ...(configuration.database ? [{ name: "DATABASE_PASSWORD", secretName: configuration.database.passwordSecretName, key: configuration.database.passwordSecretKey }] : []),
    ];
    return {
      image: process.env.FIVEM_RUNTIME_IMAGE ?? "riftgrid/fivem-server:0.1.0",
      environment: {
        FIVEM_ARTIFACT_URL: configuration.artifactUrl, SERVER_NAME: configuration.serverName, MAX_CLIENTS: String(configuration.maxClients), LOCALE: configuration.locale,
        TAGS: configuration.tags.join(","), GAME_PORT: String(configuration.gamePort), TXADMIN_PORT: String(configuration.txAdminPort), SERVER_PROFILE: configuration.serverProfile,
        ...databaseEnvironment,
      },
      secretEnvironment,
      ports: [
        { name: "game-tcp", containerPort: configuration.gamePort, protocol: "TCP", public: true },
        { name: "game-udp", containerPort: configuration.gamePort, protocol: "UDP", public: true },
        { name: "txadmin", containerPort: configuration.txAdminPort, protocol: "TCP", public: true },
      ],
      dataMountPath: "/data", resources,
      probe: { kind: "http", port: configuration.txAdminPort, path: "/", initialDelaySeconds: 20, periodSeconds: 5, failureThreshold: 120 },
      shutdownGraceSeconds: 120,
      security: { runAsNonRoot: false, readOnlyRootFilesystem: false },
    };
  }
}

export class FiveMAdapter implements GameAdapter {
  metadata() { return { id: "fivem", name: "FiveM", description: "FXServer, player, resource, txAdmin, configuration and database intelligence.", icon: "radio" }; }
  capabilities() { return new Set(["console", "players", "resources", "txAdmin", "serverConfig", "database", "performance"] as const); }
  evaluateHealth(pod: { phase?: string; ready: boolean; message?: string }): GameHealth { return { healthy: pod.phase === "Running" && pod.ready, ready: pod.ready, message: pod.ready ? "txAdmin health endpoint is ready" : (pod.message ?? `Pod phase: ${pod.phase ?? "unknown"}`) }; }
  parseConsole(line: string): GameEvent | null {
    const joined = line.match(/Connecting:\s+(.+)$/i); if (joined?.[1]) return { type: "player.join", data: { name: joined[1].trim() } };
    const left = line.match(/Dropped player\s+(.+?)(?:\s+\(|$)/i); if (left?.[1]) return { type: "player.leave", data: { name: left[1].trim() } };
    if (/txAdmin.*started|server license key authentication succeeded/i.test(line)) return { type: "server.ready", data: {} };
    return null;
  }
  gracefulStopCommand() { return ["sh", "-c", "kill -TERM 1"]; }
  consoleCommand(_command: string) { return null; }
}
