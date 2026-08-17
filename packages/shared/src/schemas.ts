import { z } from "zod";

export const idSchema = z.string().uuid();
export const serverNameSchema = z.string().min(3).max(48).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
export const resourceRequestSchema = z.object({
  cpuMillicores: z.number().int().min(250).max(32000),
  memoryMiB: z.number().int().min(512).max(262144),
  storageGiB: z.number().int().min(5).max(4096),
});

export const createServerSchema = z.object({
  name: serverNameSchema,
  installerId: z.string().min(1).max(64),
  configuration: z.record(z.unknown()),
  resources: resourceRequestSchema,
  placement: z.object({
    nodeId: z.string().uuid().optional(),
    requiredLabels: z.record(z.string()).optional(),
  }).default({}),
  idempotencyKey: z.string().min(8).max(128),
});
