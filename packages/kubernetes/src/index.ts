import { AppsV1Api, BatchV1Api, CoreV1Api, Exec, KubeConfig, Log, StorageV1Api, type V1Job, type V1Node, type V1PersistentVolumeClaim, type V1Service, type V1StatefulSet } from "@kubernetes/client-node";
import { PassThrough } from "node:stream";
import type { GameServerDefinition } from "@riftgrid/game-sdk";
import type { NodeCandidate } from "@riftgrid/shared";
import { bytesToGiB, bytesToMiB, parseBytes, parseCpuMillicores } from "./quantity.js";

export * from "./quantity.js";

export interface ProvisionRequest {
  serverId: string;
  kubernetesName: string;
  nodeName: string;
  namespace: string;
  definition: GameServerDefinition;
  publicPorts: Array<{ name: string; port: number; protocol: "TCP" | "UDP"; containerPort: number }>;
  storageClassName?: string;
}

export interface PodObservation { podName?: string; phase?: string; ready: boolean; message?: string; }
export interface StorageClaimObservation { name: string; phase: string; capacityGiB: number; storageClassName: string | null; volumeName: string | null; serverId: string | null; }
export interface StorageInventory {
  claims: Array<StorageClaimObservation & { accessModes: string[]; provider: string; volumePhase: string | null }>;
  volumes: Array<{ name: string; phase: string; capacityGiB: number; storageClassName: string | null; claimName: string | null; provider: string }>;
  storageClasses: Array<{ name: string; provisioner: string; reclaimPolicy: string; volumeBindingMode: string }>;
}
export interface NetworkServiceObservation { name: string; serverId: string | null; type: string; clusterIp: string | null; nodeName: string | null; ports: Array<{ name: string; protocol: string; servicePort: number; nodePort: number | null; targetPort: string | number | null }>; }
export interface BackupArchiveResult { sizeBytes: number; checksum: string; storageClaim: string; }
export interface ManagedDatabaseRequest { namespace: string; kubernetesName: string; engine: "MARIADB" | "MYSQL"; databaseName: string; username: string; password: string; rootPassword: string; storageGiB: number; nodeName?: string; }
export interface KubernetesGateway {
  discoverNodes(): Promise<NodeCandidate[]>;
  ensureWorkload(request: ProvisionRequest): Promise<void>;
  scaleWorkload(namespace: string, name: string, replicas: number): Promise<void>;
  observePod(namespace: string, name: string): Promise<PodObservation>;
  recentLogs(namespace: string, name: string, lines?: number): Promise<string>;
  followLogs(namespace: string, name: string, onLine: (stream: "stdout" | "stderr", line: string) => void, signal: AbortSignal): Promise<void>;
  exec(namespace: string, name: string, command: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  createBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<BackupArchiveResult>;
  restoreBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<void>;
  deleteBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<void>;
}

function workloadLabels(serverId: string, name: string) { return { "app.kubernetes.io/name": "riftgrid-world", "app.kubernetes.io/managed-by": "riftgrid", "riftgrid.io/server-id": serverId, "riftgrid.io/workload": name }; }

function conditionReady(node: V1Node): boolean { return node.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") ?? false; }

function timestampMillis(value: unknown): number {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function timestampIso(value: unknown): string | null {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : null;
}

export class KubernetesService implements KubernetesGateway {
  private readonly config = new KubeConfig();
  private readonly core: CoreV1Api;
  private readonly apps: AppsV1Api;
  private readonly batch: BatchV1Api;
  private readonly storage: StorageV1Api;
  private readonly execClient: Exec;
  private readonly logClient: Log;

  constructor() {
    if (process.env.KUBERNETES_SERVICE_HOST) this.config.loadFromCluster(); else this.config.loadFromDefault();
    this.core = this.config.makeApiClient(CoreV1Api);
    this.apps = this.config.makeApiClient(AppsV1Api);
    this.batch = this.config.makeApiClient(BatchV1Api);
    this.storage = this.config.makeApiClient(StorageV1Api);
    this.execClient = new Exec(this.config);
    this.logClient = new Log(this.config);
  }

  async discoverNodes(): Promise<NodeCandidate[]> {
    const [nodeResponse, podResponse, eventResponse] = await Promise.all([this.core.listNode(), this.core.listPodForAllNamespaces(), this.core.listEventForAllNamespaces()]);
    const pods = podResponse.body.items.filter((pod) => pod.status?.phase === "Running" || pod.status?.phase === "Pending");
    return nodeResponse.body.items.map((node) => {
      const name = node.metadata?.name ?? "unknown";
      const nodePods = pods.filter((pod) => pod.spec?.nodeName === name);
      let allocatedCpu = 0; let allocatedMemory = 0;
      for (const pod of nodePods) for (const container of pod.spec?.containers ?? []) {
        allocatedCpu += parseCpuMillicores(container.resources?.requests?.cpu);
        allocatedMemory += bytesToMiB(parseBytes(container.resources?.requests?.memory));
      }
      const allocatable = node.status?.allocatable ?? node.status?.capacity ?? {};
      const taints = (node.spec?.taints ?? []).filter((taint) => taint.effect === "NoSchedule" || taint.effect === "NoExecute").map((taint) => `${taint.key}${taint.value ? `=${taint.value}` : ""}:${taint.effect}`);
      const events = eventResponse.body.items.filter((event) => event.involvedObject.kind === "Node" && event.involvedObject.name === name).sort((left, right) => timestampMillis(right.lastTimestamp ?? right.eventTime) - timestampMillis(left.lastTimestamp ?? left.eventTime)).slice(0, 8).map((event) => ({ type: event.type ?? "Normal", reason: event.reason ?? "Event", message: event.message ?? "", timestamp: timestampIso(event.lastTimestamp ?? event.eventTime) }));
      const internalIp = node.status?.addresses?.find((address) => address.type === "InternalIP")?.address;
      const kubernetesVersion = node.status?.nodeInfo?.kubeletVersion;
      return {
        id: node.metadata?.uid ?? name, name, healthy: conditionReady(node), maintenance: node.metadata?.labels?.["riftgrid.io/maintenance"] === "true",
        schedulingEnabled: !node.spec?.unschedulable, capacity: { cpuMillicores: parseCpuMillicores(allocatable.cpu), memoryMiB: bytesToMiB(parseBytes(allocatable.memory)), storageGiB: bytesToGiB(parseBytes(allocatable["ephemeral-storage"])) },
        allocated: { cpuMillicores: allocatedCpu, memoryMiB: allocatedMemory, storageGiB: 0 }, labels: node.metadata?.labels ?? {}, taints, workloadCount: nodePods.filter((pod) => pod.metadata?.labels?.["app.kubernetes.io/managed-by"] === "riftgrid").length, ...(internalIp ? { internalIp } : {}), ...(kubernetesVersion ? { kubernetesVersion } : {}), events,
      };
    });
  }

  async storageInventory(namespace: string): Promise<StorageClaimObservation[]> {
    const response = await this.core.listNamespacedPersistentVolumeClaim(namespace);
    return response.body.items.map((claim) => ({
      name: claim.metadata?.name ?? "unknown",
      phase: claim.status?.phase ?? "Unknown",
      capacityGiB: bytesToGiB(parseBytes(claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage)),
      storageClassName: claim.spec?.storageClassName ?? null,
      volumeName: claim.spec?.volumeName ?? null,
      serverId: claim.metadata?.labels?.["riftgrid.io/server-id"] ?? null,
    }));
  }

  async storageOverview(namespace: string): Promise<StorageInventory> {
    const [claimResponse, volumeResponse, classResponse] = await Promise.all([
      this.core.listNamespacedPersistentVolumeClaim(namespace),
      this.core.listPersistentVolume(),
      this.storage.listStorageClass(),
    ]);
    const volumeByName = new Map(volumeResponse.body.items.map((volume) => [volume.metadata?.name, volume]));
    const providerFor = (provisioner?: string) => provisioner?.includes("local-path") ? "Local Path" : provisioner?.includes("csi") ? `CSI · ${provisioner}` : provisioner ?? "Unknown";
    const classByName = new Map(classResponse.body.items.map((storageClass) => [storageClass.metadata?.name, storageClass.provisioner]));
    return {
      claims: claimResponse.body.items.map((claim) => {
        const volume = volumeByName.get(claim.spec?.volumeName);
        return {
          name: claim.metadata?.name ?? "unknown", phase: claim.status?.phase ?? "Unknown", capacityGiB: bytesToGiB(parseBytes(claim.status?.capacity?.storage ?? claim.spec?.resources?.requests?.storage)), storageClassName: claim.spec?.storageClassName ?? null, volumeName: claim.spec?.volumeName ?? null, serverId: claim.metadata?.labels?.["riftgrid.io/server-id"] ?? null,
          accessModes: claim.status?.accessModes ?? claim.spec?.accessModes ?? [], volumePhase: volume?.status?.phase ?? null, provider: providerFor(classByName.get(claim.spec?.storageClassName)),
        };
      }),
      volumes: volumeResponse.body.items.filter((volume) => volume.spec?.claimRef?.namespace === namespace).map((volume) => ({ name: volume.metadata?.name ?? "unknown", phase: volume.status?.phase ?? "Unknown", capacityGiB: bytesToGiB(parseBytes(volume.spec?.capacity?.storage)), storageClassName: volume.spec?.storageClassName ?? null, claimName: volume.spec?.claimRef?.name ?? null, provider: providerFor(classByName.get(volume.spec?.storageClassName)) })),
      storageClasses: classResponse.body.items.map((storageClass) => ({ name: storageClass.metadata?.name ?? "unknown", provisioner: storageClass.provisioner, reclaimPolicy: storageClass.reclaimPolicy ?? "Delete", volumeBindingMode: storageClass.volumeBindingMode ?? "Immediate" })),
    };
  }

  async networkInventory(namespace: string): Promise<NetworkServiceObservation[]> {
    const [services, pods] = await Promise.all([this.core.listNamespacedService(namespace), this.core.listNamespacedPod(namespace)]);
    return services.body.items.map((service) => {
      const serverId = service.metadata?.labels?.["riftgrid.io/server-id"] ?? null;
      const nodeName = pods.body.items.find((pod) => serverId && pod.metadata?.labels?.["riftgrid.io/server-id"] === serverId)?.spec?.nodeName ?? null;
      return { name: service.metadata?.name ?? "unknown", serverId, type: service.spec?.type ?? "ClusterIP", clusterIp: service.spec?.clusterIP ?? null, nodeName, ports: (service.spec?.ports ?? []).map((port) => ({ name: port.name ?? "unnamed", protocol: port.protocol ?? "TCP", servicePort: port.port, nodePort: port.nodePort ?? null, targetPort: port.targetPort ?? null })) };
    });
  }

  async patchNodePolicy(name: string, policy: { maintenance?: boolean; schedulingEnabled?: boolean }): Promise<void> {
    const current = await this.core.readNode(name);
    current.body.metadata ??= {};
    current.body.metadata.labels = { ...current.body.metadata.labels, ...(policy.maintenance !== undefined ? { "riftgrid.io/maintenance": String(policy.maintenance) } : {}) };
    current.body.spec ??= {};
    if (policy.schedulingEnabled !== undefined) current.body.spec.unschedulable = !policy.schedulingEnabled;
    await this.core.replaceNode(name, current.body);
  }

  async createBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<BackupArchiveResult> {
    const backupClaim = await this.ensureBackupClaim(namespace, sourceClaim, storageGiB);
    const jobName = `backup-${archiveName.replace(/[^a-z0-9-]/g, "-").slice(0, 43)}`;
    await this.runDataJob(namespace, jobName, sourceClaim, backupClaim, nodeName, ["sh", "-c", `set -eu; tar -czf /backups/${archiveName} -C /source .; bytes=$(wc -c < /backups/${archiveName}); sum=$(sha256sum /backups/${archiveName} | cut -d ' ' -f 1); printf '%s %s' "$bytes" "$sum"`], true);
    const output = await this.readJobLog(namespace, jobName);
    const match = output.trim().match(/(\d+)\s+([a-f0-9]{64})$/i);
    if (!match?.[1] || !match[2]) throw new Error(`Backup archive metadata was not produced: ${output.slice(-300)}`);
    return { sizeBytes: Number(match[1]), checksum: match[2], storageClaim: backupClaim };
  }

  async restoreBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<void> {
    const backupClaim = await this.ensureBackupClaim(namespace, sourceClaim, storageGiB);
    const jobName = `restore-${archiveName.replace(/[^a-z0-9-]/g, "-").slice(0, 42)}`;
    await this.runDataJob(namespace, jobName, sourceClaim, backupClaim, nodeName, ["sh", "-c", `set -eu; test -f /backups/${archiveName}; find /source -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -xzf /backups/${archiveName} -C /source`], false);
  }

  async deleteBackup(namespace: string, sourceClaim: string, nodeName: string, archiveName: string, storageGiB: number): Promise<void> {
    const backupClaim = await this.ensureBackupClaim(namespace, sourceClaim, storageGiB);
    const jobName = `delete-${archiveName.replace(/[^a-z0-9-]/g, "-").slice(0, 43)}`;
    await this.runDataJob(namespace, jobName, sourceClaim, backupClaim, nodeName, ["sh", "-c", `set -eu; rm -f /backups/${archiveName}`], true, true);
  }

  async ensureManagedDatabase(request: ManagedDatabaseRequest): Promise<void> {
    await this.ensureNamespace(request.namespace);
    const labels = { "app.kubernetes.io/name": "riftgrid-database", "app.kubernetes.io/managed-by": "riftgrid", "riftgrid.io/database": request.kubernetesName };
    const secret = { apiVersion: "v1", kind: "Secret", metadata: { name: `${request.kubernetesName}-credentials`, namespace: request.namespace, labels }, type: "Opaque", stringData: { "root-password": request.rootPassword, "user-password": request.password } };
    try { await this.core.readNamespacedSecret(secret.metadata.name, request.namespace); } catch (error: any) { if (error?.response?.statusCode !== 404) throw error; await this.core.createNamespacedSecret(request.namespace, secret); }
    await this.upsertPvc(request.namespace, { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: request.kubernetesName, namespace: request.namespace, labels }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: `${request.storageGiB}Gi` } } } });
    await this.upsertService(request.namespace, { apiVersion: "v1", kind: "Service", metadata: { name: request.kubernetesName, namespace: request.namespace, labels }, spec: { type: "ClusterIP", selector: labels, ports: [{ name: "mysql", port: 3306, targetPort: 3306, protocol: "TCP" }] } });
    const prefix = request.engine === "MARIADB" ? "MARIADB" : "MYSQL";
    const image = request.engine === "MARIADB" ? "mariadb:11.8" : "mysql:8.4";
    const statefulSet: V1StatefulSet = {
      apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: request.kubernetesName, namespace: request.namespace, labels },
      spec: {
        serviceName: request.kubernetesName, replicas: 1, selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: {
          ...(request.nodeName ? { nodeSelector: { "kubernetes.io/hostname": request.nodeName } } : {}),
          terminationGracePeriodSeconds: 60, securityContext: { seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "database", image, imagePullPolicy: "IfNotPresent",
            env: [{ name: `${prefix}_DATABASE`, value: request.databaseName }, { name: `${prefix}_USER`, value: request.username }, { name: `${prefix}_PASSWORD`, valueFrom: { secretKeyRef: { name: secret.metadata.name, key: "user-password" } } }, { name: `${prefix}_ROOT_PASSWORD`, valueFrom: { secretKeyRef: { name: secret.metadata.name, key: "root-password" } } }],
            ports: [{ name: "mysql", containerPort: 3306, protocol: "TCP" }], volumeMounts: [{ name: "data", mountPath: "/var/lib/mysql" }],
            resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1000m", memory: "1024Mi" } },
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"], add: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"] } }, readinessProbe: { tcpSocket: { port: 3306 }, initialDelaySeconds: 10, periodSeconds: 5, failureThreshold: 18 },
          }],
          volumes: [{ name: "data", persistentVolumeClaim: { claimName: request.kubernetesName } }],
        } },
      },
    };
    await this.upsertStatefulSet(request.namespace, statefulSet);
  }

  async observeManagedDatabase(namespace: string, name: string): Promise<PodObservation> {
    const pods = await this.core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `riftgrid.io/database=${name}`);
    const pod = pods.body.items[0];
    if (!pod) return { ready: false, message: "Database pod has not been created" };
    const ready = pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") ?? false;
    return { ready, ...(pod.metadata?.name ? { podName: pod.metadata.name } : {}), ...(pod.status?.phase ? { phase: pod.status.phase } : {}), ...(!ready ? { message: pod.status?.containerStatuses?.[0]?.state?.waiting?.reason ?? pod.status?.phase ?? "Pending" } : {}) };
  }

  async ensureWorkload(request: ProvisionRequest): Promise<void> {
    await this.ensureNamespace(request.namespace);
    const labels = workloadLabels(request.serverId, request.kubernetesName);
    const pvc: V1PersistentVolumeClaim = { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: request.kubernetesName, namespace: request.namespace, labels }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: `${request.definition.resources.storageGiB}Gi` } }, ...(request.storageClassName ? { storageClassName: request.storageClassName } : {}) } };
    const service: V1Service = { apiVersion: "v1", kind: "Service", metadata: { name: request.kubernetesName, namespace: request.namespace, labels }, spec: { type: process.env.MINECRAFT_SERVICE_TYPE ?? "NodePort", selector: labels, ports: request.publicPorts.map((port) => ({ name: port.name, port: port.containerPort, targetPort: port.containerPort, nodePort: port.port, protocol: port.protocol })) } };
    const definition = request.definition;
    const statefulSet: V1StatefulSet = {
      apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: request.kubernetesName, namespace: request.namespace, labels },
      spec: { serviceName: request.kubernetesName, replicas: 1, selector: { matchLabels: labels }, template: { metadata: { labels }, spec: {
        nodeSelector: { "kubernetes.io/hostname": request.nodeName }, terminationGracePeriodSeconds: definition.shutdownGraceSeconds,
        securityContext: { seccompProfile: { type: "RuntimeDefault" } }, containers: [{ name: "game", image: definition.image, imagePullPolicy: "IfNotPresent", ...(definition.command ? { command: definition.command } : {}), ...(definition.args ? { args: definition.args } : {}), env: [...Object.entries(definition.environment).map(([name, value]) => ({ name, value })), ...(definition.secretEnvironment ?? []).map((reference) => ({ name: reference.name, valueFrom: { secretKeyRef: { name: reference.secretName, key: reference.key } } }))], ports: definition.ports.map((port) => ({ name: port.name, containerPort: port.containerPort, protocol: port.protocol })), volumeMounts: [{ name: "data", mountPath: definition.dataMountPath }], resources: { requests: { cpu: `${definition.resources.cpuMillicores}m`, memory: `${definition.resources.memoryMiB}Mi` }, limits: { cpu: `${definition.resources.cpuMillicores}m`, memory: `${definition.resources.memoryMiB}Mi` } }, securityContext: { allowPrivilegeEscalation: false, privileged: false, readOnlyRootFilesystem: definition.security.readOnlyRootFilesystem, capabilities: { drop: ["ALL"], ...(!definition.security.runAsNonRoot ? { add: ["CHOWN", "SETUID", "SETGID"] } : {}) }, ...(definition.security.runAsNonRoot ? { runAsNonRoot: true } : {}) }, readinessProbe: definition.probe.kind === "tcp" ? { tcpSocket: { port: definition.probe.port }, initialDelaySeconds: definition.probe.initialDelaySeconds, periodSeconds: definition.probe.periodSeconds, failureThreshold: definition.probe.failureThreshold } : { httpGet: { port: definition.probe.port, path: definition.probe.path ?? "/" }, initialDelaySeconds: definition.probe.initialDelaySeconds, periodSeconds: definition.probe.periodSeconds, failureThreshold: definition.probe.failureThreshold } }], volumes: [{ name: "data", persistentVolumeClaim: { claimName: request.kubernetesName } }],
      } } } };
    await this.upsertPvc(request.namespace, pvc);
    await this.upsertService(request.namespace, service);
    await this.upsertStatefulSet(request.namespace, statefulSet);
  }

  async scaleWorkload(namespace: string, name: string, replicas: number): Promise<void> {
    const current = await this.apps.readNamespacedStatefulSet(name, namespace);
    current.body.spec!.replicas = replicas;
    await this.apps.replaceNamespacedStatefulSet(name, namespace, current.body);
  }

  async observePod(namespace: string, name: string): Promise<PodObservation> {
    const pods = await this.core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `riftgrid.io/workload=${name}`);
    const pod = pods.body.items[0];
    if (!pod) return { ready: false, message: "Workload pod has not been created" };
    const ready = pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") ?? false;
    const waiting = pod.status?.containerStatuses?.find((status) => status.state?.waiting)?.state?.waiting;
    return {
      ready,
      ...(pod.metadata?.name ? { podName: pod.metadata.name } : {}),
      ...(pod.status?.phase ? { phase: pod.status.phase } : {}),
      ...(waiting ? { message: `${waiting.reason ?? "Waiting"}: ${waiting.message ?? ""}`.trim() } : {}),
    };
  }

  async recentLogs(namespace: string, name: string, lines = 250): Promise<string> {
    const pod = await this.requirePod(namespace, name);
    const response = await this.core.readNamespacedPodLog(pod, namespace, "game", false, undefined, undefined, undefined, false, undefined, lines, true);
    return response.body;
  }

  async followLogs(namespace: string, name: string, onLine: (stream: "stdout" | "stderr", line: string) => void, signal: AbortSignal): Promise<void> {
    const pod = await this.requirePod(namespace, name);
    const stream = new PassThrough(); let pending = "";
    stream.on("data", (chunk: Buffer) => { pending += chunk.toString("utf8"); const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ""; for (const line of lines) if (line) onLine("stdout", line); });
    const request = await this.logClient.log(namespace, pod, "game", stream, { follow: true, timestamps: true });
    signal.addEventListener("abort", () => request.abort(), { once: true });
    await new Promise<void>((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); signal.addEventListener("abort", () => resolve(), { once: true }); });
  }

  async exec(namespace: string, name: string, command: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    const pod = await this.requirePod(namespace, name); const stdout = new PassThrough(); const stderr = new PassThrough(); let out = ""; let err = "";
    stdout.on("data", (chunk) => { out += chunk.toString(); }); stderr.on("data", (chunk) => { err += chunk.toString(); });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Kubernetes exec timed out")), 30_000);
      void this.execClient.exec(namespace, pod, "game", command, stdout, stderr, null, false, (status) => {
        clearTimeout(timeout);
        if (status.status !== "Success") err += status.message ?? "Command failed";
        resolve();
      }).catch((error) => { clearTimeout(timeout); reject(error); });
    });
    return { stdout: out, stderr: err, code: err ? 1 : 0 };
  }

  private async requirePod(namespace: string, name: string): Promise<string> { const observation = await this.observePod(namespace, name); if (!observation.podName) throw new Error(observation.message); return observation.podName; }
  private async ensureBackupClaim(namespace: string, sourceClaim: string, sourceStorageGiB: number): Promise<string> {
    const name = `bk-${sourceClaim}`.slice(0, 63);
    await this.upsertPvc(namespace, { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name, namespace, labels: { "app.kubernetes.io/name": "riftgrid-backup-store", "app.kubernetes.io/managed-by": "riftgrid", "riftgrid.io/backup-for": sourceClaim } }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: `${Math.max(10, sourceStorageGiB * 2)}Gi` } } } });
    return name;
  }
  private async runDataJob(namespace: string, name: string, sourceClaim: string, backupClaim: string, nodeName: string, command: string[], sourceReadOnly: boolean, backupReadOnly = false): Promise<void> {
    const labels = { "app.kubernetes.io/name": "riftgrid-data-operation", "app.kubernetes.io/managed-by": "riftgrid", "riftgrid.io/data-operation": name };
    const requiredCapabilities = sourceReadOnly && !backupReadOnly ? ["DAC_READ_SEARCH"] : sourceReadOnly ? [] : ["DAC_OVERRIDE", "CHOWN", "FOWNER"];
    const body: V1Job = { apiVersion: "batch/v1", kind: "Job", metadata: { name, namespace, labels }, spec: { backoffLimit: 1, ttlSecondsAfterFinished: 600, template: { metadata: { labels }, spec: { restartPolicy: "Never", nodeSelector: { "kubernetes.io/hostname": nodeName }, securityContext: { seccompProfile: { type: "RuntimeDefault" } }, containers: [{ name: "archive", image: "busybox:1.36.1", imagePullPolicy: "IfNotPresent", command, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"], ...(requiredCapabilities.length ? { add: requiredCapabilities } : {}) } }, volumeMounts: [{ name: "source", mountPath: "/source", readOnly: sourceReadOnly }, { name: "backups", mountPath: "/backups", readOnly: backupReadOnly }] }], volumes: [{ name: "source", persistentVolumeClaim: { claimName: sourceClaim, readOnly: sourceReadOnly } }, { name: "backups", persistentVolumeClaim: { claimName: backupClaim, readOnly: backupReadOnly } }] } } } };
    try { await this.batch.readNamespacedJob(name, namespace); } catch (error: any) { if (error?.response?.statusCode !== 404) throw error; await this.batch.createNamespacedJob(namespace, body); }
    await this.waitForJob(namespace, name);
  }
  private async waitForJob(namespace: string, name: string): Promise<void> {
    const timeoutAt = Date.now() + Number(process.env.DATA_JOB_TIMEOUT_MS ?? 900_000);
    while (Date.now() < timeoutAt) {
      const job = await this.batch.readNamespacedJob(name, namespace);
      if ((job.body.status?.succeeded ?? 0) > 0) return;
      if ((job.body.status?.failed ?? 0) > (job.body.spec?.backoffLimit ?? 0)) throw new Error(`Kubernetes data job ${name} failed: ${await this.readJobLog(namespace, name)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Kubernetes data job ${name} timed out`);
  }
  private async readJobLog(namespace: string, name: string): Promise<string> {
    const pods = await this.core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, `job-name=${name}`);
    const podName = pods.body.items[0]?.metadata?.name;
    if (!podName) return "No job pod was created";
    try { return (await this.core.readNamespacedPodLog(podName, namespace, "archive")).body; } catch (error) { return error instanceof Error ? error.message : "Job logs unavailable"; }
  }
  private async ensureNamespace(namespace: string) { try { await this.core.readNamespace(namespace); } catch (error: any) { if (error?.response?.statusCode !== 404) throw error; await this.core.createNamespace({ apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels: { "app.kubernetes.io/managed-by": "riftgrid" } } }); } }
  private async upsertPvc(namespace: string, body: V1PersistentVolumeClaim) {
    try {
      const current = await this.core.readNamespacedPersistentVolumeClaim(body.metadata!.name!, namespace);
      const desiredStorage = body.spec?.resources?.requests?.storage;
      const currentStorage = current.body.spec?.resources?.requests?.storage;
      if (!desiredStorage || desiredStorage === currentStorage) return;
      current.body.spec!.resources!.requests = { ...current.body.spec!.resources!.requests, storage: desiredStorage };
      await this.core.replaceNamespacedPersistentVolumeClaim(body.metadata!.name!, namespace, current.body);
    } catch (error: any) {
      if (error?.response?.statusCode !== 404) throw error;
      await this.core.createNamespacedPersistentVolumeClaim(namespace, body);
    }
  }
  private async upsertService(namespace: string, body: V1Service) { try { const current = await this.core.readNamespacedService(body.metadata!.name!, namespace); if (current.body.metadata?.resourceVersion) body.metadata!.resourceVersion = current.body.metadata.resourceVersion; if (current.body.spec?.clusterIP) body.spec!.clusterIP = current.body.spec.clusterIP; if (current.body.spec?.clusterIPs) body.spec!.clusterIPs = current.body.spec.clusterIPs; await this.core.replaceNamespacedService(body.metadata!.name!, namespace, body); } catch (error: any) { if (error?.response?.statusCode !== 404) throw error; await this.core.createNamespacedService(namespace, body); } }
  private async upsertStatefulSet(namespace: string, body: V1StatefulSet) { try { const current = await this.apps.readNamespacedStatefulSet(body.metadata!.name!, namespace); if (current.body.metadata?.resourceVersion) body.metadata!.resourceVersion = current.body.metadata.resourceVersion; await this.apps.replaceNamespacedStatefulSet(body.metadata!.name!, namespace, body); } catch (error: any) { if (error?.response?.statusCode !== 404) throw error; await this.apps.createNamespacedStatefulSet(namespace, body); } }
}
