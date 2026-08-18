import { Worker } from "bullmq";
import { ControlPlane } from "@riftgrid/control-plane";
import { MinecraftAdapter, MinecraftInstaller } from "@riftgrid/game-minecraft";
import { CustomDockerInstaller, FiveMAdapter, FiveMInstaller, GameAdapterRegistry, GenericWorkloadAdapter, InstallerRegistry, RustAdapter, RustInstaller, ValheimAdapter, ValheimInstaller } from "@riftgrid/game-sdk";
import { KubernetesService } from "@riftgrid/kubernetes";
import { redisConnection, TASK_QUEUE, type ControlPlaneJob } from "@riftgrid/tasks";

const adapters = new GameAdapterRegistry().register(new MinecraftAdapter()).register(new GenericWorkloadAdapter()).register(new FiveMAdapter()).register(new RustAdapter()).register(new ValheimAdapter());
const installers = new InstallerRegistry().register(new MinecraftInstaller()).register(new CustomDockerInstaller()).register(new FiveMInstaller()).register(new RustInstaller()).register(new ValheimInstaller());
const controlPlane = new ControlPlane(new KubernetesService(), adapters, installers);
const worker = new Worker<ControlPlaneJob>(TASK_QUEUE, async (job) => controlPlane.execute(job.data.taskId), { connection: redisConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4), lockDuration: 15 * 60 * 1000 });
worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`[worker] failed ${job?.id}`, error));
const scanInterval = setInterval(() => void controlPlane.scanForDrift().catch((error) => console.error("[worker] drift scan failed", error)), Number(process.env.RECONCILE_INTERVAL_MS ?? 30_000));
const backupScanInterval = setInterval(() => void controlPlane.scanScheduledBackups().catch((error) => console.error("[worker] backup schedule scan failed", error)), Number(process.env.BACKUP_SCAN_INTERVAL_MS ?? 60_000));
void controlPlane.scanForDrift().catch((error) => console.error("[worker] initial drift scan failed", error));
void controlPlane.scanScheduledBackups().catch((error) => console.error("[worker] initial backup schedule scan failed", error));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => { clearInterval(scanInterval); clearInterval(backupScanInterval); await worker.close(); process.exit(0); });
console.log("RIFTGRID worker is ready.");
