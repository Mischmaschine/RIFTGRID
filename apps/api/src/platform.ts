import type { FastifyInstance } from "fastify";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { and, activityEvents, backupPolicies, backups, count, db, deploymentTemplateRevisions, deploymentTemplates, desc, eq, inArray, managedDatabases, nodes, organizationSettings, projects, servers, sessions, tasks, users } from "@riftgrid/database";
import type { InstallerRegistry } from "@riftgrid/game-sdk";
import type { KubernetesService } from "@riftgrid/kubernetes";
import { hasPermission, permissions } from "@riftgrid/permissions";
import { RiftgridError } from "@riftgrid/shared";
import { enqueueTask } from "@riftgrid/tasks";
import { z } from "zod";
import { authenticate, authorize } from "./auth.js";

const resourceSchema = z.object({ cpuMillicores: z.number().int().min(250), memoryMiB: z.number().int().min(512), storageGiB: z.number().int().min(1) });
const templateBodySchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), description: z.string().max(500).default(""), installerId: z.string().min(1), configuration: z.record(z.string(), z.unknown()), resources: resourceSchema, placement: z.object({ nodeId: z.string().uuid().optional(), requiredLabels: z.record(z.string(), z.string()).optional() }).default({}) });
const settingsSchema = z.object({ defaultPlacement: z.literal("AUTOMATIC"), defaultCpuMillicores: z.number().int().min(250).max(16000), defaultMemoryMiB: z.number().int().min(512).max(65536), defaultStorageGiB: z.number().int().min(1).max(250), maximumCpuMillicores: z.number().int().min(250).max(64000), maximumMemoryMiB: z.number().int().min(512).max(262144), maximumStorageGiB: z.number().int().min(1).max(4096), backupRetentionDays: z.number().int().min(1).max(3650), backupRetentionCount: z.number().int().min(1).max(1000), installerChannel: z.enum(["STABLE", "PREVIEW"]) }).refine((value) => value.defaultCpuMillicores <= value.maximumCpuMillicores && value.defaultMemoryMiB <= value.maximumMemoryMiB && value.defaultStorageGiB <= value.maximumStorageGiB, { message: "Defaults cannot exceed organization maximums" });

export function registerPlatformRoutes(app: FastifyInstance, dependencies: { kube: () => KubernetesService; installers: InstallerRegistry }) {
  const { kube, installers } = dependencies;

  app.get("/api/v1/templates", async (request) => {
    const user = await authenticate(request); const projectIds = await ownedProjectIds(user.organizationId);
    const rows = projectIds.length ? await db.select().from(deploymentTemplates).where(inArray(deploymentTemplates.projectId, projectIds)).orderBy(desc(deploymentTemplates.updatedAt)) : [];
    return { templates: rows };
  });

  app.post("/api/v1/templates", async (request, reply) => {
    const user = await authorize(request, "template.manage"); const body = templateBodySchema.parse(request.body); const project = await ownedProject(user.organizationId);
    const installer = installers.get(body.installerId); const manifest = installer.manifest(); const configuration = installer.configurationSchema().parse(body.configuration);
    const settings = await getSettings(user.organizationId); assertWithinLimits(body.resources, settings);
    const created = await db.transaction(async (tx) => {
      const [template] = await tx.insert(deploymentTemplates).values({ projectId: project.id, name: body.name, description: body.description, installerId: manifest.metadata.id, installerVersion: manifest.metadata.version, configuration: configuration as Record<string, unknown>, cpuMillicores: body.resources.cpuMillicores, memoryMiB: body.resources.memoryMiB, storageGiB: body.resources.storageGiB, placement: body.placement, createdBy: user.id }).returning();
      if (!template) throw new Error("Template could not be created");
      await tx.insert(deploymentTemplateRevisions).values(templateRevisionValues(template, user.id));
      return template;
    });
    await recordActivity(user.organizationId, project.id, user.id, null, "template.created", `${user.name} created template ${body.name}`, { templateId: created!.id, installerId: body.installerId });
    return reply.code(201).send({ template: created });
  });

  app.get("/api/v1/templates/:id/revisions", async (request) => {
    const user = await authenticate(request); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const projectIds = await ownedProjectIds(user.organizationId);
    const [template] = projectIds.length ? await db.select().from(deploymentTemplates).where(and(eq(deploymentTemplates.id, id), inArray(deploymentTemplates.projectId, projectIds))).limit(1) : [];
    if (!template) throw new RiftgridError("NOT_FOUND", "Template not found", 404);
    const revisions = await db.select().from(deploymentTemplateRevisions).where(eq(deploymentTemplateRevisions.templateId, id)).orderBy(desc(deploymentTemplateRevisions.revision));
    return { template, revisions };
  });

  app.patch("/api/v1/templates/:id", async (request) => {
    const user = await authorize(request, "template.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = templateBodySchema.partial().parse(request.body); const projectIds = await ownedProjectIds(user.organizationId);
    const [current] = projectIds.length ? await db.select().from(deploymentTemplates).where(and(eq(deploymentTemplates.id, id), inArray(deploymentTemplates.projectId, projectIds))).limit(1) : [];
    if (!current) throw new RiftgridError("NOT_FOUND", "Template not found", 404);
    let installerId = current.installerId; let installerVersion = current.installerVersion; let configuration = current.configuration;
    if (body.installerId || body.configuration) { const installer = installers.get(body.installerId ?? current.installerId); const manifest = installer.manifest(); installerId = manifest.metadata.id; installerVersion = manifest.metadata.version; configuration = installer.configurationSchema().parse(body.configuration ?? current.configuration) as Record<string, unknown>; }
    const resources = { cpuMillicores: body.resources?.cpuMillicores ?? current.cpuMillicores, memoryMiB: body.resources?.memoryMiB ?? current.memoryMiB, storageGiB: body.resources?.storageGiB ?? current.storageGiB }; assertWithinLimits(resources, await getSettings(user.organizationId));
    const updated = await db.transaction(async (tx) => {
      const [template] = await tx.update(deploymentTemplates).set({ ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description } : {}), revision: current.revision + 1, installerId, installerVersion, configuration, ...resources, ...(body.placement ? { placement: body.placement } : {}), updatedAt: new Date() }).where(eq(deploymentTemplates.id, id)).returning();
      if (!template) throw new Error("Template could not be updated");
      await tx.insert(deploymentTemplateRevisions).values(templateRevisionValues(template, user.id));
      return template;
    });
    await recordActivity(user.organizationId, current.projectId, user.id, null, "template.updated", `${user.name} published revision ${updated.revision} of template ${updated.name}`, { templateId: id, revision: updated.revision });
    return { template: updated };
  });

  app.post("/api/v1/templates/:id/revisions/:revision/restore", async (request) => {
    const user = await authorize(request, "template.manage"); const { id, revision } = z.object({ id: z.string().uuid(), revision: z.coerce.number().int().min(1) }).parse(request.params); const projectIds = await ownedProjectIds(user.organizationId);
    const [current] = projectIds.length ? await db.select().from(deploymentTemplates).where(and(eq(deploymentTemplates.id, id), inArray(deploymentTemplates.projectId, projectIds))).limit(1) : [];
    if (!current) throw new RiftgridError("NOT_FOUND", "Template not found", 404);
    const [source] = await db.select().from(deploymentTemplateRevisions).where(and(eq(deploymentTemplateRevisions.templateId, id), eq(deploymentTemplateRevisions.revision, revision))).limit(1);
    if (!source) throw new RiftgridError("NOT_FOUND", "Template revision not found", 404);
    const installer = installers.get(source.installerId); installer.configurationSchema().parse(source.configuration); const manifest = installer.manifest();
    const restored = await db.transaction(async (tx) => {
      const [template] = await tx.update(deploymentTemplates).set({ name: source.name, description: source.description, revision: current.revision + 1, installerId: manifest.metadata.id, installerVersion: manifest.metadata.version, configuration: source.configuration, cpuMillicores: source.cpuMillicores, memoryMiB: source.memoryMiB, storageGiB: source.storageGiB, placement: source.placement, updatedAt: new Date() }).where(eq(deploymentTemplates.id, id)).returning();
      if (!template) throw new Error("Template revision could not be restored");
      await tx.insert(deploymentTemplateRevisions).values(templateRevisionValues(template, user.id));
      return template;
    });
    await recordActivity(user.organizationId, current.projectId, user.id, null, "template.restored", `${user.name} restored revision ${revision} of template ${current.name} as revision ${restored.revision}`, { templateId: id, sourceRevision: revision, revision: restored.revision });
    return { template: restored };
  });

  app.delete("/api/v1/templates/:id", async (request, reply) => {
    const user = await authorize(request, "template.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const projectIds = await ownedProjectIds(user.organizationId);
    const [removed] = projectIds.length ? await db.delete(deploymentTemplates).where(and(eq(deploymentTemplates.id, id), inArray(deploymentTemplates.projectId, projectIds))).returning() : [];
    if (!removed) throw new RiftgridError("NOT_FOUND", "Template not found", 404);
    await recordActivity(user.organizationId, removed.projectId, user.id, null, "template.deleted", `${user.name} deleted template ${removed.name}`, { templateId: removed.id, revision: removed.revision });
    return reply.code(204).send();
  });

  app.get("/api/v1/backups", async (request) => {
    const user = await authenticate(request); const projectIds = await ownedProjectIds(user.organizationId);
    const rows = projectIds.length ? await db.select({ id: backups.id, serverId: backups.serverId, serverName: servers.name, status: backups.status, trigger: backups.trigger, archiveName: backups.archiveName, sizeBytes: backups.sizeBytes, checksum: backups.checksum, errorMessage: backups.errorMessage, retentionDays: backups.retentionDays, createdAt: backups.createdAt, completedAt: backups.completedAt }).from(backups).innerJoin(servers, eq(backups.serverId, servers.id)).where(inArray(backups.projectId, projectIds)).orderBy(desc(backups.createdAt)) : [];
    const policies = projectIds.length ? await db.select({ serverId: backupPolicies.serverId, enabled: backupPolicies.enabled, schedule: backupPolicies.schedule, retentionDays: backupPolicies.retentionDays, retentionCount: backupPolicies.retentionCount, nextRunAt: backupPolicies.nextRunAt }).from(backupPolicies).innerJoin(servers, eq(backupPolicies.serverId, servers.id)).where(inArray(servers.projectId, projectIds)) : [];
    return { backups: rows, policies };
  });

  app.post("/api/v1/servers/:id/backups", async (request, reply) => {
    const user = await authorize(request, "backup.create"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const server = await ownedServer(id, user.organizationId);
    if (!["RUNNING", "STOPPED"].includes(server.actualState)) throw new RiftgridError("INVALID_SERVER_STATE", "Backups require a running or stopped deployment", 409);
    await assertNoActiveTask(server.id); const settings = await getSettings(user.organizationId); const backupId = randomUUID(); const taskId = randomUUID();
    await db.transaction(async (tx) => { await tx.insert(backups).values({ id: backupId, projectId: server.projectId, serverId: server.id, requestedBy: user.id, archiveName: `${server.kubernetesName}-${backupId}.tar.gz`, retentionDays: settings.backupRetentionDays }); await tx.insert(tasks).values({ id: taskId, projectId: server.projectId, serverId: server.id, type: "BACKUP_SERVER", idempotencyKey: `manual-backup:${backupId}`, metadata: { backupId } }); await tx.insert(activityEvents).values({ organizationId: user.organizationId, projectId: server.projectId, actorId: user.id, serverId: server.id, type: "backup.requested", message: `${user.name} requested a backup of ${server.name}`, metadata: { backupId } }); });
    await enqueueTask({ taskId, serverId: server.id, type: "BACKUP_SERVER" }); return reply.code(202).send({ backupId, taskId });
  });

  app.post("/api/v1/backups/:id/restore", async (request, reply) => {
    const user = await authorize(request, "backup.restore"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const record = await ownedBackup(id, user.organizationId); const server = await ownedServer(record.serverId, user.organizationId);
    if (server.actualState !== "STOPPED" || server.desiredState !== "STOPPED") throw new RiftgridError("INVALID_SERVER_STATE", "Stop the deployment before restoring a backup", 409);
    await assertNoActiveTask(server.id); const taskId = randomUUID();
    await db.insert(tasks).values({ id: taskId, projectId: server.projectId, serverId: server.id, type: "RESTORE_SERVER", idempotencyKey: `restore:${id}:${taskId}`, metadata: { backupId: id } });
    await recordActivity(user.organizationId, server.projectId, user.id, server.id, "backup.restore-requested", `${user.name} requested restore of ${server.name}`, { backupId: id });
    await enqueueTask({ taskId, serverId: server.id, type: "RESTORE_SERVER" }); return reply.code(202).send({ taskId });
  });

  app.delete("/api/v1/backups/:id", async (request, reply) => {
    const user = await authorize(request, "backup.delete"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const record = await ownedBackup(id, user.organizationId); const server = await ownedServer(record.serverId, user.organizationId); const [node] = server.nodeId ? await db.select().from(nodes).where(eq(nodes.id, server.nodeId)).limit(1) : [];
    if (!node || !["AVAILABLE", "FAILED"].includes(record.status)) throw new RiftgridError("CONFLICT", "Only an available or failed backup with a known source node can be deleted", 409);
    await db.update(backups).set({ status: "DELETING" }).where(eq(backups.id, id));
    try { await kube().deleteBackup(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", server.kubernetesName, node.name, record.archiveName, server.storageGiB); await db.delete(backups).where(eq(backups.id, id)); await recordActivity(user.organizationId, server.projectId, user.id, server.id, "backup.deleted", `${user.name} deleted a backup of ${server.name}`, { backupId: id }); }
    catch (error) { await db.update(backups).set({ status: record.status, errorMessage: error instanceof Error ? error.message : "Delete failed" }).where(eq(backups.id, id)); throw error; }
    return reply.code(204).send();
  });

  app.put("/api/v1/servers/:id/backup-policy", async (request) => {
    const user = await authorize(request, "backup.create"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const server = await ownedServer(id, user.organizationId); const body = z.object({ enabled: z.boolean(), schedule: z.enum(["0 */6 * * *", "0 3 * * *", "0 3 * * 0"]), retentionDays: z.number().int().min(1).max(3650), retentionCount: z.number().int().min(1).max(1000) }).parse(request.body);
    const [policy] = await db.insert(backupPolicies).values({ serverId: server.id, ...body, nextRunAt: body.enabled ? nextScheduleTime(body.schedule) : null }).onConflictDoUpdate({ target: backupPolicies.serverId, set: { ...body, nextRunAt: body.enabled ? nextScheduleTime(body.schedule) : null, updatedAt: new Date() } }).returning(); return { policy };
  });

  app.get("/api/v1/databases", async (request) => {
    const user = await authorize(request, "database.view"); const projectIds = await ownedProjectIds(user.organizationId);
    const rows = projectIds.length ? await db.select({ id: managedDatabases.id, name: managedDatabases.name, engine: managedDatabases.engine, databaseName: managedDatabases.databaseName, username: managedDatabases.username, passwordSecretName: managedDatabases.passwordSecretName, host: managedDatabases.host, port: managedDatabases.port, storageGiB: managedDatabases.storageGiB, state: managedDatabases.state, lastError: managedDatabases.lastError, serverId: managedDatabases.serverId, serverName: servers.name, kubernetesName: managedDatabases.kubernetesName, createdAt: managedDatabases.createdAt }).from(managedDatabases).leftJoin(servers, eq(managedDatabases.serverId, servers.id)).where(inArray(managedDatabases.projectId, projectIds)).orderBy(desc(managedDatabases.createdAt)) : [];
    const namespace = process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers";
    const refreshed = await Promise.all(rows.map(async (row) => { if (row.state === "STOPPED") return row; try { const observation = await kube().observeManagedDatabase(namespace, row.kubernetesName); const state = observation.ready ? "RUNNING" as const : observation.phase === "Failed" ? "FAILED" as const : "PROVISIONING" as const; if (state !== row.state) await db.update(managedDatabases).set({ state, lastError: observation.ready ? null : observation.message ?? null, updatedAt: new Date() }).where(eq(managedDatabases.id, row.id)); return { ...row, state, lastError: observation.ready ? null : observation.message ?? row.lastError }; } catch (error) { return { ...row, state: "FAILED" as const, lastError: error instanceof Error ? error.message : "Kubernetes unavailable" }; } }));
    return { databases: refreshed, canReadCredentials: hasPermission(user.role, "database.manage") };
  });

  app.post("/api/v1/databases/:id/credentials/password", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await authorize(request, "database.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const projectIds = await ownedProjectIds(user.organizationId);
    const [record] = projectIds.length ? await db.select().from(managedDatabases).where(and(eq(managedDatabases.id, id), inArray(managedDatabases.projectId, projectIds))).limit(1) : [];
    if (!record) throw new RiftgridError("NOT_FOUND", "Database not found", 404);
    const password = await kube().readSecretValue(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", record.passwordSecretName, "user-password");
    await recordActivity(user.organizationId, record.projectId, user.id, record.serverId, "database.credentials-accessed", `${user.name} copied application credentials for ${record.name}`, { databaseId: record.id, secretName: record.passwordSecretName, key: "user-password" });
    return reply.header("Cache-Control", "no-store, max-age=0").header("Pragma", "no-cache").send({ password });
  });

  app.post("/api/v1/databases", async (request, reply) => {
    const user = await authorize(request, "database.manage"); const body = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), engine: z.enum(["MARIADB", "MYSQL"]), databaseName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/), username: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/), storageGiB: z.number().int().min(1).max(250), serverId: z.string().uuid().nullable().optional() }).parse(request.body); const project = await ownedProject(user.organizationId);
    const associated = body.serverId ? await ownedServer(body.serverId, user.organizationId) : null; const [storedNode] = associated?.nodeId ? await db.select().from(nodes).where(eq(nodes.id, associated.nodeId)).limit(1) : await db.select().from(nodes).where(and(eq(nodes.healthy, true), eq(nodes.maintenance, false), eq(nodes.schedulingEnabled, true))).limit(1); if (!storedNode) throw new RiftgridError("NO_CLUSTER_CAPACITY", "No healthy schedulable node is available", 409);
    const id = randomUUID(); const kubernetesName = `db-${id.slice(0, 12)}`; const namespace = process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers"; const secretName = `${kubernetesName}-credentials`; const password = randomBytes(32).toString("base64url"); const rootPassword = randomBytes(40).toString("base64url");
    const [created] = await db.insert(managedDatabases).values({ id, projectId: project.id, serverId: body.serverId ?? null, name: body.name, engine: body.engine, databaseName: body.databaseName, username: body.username, passwordSecretName: secretName, kubernetesName, host: `${kubernetesName}.${namespace}.svc.cluster.local`, storageGiB: body.storageGiB }).returning();
    try { await kube().ensureManagedDatabase({ namespace, kubernetesName, engine: body.engine, databaseName: body.databaseName, username: body.username, password, rootPassword, storageGiB: body.storageGiB, nodeName: storedNode.name }); await recordActivity(user.organizationId, project.id, user.id, body.serverId ?? null, "database.provisioned", `${user.name} provisioned database ${body.name}`, { databaseId: id, engine: body.engine }); }
    catch (error) { await db.update(managedDatabases).set({ state: "FAILED", lastError: error instanceof Error ? error.message : "Provisioning failed", updatedAt: new Date() }).where(eq(managedDatabases.id, id)); throw error; }
    return reply.code(202).send({ database: created });
  });

  for (const action of ["start", "stop"] as const) app.post(`/api/v1/databases/:id/${action}`, async (request, reply) => {
    const user = await authorize(request, "database.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const projectIds = await ownedProjectIds(user.organizationId); const [record] = projectIds.length ? await db.select().from(managedDatabases).where(and(eq(managedDatabases.id, id), inArray(managedDatabases.projectId, projectIds))).limit(1) : []; if (!record) throw new RiftgridError("NOT_FOUND", "Database not found", 404);
    await kube().scaleWorkload(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", record.kubernetesName, action === "start" ? 1 : 0); await db.update(managedDatabases).set({ state: action === "start" ? "PROVISIONING" : "STOPPED", updatedAt: new Date() }).where(eq(managedDatabases.id, id)); return reply.code(202).send({ state: action === "start" ? "PROVISIONING" : "STOPPED" });
  });

  app.get("/api/v1/users", async (request) => { const user = await authorize(request, "user.manage"); return { users: await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, enabled: users.enabled, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(eq(users.organizationId, user.organizationId)).orderBy(users.name), permissions }; });
  app.post("/api/v1/users", async (request, reply) => { const actor = await authorize(request, "user.manage"); const body = z.object({ name: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(12).max(128), role: z.enum(["SUPER_ADMIN", "ADMIN", "USER", "VIEWER"]) }).parse(request.body); const [created] = await db.insert(users).values({ organizationId: actor.organizationId, name: body.name, email: body.email.toLowerCase(), passwordHash: await hash(body.password, 12), role: body.role }).returning({ id: users.id, name: users.name, email: users.email, role: users.role, enabled: users.enabled, createdAt: users.createdAt }); await recordActivity(actor.organizationId, null, actor.id, null, "user.created", `${actor.name} created user ${body.email}`, { userId: created!.id, role: body.role }); return reply.code(201).send({ user: created }); });
  app.patch("/api/v1/users/:id", async (request) => { const actor = await authorize(request, "user.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ name: z.string().min(2).max(80).optional(), role: z.enum(["SUPER_ADMIN", "ADMIN", "USER", "VIEWER"]).optional(), enabled: z.boolean().optional() }).parse(request.body); const [target] = await db.select().from(users).where(and(eq(users.id, id), eq(users.organizationId, actor.organizationId))).limit(1); if (!target) throw new RiftgridError("NOT_FOUND", "User not found", 404); if (actor.id === id && (body.enabled === false || body.role && body.role !== "SUPER_ADMIN" && actor.role === "SUPER_ADMIN")) throw new RiftgridError("CONFLICT", "You cannot disable or remove your own active administration role", 409); if (target.role === "SUPER_ADMIN" && (body.enabled === false || body.role && body.role !== "SUPER_ADMIN")) { const [admins] = await db.select({ count: count() }).from(users).where(and(eq(users.organizationId, actor.organizationId), eq(users.role, "SUPER_ADMIN"), eq(users.enabled, true))); if (Number(admins?.count ?? 0) <= 1) throw new RiftgridError("CONFLICT", "The organization must retain an enabled super administrator", 409); } const [updated] = await db.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, id)).returning({ id: users.id, name: users.name, email: users.email, role: users.role, enabled: users.enabled, updatedAt: users.updatedAt }); if (body.enabled === false) await db.delete(sessions).where(eq(sessions.userId, id)); return { user: updated }; });

  app.get("/api/v1/settings", async (request) => { const user = await authenticate(request); return { settings: await getSettings(user.organizationId) }; });
  app.patch("/api/v1/settings", async (request) => { const user = await authorize(request, "settings.manage"); const body = settingsSchema.parse(request.body); const [settings] = await db.insert(organizationSettings).values({ organizationId: user.organizationId, ...body }).onConflictDoUpdate({ target: organizationSettings.organizationId, set: { ...body, updatedAt: new Date() } }).returning(); await recordActivity(user.organizationId, null, user.id, null, "settings.updated", `${user.name} updated organization settings`, {}); return { settings }; });
}

async function ownedProjectIds(organizationId: string) { return (await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).map((row) => row.id); }
async function ownedProject(organizationId: string) { const [project] = await db.select().from(projects).where(eq(projects.organizationId, organizationId)).limit(1); if (!project) throw new RiftgridError("NOT_FOUND", "Project not found", 404); return project; }
async function ownedServer(id: string, organizationId: string) { const [row] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, organizationId))).limit(1); if (!row) throw new RiftgridError("NOT_FOUND", "Deployment not found", 404); return row.servers; }
async function ownedBackup(id: string, organizationId: string) { const [row] = await db.select().from(backups).innerJoin(projects, eq(backups.projectId, projects.id)).where(and(eq(backups.id, id), eq(projects.organizationId, organizationId))).limit(1); if (!row) throw new RiftgridError("NOT_FOUND", "Backup not found", 404); return row.backups; }
async function assertNoActiveTask(serverId: string) { const [active] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.serverId, serverId), inArray(tasks.status, ["QUEUED", "RUNNING"]))).limit(1); if (active) throw new RiftgridError("CONFLICT", "Another operation already owns this deployment", 409, { taskId: active.id }); }
async function getSettings(organizationId: string) { const [settings] = await db.insert(organizationSettings).values({ organizationId }).onConflictDoNothing().returning(); if (settings) return settings; const [existing] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, organizationId)); if (!existing) throw new Error("Organization settings could not be loaded"); return existing; }
function assertWithinLimits(resources: { cpuMillicores: number; memoryMiB: number; storageGiB: number }, settings: Awaited<ReturnType<typeof getSettings>>) { if (resources.cpuMillicores > settings.maximumCpuMillicores || resources.memoryMiB > settings.maximumMemoryMiB || resources.storageGiB > settings.maximumStorageGiB) throw new RiftgridError("CONFLICT", "Requested resources exceed organization limits", 409); }
async function recordActivity(organizationId: string, projectId: string | null, actorId: string, serverId: string | null, type: string, message: string, metadata: Record<string, unknown>) { await db.insert(activityEvents).values({ organizationId, projectId, actorId, serverId, type, message, metadata }); }
function nextScheduleTime(schedule: string) { const delay = schedule === "0 */6 * * *" ? 6 * 60 * 60 * 1000 : schedule === "0 3 * * 0" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; return new Date(Date.now() + delay); }
function templateRevisionValues(template: typeof deploymentTemplates.$inferSelect, createdBy: string) { return { templateId: template.id, revision: template.revision, name: template.name, description: template.description, installerId: template.installerId, installerVersion: template.installerVersion, configuration: template.configuration, cpuMillicores: template.cpuMillicores, memoryMiB: template.memoryMiB, storageGiB: template.storageGiB, placement: template.placement, createdBy }; }
