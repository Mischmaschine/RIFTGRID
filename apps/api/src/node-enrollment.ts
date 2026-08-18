import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { activityEvents, and, db, eq, gt, inArray, nodeEnrollments, nodes } from "@riftgrid/database";
import { RiftgridError } from "@riftgrid/shared";
import { z } from "zod";
import { authorize, hashToken } from "./auth.js";
import { nodeInstallerScript } from "./node-installer.js";

const activeStatuses = ["WAITING", "PREFLIGHT", "INSTALLING", "VERIFYING"] as const;
const terminalStatuses = ["SUCCESS", "FAILED", "EXPIRED", "CANCELLED"] as const;
const endpointSchema = z.string().url().max(240).refine((value) => { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }, "Use an HTTP(S) endpoint without embedded credentials");
const kubernetesEndpointSchema = z.string().url().max(240).refine((value) => { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }, "The Kubernetes API endpoint must use HTTPS and cannot contain credentials");
const createSchema = z.object({
  nodeName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Use a lowercase DNS-compatible node name"),
  operatingSystem: z.enum(["UBUNTU_24_04", "UBUNTU_22_04", "DEBIAN_12"]),
  architecture: z.enum(["AMD64", "ARM64"]),
  riftgridUrl: endpointSchema,
  kubernetesServerUrl: kubernetesEndpointSchema,
});
const checkInSchema = z.object({
  status: z.enum(["PREFLIGHT", "INSTALLING", "VERIFYING", "FAILED"]),
  message: z.string().min(1).max(500),
});

type EnrollmentControlPlane = { syncNodes(): Promise<Array<{ name: string; healthy: boolean }>> };

function withoutTrailingSlash(value: string) { return value.replace(/\/+$/, ""); }
function shellQuote(value: string) { return `'${value.replaceAll("'", `'\"'\"'`)}'`; }
function present(row: typeof nodeEnrollments.$inferSelect) {
  const { tokenHash: _tokenHash, ...safe } = row;
  return safe;
}

export function registerNodeEnrollmentRoutes(app: FastifyInstance, getControlPlane: () => EnrollmentControlPlane) {
  app.get("/api/v1/node-enrollments/install.sh", async (_request, reply) => reply.type("text/x-shellscript; charset=utf-8").header("cache-control", "no-store").send(nodeInstallerScript()));

  app.post("/api/v1/node-enrollments", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const user = await authorize(request, "node.manage");
    const body = createSchema.parse(request.body);
    let discovered: Array<{ name: string }>;
    try { discovered = await getControlPlane().syncNodes(); }
    catch (error) { request.log.warn(error, "Could not validate node enrollment against Kubernetes"); throw new RiftgridError("NODE_UNAVAILABLE", "The existing Kubernetes cluster must be reachable before a node can be enrolled.", 503); }
    if (discovered.some((node) => node.name === body.nodeName)) throw new RiftgridError("CONFLICT", "A Kubernetes node with this name already exists.", 409);
    const [existingNode] = await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.name, body.nodeName)).limit(1);
    if (existingNode) throw new RiftgridError("CONFLICT", "A Kubernetes node with this name already exists.", 409);
    const [active] = await db.select({ id: nodeEnrollments.id }).from(nodeEnrollments).where(and(eq(nodeEnrollments.nodeName, body.nodeName), inArray(nodeEnrollments.status, [...activeStatuses]), gt(nodeEnrollments.expiresAt, new Date()))).limit(1);
    if (active) throw new RiftgridError("CONFLICT", "An active enrollment for this node already exists.", 409, { enrollmentId: active.id });

    const enrollmentCode = `rg_enroll_${randomBytes(24).toString("base64url")}`;
    const riftgridUrl = withoutTrailingSlash(body.riftgridUrl);
    const kubernetesServerUrl = withoutTrailingSlash(body.kubernetesServerUrl);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const [created] = await db.insert(nodeEnrollments).values({ organizationId: user.organizationId, createdBy: user.id, nodeName: body.nodeName, operatingSystem: body.operatingSystem, architecture: body.architecture, riftgridUrl, kubernetesServerUrl, tokenHash: hashToken(enrollmentCode), expiresAt }).returning();
    await db.insert(activityEvents).values({ organizationId: user.organizationId, actorId: user.id, type: "node.enrollment.created", message: `${user.name} created a short-lived enrollment for ${body.nodeName}`, metadata: { enrollmentId: created!.id, operatingSystem: body.operatingSystem, architecture: body.architecture, expiresAt: expiresAt.toISOString() } });
    const installerUrl = `${riftgridUrl}/api/v1/node-enrollments/install.sh`;
    const installCommand = `curl -fsSL ${shellQuote(installerUrl)} -o /tmp/riftgrid-node-install.sh\nsudo sh /tmp/riftgrid-node-install.sh --riftgrid-url ${shellQuote(riftgridUrl)} --server-url ${shellQuote(kubernetesServerUrl)} --node-name ${shellQuote(body.nodeName)} --architecture ${shellQuote(body.architecture)}\nrm -f /tmp/riftgrid-node-install.sh`;
    return reply.code(201).header("cache-control", "no-store").send({ enrollment: present(created!), enrollmentCode, commands: { prerequisites: "sudo apt-get update && sudo apt-get install -y curl ca-certificates", controlPlaneToken: "sudo cat /var/lib/rancher/k3s/server/node-token", install: installCommand } });
  });

  app.get("/api/v1/node-enrollments/:id", async (request) => {
    const user = await authorize(request, "node.view");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    let [row] = await db.select().from(nodeEnrollments).where(and(eq(nodeEnrollments.id, id), eq(nodeEnrollments.organizationId, user.organizationId))).limit(1);
    if (!row) throw new RiftgridError("NOT_FOUND", "Node enrollment not found", 404);
    const now = new Date();
    if (activeStatuses.includes(row.status as typeof activeStatuses[number]) && row.expiresAt <= now) {
      [row] = await db.update(nodeEnrollments).set({ status: "EXPIRED", currentStep: "Enrollment expired", updatedAt: now }).where(eq(nodeEnrollments.id, id)).returning();
    } else if (!terminalStatuses.includes(row.status as typeof terminalStatuses[number])) {
      try {
        const discovered = await getControlPlane().syncNodes();
        const node = discovered.find((candidate) => candidate.name === row!.nodeName);
        if (node) {
          const success = node.healthy;
          [row] = await db.update(nodeEnrollments).set({ status: success ? "SUCCESS" : "VERIFYING", currentStep: success ? "Node joined and is Ready" : "Node joined; waiting for Ready", lastMessage: success ? "Kubernetes reports the new node as Ready" : "Kubernetes discovered the node but it is not Ready yet", usedAt: success ? now : null, updatedAt: now }).where(eq(nodeEnrollments.id, id)).returning();
        }
      } catch (error) {
        request.log.warn(error, "Could not refresh node enrollment from Kubernetes");
      }
    }
    return { enrollment: present(row!) };
  });

  app.post("/api/v1/node-enrollments/check-in", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new RiftgridError("UNAUTHORIZED", "A valid enrollment code is required.", 401);
    const body = checkInSchema.parse(request.body);
    const tokenHash = hashToken(authorization.slice(7));
    const [row] = await db.select().from(nodeEnrollments).where(eq(nodeEnrollments.tokenHash, tokenHash)).limit(1);
    if (!row) throw new RiftgridError("UNAUTHORIZED", "The enrollment code is invalid.", 401);
    if (row.expiresAt <= new Date()) { await db.update(nodeEnrollments).set({ status: "EXPIRED", currentStep: "Enrollment expired", updatedAt: new Date() }).where(eq(nodeEnrollments.id, row.id)); throw new RiftgridError("CONFLICT", "The enrollment code has expired.", 410); }
    if (terminalStatuses.includes(row.status as typeof terminalStatuses[number])) throw new RiftgridError("CONFLICT", "This enrollment is no longer active.", 409);
    const steps = { PREFLIGHT: "Remote preflight completed", INSTALLING: "Installing k3s agent", VERIFYING: "Waiting for Kubernetes discovery", FAILED: "Remote installation failed" } as const;
    const [updated] = await db.update(nodeEnrollments).set({ status: body.status, currentStep: steps[body.status], lastMessage: body.message, updatedAt: new Date() }).where(eq(nodeEnrollments.id, row.id)).returning();
    return reply.header("cache-control", "no-store").send({ enrollment: present(updated!) });
  });

  app.post("/api/v1/node-enrollments/:id/cancel", async (request) => {
    const user = await authorize(request, "node.manage");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [row] = await db.select().from(nodeEnrollments).where(and(eq(nodeEnrollments.id, id), eq(nodeEnrollments.organizationId, user.organizationId))).limit(1);
    if (!row) throw new RiftgridError("NOT_FOUND", "Node enrollment not found", 404);
    if (terminalStatuses.includes(row.status as typeof terminalStatuses[number])) return { enrollment: present(row) };
    const [updated] = await db.update(nodeEnrollments).set({ status: "CANCELLED", currentStep: "Enrollment cancelled", updatedAt: new Date() }).where(eq(nodeEnrollments.id, id)).returning();
    await db.insert(activityEvents).values({ organizationId: user.organizationId, actorId: user.id, type: "node.enrollment.cancelled", message: `${user.name} cancelled enrollment for ${row.nodeName}`, metadata: { enrollmentId: id } });
    return { enrollment: present(updated!) };
  });
}
