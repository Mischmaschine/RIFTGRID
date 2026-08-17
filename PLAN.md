# RIFTGRID delivery plan

Updated: 2026-08-17

## Product boundary

RIFTGRID is a desired-state control plane for persistent game workloads on administrator-provided Kubernetes infrastructure. PostgreSQL is authoritative, Redis transports work and progress events, Kubernetes runs workloads, installer packages define deployment/configuration, and game adapters provide runtime-specific health and operations.

## DONE

- Built the pnpm/Turborepo TypeScript monorepo with Next.js web, Fastify API, BullMQ worker, PostgreSQL/Drizzle persistence, Kubernetes integration, and a versioned installer/adapter SDK.
- Preserved the existing Minecraft workload, world, configuration, StatefulSet, service, and 5 GiB PVC while evolving the product architecture.
- Reconciled the stale persisted Minecraft state through the existing task path. The previously interrupted reconciliation now reports `SUCCESS`, and `survival-01` reports `RUNNING` in RIFTGRID and the UI.
- Separated installers from adapters. Installers own manifests, schema-driven configuration, supported versions, and workload definitions; adapters own runtime-specific health and operational behavior.
- Added a versioned installer manifest and registry with provenance/status metadata and APIs for installer catalog, detail, and supported versions.
- Added additive database identity for `installer_id` and `installer_version`; the existing Minecraft row was backfilled without recreating its workload or storage.
- Added installer-first deployment with no default selection and real configuration flows for Minecraft, Custom Docker/OCI, and FiveM.
- Added generic Custom Deployment support for image, command/arguments, ports, environment variables, existing Kubernetes Secret references, persistent mounts, TCP/HTTP health checks, placement, and resource limits.
- Proved the generic path end to end by deploying `custom-web-01` from `nginx:1.27-alpine` through the same API, task, control-plane, scheduler, StatefulSet, PVC, service, and status pipeline used by Minecraft.
- Implemented the first-party FiveM installer/adapter and a Debian-based runtime image that downloads an explicit official artifact, clones official `cfx-server-data`, launches bundled txAdmin/FXServer, and requires the Cfx.re key from an existing Kubernetes Secret.
- Reorganized navigation into Deployments, Infrastructure, Operations, Extensions, and Administration. Unimplemented destinations are disabled with explanatory tooltips rather than fake pages or repeated `SOON` labels.
- Replaced placeholder screens with live Installers, Tasks, Activity, Storage, Network, Game Adapters, and Cluster pages backed by API/Kubernetes data.
- Added a real control-plane Overview with cluster health, deployment counts, player data where the adapter supports it, node CPU/RAM/storage capacity, tasks, warnings, deployment state, and recent activity.
- Finished the generic six-stage deployment wizard (`SOURCE` through `REVIEW`) with installer-driven Minecraft, Custom OCI, and FiveM configuration, organization resource limits, real placement candidates, network/storage review, and no default installer selection.
- Implemented persisted deployment templates, including creation from an existing deployment and hydration back into the generic wizard. The live `minecraft-standard` template was saved and loaded successfully without creating another workload.
- Implemented real persistent backups through tasks, the worker, Kubernetes data jobs, a dedicated per-server backup PVC, SHA-256 checksums, manual and scheduled policies, restore/delete operations, and count/age retention. Failed archive creation now performs best-effort partial-archive cleanup while preserving diagnostic history.
- Implemented managed MariaDB 11.8/MySQL 8.4 resources with Kubernetes Secret, PVC, ClusterIP Service, StatefulSet, real lifecycle observation, association to a deployment, and no password disclosure through the API or UI.
- Implemented real Users/RBAC and organization Settings pages with enable/disable, role updates, last-super-admin/self-lockout protection, deployment defaults/maximums, backup defaults, and installer channel persistence.
- Implemented real node policy mutation for maintenance/scheduling, expanded cluster/node/network/storage inventory, and adapter-aware console transport so FiveM logs cannot accidentally receive Minecraft RCON commands.
- Added an optional FiveM managed-database binding. Connection metadata is supplied as runtime environment, while `DATABASE_PASSWORD` remains a Kubernetes Secret reference.
- Diagnosed and fixed the pathological Windows pnpm relink without weakening Defender. The initiating defect was interrupted/concurrent install metadata; Defender amplified small-file work. The store was valid, the workspace graph was acyclic, and the linker configuration was stabilized with a project-local store and no implicit install-on-run.
- Kept production and development Next.js outputs separate and retained the Minecraft JVM headroom fix that prevents the prior 2 GiB-container OOM restart.

## IN PROGRESS

- FiveM deployment acceptance is implemented up to the external credential boundary. No FiveM task, StatefulSet, pod, service, or PVC has been created because a Cfx.re license key is not available.
- Managed-database provisioning is implemented, but creating a disposable live database during this milestone was not attempted after local browser and kubeconfig access were denied by the active security/usage limit.
- Backup restore is implemented and constrained to a stopped workload. Its live UI action was denied before the request started; no restore or data mutation occurred.

## VERIFIED

- Minecraft `survival-01`: RIFTGRID/UI `RUNNING`; StatefulSet `rg-73ae6d88-13e` `1/1`; pod `rg-73ae6d88-13e-0` `1/1 Ready`, `Running`, 0 restarts on `k3d-riftgrid-dev-agent-1`.
- Its original PVC `rg-73ae6d88-13e` remains `Bound` to PV `pvc-f433b1c8-ee7d-416c-b302-c6610a5edffe`, 5 GiB, and mounted by the same StatefulSet. `/data/world/level.dat` and `/data/server.properties` are present.
- Minecraft service remains `25565:30000/TCP`; `localhost:30000` is reachable. Previously saved world/configuration data, including the accepted world-border persistence check, was preserved.
- Generic `custom-web-01`: RIFTGRID `RUNNING`; pod `rg-95622dff-2a5-0` `1/1 Ready`, 0 restarts; PVC `rg-95622dff-2a5` is `Bound` at 5 GiB; `localhost:30001` returns HTTP 200.
- A real Minecraft archive `rg-73ae6d88-13e-63327387-e1a9-41b1-b950-97744703932b.tar.gz` completed as `AVAILABLE` at 222.3 MiB with SHA-256 `8fec1695656efde6cd236168148d1951ae817ef630532ac8e3a7138ebe04b8af` on the bound 10 GiB backup claim `bk-rg-73ae6d88-13e`.
- The initial archive attempt exposed read permissions on mode-0600 Minecraft files. The backup job was narrowed to `DAC_READ_SEARCH`, a second real backup succeeded, and Minecraft returned to `RUNNING`; no source PVC was replaced.
- After the stopped-workload restore precondition test was cancelled by browser policy before restore execution, Minecraft was started normally. The live RIFTGRID UI reports `RUNNING`/desired `RUNNING`; `localhost:30000` is reachable, and `custom-web-01` still returns HTTP 200 on `localhost:30001`.
- FiveM version discovery resolves the current official `LATEST RECOMMENDED` Linux artifact (build 25770 at verification time), and the local `riftgrid/fivem-server:0.1.0` image was built and imported into all three existing k3d nodes without restarting them.
- The FiveM runtime fails safely when its artifact URL or Secret-backed `CFX_LICENSE_KEY` is absent, and the UI cannot submit until a Secret name is provided.
- The live UI was inspected for the installer catalog, deploy flows, server identity, tasks, activity, storage, networking, adapters, cluster state, and disabled unfinished destinations.
- Database migration completed successfully. No pnpm reinstall, workspace relink, cluster recreation, PVC replacement, or Minecraft recreation was performed.
- Before the current operations/FiveM-database increment, quality gates ran once sequentially: typecheck 12/12 tasks; lint 12/12 tasks; tests 21/21 tasks with 25 assertions; build 12/12 tasks with 17 web routes emitted. The current API and worker watch processes restarted after the latest source edits, but new CLI gates could not start because Node hit the Windows sandbox boundary and the required retry was denied by the active usage limit.
- The production build used Next.js's supported WASM fallback because the optional native Windows SWC DLL could not load; the build completed successfully.

## BLOCKED

- **REQUIRED:** A Cfx.re server registration/license key stored in a Kubernetes Secret.
- **WHY:** FiveM requires the key to register and start a real server. RIFTGRID deliberately does not accept or persist this secret value in deployment configuration or logs.
- **WHERE TO OBTAIN:** Create/manage a key at `https://portal.cfx.re/` for the intended server/IP and comply with Cfx.re licensing requirements.
- **WHERE TO ENTER:** Create the Secret in namespace `riftgrid-servers`, then enter only its Secret name and key field in **Deploy Server → FiveM**. Do not paste the secret value into RIFTGRID's ordinary environment-variable fields.

## NEXT

1. When local tool execution is available again, run the latest typecheck, lint, tests, and build once, sequentially; then perform one non-destructive managed MariaDB acceptance deployment and inspect its readiness through RIFTGRID.
2. Perform the already implemented backup restore acceptance only through the explicit UI action while Minecraft is stopped, then verify the preserved marker and start the existing workload normally.
3. After the user supplies the Cfx.re credential, create or confirm the Kubernetes Secret without echoing its value.
4. Deploy FiveM once through **Deploy Server → FiveM**, optionally bind the managed database, and verify task success, pod readiness, persistent storage, UDP/TCP game endpoint, txAdmin onboarding, and an actual client connection.

## KNOWN LIMITATIONS

- FiveM cannot be accepted end to end without the external Cfx.re credential described above.
- The FiveM runtime image is currently built/imported locally for this development k3d cluster; it is not yet published to a production registry or pinned by digest.
- Custom Deployment Secret references require the named Kubernetes Secret to exist in `riftgrid-servers`; RIFTGRID does not create secrets from plaintext in the deployment form.
- The first failed backup remains visible as diagnostic history; its pre-fix partial archive was created before best-effort failure cleanup existed. It can be removed through the explicit Backups delete action when desired.
- Live restore acceptance and live managed-database acceptance remain pending because the browser action and direct kubeconfig read were denied by the active security/usage limit. This is an acceptance limitation, not a claimed successful result.
- The latest source increment has not received a new full quality run for the same reason; the prior complete sequential run remains valid only for the preceding milestone.
- NodePort allocation is suitable for the current local development cluster. Production ingress/load-balancing, TLS, observability, CSI-native snapshots, and external PostgreSQL/Redis secret management remain deployment-hardening work.
