import { and, backupPolicies, backups, db, desc, eq, inArray, lte, nodes, organizationSettings, portAllocations, schedulingDecisions, servers, sql as postgresClient, tasks, activityEvents, projects } from "@riftgrid/database";
import type { GameAdapterRegistry, InstallerRegistry } from "@riftgrid/game-sdk";
import type { KubernetesGateway, ProvisionRequest } from "@riftgrid/kubernetes";
import { schedule } from "@riftgrid/scheduler";
import { assertTransition, RiftgridError, type CandidateDecision, type NodeCandidate, type ServerState } from "@riftgrid/shared";
import { enqueueTask, redisConnection } from "@riftgrid/tasks";
import { randomUUID } from "node:crypto";
import { chooseAvailablePort } from "./ports.js";

export * from "./ports.js";

type ServerRecord = typeof servers.$inferSelect;
type TaskRecord = typeof tasks.$inferSelect;
const namespace = process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers";
const progressChannel = "riftgrid:events";

export class ControlPlane {
  constructor(private readonly kubernetes: KubernetesGateway, private readonly adapters: GameAdapterRegistry, private readonly installers: InstallerRegistry) {}

  async scanForDrift(): Promise<void> {
    const serverRows = await db.select().from(servers);
    for (const original of serverRows) {
      let server = original;
      let driftDetected = false;
      if (server.actualState === "RUNNING") {
        const observation = await this.kubernetes.observePod(namespace, server.kubernetesName);
        const health = this.adapters.get(server.adapterId).evaluateHealth(observation);
        if (!health.healthy) {
          await db.update(servers).set({ actualState: "FAILED", lastErrorCode: "NODE_UNAVAILABLE", lastErrorMessage: health.message, updatedAt: new Date() }).where(eq(servers.id, server.id));
          server = { ...server, actualState: "FAILED", lastErrorCode: "NODE_UNAVAILABLE", lastErrorMessage: health.message };
          driftDetected = true;
          await this.activity(server, "server.drift", `${server.name} health drift detected`, { observation, desiredState: server.desiredState });
        }
      }
      const converged = server.desiredState === "RUNNING" ? server.actualState === "RUNNING" : server.actualState === "STOPPED";
      const transitional = ["SCHEDULING", "INSTALLING", "STARTING", "STOPPING", "BACKING_UP", "RESTORING", "MIGRATING"].includes(server.actualState);
      if (converged || transitional) continue;
      // A failed reconciliation needs an explicit retry. Retrying it every scan interval
      // creates an unbounded task flood while the underlying configuration stays invalid.
      if (server.actualState === "FAILED" && !driftDetected) continue;
      const [active] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.serverId, server.id), inArray(tasks.status, ["QUEUED", "RUNNING"]))).limit(1);
      if (active) continue;
      const taskId = randomUUID();
      try { await db.insert(tasks).values({ id: taskId, projectId: server.projectId, serverId: server.id, type: "RECONCILE_SERVER", idempotencyKey: `reconcile:${server.id}:${taskId}`, metadata: { reason: "desired-actual-drift" } }); }
      catch (error: any) { if (error?.code === "23505") continue; throw error; }
      await enqueueTask({ taskId, serverId: server.id, type: "RECONCILE_SERVER" });
    }
  }

  async scanScheduledBackups(): Promise<void> {
    const due = await db.select().from(backupPolicies).where(and(eq(backupPolicies.enabled, true), lte(backupPolicies.nextRunAt, new Date())));
    for (const policy of due) {
      const [server] = await db.select().from(servers).where(eq(servers.id, policy.serverId)).limit(1);
      if (!server || !["RUNNING", "STOPPED"].includes(server.actualState)) continue;
      const [active] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.serverId, server.id), inArray(tasks.status, ["QUEUED", "RUNNING"]))).limit(1);
      if (active) continue;
      const backupId = randomUUID(); const taskId = randomUUID(); const now = new Date();
      await db.transaction(async (tx) => {
        await tx.insert(backups).values({ id: backupId, projectId: server.projectId, serverId: server.id, trigger: "SCHEDULED", archiveName: `${server.kubernetesName}-${backupId}.tar.gz`, retentionDays: policy.retentionDays });
        await tx.insert(tasks).values({ id: taskId, projectId: server.projectId, serverId: server.id, type: "BACKUP_SERVER", idempotencyKey: `scheduled-backup:${backupId}`, metadata: { backupId } });
        await tx.update(backupPolicies).set({ nextRunAt: nextScheduleTime(policy.schedule, now), updatedAt: now }).where(eq(backupPolicies.id, policy.id));
      });
      await enqueueTask({ taskId, serverId: server.id, type: "BACKUP_SERVER" });
    }
  }

  async syncNodes(): Promise<NodeCandidate[]> {
    const discovered = await this.kubernetes.discoverNodes();
    const result: NodeCandidate[] = [];
    for (const item of discovered) {
      const [saved] = await db.insert(nodes).values({
        kubernetesUid: item.id, name: item.name, healthy: item.healthy, maintenance: item.maintenance,
        schedulingEnabled: item.schedulingEnabled, cpuMillicores: item.capacity.cpuMillicores,
        memoryMiB: item.capacity.memoryMiB, storageGiB: item.capacity.storageGiB,
        allocatedCpuMillicores: item.allocated.cpuMillicores, allocatedMemoryMiB: item.allocated.memoryMiB,
        allocatedStorageGiB: item.allocated.storageGiB, labels: item.labels, taints: item.taints, ...(item.kubernetesVersion ? { kubernetesVersion: item.kubernetesVersion } : {}), ...(item.internalIp ? { internalIp: item.internalIp } : {}), lastSeenAt: new Date(),
      }).onConflictDoUpdate({ target: nodes.kubernetesUid, set: {
        name: item.name, healthy: item.healthy, cpuMillicores: item.capacity.cpuMillicores, memoryMiB: item.capacity.memoryMiB,
        storageGiB: item.capacity.storageGiB, allocatedCpuMillicores: item.allocated.cpuMillicores,
        allocatedMemoryMiB: item.allocated.memoryMiB, labels: item.labels, taints: item.taints, ...(item.kubernetesVersion ? { kubernetesVersion: item.kubernetesVersion } : {}), ...(item.internalIp ? { internalIp: item.internalIp } : {}), lastSeenAt: new Date(),
      }}).returning();
      if (saved) result.push({ ...item, id: saved.id, maintenance: saved.maintenance, schedulingEnabled: saved.schedulingEnabled });
    }
    return result;
  }

  async execute(taskId: string): Promise<void> {
    const [candidate] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!candidate?.serverId) throw new RiftgridError("NOT_FOUND", "Task or server not found", 404);
    const lock = await postgresClient.reserve();
    await lock`select pg_advisory_lock(hashtext(${candidate.serverId}))`;
    try {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
      if (!task?.serverId) throw new RiftgridError("NOT_FOUND", "Task not found", 404);
      if (task.status === "SUCCESS" || task.status === "FAILED" || task.status === "CANCELLED") return;
      const [server] = await db.select().from(servers).where(eq(servers.id, task.serverId)).limit(1);
      if (!server) throw new RiftgridError("NOT_FOUND", "Server not found", 404);
      await db.update(tasks).set({ status: "RUNNING", startedAt: task.startedAt ?? new Date() }).where(eq(tasks.id, task.id));
      try {
        if (task.type === "CREATE_SERVER" || task.type === "RECONCILE_SERVER") await this.reconcile(server, task);
        else if (task.type === "START_SERVER") await this.start(server, task);
        else if (task.type === "STOP_SERVER") await this.stop(server, task);
        else if (task.type === "RESTART_SERVER") { await this.stop(server, task, false); const [fresh] = await db.select().from(servers).where(eq(servers.id, server.id)); if (fresh) await this.start(fresh, task, false); }
        else if (task.type === "BACKUP_SERVER") await this.backup(server, task);
        else if (task.type === "RESTORE_SERVER") await this.restore(server, task);
        else throw new RiftgridError("CONFLICT", `Task ${task.type} is not implemented in this milestone`, 409);
        await this.progress(task, 100, "COMPLETED", "SUCCESS");
      } catch (error) {
        const failure = error instanceof RiftgridError ? error : new RiftgridError("INTERNAL_ERROR", describeError(error), 500);
        await db.update(tasks).set({ status: "FAILED", errorCode: failure.code, errorMessage: failure.message, finishedAt: new Date() }).where(eq(tasks.id, task.id));
        if (task.type !== "BACKUP_SERVER" && task.type !== "RESTORE_SERVER") await db.update(servers).set({ actualState: "FAILED", lastErrorCode: failure.code, lastErrorMessage: failure.message, updatedAt: new Date() }).where(eq(servers.id, server.id));
        await this.publish({ type: "task.failed", taskId: task.id, serverId: server.id, error: { code: failure.code, message: failure.message } });
        throw failure;
      }
    } finally {
      await lock`select pg_advisory_unlock(hashtext(${candidate.serverId}))`;
      lock.release();
    }
  }

  private async reconcile(server: ServerRecord, task: TaskRecord): Promise<void> {
    if (server.desiredState === "STOPPED") return this.stop(server, task);
    const adapter = this.adapters.get(server.adapterId);
    const installer = this.installers.get(server.installerId);
    if (server.actualState === "RUNNING") {
      const observation = await this.kubernetes.observePod(namespace, server.kubernetesName);
      if (adapter.evaluateHealth(observation).healthy) return;
      await db.update(servers).set({ actualState: "FAILED", updatedAt: new Date() }).where(eq(servers.id, server.id));
      server = { ...server, actualState: "FAILED" };
    }
    const configuration = installer.configurationSchema().parse(server.configuration);
    await this.transition(server, "SCHEDULING", task, 12, "SCHEDULING");
    const clusterNodes = await this.syncNodes();
    const requestedNode = (task.metadata.placement as { nodeId?: string } | undefined)?.nodeId ?? server.nodeId ?? undefined;
    const decision = schedule(clusterNodes, { cpuMillicores: server.cpuMillicores, memoryMiB: server.memoryMiB, storageGiB: server.storageGiB }, requestedNode ? { nodeId: requestedNode } : {});
    await db.insert(schedulingDecisions).values({ serverId: server.id, selectedNodeId: decision.selected.id, explanation: decision.explanation, candidates: decision.candidates });
    assertTransition("SCHEDULING", "INSTALLING");
    await db.update(servers).set({ nodeId: decision.selected.id, actualState: "INSTALLING", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.progress(task, 30, `SELECTED ${decision.selected.name}`);
    const definition = await installer.createServerDefinition(configuration, { cpuMillicores: server.cpuMillicores, memoryMiB: server.memoryMiB, storageGiB: server.storageGiB });
    const ports = await this.allocatePorts(server, decision.selected.id, definition.ports.filter((port) => port.public).map((port) => ({ name: port.name, protocol: port.protocol, containerPort: port.containerPort })));
    await this.progress(task, 48, `ALLOCATED ${ports.map((port) => port.port).join(", ")}`);
    const provision: ProvisionRequest = { serverId: server.id, kubernetesName: server.kubernetesName, nodeName: decision.selected.name, namespace, definition, publicPorts: ports };
    await this.kubernetes.ensureWorkload(provision);
    assertTransition("INSTALLING", "STARTING");
    await db.update(servers).set({ actualState: "STARTING", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.progress(task, 68, "STARTING WORKLOAD");
    await this.waitUntilReady(server, task, adapter);
  }

  private async start(server: ServerRecord, task: TaskRecord, complete = true): Promise<void> {
    if (server.actualState === "RUNNING") return;
    assertTransition(server.actualState, "STARTING");
    await db.update(servers).set({ desiredState: "RUNNING", actualState: "STARTING", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.progress(task, 30, "STARTING WORKLOAD");
    await this.kubernetes.scaleWorkload(namespace, server.kubernetesName, 1);
    await this.waitUntilReady(server, task, this.adapters.get(server.adapterId));
    if (complete) await this.progress(task, 100, "RUNNING", "SUCCESS");
  }

  private async stop(server: ServerRecord, task: TaskRecord, complete = true): Promise<void> {
    if (server.actualState === "STOPPED") return;
    if (server.actualState !== "STOPPING") assertTransition(server.actualState, "STOPPING");
    await db.update(servers).set({ desiredState: "STOPPED", actualState: "STOPPING", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.progress(task, 35, "STOPPING SAFELY");
    try { await this.kubernetes.exec(namespace, server.kubernetesName, this.adapters.get(server.adapterId).gracefulStopCommand()); } catch { /* scaling remains the reliable stop boundary */ }
    await this.kubernetes.scaleWorkload(namespace, server.kubernetesName, 0);
    await db.update(servers).set({ actualState: "STOPPED", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.activity(server, "server.state", `${server.name} -> STOPPED`, { from: server.actualState, to: "STOPPED" });
    if (complete) await this.progress(task, 100, "STOPPED", "SUCCESS");
  }

  private async backup(server: ServerRecord, task: TaskRecord): Promise<void> {
    const backupId = typeof task.metadata.backupId === "string" ? task.metadata.backupId : null;
    if (!backupId) throw new RiftgridError("CONFLICT", "Backup task has no backup record", 409);
    const [record] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
    const [node] = server.nodeId ? await db.select().from(nodes).where(eq(nodes.id, server.nodeId)).limit(1) : [];
    if (!record || !node) throw new RiftgridError("NOT_FOUND", "Backup, source server, or node was not found", 404);
    if (!["RUNNING", "STOPPED", "BACKING_UP"].includes(server.actualState)) throw new RiftgridError("INVALID_SERVER_STATE", "Backups require a running or stopped deployment", 409);
    const returnState = server.actualState === "STOPPED" ? "STOPPED" : "RUNNING";
    await db.update(backups).set({ status: "CREATING", errorMessage: null }).where(eq(backups.id, record.id));
    if (server.actualState === "RUNNING") {
      assertTransition("RUNNING", "BACKING_UP");
      await db.update(servers).set({ actualState: "BACKING_UP", updatedAt: new Date() }).where(eq(servers.id, server.id));
    }
    await this.progress(task, 15, "PREPARING BACKUP");
    let minecraftPaused = false;
    try {
      if (server.adapterId === "minecraft" && returnState === "RUNNING") {
        await this.kubernetes.exec(namespace, server.kubernetesName, ["rcon-cli", "save-all", "flush"]);
        await this.kubernetes.exec(namespace, server.kubernetesName, ["rcon-cli", "save-off"]);
        minecraftPaused = true;
      }
      await this.progress(task, 35, "ARCHIVING PERSISTENT DATA");
      const archive = await this.kubernetes.createBackup(namespace, server.kubernetesName, node.name, record.archiveName, server.storageGiB);
      await db.update(backups).set({ status: "AVAILABLE", sizeBytes: archive.sizeBytes, checksum: archive.checksum, completedAt: new Date() }).where(eq(backups.id, record.id));
      await db.update(servers).set({ actualState: returnState, updatedAt: new Date() }).where(eq(servers.id, server.id));
      await this.activity(server, "backup.created", `Backup created for ${server.name}`, { backupId: record.id, sizeBytes: archive.sizeBytes, trigger: record.trigger });
      await this.pruneBackups(server, node.name, record.id).catch(async (error) => {
        await this.activity(server, "backup.retention-failed", `Backup retention could not be completed for ${server.name}`, { backupId: record.id, error: error instanceof Error ? error.message : "Retention cleanup failed" }).catch(() => undefined);
      });
      await this.progress(task, 90, "BACKUP AVAILABLE");
    } catch (error) {
      await db.update(backups).set({ status: "FAILED", errorMessage: error instanceof Error ? error.message : "Backup failed", completedAt: new Date() }).where(eq(backups.id, record.id));
      await db.update(servers).set({ actualState: returnState, updatedAt: new Date() }).where(eq(servers.id, server.id));
      await this.kubernetes.deleteBackup(namespace, server.kubernetesName, node.name, record.archiveName, server.storageGiB).catch(() => undefined);
      throw error;
    } finally {
      if (minecraftPaused) await this.kubernetes.exec(namespace, server.kubernetesName, ["rcon-cli", "save-on"]).catch(() => undefined);
    }
  }

  private async pruneBackups(server: ServerRecord, nodeName: string, protectedBackupId: string): Promise<void> {
    const [policy] = await db.select({ retentionDays: backupPolicies.retentionDays, retentionCount: backupPolicies.retentionCount }).from(backupPolicies).where(eq(backupPolicies.serverId, server.id)).limit(1);
    const [project] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, server.projectId)).limit(1);
    const [settings] = project ? await db.select({ retentionDays: organizationSettings.backupRetentionDays, retentionCount: organizationSettings.backupRetentionCount }).from(organizationSettings).where(eq(organizationSettings.organizationId, project.organizationId)).limit(1) : [];
    const retentionDays = policy?.retentionDays ?? settings?.retentionDays ?? 14;
    const retentionCount = Math.max(1, policy?.retentionCount ?? settings?.retentionCount ?? 7);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const available = await db.select().from(backups).where(and(eq(backups.serverId, server.id), eq(backups.status, "AVAILABLE"))).orderBy(desc(backups.createdAt));
    const expired = available.filter((item, index) => item.id !== protectedBackupId && (index >= retentionCount || item.createdAt.getTime() < cutoff));
    for (const item of expired) {
      await this.kubernetes.deleteBackup(namespace, server.kubernetesName, nodeName, item.archiveName, server.storageGiB);
      await db.delete(backups).where(eq(backups.id, item.id));
      await this.activity(server, "backup.retention-deleted", `Expired backup deleted for ${server.name}`, { backupId: item.id, retentionDays, retentionCount }).catch(() => undefined);
    }
  }

  private async restore(server: ServerRecord, task: TaskRecord): Promise<void> {
    const backupId = typeof task.metadata.backupId === "string" ? task.metadata.backupId : null;
    if (!backupId) throw new RiftgridError("CONFLICT", "Restore task has no backup record", 409);
    const [record] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
    const [node] = server.nodeId ? await db.select().from(nodes).where(eq(nodes.id, server.nodeId)).limit(1) : [];
    if (!record || !node) throw new RiftgridError("NOT_FOUND", "Backup, source server, or node was not found", 404);
    if (server.actualState !== "STOPPED" || server.desiredState !== "STOPPED") throw new RiftgridError("INVALID_SERVER_STATE", "Stop the deployment before restoring persistent data", 409);
    if (record.status !== "AVAILABLE") throw new RiftgridError("CONFLICT", "Only an available backup can be restored", 409);
    assertTransition("STOPPED", "RESTORING");
    await db.update(servers).set({ actualState: "RESTORING", updatedAt: new Date() }).where(eq(servers.id, server.id));
    await db.update(backups).set({ status: "RESTORING", errorMessage: null }).where(eq(backups.id, record.id));
    await this.progress(task, 20, "VALIDATING ARCHIVE");
    try {
      await this.progress(task, 45, "RESTORING PERSISTENT DATA");
      await this.kubernetes.restoreBackup(namespace, server.kubernetesName, node.name, record.archiveName, server.storageGiB);
      await db.update(backups).set({ status: "AVAILABLE" }).where(eq(backups.id, record.id));
      await db.update(servers).set({ actualState: "STOPPED", updatedAt: new Date() }).where(eq(servers.id, server.id));
      await this.activity(server, "backup.restored", `Backup restored to ${server.name}`, { backupId: record.id });
      await this.progress(task, 90, "RESTORE COMPLETE — DEPLOYMENT REMAINS STOPPED");
    } catch (error) {
      await db.update(backups).set({ status: "AVAILABLE", errorMessage: error instanceof Error ? error.message : "Restore failed" }).where(eq(backups.id, record.id));
      await db.update(servers).set({ actualState: "STOPPED", updatedAt: new Date() }).where(eq(servers.id, server.id));
      throw error;
    }
  }

  private async waitUntilReady(server: ServerRecord, task: TaskRecord, adapter: ReturnType<GameAdapterRegistry["get"]>): Promise<void> {
    const timeoutAt = Date.now() + Number(process.env.WORKLOAD_READY_TIMEOUT_MS ?? 600_000);
    while (Date.now() < timeoutAt) {
      const observed = await this.kubernetes.observePod(namespace, server.kubernetesName);
      const health = adapter.evaluateHealth(observed);
      await this.progress(task, health.ready ? 95 : 75, health.message);
      if (health.healthy) {
        assertTransition("STARTING", "RUNNING");
        await db.update(servers).set({ actualState: "RUNNING", lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() }).where(eq(servers.id, server.id));
        await this.activity(server, "server.state", `${server.name} -> RUNNING`, { from: server.actualState, to: "RUNNING" });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new RiftgridError("NODE_UNAVAILABLE", "The workload did not become healthy before the startup deadline.", 504);
  }

  private async transition(server: ServerRecord, state: ServerState, task: TaskRecord, progress: number, step: string) {
    if (server.actualState !== state) assertTransition(server.actualState, state);
    await db.update(servers).set({ actualState: state, updatedAt: new Date() }).where(eq(servers.id, server.id));
    await this.progress(task, progress, step);
  }

  private async allocatePorts(server: ServerRecord, nodeId: string, requests: Array<{ name: string; protocol: "TCP" | "UDP"; containerPort: number }>) {
    const start = Number(process.env.PORT_RANGE_START ?? 30000); const end = Number(process.env.PORT_RANGE_END ?? 32767);
    const existingForServer = await db.select().from(portAllocations).where(eq(portAllocations.serverId, server.id));
    const result: Array<{ name: string; protocol: "TCP" | "UDP"; containerPort: number; port: number }> = [];
    for (const request of requests) {
      const existing = existingForServer.find((port) => port.purpose === request.name && port.protocol === request.protocol);
      if (existing) { result.push({ ...request, port: existing.port }); continue; }
      let allocated = false;
      for (let attempt = 0; attempt < end - start + 1 && !allocated; attempt += 1) {
        // Kubernetes NodePorts are allocated cluster-wide, including across protocols.
        const usedRows = await db.select({ port: portAllocations.port }).from(portAllocations);
        const port = chooseAvailablePort(new Set(usedRows.map((row) => row.port)), start, end);
        try { await db.insert(portAllocations).values({ serverId: server.id, nodeId, port, protocol: request.protocol, purpose: request.name }); result.push({ ...request, port }); allocated = true; } catch (error: any) { if (error?.code !== "23505") throw error; }
      }
      if (!allocated) throw new RiftgridError("PORT_ALLOCATION_FAILED", "No collision-free port is available.", 409);
    }
    return result;
  }

  private async progress(task: TaskRecord, progress: number, currentStep: string, status?: "SUCCESS") {
    await db.update(tasks).set({ progress, currentStep, ...(status ? { status, finishedAt: new Date() } : {}) }).where(eq(tasks.id, task.id));
    await this.publish({ type: "task.progress", taskId: task.id, serverId: task.serverId, progress, currentStep, status: status ?? "RUNNING" });
  }
  private async activity(server: ServerRecord, type: string, message: string, metadata: Record<string, unknown>) {
    const [project] = await db.select().from(projects).where(eq(projects.id, server.projectId));
    if (project) await db.insert(activityEvents).values({ organizationId: project.organizationId, projectId: project.id, serverId: server.id, type, message, metadata });
    await this.publish({ type, serverId: server.id, message, metadata });
  }
  private async publish(payload: unknown) { const redis = redisConnection(); try { await redis.publish(progressChannel, JSON.stringify(payload)); } finally { redis.disconnect(); } }
}

function describeError(error: unknown): string {
  const candidate = error as { message?: unknown; body?: unknown; response?: { body?: unknown } } | null;
  for (const body of [candidate?.body, candidate?.response?.body]) {
    if (typeof body === "string" && body.trim()) return body;
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string" && body.message.trim()) return body.message;
  }
  return error instanceof Error ? error.message : "Unknown worker error";
}

function nextScheduleTime(schedule: string, from: Date): Date {
  const delay = schedule === "0 */6 * * *" ? 6 * 60 * 60 * 1000 : schedule === "0 3 * * 0" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(from.getTime() + delay);
}
