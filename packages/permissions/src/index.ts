import { RiftgridError } from "@riftgrid/shared";

export const permissions = [
  "server.view", "server.create", "server.start", "server.stop", "server.restart", "server.delete",
  "server.console.read", "server.console.write", "server.files.read", "server.files.write",
  "backup.create", "backup.restore", "backup.delete", "node.view", "node.manage",
  "template.manage", "database.view", "database.manage", "user.manage", "settings.manage",
] as const;
export type Permission = (typeof permissions)[number];
export type Role = "SUPER_ADMIN" | "ADMIN" | "USER" | "VIEWER";

const rolePermissions: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(permissions),
  ADMIN: new Set(permissions.filter((permission) => permission !== "settings.manage")),
  USER: new Set(["server.view", "server.create", "server.start", "server.stop", "server.restart", "server.console.read", "server.console.write", "server.files.read", "server.files.write", "backup.create"]),
  VIEWER: new Set(["server.view", "server.console.read", "node.view", "database.view"]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) throw new RiftgridError("FORBIDDEN", `Missing permission: ${permission}`, 403);
}
