import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { and, asc, count, db, desc, eq, ilike, inArray, activityEvents, consoleLines, deploymentTemplates, nodes, organizations, organizationSettings, portAllocations, projects, schedulingDecisions, servers, sessions, tasks, users } from "@riftgrid/database";
import { ControlPlane } from "@riftgrid/control-plane";
import { MinecraftAdapter } from "@riftgrid/game-minecraft";
import { FiveMAdapter, GameAdapterRegistry, GenericWorkloadAdapter, RustAdapter, ValheimAdapter } from "@riftgrid/game-sdk";
import { cleanLogText, KubernetesService } from "@riftgrid/kubernetes";
import { hasPermission } from "@riftgrid/permissions";
import { createServerSchema, errorMessage, RiftgridError } from "@riftgrid/shared";
import { enqueueTask, redisConnection } from "@riftgrid/tasks";
import { z } from "zod";
import { authenticate, authorize, createSession, hashToken, resolveUser, sessionCookie } from "./auth.js";
import { fetchFiveMRuntime } from "./fivem-runtime.js";
import { createInstallerRegistry } from "./installers.js";
import { registerPlatformRoutes } from "./platform.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true, bodyLimit: 1024 * 1024 });
await app.register(cookie);
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true });
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
await app.register(websocket);
await app.register(swagger, { openapi: { info: { title: "RIFTGRID API", version: "0.1.0", description: "Desired-state game infrastructure control plane" }, servers: [{ url: "/" }] } });
await app.register(swaggerUi, { routePrefix: "/docs" });

const adapters = new GameAdapterRegistry().register(new MinecraftAdapter()).register(new GenericWorkloadAdapter()).register(new FiveMAdapter()).register(new RustAdapter()).register(new ValheimAdapter());
const installers = createInstallerRegistry();
let kubernetes: KubernetesService | null = null;
function kube() { return kubernetes ??= new KubernetesService(); }
function controlPlane() { return new ControlPlane(kube(), adapters, installers); }

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof RiftgridError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
  if (error instanceof z.ZodError) return reply.code(400).send({ error: { code: "INVALID_GAME_CONFIGURATION", message: "The request is invalid.", details: error.flatten() } });
  app.log.error(error); return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: errorMessage("INTERNAL_ERROR") } });
});

app.get("/health", { schema: { tags: ["system"] } }, async () => ({ status: "ok", service: "riftgrid-api" }));

app.get("/api/v1/auth/bootstrap", async () => { const [row] = await db.select({ count: count() }).from(users); return { required: Number(row?.count ?? 0) === 0 }; });
app.post("/api/v1/auth/bootstrap", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
  const body = z.object({ name: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(12).max(128) }).parse(request.body);
  const [existing] = await db.select({ count: count() }).from(users); if (Number(existing?.count ?? 0) > 0) throw new RiftgridError("CONFLICT", "Bootstrap is already complete.", 409);
  const user = await db.transaction(async (tx) => {
    const [organization] = await tx.insert(organizations).values({ name: "RIFTGRID", slug: "riftgrid" }).returning();
    if (!organization) throw new Error("Could not create organization");
    await tx.insert(projects).values({ organizationId: organization.id, name: "Default", slug: "default" });
    const [created] = await tx.insert(users).values({ organizationId: organization.id, name: body.name, email: body.email.toLowerCase(), passwordHash: await hash(body.password, 12), role: "SUPER_ADMIN" }).returning();
    return created!;
  });
  await createSession(user.id, reply); return reply.code(201).send({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});
app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(request.body);
  const [user] = await db.select().from(users).where(eq(users.email, body.email.toLowerCase())).limit(1);
  if (!user || !(await compare(body.password, user.passwordHash))) throw new RiftgridError("UNAUTHORIZED", "Email or password is incorrect.", 401);
  await createSession(user.id, reply); return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
});
app.post("/api/v1/auth/logout", async (request, reply) => { const token = request.cookies[sessionCookie]; if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))); reply.clearCookie(sessionCookie, { path: "/" }); return reply.code(204).send(); });
app.get("/api/v1/auth/me", async (request) => ({ user: await authenticate(request) }));

app.get("/api/v1/game-adapters", async (request) => { await authenticate(request); return { adapters: adapters.list().map((adapter) => ({ ...adapter.metadata(), capabilities: [...adapter.capabilities()] })) }; });
app.get("/api/v1/installers", async (request) => { await authenticate(request); return { installers: await Promise.all(installers.list().map(async (manifest) => ({ ...manifest, availableVersions: manifest.spec.status === "READY" ? await installers.get(manifest.metadata.id).supportedVersions() : [], latestManifestVersion: manifest.metadata.version, updateAvailable: false }))) }; });
app.get("/api/v1/installers/:id", async (request) => {
  const user = await authenticate(request); const { id } = z.object({ id: z.string() }).parse(request.params); const manifest = installers.manifest(id);
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, user.organizationId)); const projectIds = projectRows.map((project) => project.id);
  const [templateRows, deploymentRows, availableVersions] = await Promise.all([
    projectIds.length ? db.select().from(deploymentTemplates).where(and(inArray(deploymentTemplates.projectId, projectIds), eq(deploymentTemplates.installerId, id))).orderBy(desc(deploymentTemplates.updatedAt)) : [],
    projectIds.length ? db.select({ id: servers.id, name: servers.name, actualState: servers.actualState, installerVersion: servers.installerVersion, createdAt: servers.createdAt }).from(servers).where(and(inArray(servers.projectId, projectIds), eq(servers.installerId, id))).orderBy(desc(servers.createdAt)) : [],
    manifest.spec.status === "READY" ? installers.get(id).supportedVersions() : Promise.resolve([]),
  ]);
  const capabilities = manifest.spec.adapterId ? [...adapters.get(manifest.spec.adapterId).capabilities()] : [];
  return { installer: { ...manifest, availableVersions, latestManifestVersion: manifest.metadata.version, updateAvailable: false }, capabilities, usage: { templates: templateRows, deployments: deploymentRows, templateCount: templateRows.length, deploymentCount: deploymentRows.length } };
});
app.get("/api/v1/installers/:id/versions", async (request) => { await authenticate(request); const { id } = z.object({ id: z.string() }).parse(request.params); return { versions: await installers.get(id).supportedVersions() }; });

app.get("/api/v1/nodes", async (request) => {
  await authorize(request, "node.view");
  try { const discovered = await controlPlane().syncNodes(); return { nodes: discovered, connected: true }; }
  catch (error) { request.log.warn(error); const stored = await db.select().from(nodes).orderBy(asc(nodes.name)); return { nodes: stored, connected: false, error: error instanceof Error ? error.message : "Kubernetes unavailable" }; }
});
app.patch("/api/v1/nodes/:id", async (request) => { const user = await authorize(request, "node.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const body = z.object({ maintenance: z.boolean().optional(), schedulingEnabled: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0).parse(request.body); const policy = { ...(body.maintenance !== undefined ? { maintenance: body.maintenance } : {}), ...(body.schedulingEnabled !== undefined ? { schedulingEnabled: body.schedulingEnabled } : {}) }; const [current] = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1); if (!current) throw new RiftgridError("NOT_FOUND", "Node not found", 404); await kube().patchNodePolicy(current.name, policy); const [node] = await db.update(nodes).set({ ...policy, lastSeenAt: new Date() }).where(eq(nodes.id, id)).returning(); await db.insert(activityEvents).values({ organizationId: user.organizationId, actorId: user.id, type: "node.policy", message: `${user.name} updated scheduling policy for ${current.name}`, metadata: policy }); return { node }; });

app.get("/api/v1/overview", async (request) => {
  const user = await authenticate(request); const [project] = await db.select().from(projects).where(eq(projects.organizationId, user.organizationId)).limit(1); if (!project) throw new RiftgridError("NOT_FOUND", "Project not found", 404);
  const serverRows = await db.select().from(servers).where(eq(servers.projectId, project.id));
  let nodeRows; let clusterConnected = true; try { const discovered = await controlPlane().syncNodes(); const workloadCounts = new Map(discovered.map((node) => [node.name, node.workloadCount])); nodeRows = (await db.select().from(nodes).orderBy(asc(nodes.name))).map((node) => ({ ...node, workloadCount: workloadCounts.get(node.name) ?? 0 })); } catch (error) { request.log.warn(error); clusterConnected = false; nodeRows = (await db.select().from(nodes).orderBy(asc(nodes.name))).map((node) => ({ ...node, workloadCount: 0 })); }
  const recentActivity = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, user.organizationId)).orderBy(desc(activityEvents.createdAt)).limit(20);
  const recentTasks = await db.select().from(tasks).where(eq(tasks.projectId, project.id)).orderBy(desc(tasks.createdAt)).limit(8);
  let storage = { allocatedGiB: serverRows.reduce((sum, server) => sum + server.storageGiB, 0), claims: 0 }; try { const inventory = await kube().storageOverview(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers"); storage = { allocatedGiB: inventory.claims.reduce((sum, claim) => sum + claim.capacityGiB, 0), claims: inventory.claims.length }; } catch (error) { request.log.warn(error); clusterConnected = false; }
  const playerSamples = await Promise.all(serverRows.filter((server) => server.actualState === "RUNNING" && server.adapterId === "minecraft").map(async (server) => { try { const result = await kube().exec(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", server.kubernetesName, ["rcon-cli", "list"]); const match = result.stdout.match(/There are (\d+) of a max of (\d+) players online/i); return { serverId: server.id, online: Number(match?.[1] ?? 0), maximum: Number(match?.[2] ?? 0), available: Boolean(match) }; } catch { return { serverId: server.id, online: 0, maximum: 0, available: false }; } }));
  const warnings = [...(!clusterConnected ? ["Kubernetes API data could not be fully refreshed"] : []), ...nodeRows.filter((node) => !node.healthy).map((node) => `${node.name} is not healthy`), ...nodeRows.filter((node) => node.maintenance).map((node) => `${node.name} is in maintenance`), ...serverRows.filter((server) => server.actualState === "FAILED").map((server) => `${server.name} is failed${server.lastErrorMessage ? `: ${server.lastErrorMessage}` : ""}`)];
  return { cluster: { healthy: clusterConnected && nodeRows.length > 0 && nodeRows.every((node) => node.healthy), connected: clusterConnected, connectedNodes: nodeRows.filter((node) => node.healthy).length, nodeCount: nodeRows.length, schedulerAvailableNodes: nodeRows.filter((node) => node.healthy && !node.maintenance && node.schedulingEnabled).length, capacity: { cpuMillicores: nodeRows.reduce((sum, node) => sum + node.cpuMillicores, 0), memoryMiB: nodeRows.reduce((sum, node) => sum + node.memoryMiB, 0), storageGiB: nodeRows.reduce((sum, node) => sum + node.storageGiB, 0) }, allocated: { cpuMillicores: nodeRows.reduce((sum, node) => sum + node.allocatedCpuMillicores, 0), memoryMiB: nodeRows.reduce((sum, node) => sum + node.allocatedMemoryMiB, 0), storageGiB: storage.allocatedGiB } }, servers: { total: serverRows.length, running: serverRows.filter((server) => server.actualState === "RUNNING").length, stopped: serverRows.filter((server) => server.actualState === "STOPPED").length, failed: serverRows.filter((server) => server.actualState === "FAILED").length, playersOnline: playerSamples.filter((sample) => sample.available).reduce((sum, sample) => sum + sample.online, 0), playersAvailable: playerSamples.some((sample) => sample.available), deployments: serverRows.map((server) => ({ id: server.id, name: server.name, state: server.actualState, desiredState: server.desiredState, installerId: server.installerId, players: playerSamples.find((sample) => sample.serverId === server.id) ?? null })) }, storage, activeTasks: recentTasks.filter((task) => task.status === "RUNNING" || task.status === "QUEUED").length, warnings, nodes: nodeRows, activity: recentActivity, tasks: recentTasks };
});

app.get("/api/v1/tasks", async (request) => {
  const user = await authenticate(request);
  const query = z.object({ status: z.enum(["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"]).optional(), type: z.enum(["CREATE_SERVER", "START_SERVER", "STOP_SERVER", "RESTART_SERVER", "BACKUP_SERVER", "RESTORE_SERVER", "MIGRATE_SERVER", "REINSTALL_SERVER", "DELETE_SERVER", "RECONCILE_SERVER"]).optional(), serverId: z.string().uuid().optional(), deployment: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(250).default(100) }).parse(request.query);
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, user.organizationId));
  const conditions = [projectRows.length ? inArray(tasks.projectId, projectRows.map((row) => row.id)) : eq(tasks.id, "00000000-0000-0000-0000-000000000000")];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.type) conditions.push(eq(tasks.type, query.type));
  if (query.serverId) conditions.push(eq(tasks.serverId, query.serverId));
  if (query.deployment) conditions.push(ilike(servers.name, `%${query.deployment}%`));
  const rows = await db.select({ id: tasks.id, type: tasks.type, status: tasks.status, progress: tasks.progress, currentStep: tasks.currentStep, errorCode: tasks.errorCode, errorMessage: tasks.errorMessage, serverId: tasks.serverId, serverName: servers.name, createdAt: tasks.createdAt, startedAt: tasks.startedAt, finishedAt: tasks.finishedAt }).from(tasks).leftJoin(servers, eq(tasks.serverId, servers.id)).where(and(...conditions)).orderBy(desc(tasks.createdAt)).limit(query.limit);
  return { tasks: rows };
});

app.get("/api/v1/activity", async (request) => {
  const user = await authenticate(request);
  const query = z.object({ limit: z.coerce.number().int().min(1).max(250).default(100), serverId: z.string().uuid().optional() }).parse(request.query);
  const conditions = [eq(activityEvents.organizationId, user.organizationId)];
  if (query.serverId) conditions.push(eq(activityEvents.serverId, query.serverId));
  const rows = await db.select({ id: activityEvents.id, type: activityEvents.type, message: activityEvents.message, metadata: activityEvents.metadata, serverId: activityEvents.serverId, serverName: servers.name, actorName: users.name, createdAt: activityEvents.createdAt }).from(activityEvents).leftJoin(servers, eq(activityEvents.serverId, servers.id)).leftJoin(users, eq(activityEvents.actorId, users.id)).where(and(...conditions)).orderBy(desc(activityEvents.createdAt)).limit(query.limit);
  return { activity: rows };
});

app.get("/api/v1/storage", async (request) => {
  await authorize(request, "node.view");
  try {
    const inventory = await kube().storageOverview(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers");
    const serverRows = await db.select({ id: servers.id, name: servers.name }).from(servers); const names = new Map(serverRows.map((server) => [server.id, server.name]));
    return { connected: true, ...inventory, claims: inventory.claims.map((claim) => ({ ...claim, serverName: claim.serverId ? names.get(claim.serverId) ?? null : null })), allocatedGiB: inventory.claims.reduce((sum, claim) => sum + claim.capacityGiB, 0) };
  } catch (error) {
    request.log.warn(error);
    return { connected: false, claims: [], volumes: [], storageClasses: [], allocatedGiB: 0, error: error instanceof Error ? error.message : "Kubernetes storage inventory unavailable" };
  }
});

app.get("/api/v1/network", async (request) => {
  const user = await authorize(request, "server.view");
  const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, user.organizationId));
  const serverRows = await db.select({ id: servers.id, name: servers.name }).from(servers).where(projectRows.length ? inArray(servers.projectId, projectRows.map((row) => row.id)) : eq(servers.id, "00000000-0000-0000-0000-000000000000"));
  const ids = serverRows.map((server) => server.id); const names = new Map(serverRows.map((server) => [server.id, server.name]));
  const allocations = ids.length ? await db.select().from(portAllocations).where(inArray(portAllocations.serverId, ids)).orderBy(asc(portAllocations.port)) : [];
  const publicHost = process.env.GAME_PUBLIC_HOST ?? "localhost";
  let services: Awaited<ReturnType<KubernetesService["networkInventory"]>> = []; let connected = true; try { services = await kube().networkInventory(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers"); } catch (error) { request.log.warn(error); connected = false; }
  return { connected, services, allocations: allocations.map((allocation) => { const service = services.find((item) => item.serverId === allocation.serverId && item.ports.some((port) => port.nodePort === allocation.port && port.protocol === allocation.protocol)); return { ...allocation, serverName: names.get(allocation.serverId) ?? "Unknown deployment", address: `${publicHost}:${allocation.port}`, serviceName: service?.name ?? null, serviceType: service?.type ?? null, clusterIp: service?.clusterIp ?? null, nodeName: service?.nodeName ?? null, state: service ? "ACTIVE" : "ALLOCATED" }; }) };
});

app.get("/api/v1/servers", async (request) => { const user = await authorize(request, "server.view"); const projectRows = await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, user.organizationId)); return { servers: await db.select().from(servers).where(projectRows.length ? inArray(servers.projectId, projectRows.map((row) => row.id)) : eq(servers.id, "00000000-0000-0000-0000-000000000000")).orderBy(desc(servers.createdAt)) }; });

app.post("/api/v1/servers", async (request, reply) => {
  const user = await authorize(request, "server.create"); const body = createServerSchema.parse(request.body); const installer = installers.get(body.installerId); const manifest = installer.manifest(); const configuration = installer.configurationSchema().parse(body.configuration); const adapterId = manifest.spec.adapterId; if (!adapterId) throw new RiftgridError("CONFLICT", "This installer does not expose a deployable game adapter yet.", 409); adapters.get(adapterId);
  const [project] = await db.select().from(projects).where(eq(projects.organizationId, user.organizationId)).limit(1); if (!project) throw new RiftgridError("NOT_FOUND", "Project not found", 404);
  const [settings] = await db.insert(organizationSettings).values({ organizationId: user.organizationId }).onConflictDoNothing().returning(); const limits = settings ?? (await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, user.organizationId)).limit(1))[0]; if (limits && (body.resources.cpuMillicores > limits.maximumCpuMillicores || body.resources.memoryMiB > limits.maximumMemoryMiB || body.resources.storageGiB > limits.maximumStorageGiB)) throw new RiftgridError("CONFLICT", "Requested resources exceed organization limits", 409);
  const existingTask = await db.select().from(tasks).where(eq(tasks.idempotencyKey, body.idempotencyKey)).limit(1); if (existingTask[0]) { const [existingServer] = await db.select().from(servers).where(eq(servers.id, existingTask[0].serverId!)); return reply.send({ server: existingServer, task: existingTask[0] }); }
  const serverId = randomUUID();
  const created = await db.transaction(async (tx) => {
    const [server] = await tx.insert(servers).values({ id: serverId, projectId: project.id, name: body.name, adapterId, installerId: manifest.metadata.id, installerVersion: manifest.metadata.version, configuration: configuration as Record<string, unknown>, cpuMillicores: body.resources.cpuMillicores, memoryMiB: body.resources.memoryMiB, storageGiB: body.resources.storageGiB, kubernetesName: `rg-${serverId.slice(0, 12)}` }).returning();
    const [task] = await tx.insert(tasks).values({ projectId: project.id, serverId, type: "CREATE_SERVER", idempotencyKey: body.idempotencyKey, metadata: { placement: body.placement } }).returning();
    await tx.insert(activityEvents).values({ organizationId: user.organizationId, projectId: project.id, actorId: user.id, serverId, type: "server.desired-state", message: `${user.name} requested ${body.name} -> RUNNING`, metadata: { desiredState: "RUNNING" } });
    return { server: server!, task: task! };
  });
  await enqueueTask({ taskId: created.task.id, serverId, type: "CREATE_SERVER" }); return reply.code(202).send(created);
});

app.get("/api/v1/servers/:id", async (request) => { const user = await authorize(request, "server.view"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const [server] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, user.organizationId))).limit(1); if (!server) throw new RiftgridError("NOT_FOUND", "Server not found", 404); const [ports, decisions, taskRows] = await Promise.all([db.select().from(portAllocations).where(eq(portAllocations.serverId, id)), db.select().from(schedulingDecisions).where(eq(schedulingDecisions.serverId, id)).orderBy(desc(schedulingDecisions.createdAt)).limit(1), db.select().from(tasks).where(eq(tasks.serverId, id)).orderBy(desc(tasks.createdAt)).limit(20)]); const publicHost = process.env.GAME_PUBLIC_HOST ?? "localhost"; const adapter = adapters.get(server.servers.adapterId); return { server: server.servers, ports: ports.map((port) => ({ ...port, address: `${publicHost}:${port.port}` })), schedulingDecision: decisions[0] ?? null, tasks: taskRows, capabilities: [...adapter.capabilities()], consoleWritable: adapter.consoleCommand("") !== null }; });

app.get("/api/v1/servers/:id/runtime", async (request) => {
  const user = await authorize(request, "server.view");
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const [owned] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, user.organizationId))).limit(1);
  if (!owned) throw new RiftgridError("NOT_FOUND", "Server not found", 404);
  const namespace = process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers";
  const pod = await kube().observePod(namespace, owned.servers.kubernetesName).catch((error) => ({ ready: false, message: error instanceof Error ? error.message : "Kubernetes workload unavailable" }));
  if (owned.servers.adapterId !== "fivem") return { adapterId: owned.servers.adapterId, pod, live: null };
  const [gamePort] = await db.select().from(portAllocations).where(and(eq(portAllocations.serverId, id), eq(portAllocations.purpose, "game-tcp"))).limit(1);
  if (!gamePort) return { adapterId: "fivem", pod, live: { connected: false, sampledAt: new Date().toISOString(), error: "FiveM game endpoint has not been allocated", players: [], resources: [], server: { hostname: null, clients: 0, maxClients: null, gameType: null, mapName: null, onesync: null, version: null } } };
  const live = await fetchFiveMRuntime(`${process.env.GAME_PUBLIC_HOST ?? "localhost"}:${gamePort.port}`);
  return { adapterId: "fivem", pod, live };
});

for (const action of ["start", "stop", "restart", "reconcile"] as const) app.post(`/api/v1/servers/:id/${action}`, async (request, reply) => {
  const permission = action === "start" ? "server.start" : action === "stop" ? "server.stop" : "server.restart"; const user = await authorize(request, permission); const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
  const [server] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, user.organizationId))).limit(1); if (!server) throw new RiftgridError("NOT_FOUND", "Server not found", 404);
  const [activeTask] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.serverId, id), inArray(tasks.status, ["QUEUED", "RUNNING"]))).limit(1); if (activeTask) throw new RiftgridError("CONFLICT", "Another operation already owns this server.", 409, { taskId: activeTask.id });
  const type = action === "start" ? "START_SERVER" : action === "stop" ? "STOP_SERVER" : action === "restart" ? "RESTART_SERVER" : "RECONCILE_SERVER"; const desiredState = action === "stop" ? "STOPPED" : "RUNNING"; const taskId = randomUUID();
  await db.transaction(async (tx) => { await tx.update(servers).set({ desiredState, updatedAt: new Date() }).where(eq(servers.id, id)); await tx.insert(tasks).values({ id: taskId, projectId: server.projects.id, serverId: id, type, idempotencyKey: `${type}:${id}:${taskId}` }); await tx.insert(activityEvents).values({ organizationId: user.organizationId, projectId: server.projects.id, actorId: user.id, serverId: id, type: "server.desired-state", message: `${user.name} requested ${server.servers.name} -> ${desiredState}`, metadata: { desiredState } }); });
  await enqueueTask({ taskId, serverId: id, type }); return reply.code(202).send({ taskId, desiredState });
});

app.get("/api/v1/servers/:id/console/history", async (request) => { const user = await authorize(request, "server.console.read"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const [row] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, user.organizationId))); if (!row) throw new RiftgridError("NOT_FOUND", "Server not found", 404); const persisted = await db.select().from(consoleLines).where(eq(consoleLines.serverId, id)).orderBy(desc(consoleLines.createdAt)).limit(300); try { const live = await kube().recentLogs(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", row.servers.kubernetesName, 300); return { lines: live.split(/\r?\n/).filter(Boolean).map((line) => ({ stream: "stdout", line })) }; } catch { return { lines: persisted.reverse().map((entry) => ({ ...entry, line: cleanLogText(entry.line) })) }; } });

app.get("/api/v1/events", { websocket: true }, async (socket, request) => {
  const user = await resolveUser(request); if (!user) { socket.close(4401, "Unauthorized"); return; }
  const redis = redisConnection(); await redis.subscribe("riftgrid:events"); redis.on("message", (_channel, message) => { if (socket.readyState === socket.OPEN) socket.send(message); });
  socket.on("close", () => { void redis.unsubscribe().finally(() => redis.disconnect()); }); socket.send(JSON.stringify({ type: "connected", userId: user.id }));
});

app.get("/api/v1/servers/:id/console", { websocket: true }, async (socket, request) => {
  const user = await resolveUser(request); if (!user || !hasPermission(user.role, "server.console.read")) { socket.close(4403, "Forbidden"); return; }
  const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const [owned] = await db.select().from(servers).innerJoin(projects, eq(servers.projectId, projects.id)).where(and(eq(servers.id, id), eq(projects.organizationId, user.organizationId))); if (!owned) { socket.close(4404, "Not found"); return; } const server = owned.servers;
  const abort = new AbortController(); socket.on("close", () => abort.abort());
  socket.on("message", async (raw: Buffer) => { try { if (!hasPermission(user.role, "server.console.write")) throw new RiftgridError("FORBIDDEN", "Console is read-only", 403); const payload = z.object({ type: z.literal("command"), command: z.string().min(1).max(512) }).parse(JSON.parse(raw.toString())); const command = adapters.get(server.adapterId).consoleCommand(payload.command); if (!command) throw new RiftgridError("CONFLICT", "This adapter currently exposes logs but no safe interactive command transport.", 409); const result = await kube().exec(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", server.kubernetesName, command); socket.send(JSON.stringify({ type: "command.result", ...result })); } catch (error) { socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Command failed" })); } });
  void kube().followLogs(process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers", server.kubernetesName, (stream, line) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "console.line", stream, line, timestamp: new Date().toISOString() })); void db.insert(consoleLines).values({ serverId: id, stream, line }); }, abort.signal).catch((error) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Log stream ended" })); });
});

registerPlatformRoutes(app, { kube, installers });

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });
