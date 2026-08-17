import { describe, expect, it } from "vitest";
import { CustomDockerInstaller, FiveMAdapter, FiveMInstaller, InstallerRegistry, customDeploymentConfigurationSchema, installerManifestSchema, type InstallerManifest } from "./index.js";

const manifest: InstallerManifest = {
  apiVersion: "riftgrid.io/v1alpha1",
  kind: "Installer",
  metadata: { id: "example", name: "Example", version: "1.0.0", description: "Example installer", icon: "box", provenance: "LOCAL", verified: false },
  spec: { status: "PLANNED", category: "CUSTOM", adapterId: null, runtimes: [], features: [], delivery: ["CONTAINER_IMAGE"], storage: { persistent: true, mountPath: "/data" }, network: [], health: ["TCP"] },
};

describe("Installer registry", () => {
  it("validates and exposes versioned manifests", () => {
    const registry = new InstallerRegistry().registerManifest(manifest);
    expect(registry.manifest("example").metadata.version).toBe("1.0.0");
  });

  it("does not treat community provenance as automatic verification", () => {
    expect(() => installerManifestSchema.parse({ ...manifest, metadata: { ...manifest.metadata, provenance: "COMMUNITY", verified: true } })).toThrow(/implicitly verified/);
  });

  it("does not deploy catalog-only entries", () => {
    const registry = new InstallerRegistry().registerManifest(manifest);
    expect(() => registry.get("example")).toThrow(/not deployable/);
  });

  it("builds a generic OCI workload through the installer contract", async () => {
    const definition = await new CustomDockerInstaller().createServerDefinition({ image: "ghcr.io/example/server:1.0", ports: [{ name: "game", containerPort: 7777, protocol: "TCP", public: true }], environment: { MODE: "production" }, secretEnvironment: [{ name: "TOKEN", secretName: "server-credentials", key: "token" }], dataMountPath: "/srv/data", healthCheck: { kind: "tcp", port: 7777 }, command: [], args: [], shutdownGraceSeconds: 60, runAsNonRoot: false, readOnlyRootFilesystem: false }, { cpuMillicores: 1000, memoryMiB: 1024, storageGiB: 5 });
    expect(definition.image).toBe("ghcr.io/example/server:1.0");
    expect(definition.secretEnvironment?.[0]?.secretName).toBe("server-credentials");
    expect(definition.dataMountPath).toBe("/srv/data");
  });

  it("rejects health checks that do not reference a declared TCP port", () => {
    expect(() => customDeploymentConfigurationSchema.parse({ image: "example/server:1", ports: [{ name: "game", containerPort: 7777, protocol: "UDP", public: true }], healthCheck: { kind: "tcp", port: 7777 } })).toThrow(/declared TCP port/);
  });

  it("builds FiveM with official artifact acquisition and secret-backed licensing", async () => {
    const definition = await new FiveMInstaller().createServerDefinition({ artifactUrl: "https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/12345/fx.tar.xz", serverName: "RIFTGRID RP", maxClients: 48, locale: "en-US", tags: ["roleplay"], gamePort: 30120, txAdminPort: 40120, serverProfile: "default", licenseSecretName: "fivem-license", licenseSecretKey: "license-key", database: { host: "db-123.riftgrid-servers.svc.cluster.local", port: 3306, name: "fivem", user: "fivem", passwordSecretName: "db-123-credentials", passwordSecretKey: "user-password" } }, { cpuMillicores: 4000, memoryMiB: 8192, storageGiB: 30 });
    expect(definition.ports.map((port) => `${port.name}/${port.protocol}`)).toEqual(["game-tcp/TCP", "game-udp/UDP", "txadmin/TCP"]);
    expect(definition.secretEnvironment?.[0]).toEqual({ name: "CFX_LICENSE_KEY", secretName: "fivem-license", key: "license-key" });
    expect(definition.environment.DATABASE_HOST).toBe("db-123.riftgrid-servers.svc.cluster.local");
    expect(definition.environment).not.toHaveProperty("DATABASE_PASSWORD");
    expect(definition.secretEnvironment?.[1]).toEqual({ name: "DATABASE_PASSWORD", secretName: "db-123-credentials", key: "user-password" });
    expect(new FiveMAdapter().capabilities()).toContain("txAdmin");
  });
});
