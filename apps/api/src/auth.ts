import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, db, eq, gt, sessions, users } from "@riftgrid/database";
import { requirePermission, type Permission, type Role } from "@riftgrid/permissions";
import { RiftgridError } from "@riftgrid/shared";

export const sessionCookie = "riftgrid_session";
const sessionDurationMs = 1000 * 60 * 60 * 24 * 14;
export type AuthUser = { id: string; organizationId: string; email: string; name: string; role: Role };

export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function createSession(userId: string, reply: FastifyReply) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + sessionDurationMs) });
  reply.setCookie(sessionCookie, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: sessionDurationMs / 1000 });
}
export async function resolveUser(request: FastifyRequest): Promise<AuthUser | null> {
  const token = request.cookies[sessionCookie];
  if (!token) return null;
  const [row] = await db.select({ id: users.id, organizationId: users.organizationId, email: users.email, name: users.name, role: users.role }).from(sessions).innerJoin(users, eq(sessions.userId, users.id)).where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.enabled, true))).limit(1);
  return row ?? null;
}
export async function authenticate(request: FastifyRequest): Promise<AuthUser> {
  const user = await resolveUser(request);
  if (!user) throw new RiftgridError("UNAUTHORIZED", "Sign in to continue.", 401);
  return user;
}
export async function authorize(request: FastifyRequest, permission: Permission): Promise<AuthUser> {
  const user = await authenticate(request); requirePermission(user.role, permission); return user;
}
