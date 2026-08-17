import { Queue, QueueEvents, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { TaskType } from "@riftgrid/shared";

export interface ControlPlaneJob { taskId: string; serverId: string; type: TaskType; }
export const TASK_QUEUE = "riftgrid-control-plane";

export function redisConnection() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
}
export function taskQueue() { return new Queue<ControlPlaneJob>(TASK_QUEUE, { connection: redisConnection() }); }
export function taskEvents() { return new QueueEvents(TASK_QUEUE, { connection: redisConnection() }); }
export async function enqueueTask(job: ControlPlaneJob, options: JobsOptions = {}) {
  const queue = taskQueue();
  try { return await queue.add(job.type, job, { jobId: job.taskId, attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000, ...options }); }
  finally { await queue.close(); }
}
