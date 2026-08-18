import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { activityEvents, and, componentRelationships, db, desc, eq, inArray, isNull, managedDatabases, nodes, or, placementPolicies, portAllocations, projects, scalingPolicies, servers, serviceBindings, stackBlueprints, stackComponents, stackOperations, stacks, tasks } from "@riftgrid/database";
import { aggregateStackHealth, DependencyCycleError, lifecyclePlan, relationshipTypes, RiftgridError, workloadSemantics } from "@riftgrid/shared";
import { z } from "zod";
import { authorize } from "./auth.js";

const componentTypeSchema = z.enum(["WORKLOAD", "DATABASE", "CACHE", "PROXY", "SERVICE", "CUSTOM"]);
const componentSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), name: z.string().min(1).max(80), componentType: componentTypeSchema.default("WORKLOAD"),
  resourceKind: z.enum(["DEPLOYMENT", "MANAGED_DATABASE", "EXTERNAL"]), serverId: z.string().uuid().optional(), managedDatabaseId: z.string().uuid().optional(),
  workloadSemantics: z.enum(workloadSemantics).default("PERSISTENT"), required: z.boolean().default(true), configuration: z.record(z.unknown()).default({}),
}).superRefine((component, context) => {
  if (component.resourceKind === "DEPLOYMENT" && !component.serverId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["serverId"], message: "Deployment components require a serverId" });
  if (component.resourceKind === "MANAGED_DATABASE" && !component.managedDatabaseId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["managedDatabaseId"], message: "Database components require a managedDatabaseId" });
  if (component.resourceKind === "EXTERNAL" && (component.serverId || component.managedDatabaseId)) context.addIssue({ code: z.ZodIssueCode.custom, message: "External components cannot reference managed resources" });
});
const relationshipSchema = z.object({ sourceKey: z.string(), targetKey: z.string(), type: z.enum(relationshipTypes), requiredForStartup: z.boolean().default(false), metadata: z.record(z.unknown()).default({}) });
const bindingSchema = z.object({ consumerKey: z.string(), providerKey: z.string(), logicalName: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), portName: z.string().max(40).optional(), environmentVariable: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(), protocol: z.enum(["TCP", "UDP", "HTTP", "HTTPS"]).default("TCP") });
const createStackSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{2,47}$/), description: z.string().max(500).default(""), blueprintId: z.string().uuid().optional(), components: z.array(componentSchema).min(1).max(100), relationships: z.array(relationshipSchema).max(300).default([]), serviceBindings: z.array(bindingSchema).max(300).default([]) }).superRefine((input, context) => {
  const keys = input.components.map((component) => component.key); const known = new Set(keys);
  if (known.size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Component keys must be unique" });
  input.relationships.forEach((relationship, index) => { if (!known.has(relationship.sourceKey) || !known.has(relationship.targetKey) || relationship.sourceKey === relationship.targetKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", index], message: "Relationships require two different known components" }); });
  input.serviceBindings.forEach((binding, index) => { if (!known.has(binding.consumerKey) || !known.has(binding.providerKey) || binding.consumerKey === binding.providerKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ["serviceBindings", index], message: "Bindings require two different known components" }); });
});

export function registerStackRoutes(app: FastifyInstance) {
  app.get("/api/v1/stack-blueprints", async (request) => {
    const user = await authorize(request, "stack.view"); const projectIds = await ownedProjectIds(user.organizationId);
    const blueprints = await db.select().from(stackBlueprints).where(projectIds.length ? or(isNull(stackBlueprints.projectId), inArray(stackBlueprints.projectId, projectIds)) : isNull(stackBlueprints.projectId)).orderBy(stackBlueprints.name);
    return { blueprints };
  });

  app.get("/api/v1/stacks", async (request) => {
    const user = await authorize(request, "stack.view"); const projectIds = await ownedProjectIds(user.organizationId);
    const rows = projectIds.length ? await db.select().from(stacks).where(inArray(stacks.projectId, projectIds)).orderBy(desc(stacks.createdAt)) : [];
    return { stacks: await Promise.all(rows.map(async (stack) => summarizeStack(stack))) };
  });

  app.post("/api/v1/stacks", async (request, reply) => {
    const user = await authorize(request, "stack.manage"); const body = createStackSchema.parse(request.body); const project = await ownedProject(user.organizationId);
    if (body.blueprintId) { const [blueprint] = await db.select().from(stackBlueprints).where(and(eq(stackBlueprints.id, body.blueprintId), or(isNull(stackBlueprints.projectId), eq(stackBlueprints.projectId, project.id)))).limit(1); if (!blueprint) throw new RiftgridError("NOT_FOUND", "Stack blueprint not found", 404); if (blueprint.status !== "READY") throw new RiftgridError("CONFLICT", `${blueprint.name} is ${blueprint.status.toLowerCase()} and cannot create a production stack yet.`, 409); }
    const serverIds = body.components.flatMap((component) => component.serverId ? [component.serverId] : []); const databaseIds = body.components.flatMap((component) => component.managedDatabaseId ? [component.managedDatabaseId] : []);
    const ownedServers = serverIds.length ? await db.select({ id: servers.id }).from(servers).where(and(inArray(servers.id, serverIds), eq(servers.projectId, project.id))) : [];
    const ownedDatabases = databaseIds.length ? await db.select({ id: managedDatabases.id }).from(managedDatabases).where(and(inArray(managedDatabases.id, databaseIds), eq(managedDatabases.projectId, project.id))) : [];
    if (ownedServers.length !== new Set(serverIds).size || ownedDatabases.length !== new Set(databaseIds).size) throw new RiftgridError("NOT_FOUND", "One or more selected Stack resources do not exist in this project.", 404);
    const stackId = randomUUID(); const componentIds = new Map(body.components.map((component) => [component.key, randomUUID()]));
    const orchestrationComponents = body.components.map((component) => ({ id: componentIds.get(component.key)!, required: component.required }));
    const orchestrationRelationships = body.relationships.map((relationship) => ({ sourceComponentId: componentIds.get(relationship.sourceKey)!, targetComponentId: componentIds.get(relationship.targetKey)!, type: relationship.type, requiredForStartup: relationship.requiredForStartup }));
    try { lifecyclePlan(orchestrationComponents, orchestrationRelationships, "START"); } catch (error) { if (error instanceof DependencyCycleError) throw new RiftgridError("CONFLICT", error.message, 409, { componentIds: error.componentIds }); throw error; }
    try {
      await db.transaction(async (tx) => {
        await tx.insert(stacks).values({ id: stackId, projectId: project.id, blueprintId: body.blueprintId ?? null, name: body.name, description: body.description, createdBy: user.id });
        await tx.insert(stackComponents).values(body.components.map((component) => ({ id: componentIds.get(component.key)!, stackId, key: component.key, name: component.name, componentType: component.componentType, resourceKind: component.resourceKind, serverId: component.serverId ?? null, managedDatabaseId: component.managedDatabaseId ?? null, workloadSemantics: component.workloadSemantics, required: component.required, configuration: component.configuration })));
        if (body.relationships.length) await tx.insert(componentRelationships).values(body.relationships.map((relationship) => ({ stackId, sourceComponentId: componentIds.get(relationship.sourceKey)!, targetComponentId: componentIds.get(relationship.targetKey)!, type: relationship.type, requiredForStartup: relationship.requiredForStartup, metadata: relationship.metadata })));
        if (body.serviceBindings.length) await tx.insert(serviceBindings).values(body.serviceBindings.map((binding) => ({ stackId, consumerComponentId: componentIds.get(binding.consumerKey)!, providerComponentId: componentIds.get(binding.providerKey)!, logicalName: binding.logicalName, portName: binding.portName ?? null, environmentVariable: binding.environmentVariable ?? null, protocol: binding.protocol })));
        await tx.insert(activityEvents).values({ organizationId: user.organizationId, projectId: project.id, actorId: user.id, type: "stack.created", message: `${user.name} created Stack ${body.name}`, metadata: { stackId, componentCount: body.components.length, relationshipCount: body.relationships.length } });
      });
    } catch (error: any) { if (error?.code === "23505") throw new RiftgridError("CONFLICT", "The Stack name or one of its resources is already assigned.", 409); throw error; }
    return reply.code(201).send(await loadStackDetail(stackId, user.organizationId));
  });

  app.get("/api/v1/stacks/:id", async (request) => { const user = await authorize(request, "stack.view"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); return loadStackDetail(id, user.organizationId); });

  app.post("/api/v1/stacks/:id/actions/:action", async (request, reply) => {
    const user = await authorize(request, "stack.lifecycle"); const { id, action } = z.object({ id: z.string().uuid(), action: z.enum(["start", "stop", "restart"]) }).parse(request.params); const owned = await ownedStack(id, user.organizationId);
    const [activeOperation] = await db.select({ id: stackOperations.id }).from(stackOperations).where(and(eq(stackOperations.stackId, id), inArray(stackOperations.status, ["QUEUED", "RUNNING"]))).limit(1); if (activeOperation) throw new RiftgridError("CONFLICT", "Another Stack operation is already active.", 409, { operationId: activeOperation.id });
    const components = await db.select().from(stackComponents).where(eq(stackComponents.stackId, id)); if (!components.length) throw new RiftgridError("CONFLICT", "A Stack without components has no lifecycle.", 409);
    const relationships = await db.select().from(componentRelationships).where(eq(componentRelationships.stackId, id));
    const serverIds = components.flatMap((component) => component.serverId ? [component.serverId] : []); if (serverIds.length) { const [activeTask] = await db.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.serverId, serverIds), inArray(tasks.status, ["QUEUED", "RUNNING"]))).limit(1); if (activeTask) throw new RiftgridError("CONFLICT", "A component already has an active deployment task.", 409, { taskId: activeTask.id }); }
    const lifecycleAction = action.toUpperCase() as "START" | "STOP" | "RESTART"; let plan;
    try { plan = lifecyclePlan(components.map((component) => ({ id: component.id, required: component.required })), relationships.map((relationship) => ({ sourceComponentId: relationship.sourceComponentId, targetComponentId: relationship.targetComponentId, type: relationship.type, requiredForStartup: relationship.requiredForStartup })), lifecycleAction); }
    catch (error) { if (error instanceof DependencyCycleError) throw new RiftgridError("CONFLICT", error.message, 409); throw error; }
    const [operation] = await db.transaction(async (tx) => { const [created] = await tx.insert(stackOperations).values({ stackId: id, requestedBy: user.id, action: lifecycleAction, plan, currentStep: "Waiting for orchestrator" }).returning(); await tx.update(stacks).set({ desiredState: action === "stop" ? "STOPPED" : "RUNNING", updatedAt: new Date() }).where(eq(stacks.id, id)); await tx.insert(activityEvents).values({ organizationId: user.organizationId, projectId: owned.projectId, actorId: user.id, type: "stack.lifecycle.requested", message: `${user.name} requested ${lifecycleAction} for Stack ${owned.name}`, metadata: { stackId: id, operationId: created!.id, steps: plan.length } }); return [created!]; });
    return reply.code(202).send({ operation });
  });

  app.delete("/api/v1/stacks/:id", async (request, reply) => {
    const user = await authorize(request, "stack.manage"); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const owned = await ownedStack(id, user.organizationId); const [active] = await db.select({ id: stackOperations.id }).from(stackOperations).where(and(eq(stackOperations.stackId, id), inArray(stackOperations.status, ["QUEUED", "RUNNING"]))).limit(1); if (active) throw new RiftgridError("CONFLICT", "Cancel or finish the active Stack operation first.", 409);
    await db.delete(stacks).where(eq(stacks.id, id)); await db.insert(activityEvents).values({ organizationId: user.organizationId, projectId: owned.projectId, actorId: user.id, type: "stack.deleted", message: `${user.name} deleted Stack ${owned.name} without deleting its resources`, metadata: { stackId: id } }); return reply.code(204).send();
  });
}

async function loadStackDetail(id: string, organizationId: string) {
  const stack = await ownedStack(id, organizationId); const components = await db.select().from(stackComponents).where(eq(stackComponents.stackId, id)); const relationships = await db.select().from(componentRelationships).where(eq(componentRelationships.stackId, id));
  const serverIds = components.flatMap((component) => component.serverId ? [component.serverId] : []); const databaseIds = components.flatMap((component) => component.managedDatabaseId ? [component.managedDatabaseId] : []);
  const serverRows = serverIds.length ? await db.select({ server: servers, nodeName: nodes.name }).from(servers).leftJoin(nodes, eq(servers.nodeId, nodes.id)).where(inArray(servers.id, serverIds)) : [];
  const databaseRows = databaseIds.length ? await db.select().from(managedDatabases).where(inArray(managedDatabases.id, databaseIds)) : [];
  const ports = serverIds.length ? await db.select().from(portAllocations).where(inArray(portAllocations.serverId, serverIds)) : [];
  const taskRows = serverIds.length ? await db.select().from(tasks).where(and(inArray(tasks.serverId, serverIds), inArray(tasks.status, ["QUEUED", "RUNNING"]))).orderBy(desc(tasks.createdAt)) : [];
  const componentViews = components.map((component) => {
    const server = component.serverId ? serverRows.find((row) => row.server.id === component.serverId) : undefined; const database = component.managedDatabaseId ? databaseRows.find((row) => row.id === component.managedDatabaseId) : undefined;
    const state = server?.server.actualState ?? database?.state ?? (component.resourceKind === "EXTERNAL" ? "EXTERNAL" : "UNKNOWN");
    return { ...component, state, desiredState: server?.server.desiredState ?? (database ? database.state === "STOPPED" ? "STOPPED" : "RUNNING" : null), nodeName: server?.nodeName ?? null, adapterId: server?.server.adapterId ?? null, installerId: server?.server.installerId ?? null, resources: server ? { cpuMillicores: server.server.cpuMillicores, memoryMiB: server.server.memoryMiB, storageGiB: server.server.storageGiB } : database ? { cpuMillicores: null, memoryMiB: null, storageGiB: database.storageGiB } : null, ports: component.serverId ? ports.filter((port) => port.serverId === component.serverId) : [], serviceAddress: server ? `${server.server.kubernetesName}.${process.env.KUBERNETES_NAMESPACE ?? "riftgrid-servers"}.svc.cluster.local` : database?.host ?? null, activeTask: component.serverId ? taskRows.find((task) => task.serverId === component.serverId) ?? null : null };
  });
  const bindings = await db.select().from(serviceBindings).where(eq(serviceBindings.stackId, id)); const policies = await db.select().from(placementPolicies).where(eq(placementPolicies.stackId, id)); const componentIds = components.map((component) => component.id); const scaling = componentIds.length ? await db.select().from(scalingPolicies).where(inArray(scalingPolicies.componentId, componentIds)) : []; const operations = await db.select().from(stackOperations).where(eq(stackOperations.stackId, id)).orderBy(desc(stackOperations.createdAt)).limit(20);
  return { stack, health: aggregateStackHealth(componentViews.map((component) => ({ required: component.required, state: component.state }))), components: componentViews, relationships, serviceBindings: bindings.map((binding) => ({ ...binding, resolvedAddress: componentViews.find((component) => component.id === binding.providerComponentId)?.serviceAddress ?? null })), placementPolicies: policies, scalingPolicies: scaling, operations };
}

async function summarizeStack(stack: typeof stacks.$inferSelect) { const components = await db.select().from(stackComponents).where(eq(stackComponents.stackId, stack.id)); const serverIds = components.flatMap((component) => component.serverId ? [component.serverId] : []); const databaseIds = components.flatMap((component) => component.managedDatabaseId ? [component.managedDatabaseId] : []); const serverRows = serverIds.length ? await db.select({ id: servers.id, state: servers.actualState }).from(servers).where(inArray(servers.id, serverIds)) : []; const databaseRows = databaseIds.length ? await db.select({ id: managedDatabases.id, state: managedDatabases.state }).from(managedDatabases).where(inArray(managedDatabases.id, databaseIds)) : []; const states = components.map((component) => ({ required: component.required, state: component.serverId ? serverRows.find((row) => row.id === component.serverId)?.state ?? null : component.managedDatabaseId ? databaseRows.find((row) => row.id === component.managedDatabaseId)?.state ?? null : "EXTERNAL" })); const [activeOperation] = await db.select().from(stackOperations).where(and(eq(stackOperations.stackId, stack.id), inArray(stackOperations.status, ["QUEUED", "RUNNING"]))).limit(1); return { ...stack, health: aggregateStackHealth(states), componentCount: components.length, activeOperation: activeOperation ?? null }; }
async function ownedProjectIds(organizationId: string) { return (await db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId))).map((row) => row.id); }
async function ownedProject(organizationId: string) { const [project] = await db.select().from(projects).where(eq(projects.organizationId, organizationId)).limit(1); if (!project) throw new RiftgridError("NOT_FOUND", "Project not found", 404); return project; }
async function ownedStack(id: string, organizationId: string) { const [row] = await db.select({ stack: stacks }).from(stacks).innerJoin(projects, eq(stacks.projectId, projects.id)).where(and(eq(stacks.id, id), eq(projects.organizationId, organizationId))).limit(1); if (!row) throw new RiftgridError("NOT_FOUND", "Stack not found", 404); return row.stack; }
